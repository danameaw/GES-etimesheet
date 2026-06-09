import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  if (!["pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // All plan entries for this project with employee details
  const plans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: { projectId },
    include: {
      employee: {
        select: { id: true, employeeId: true, name: true, department: true, position: true },
      },
    },
    orderBy: [
      { employee: { department: "asc" } },
      { employee: { name: "asc" } },
      { year: "asc" },
      { month: "asc" },
    ],
  });

  // Distinct employees assigned
  const assignedEmployeeIds = Array.from(new Set(plans.map((p) => p.employeeId)));

  // Actual hours per employee per month for this project
  const actualEntries = await prisma.timesheetEntry.findMany({
    where: { projectId, timesheet: { employee: { isActive: true } } },
    include: { timesheet: { select: { weekStart: true, employeeId: true } } },
  });

  const actualMap = new Map<string, number>();
  for (const e of actualEntries) {
    const d = new Date(e.timesheet.weekStart);
    const year  = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const key = `${e.timesheet.employeeId}|${year}|${month}`;
    actualMap.set(key, (actualMap.get(key) || 0) + e.totalHrs);
  }
  const actuals = Array.from(actualMap.entries()).map(([key, hrs]) => {
    const [empId, y, m] = key.split("|");
    return { employeeId: empId, year: Number(y), month: Number(m), actualHrs: hrs };
  });

  // All active employees for dropdown
  const allEmployees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: { id: true, employeeId: true, name: true, department: true, position: true },
  });

  return NextResponse.json({ plans, actuals, allEmployees, assignedEmployeeIds });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pd", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { projectId, employeeId, year, month, plannedHrs } = body;

  if (!projectId || !employeeId || !year || !month)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  // Verify project ownership + plan is editable
  const proj = await prisma.project.findUnique({ where: { id: projectId } });
  if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (role === "pd" && proj.pdId !== empDbId && proj.managerId !== empDbId)
    return NextResponse.json({ error: "Not your project" }, { status: 403 });

  if (role !== "admin" && proj.planStatus !== "draft")
    return NextResponse.json({ error: "Plan is locked. Request revision first." }, { status: 403 });

  const plan = await prisma.resourcePlanEmployeeMonthly.upsert({
    where: { projectId_employeeId_year_month: { projectId, employeeId, year, month } },
    update: { plannedHrs: Number(plannedHrs), createdBy: empDbId },
    create: { projectId, employeeId, year, month, plannedHrs: Number(plannedHrs), createdBy: empDbId },
  });

  return NextResponse.json({ plan });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pd", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId  = searchParams.get("projectId");
  const employeeId = searchParams.get("employeeId");

  if (!projectId || !employeeId)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });

  // Verify project ownership + plan is editable
  const proj = await prisma.project.findUnique({ where: { id: projectId } });
  if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (role === "pd" && proj.pdId !== empDbId && proj.managerId !== empDbId)
    return NextResponse.json({ error: "Not your project" }, { status: 403 });

  if (role !== "admin" && proj.planStatus !== "draft")
    return NextResponse.json({ error: "Plan is locked. Request revision first." }, { status: 403 });

  await prisma.resourcePlanEmployeeMonthly.deleteMany({ where: { projectId, employeeId } });
  return NextResponse.json({ success: true });
}
