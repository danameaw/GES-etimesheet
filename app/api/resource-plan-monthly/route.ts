import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pm", "pd", "admin"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  // Fetch projects (PM sees own, PD/admin sees all)
  const projectWhere = role === "pm" ? { managerId: empDbId, isActive: true } : { isActive: true };
  const projects = await prisma.project.findMany({
    where: projectWhere,
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
    orderBy: { projectNumber: "asc" },
  });

  // All distinct departments from active employees
  const empDepts = await prisma.employee.findMany({
    where: { isActive: true },
    select: { department: true },
    distinct: ["department"],
    orderBy: { department: "asc" },
  });
  const departments = empDepts.map((e) => e.department);

  if (!projectId) {
    return NextResponse.json({ projects, departments, plans: [] });
  }

  // Fetch monthly plans for the selected project
  const plans = await prisma.resourcePlanMonthly.findMany({
    where: { projectId },
    orderBy: [{ year: "asc" }, { month: "asc" }, { department: "asc" }],
  });

  // Fetch actual hours per department per month from approved/submitted timesheets for this project
  const actualEntries = await prisma.timesheetEntry.findMany({
    where: { projectId },
    include: {
      timesheet: {
        include: { employee: { select: { department: true } } },
      },
    },
  });

  // Aggregate actuals by (department, year, month)
  const actualMap = new Map<string, number>();
  for (const e of actualEntries) {
    const d = new Date(e.timesheet.weekStart);
    const year  = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const dept  = e.timesheet.employee.department;
    const key   = `${dept}|${year}|${month}`;
    actualMap.set(key, (actualMap.get(key) || 0) + e.totalHrs);
  }

  const actuals = Array.from(actualMap.entries()).map(([key, hrs]) => {
    const [dept, y, m] = key.split("|");
    return { department: dept, year: Number(y), month: Number(m), actualHrs: hrs };
  });

  return NextResponse.json({ projects, departments, plans, actuals });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pm", "admin"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { projectId, department, year, month, plannedHrs } = body;

  if (!projectId || !department || !year || !month)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  // Verify PM owns the project
  if (role === "pm") {
    const proj = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
    if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
  }

  const plan = await prisma.resourcePlanMonthly.upsert({
    where: { projectId_department_year_month: { projectId, department, year, month } },
    update: { plannedHrs: Number(plannedHrs), createdBy: empDbId },
    create: { projectId, department, year, month, plannedHrs: Number(plannedHrs), createdBy: empDbId },
  });
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pm", "pd", "admin"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { action, projectId } = await req.json();

  if (action === "submit") {
    if (!["pm", "admin"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await prisma.resourcePlanMonthly.updateMany({
      where: { projectId },
      data: { planStatus: "submitted" },
    });
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  if (action === "approve" || action === "reject") {
    if (role !== "pd")
      return NextResponse.json({ error: "Only PD can approve" }, { status: 403 });
    const newStatus = action === "approve" ? "approved" : "draft";
    await prisma.resourcePlanMonthly.updateMany({
      where: { projectId },
      data: { planStatus: newStatus },
    });
    return NextResponse.json({ success: true, planStatus: newStatus });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["pm", "admin"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.resourcePlanMonthly.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
