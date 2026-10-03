import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { entryMonthHours } from "@/lib/capacity";
import { loadUnitIndex, canApproveKey, scopeDeptOf } from "@/lib/org-units";
import { syncPlanApprovals, approvalsWithLabels, currentApprovalKeys } from "@/lib/plan-approvals";

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
  const forApproval  = searchParams.get("forApproval") === "1";
  // allProjects=1 → Overview page: admin/md see ALL active projects regardless of plan status
  const allProjects  = searchParams.get("allProjects") === "1";

  // Build project filter:
  // pd normal      → projects where they are PD or PM
  // pd forApproval → all active non-draft projects
  // ges_management → same as pd
  // admin / md     → all active projects (forApproval: non-draft only; allProjects: all)
  let projectWhere: any = { isActive: true };
  if (role === "pd" || role === "ges_pd" || role === "ges_management") {
    projectWhere = forApproval
      ? { isActive: true, planStatus: { not: "draft" } }
      : { isActive: true, OR: [{ pdId: empDbId }, { managerId: empDbId }] }; // PD or PM of the project
  }
  if ((role === "admin" || role === "md") && forApproval && !allProjects) {
    projectWhere = { isActive: true, planStatus: { not: "draft" } };
  }
  if ((role === "admin" || role === "md") && allProjects) {
    projectWhere = { isActive: true };
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
    where: { projectId, timesheet: { status: { in: ["submitted", "approved"] } } },
    include: {
      timesheet: {
        include: { employee: { select: { department: true } } },
      },
    },
  });

  // Aggregate actuals by (department, year, month)
  const actualMap = new Map<string, number>();
  for (const e of actualEntries) {
    const dept = e.timesheet.employee.department;
    // แบ่งเข้าเดือนตามวันที่จริง (สัปดาห์คร่อมเดือนแบ่งถูกต้อง)
    for (const [year, month, hrs] of entryMonthHours(e.timesheet.weekStart, e)) {
      const key = `${dept}|${year}|${month}`;
      actualMap.set(key, (actualMap.get(key) || 0) + hrs);
    }
  }

  const actuals = Array.from(actualMap.entries()).map(([key, hrs]) => {
    const [dept, y, m] = key.split("|");
    return { department: dept, year: Number(y), month: Number(m), actualHrs: hrs };
  });

  // Keep approval rows (department / unit) in sync with who is planned on this project
  const idx = await loadUnitIndex();
  const proj = projects.find((p) => p.id === projectId);
  if (proj && ["submitted", "revision_requested", "approved"].includes((proj as any).planStatus)) {
    await syncPlanApprovals(projectId, idx);
  }
  const deptApprovals = await approvalsWithLabels([projectId], idx);

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

  const body = await req.json();
  const { action, projectId } = body;
  // unit heads may hold the plain "employee" role — only dept_approve checks them (per key, below)
  if (action !== "dept_approve" && !["pd", "ges_pd", "ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // PM submits plan — create one pending approval per department / unit of the planned staff
  if (action === "submit") {
    if (!["pd", "ges_pd", "admin", "md"].includes(role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // the project's PM plans the people and submits; admin / md may submit on their behalf
    if (role !== "admin" && role !== "md") {
      const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { managerId: true } });
      if (proj?.managerId !== (session.user as any).id)
        return NextResponse.json({ error: "เฉพาะ PM ของโครงการนี้ที่ Submit แผนได้" }, { status: 403 });
    }

    await prisma.$transaction([
      prisma.project.update({ where: { id: projectId }, data: { planStatus: "submitted" } }),
      prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } }),
      prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "submitted" } }),
    ]);
    await syncPlanApprovals(projectId, await loadUnitIndex(), true);
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

  // Approve one department / unit part of the plan.
  // body.unitId given → that unit (unit head of it or an ancestor, GES Management of the dept, admin/md)
  // no unitId → every part of a department (GES Management of that dept, admin/md)
  if (action === "dept_approve") {
    const empDbId = (session.user as any).id;
    const idx = await loadUnitIndex();
    const me = { id: empDbId, role, scopeDept: await scopeDeptOf(empDbId, role) };
    const department: string | null = body.department ?? me.scopeDept;
    if (!department) return NextResponse.json({ error: "Cannot determine department" }, { status: 400 });

    await syncPlanApprovals(projectId, idx);
    const keys = (await currentApprovalKeys(projectId, idx)).filter((k) =>
      k.department === department && (body.unitId === undefined || k.unitId === String(body.unitId)));
    if (keys.length === 0) return NextResponse.json({ error: "ไม่มีส่วนที่ต้องอนุมัติ" }, { status: 400 });
    // whole-department approval needs department rights; a single unit needs rights on that unit
    if (!keys.every((k) => canApproveKey(idx, me, body.unitId === undefined ? { department, unitId: "" } : k)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.$transaction(keys.map((k) =>
      prisma.resourcePlanDeptApproval.update({
        where: { projectId_department_unitId: { projectId, department: k.department, unitId: k.unitId } },
        data: { status: "approved", approvedById: empDbId, approvedAt: new Date() },
      })));

    // all parts approved → whole plan approved
    const allApprovals = await prisma.resourcePlanDeptApproval.findMany({ where: { projectId } });
    const allApproved = allApprovals.length > 0 && allApprovals.every((a) => a.status === "approved");
    if (allApproved) {
      await prisma.project.update({ where: { id: projectId }, data: { planStatus: "approved" } });
      await prisma.resourcePlanMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
      await prisma.resourcePlanEmployeeMonthly.updateMany({ where: { projectId }, data: { planStatus: "approved" } });
      return NextResponse.json({ success: true, planStatus: "approved", allApproved: true });
    }
    return NextResponse.json({ success: true, planStatus: "submitted", deptApproved: department });
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
