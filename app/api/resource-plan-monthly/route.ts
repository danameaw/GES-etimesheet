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

  if (!["pd", "ges_pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  // forApproval=1 → Approval page context: PD/admin see ALL non-draft projects
  // (bypasses pdId filter so revision_requested projects always surface)
  const forApproval = searchParams.get("forApproval") === "1";

  // Build project filter:
  // pd normal      → projects where pdId = empDbId
  // pd forApproval → all active non-draft projects
  // ges_management → same as pd
  // admin / md     → all active projects (forApproval: non-draft only)
  let projectWhere: any = { isActive: true };
  if (role === "pd" || role === "ges_pd" || role === "ges_management") {
    projectWhere = forApproval
      ? { isActive: true, planStatus: { not: "draft" } }
      : { pdId: empDbId, isActive: true };
  }
  if ((role === "admin" || role === "md") && forApproval) {
    projectWhere = { isActive: true, planStatus: { not: "draft" } };
  }

  const projects = await prisma.project.findMany({
    where: projectWhere,
    include: PROJECT_INCLUDE,
    orderBy: { projectNumber: "asc" },
  });

  const departments = [
    "Management", "Project Management", "Engineering", "Construction",
    "Project Control", "Grid Connection", "BOI", "Admin", "Procurement", "HSE",
  ];

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

  // Fetch dept approval status for this project
  const deptApprovals = await prisma.resourcePlanDeptApproval.findMany({
    where: { projectId },
    orderBy: { department: "asc" },
    select: { department: true, status: true },
  });

  return NextResponse.json({ projects, departments, plans, actuals, deptApprovals });
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

  // Verify plan is editable (draft only)
  if (role === "pd") {
    const proj = await prisma.project.findFirst({ where: { id: projectId } });
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });
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
  const role = (session.user as any).role;

  if (!["pd", "ges_pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { action, projectId } = body;
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // PM submits plan — auto-create dept approval records
  if (action === "submit") {
    if (!["pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const empPlans = await prisma.resourcePlanEmployeeMonthly.findMany({
      where: { projectId },
      include: { employee: { select: { department: true } } },
    });
    const depts = Array.from(new Set(empPlans.map((p) => p.employee.department)));

    await prisma.$transaction([
      prisma.project.update({ where: { id: projectId }, data: { planStatus: "submitted" } }),
      prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } }),
      prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } }),
      ...depts.map((dept) =>
        prisma.resourcePlanDeptApproval.upsert({
          where: { projectId_department: { projectId, department: dept } },
          create: { projectId, department: dept, status: "pending" },
          update: { status: "pending", approvedById: null, approvedAt: null },
        })
      ),
    ]);
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  // PD requests revision of submitted/approved plan
  if (action === "revision_request") {
    if (!["pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "revision_requested" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "revision_requested" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "revision_requested" } });
    return NextResponse.json({ success: true, planStatus: "revision_requested" });
  }

  // Per-dept approve: GES Management approves only their own dept
  if (action === "dept_approve") {
    if (!["ges_management", "ges_pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const empDbId = (session.user as any).id;
    const employeeId = (session.user as any).employeeId;
    let dept: string | null = null;
    if (["ges_management", "ges_pd"].includes(role)) {
      const me = await prisma.employee.findFirst({
        where: { OR: [{ id: empDbId }, { employeeId }] },
        select: { managedDept: true, department: true },
      });
      dept = (me?.managedDept && me.managedDept.trim()) ? me.managedDept : me?.department ?? null;
    } else {
      dept = body.department ?? null;
    }
    if (!dept) return NextResponse.json({ error: "Cannot determine department" }, { status: 400 });

    await prisma.resourcePlanDeptApproval.upsert({
      where: { projectId_department: { projectId, department: dept } },
      create: { projectId, department: dept, status: "approved", approvedById: empDbId, approvedAt: new Date() },
      update: { status: "approved", approvedById: empDbId, approvedAt: new Date() },
    });

    // Check if ALL depts for this project are approved
    const allApprovals = await prisma.resourcePlanDeptApproval.findMany({ where: { projectId } });
    const allApproved = allApprovals.length > 0 && allApprovals.every((a) => a.status === "approved");
    if (allApproved) {
      await prisma.project.update({ where: { id: projectId }, data: { planStatus: "approved" } });
      await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
      await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
      return NextResponse.json({ success: true, planStatus: "approved", allApproved: true });
    }
    return NextResponse.json({ success: true, planStatus: "submitted", deptApproved: dept });
  }

  // Admin/MD full override approve
  if (action === "approve") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const empDbId = (session.user as any).id;
    await prisma.resourcePlanDeptApproval.updateMany({
      where: { projectId },
      data: { status: "approved", approvedById: empDbId, approvedAt: new Date() },
    });
    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "approved" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
    return NextResponse.json({ success: true, planStatus: "approved" });
  }

  // Reject plan — reset to draft
  if (action === "reject") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.resourcePlanDeptApproval.updateMany({
      where: { projectId },
      data: { status: "pending", approvedById: null, approvedAt: null },
    });
    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "draft" } });
    return NextResponse.json({ success: true, planStatus: "draft" });
  }

  // PD cancels own revision request (revision_requested → submitted)
  if (action === "cancel_revision") {
    if (!["pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.project.update({ where: { id: projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } });
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  // Management approves revision request → reset ALL dept approvals, return to draft
  if (action === "approve_revision") {
    if (!["ges_management", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.resourcePlanDeptApproval.updateMany({
      where: { projectId },
      data: { status: "pending", approvedById: null, approvedAt: null },
    });
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
