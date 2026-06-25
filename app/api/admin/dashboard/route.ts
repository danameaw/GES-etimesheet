import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPD, isGesMgmt } from "@/lib/roles";

const MS_13H = 13 * 60 * 60 * 1000;
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function weekRange(wStart: Date) {
  return { gte: new Date(wStart.getTime() - MS_13H), lt: new Date(wStart.getTime() + MS_13H) };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;
  if (!["ges_management", "ges_pd", "admin", "md", "pd"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam  = searchParams.get("week");
  const monthParam = searchParams.get("month");
  const projectId  = searchParams.get("projectId") || "";
  const mode       = monthParam ? "month" : "week";

  // ── Role-based auto-filters ──────────────────────────────────────────────
  // GES Management (incl. ges_pd): auto-filter to their managed department
  let deptFilter = searchParams.get("dept") || "";
  if (isGesMgmt(role) && !deptFilter) {
    const me = await prisma.employee.findUnique({ where: { id: empDbId }, select: { managedDept: true } });
    deptFilter = me?.managedDept ?? "";
  }

  // PD (incl. ges_pd): restrict to own projects
  let pdProjectIds: string[] | null = null;
  if (isPD(role)) {
    const pdProjs = await prisma.project.findMany({
      where: { isActive: true, OR: [{ pdId: empDbId }, { managerId: empDbId }] },
      select: { id: true },
    });
    pdProjectIds = pdProjs.map((p) => p.id);
  }

  // ── All active projects for selector (filtered by role) ──
  const allProjects = await prisma.project.findMany({
    where: {
      isActive: true,
      ...(pdProjectIds ? { id: { in: pdProjectIds } } : {}),
    },
    select: { id: true, projectNumber: true, projectName: true },
    orderBy: { projectNumber: "asc" },
  });

  // ── Time filter ──
  let dateFilter: any = {};
  if (mode === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    const s = new Date(Date.UTC(y, m - 1, 1));
    const e = new Date(Date.UTC(y, m, 1));
    dateFilter = { gte: new Date(s.getTime() - MS_13H), lt: new Date(e.getTime() + MS_13H) };
  } else if (weekParam) {
    dateFilter = weekRange(new Date(weekParam + "T00:00:00.000Z"));
  }

  // ── Timesheets ── (นับเฉพาะ employee ที่ยัง active เท่านั้น)
  const tsWhere: any = { status: { in: ["submitted", "approved"] }, employee: { isActive: true } };
  if (Object.keys(dateFilter).length) tsWhere.weekStart = dateFilter;
  if (projectId) tsWhere.entries = { some: { projectId } };
  else if (pdProjectIds) tsWhere.entries = { some: { projectId: { in: pdProjectIds } } };
  if (deptFilter) tsWhere.employee = { ...tsWhere.employee, department: deptFilter };

  const allTS = await prisma.timesheet.findMany({
    where: tsWhere,
    include: {
      entries: {
        where: projectId ? { projectId } : undefined,
        include: { project: true, taskCode: true },
      },
      employee: true,
    },
  });

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allTS.filter((ts) => {
    const k = `${ts.employeeId}-${new Date(Math.round(ts.weekStart.getTime() / 86400000) * 86400000).toISOString().slice(0, 10)}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  const entries = deduped.flatMap((ts) =>
    ts.entries.filter((e) => e.totalHrs > 0).map((e) => ({ ...e, ts }))
  );

  // ── 1. Plan vs Actual ──
  const actualByProj = new Map<string, number>();
  for (const e of entries) actualByProj.set(e.projectId, (actualByProj.get(e.projectId) || 0) + e.totalHrs);

  const planWhere: any = projectId ? { projectId }
    : pdProjectIds ? { projectId: { in: pdProjectIds } } : {};
  if (mode === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    Object.assign(planWhere, { year: y, month: m });
  } else if (weekParam) {
    // week view: ใช้ plan ของเดือนที่ week นั้นอยู่
    const wd = new Date(weekParam + "T00:00:00.000Z");
    Object.assign(planWhere, { year: wd.getUTCFullYear(), month: wd.getUTCMonth() + 1 });
  }
  // GES Management: filter plan เฉพาะพนักงานใน dept นั้น
  if (deptFilter) {
    Object.assign(planWhere, { employee: { department: deptFilter, isActive: true } });
  }
  const empPlans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: planWhere,
    include: { project: { select: { id: true, projectNumber: true, projectName: true } } },
  });

  const planByProj = new Map<string, { num: string; name: string; planned: number }>();
  for (const p of empPlans) {
    const x = planByProj.get(p.projectId);
    if (x) x.planned += p.plannedHrs;
    else planByProj.set(p.projectId, { num: p.project.projectNumber, name: p.project.projectName, planned: p.plannedHrs });
  }

  const pvaPids = new Set([...Array.from(planByProj.keys()), ...Array.from(actualByProj.keys())]);
  const planVsActual = Array.from(pvaPids).map((pid) => {
    const pd = planByProj.get(pid);
    const pr = allProjects.find((p) => p.id === pid);
    return { projectId: pid, projectNumber: pd?.num || pr?.projectNumber || "?", projectName: pd?.name || pr?.projectName || "?", planned: pd?.planned || 0, actual: actualByProj.get(pid) || 0 };
  }).filter((x) => x.planned > 0 || x.actual > 0).sort((a, b) => b.planned - a.planned).slice(0, 10);

  // ── 2. Task Breakdown ──
  const catMap = new Map<string, number>();
  for (const e of entries) catMap.set(e.taskCode.category, (catMap.get(e.taskCode.category) || 0) + e.totalHrs);
  const taskBreakdown = Array.from(catMap.entries()).map(([category, hours]) => ({ category, hours })).sort((a, b) => b.hours - a.hours);

  const LEAVE_CODES = ["1001", "1002", "1003", "1004", "1005"];

  // ── 3. Top Employees ──
  const empMap = new Map<string, { name: string; hours: number; department: string }>();
  for (const e of entries) {
    const emp = e.ts.employee;
    if (deptFilter && emp.department !== deptFilter) continue;
    const x = empMap.get(emp.id);
    if (x) x.hours += e.totalHrs;
    else empMap.set(emp.id, { name: emp.name, hours: e.totalHrs, department: emp.department });
  }
  const topEmployees = Array.from(empMap.values()).sort((a, b) => b.hours - a.hours).slice(0, 10);
  const allDepts = Array.from(new Set(deduped.map((ts) => ts.employee.department))).sort();

  // ── 5. Plan vs Actual Matrix (last 6 months) ──
  const now2 = new Date();
  const matMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() - (5 - i), 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, label: `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });

  const matProjIds = projectId ? [projectId]
    : pdProjectIds ? pdProjectIds.slice(0, 12)
    : allProjects.slice(0, 12).map((p) => p.id);
  const [matPlans, matActuals] = await Promise.all([
    prisma.resourcePlanEmployeeMonthly.findMany({
      where: { projectId: { in: matProjIds }, OR: matMonths.map((m) => ({ year: m.year, month: m.month })) },
      select: { projectId: true, year: true, month: true, plannedHrs: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { projectId: { in: matProjIds } },
      include: { timesheet: { select: { weekStart: true } } },
    }),
  ]);

  const matPlanMap = new Map<string, number>();
  for (const p of matPlans) {
    const k = `${p.projectId}|${p.year}|${p.month}`;
    matPlanMap.set(k, (matPlanMap.get(k) || 0) + p.plannedHrs);
  }
  const matActualMap = new Map<string, number>();
  for (const e of matActuals) {
    const d = new Date(e.timesheet.weekStart);
    const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
    if (!matMonths.find((mm) => mm.year === y && mm.month === m)) continue;
    const k = `${e.projectId}|${y}|${m}`;
    matActualMap.set(k, (matActualMap.get(k) || 0) + e.totalHrs);
  }

  const planActualMatrix = matProjIds.map((pid) => {
    const proj = allProjects.find((p) => p.id === pid);
    const months = matMonths.map((m) => ({
      year: m.year, month: m.month, label: m.label,
      planned: matPlanMap.get(`${pid}|${m.year}|${m.month}`) || 0,
      actual:  matActualMap.get(`${pid}|${m.year}|${m.month}`) || 0,
    }));
    const totalPlanned = months.reduce((s, m) => s + m.planned, 0);
    const totalActual  = months.reduce((s, m) => s + m.actual, 0);
    return { projectId: pid, projectNumber: proj?.projectNumber || "?", projectName: proj?.projectName || "?", months, totalPlanned, totalActual };
  }).filter((p) => p.totalPlanned > 0 || p.totalActual > 0);

  const totalHours     = entries.reduce((s, e) => s + e.totalHrs, 0);
  const totalWorkHours = entries
    .filter((e) => !LEAVE_CODES.includes(e.taskCode.code))
    .reduce((s, e) => s + e.totalHrs, 0);
  const totalPlanned = Array.from(planByProj.values()).reduce((s, v) => s + v.planned, 0);

  // ── Employee matrix (for GES Management dept view) ──────────────────────
  let empActualMatrix: any[] = [];
  if (deptFilter) {
    const matStart = new Date(Date.UTC(matMonths[0].year, matMonths[0].month - 1, 1));
    const matEnd   = new Date(Date.UTC(matMonths[matMonths.length - 1].year, matMonths[matMonths.length - 1].month, 0));

    const [empPlans, empTimesheets] = await Promise.all([
      prisma.resourcePlanEmployeeMonthly.findMany({
        where: {
          employee: { department: deptFilter, isActive: true },
          OR: matMonths.map((m) => ({ year: m.year, month: m.month })),
        },
        include: { employee: { select: { id: true, employeeId: true, name: true, position: true } } },
      }),
      prisma.timesheet.findMany({
        where: {
          weekStart: { gte: new Date(matStart.getTime() - MS_13H), lte: new Date(matEnd.getTime() + MS_13H) },
          employee: { department: deptFilter },
          status: { in: ["submitted", "approved"] },
        },
        include: { employee: { select: { id: true } }, entries: { select: { totalHrs: true } } },
      }),
    ]);

    // Aggregate plans: empId|month -> plannedHrs
    const empPlanMap = new Map<string, number>();
    const empMeta    = new Map<string, any>();
    for (const p of empPlans) {
      const k = `${p.employee.id}|${p.year}|${p.month}`;
      empPlanMap.set(k, (empPlanMap.get(k) ?? 0) + p.plannedHrs);
      empMeta.set(p.employee.id, p.employee);
    }

    // Aggregate actuals: empId|month -> actualHrs
    const empActMap = new Map<string, number>();
    for (const ts of empTimesheets) {
      const d = new Date(ts.weekStart);
      const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
      if (!matMonths.find((mm) => mm.year === y && mm.month === m)) continue;
      const hrs = ts.entries.reduce((s: number, e: any) => s + e.totalHrs, 0);
      const k = `${ts.employee.id}|${y}|${m}`;
      empActMap.set(k, (empActMap.get(k) ?? 0) + hrs);
    }

    empActualMatrix = Array.from(empMeta.values()).map((emp) => {
      const months = matMonths.map((m) => ({
        year: m.year, month: m.month, label: m.label,
        planned: empPlanMap.get(`${emp.id}|${m.year}|${m.month}`) ?? 0,
        actual:  empActMap.get(`${emp.id}|${m.year}|${m.month}`) ?? 0,
      }));
      const totalPlanned = months.reduce((s, m) => s + m.planned, 0);
      const totalActual  = months.reduce((s, m) => s + m.actual,  0);
      return { empId: emp.id, employeeId: emp.employeeId, name: emp.name, position: emp.position, months, totalPlanned, totalActual };
    }).filter((e) => e.totalPlanned > 0 || e.totalActual > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── 6. Leave/Holiday Breakdown ──
  // Fetch leave แยกต่างหาก ไม่ผูกกับ project filter
  // เพื่อให้เห็น leave ของพนักงานที่ลาทั้งสัปดาห์ (ไม่มี project entry)
  const leaveTsWhere: any = {
    status: { in: ["submitted", "approved"] },
    employee: { isActive: true },
  };
  if (Object.keys(dateFilter).length) leaveTsWhere.weekStart = dateFilter;
  if (deptFilter) leaveTsWhere.employee = { ...leaveTsWhere.employee, department: deptFilter };

  // PD: แสดง leave เฉพาะพนักงานที่มีงานใน project ของ PD (ใน period นี้)
  const pdEmpDbIds = pdProjectIds !== null
    ? [...new Set(deduped.map((ts) => ts.employeeId))]
    : null;
  if (pdEmpDbIds !== null && pdEmpDbIds.length > 0)
    leaveTsWhere.employeeId = { in: pdEmpDbIds };

  let leaveBreakdown: { name: string; employeeId: string; department: string; hours: number }[] = [];
  let totalLeaveHrs = 0;

  if (pdEmpDbIds === null || pdEmpDbIds.length > 0) {
    const leaveTS = await prisma.timesheet.findMany({
      where: leaveTsWhere,
      include: {
        entries: {
          where: { taskCode: { code: { in: LEAVE_CODES } } },
          include: { taskCode: { select: { code: true } } },
        },
        employee: { select: { id: true, employeeId: true, name: true, department: true } },
      },
    });
    const leaveByEmp = new Map<string, { name: string; employeeId: string; department: string; hours: number }>();
    for (const ts of leaveTS) {
      for (const e of ts.entries) {
        if (e.totalHrs <= 0) continue;
        const emp = ts.employee;
        const x   = leaveByEmp.get(emp.id);
        if (x) x.hours += e.totalHrs;
        else leaveByEmp.set(emp.id, { name: emp.name, employeeId: emp.employeeId, department: emp.department, hours: e.totalHrs });
      }
    }
    leaveBreakdown = Array.from(leaveByEmp.values()).sort((a, b) => b.hours - a.hours);
    totalLeaveHrs  = leaveBreakdown.reduce((s, e) => s + e.hours, 0);
  }

  return NextResponse.json({
    allProjects,
    planVsActual,
    taskBreakdown,
    topEmployees,
    allDepts,
    planActualMatrix,
    empActualMatrix,
    matrixMonths:    matMonths,
    leaveBreakdown,
    summary: { totalHours, totalWorkHours, totalPlanned, submittedCount: deduped.length, mode, totalLeaveHrs },
  });
}
