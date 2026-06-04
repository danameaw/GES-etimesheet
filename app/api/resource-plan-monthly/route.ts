import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const PROJECT_INCLUDE = {
  manager: { select: { id: true, name: true, employeeId: true } },
  pd:      { select: { id: true, name: true, employeeId: true } },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role     = (session.user as any).role;
  const empDbId  = (session.user as any).id;

  if (!["pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  // forApproval=1 → Approval page context: PD/admin see ALL non-draft projects
  // (bypasses pdId filter so revision_requested projects always surface)
  const forApproval = searchParams.get("forApproval") === "1";

  // Build project filter:
  // PM        → own projects (managerId = empDbId)
  // PD normal → projects where pdId = empDbId
  // PD/admin forApproval → all active non-draft projects
  // admin     → all active projects
  let projectWhere: any = { isActive: true };
  if (role === "pd")  projectWhere = { managerId: empDbId, isActive: true };
  if (role === "ges_management") {
    projectWhere = forApproval
      ? { isActive: true, planStatus: { not: "draft" } }
      : { pdId: empDbId, isActive: true };
  }
  if (role === "admin" && forApproval) {
    projectWhere = { isActive: true, planStatus: { not: "draft" } };
  }

  const projects = await prisma.project.findMany({
    where: projectWhere,
    include: PROJECT_INCLUDE,
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

  // Fetch actual hours per department per month from timesheets for this project
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
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pd", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { projectId, department, year, month, plannedHrs } = body;

  if (!projectId || !department || !year || !month)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  // Verify PM owns the project + plan is editable
  if (role === "pd") {
    const proj = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
    if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
    if (proj.planStatus !== "draft")
      return NextResponse.json({ error: "Plan is locked. Request revision first." }, { status: 403 });
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
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { action, projectId } = await req.json();
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // PM submits plan
  if (action === "submit") {
    if (!["pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Verify PM owns project
    if (role === "pd") {
      const proj = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
      if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
    }

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  // PM requests revision of submitted/approved plan
  if (action === "revision_request") {
    if (!["pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (role === "pd") {
      const proj = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
      if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
    }

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "revision_requested" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "revision_requested" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "revision_requested" } });
    return NextResponse.json({ success: true, planStatus: "revision_requested" });
  }

  // PD approves plan (submitted → approved)
  if (action === "approve") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Only PD can approve" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "approved" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
    return NextResponse.json({ success: true, planStatus: "approved" });
  }

  // PD rejects plan (submitted → draft — send back to PM to revise)
  if (action === "reject") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Only PD can reject" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    return NextResponse.json({ success: true, planStatus: "draft" });
  }

  // PD approves revision request (revision_requested → draft — PM can now edit)
  if (action === "approve_revision") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Only PD can approve revision" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    return NextResponse.json({ success: true, planStatus: "draft" });
  }

  // PD rejects revision request (revision_requested → submitted — stays locked)
  if (action === "reject_revision") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Only PD can reject revision" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["pd", "admin", "md"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.resourcePlanMonthly.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
