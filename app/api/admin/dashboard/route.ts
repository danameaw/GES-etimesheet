import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPD, isGesMgmt } from "@/lib/roles";
import { LEAVE_TASK_CODES } from "@/lib/task-constants";
import { TIMESHEET_EXEMPT_IDS } from "@/lib/timesheet-exempt";
import { employedFrom } from "@/lib/employment-period";
import { loadUnitIndex } from "@/lib/org-units";
import {
  holidayWeekdaySet, monthCompanyCapacity, weekCompanyCapacity, classifyEntry, entryDays,
  emptyBreakdown, addHours, availableHrs, pctOf, toDateKey, normalizeDay, HRS_PER_DAY, UTILIZATION_TARGET,
  entryMonthHours, entryHoursInRange, weekStartFilterForRange,
} from "@/lib/capacity";

const MS_13H = 13 * 60 * 60 * 1000;
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// นับ working days (Mon-Fri) ในเดือน
function workingDaysInMonth(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count || 20;
}

// นับ working days ของ week นั้นที่ตกอยู่ในเดือนที่ระบุ (เผื่อ week ข้ามเดือน)
function workingDaysOfWeekInMonth(weekStart: Date, year: number, month: number): number {
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) count++;
  }
  return count || 5;
}

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
  // …or only their managed unit (and its sub-units) when managedUnitId is set
  let deptFilter = searchParams.get("dept") || "";
  let unitIds: string[] | null = null;
  if (isGesMgmt(role) && !deptFilter) {
    const me = await prisma.employee.findUnique({ where: { id: empDbId }, select: { managedDept: true, managedUnitId: true } });
    deptFilter = me?.managedDept ?? "";
    if (deptFilter && me?.managedUnitId) unitIds = Array.from((await loadUnitIndex()).descendants(me.managedUnitId));
  }
  const empScopeWhere = deptFilter
    ? { department: deptFilter, ...(unitIds ? { orgUnitId: { in: unitIds } } : {}) }
    : {};

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
  // Month mode: ดึงทุกสัปดาห์ที่มีวันตกในเดือน แล้วตัดชั่วโมงเฉพาะวันที่อยู่ในเดือน (สัปดาห์คร่อมเดือนแบ่งถูกต้อง)
  let dateFilter: any = {};
  let monthRange: { start: Date; end: Date } | null = null;
  if (mode === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    monthRange = { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
    dateFilter = weekStartFilterForRange(monthRange.start, monthRange.end);
  } else if (weekParam) {
    dateFilter = weekRange(new Date(weekParam + "T00:00:00.000Z"));
  }
  const hrsInPeriod = (weekStart: Date, e: any): number =>
    monthRange ? entryHoursInRange(weekStart, e, monthRange.start, monthRange.end) : e.totalHrs;
  // staff counted in this period: active, or left (endDate) on/after the period start
  const periodFrom = monthRange?.start ?? (weekParam ? new Date(weekParam + "T00:00:00.000Z") : null);
  const staffFilter = periodFrom ? employedFrom(periodFrom) : { isActive: true };

  // ── Timesheets ── (นับเฉพาะ employee ที่ยัง active เท่านั้น)
  const tsWhere: any = { status: { in: ["submitted", "approved"] }, employee: { ...staffFilter } };
  if (Object.keys(dateFilter).length) tsWhere.weekStart = dateFilter;
  if (projectId) tsWhere.entries = { some: { projectId } };
  else if (pdProjectIds) tsWhere.entries = { some: { projectId: { in: pdProjectIds } } };
  if (deptFilter) tsWhere.employee = { ...tsWhere.employee, ...empScopeWhere };

  const allTS = await prisma.timesheet.findMany({
    where: tsWhere,
    include: {
      entries: {
        where: projectId
          ? { projectId }
          : pdProjectIds ? { projectId: { in: pdProjectIds } } : undefined,
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
    ts.entries.map((e) => ({ ...e, totalHrs: hrsInPeriod(ts.weekStart, e), ts })).filter((e) => e.totalHrs > 0)
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
    Object.assign(planWhere, { employee: { ...empScopeWhere, ...staffFilter } });
  }
  const empPlans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: planWhere,
    include: { project: { select: { id: true, projectNumber: true, projectName: true } } },
  });

  // Week mode: pro-rate monthly plan ตาม proportion working days จริงของ week นั้น
  let weekProRate = 1;
  if (mode === "week" && weekParam) {
    const wd = new Date(weekParam + "T00:00:00.000Z");
    const y  = wd.getUTCFullYear();
    const m  = wd.getUTCMonth() + 1;
    const daysInWeekForMonth = workingDaysOfWeekInMonth(wd, y, m);
    const daysInMonth        = workingDaysInMonth(y, m);
    weekProRate = daysInWeekForMonth / daysInMonth;
  }

  const planByProj = new Map<string, { num: string; name: string; planned: number }>();
  for (const p of empPlans) {
    const hrs = Math.round(p.plannedHrs * weekProRate * 10) / 10;
    const x = planByProj.get(p.projectId);
    if (x) x.planned += hrs;
    else planByProj.set(p.projectId, { num: p.project.projectNumber, name: p.project.projectName, planned: hrs });
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

  const LEAVE_CODES = LEAVE_TASK_CODES;

  // ── 3. Top Employees (ไม่รวม Leave/Holiday เพื่อให้สอดคล้องกับ KPI ชั่วโมงจริง) ──
  const empMap = new Map<string, { name: string; hours: number; department: string }>();
  for (const e of entries) {
    if (LEAVE_CODES.includes(e.taskCode.code)) continue;
    const emp = e.ts.employee;
    if (deptFilter && emp.department !== deptFilter) continue;
    if (unitIds && !unitIds.includes(emp.orgUnitId ?? "")) continue;
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
      where: {
        projectId: { in: matProjIds },
        timesheet: {
          status: { in: ["submitted", "approved"] },
          weekStart: weekStartFilterForRange(
            new Date(Date.UTC(matMonths[0].year, matMonths[0].month - 1, 1)),
            new Date(Date.UTC(matMonths[matMonths.length - 1].year, matMonths[matMonths.length - 1].month, 1)),
          ),
        },
      },
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
    for (const [y, m, hrs] of entryMonthHours(e.timesheet.weekStart, e)) {
      if (!matMonths.find((mm) => mm.year === y && mm.month === m)) continue;
      const k = `${e.projectId}|${y}|${m}`;
      matActualMap.set(k, (matActualMap.get(k) || 0) + hrs);
    }
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
  let totalProjectHours = 0, totalOverheadHours = 0;
  for (const e of entries) {
    const kind = classifyEntry(e);
    if (kind === "project") totalProjectHours += e.totalHrs;
    else if (kind === "overhead") totalOverheadHours += e.totalHrs;
  }

  // ── Employee matrix (for GES Management dept view) ──────────────────────
  let empActualMatrix: any[] = [];
  if (deptFilter) {
    const matStart = new Date(Date.UTC(matMonths[0].year, matMonths[0].month - 1, 1));
    const matEnd   = new Date(Date.UTC(matMonths[matMonths.length - 1].year, matMonths[matMonths.length - 1].month, 0));

    const [empPlans, empTimesheets] = await Promise.all([
      prisma.resourcePlanEmployeeMonthly.findMany({
        where: {
          employee: { ...empScopeWhere, ...employedFrom(matStart) },
          OR: matMonths.map((m) => ({ year: m.year, month: m.month })),
        },
        include: { employee: { select: { id: true, employeeId: true, name: true, position: true } } },
      }),
      prisma.timesheet.findMany({
        where: {
          weekStart: weekStartFilterForRange(matStart, new Date(matEnd.getTime() + 86400000)),
          employee: { ...empScopeWhere, ...employedFrom(matStart) },
          status: { in: ["submitted", "approved"] },
        },
        include: {
          employee: { select: { id: true, employeeId: true, name: true, position: true } },
          entries: true,
        },
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
      let inMatrix = false;
      for (const e of ts.entries) {
        for (const [y, m, hrs] of entryMonthHours(ts.weekStart, e)) {
          if (!matMonths.find((mm) => mm.year === y && mm.month === m)) continue;
          const k = `${ts.employee.id}|${y}|${m}`;
          empActMap.set(k, (empActMap.get(k) ?? 0) + hrs);
          inMatrix = true;
        }
      }
      if (!inMatrix) continue;
      // seed พนักงานที่มี Actual แต่ไม่มี Plan เข้า matrix ด้วย
      if (!empMeta.has(ts.employee.id)) empMeta.set(ts.employee.id, ts.employee);
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
    employee: { ...staffFilter },
  };
  if (Object.keys(dateFilter).length) leaveTsWhere.weekStart = dateFilter;
  if (deptFilter) leaveTsWhere.employee = { ...leaveTsWhere.employee, ...empScopeWhere };

  // PD: แสดง leave เฉพาะพนักงานที่มีงานใน project ของ PD (ใน period นี้)
  const pdEmpDbIds = pdProjectIds !== null
    ? Array.from(new Set(deduped.map((ts) => ts.employeeId)))
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
        const hrs = hrsInPeriod(ts.weekStart, e);
        if (hrs <= 0) continue;
        const emp = ts.employee;
        const x   = leaveByEmp.get(emp.id);
        if (x) x.hours += hrs;
        else leaveByEmp.set(emp.id, { name: emp.name, employeeId: emp.employeeId, department: emp.department, hours: hrs });
      }
    }
    leaveBreakdown = Array.from(leaveByEmp.values()).sort((a, b) => b.hours - a.hours);
    totalLeaveHrs  = leaveBreakdown.reduce((s, e) => s + e.hours, 0);
  }

  // ── 7. Capacity / Chargeable Utilization (วัดที่ "คน" — ไม่ใช้เมื่อกรองรายโครงการ หรือ PD ล้วน) ──
  let capacity: null | {
    employees: number; companyHrs: number; availableHrs: number;
    projectHrs: number; overheadHrs: number; leaveHrs: number;
    utilization: number; overheadPct: number; target: number;
  } = null;
  const showCapacity = !projectId && (!isPD(role) || isGesMgmt(role)) && (monthParam || weekParam);
  if (showCapacity) {
    const DAY = 86400000;
    let periodStart: Date, periodEnd: Date; // [start, end)
    if (mode === "month" && monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      periodStart = new Date(Date.UTC(y, m - 1, 1));
      periodEnd   = new Date(Date.UTC(y, m, 1));
    } else {
      periodStart = normalizeDay(new Date(weekParam + "T00:00:00.000Z"));
      periodEnd   = new Date(periodStart.getTime() + 7 * DAY);
    }
    const [capEmployees, capHolidays, capTS] = await Promise.all([
      prisma.employee.findMany({
        where: { ...employedFrom(periodStart), ...empScopeWhere },
        select: { id: true, employeeId: true, startDate: true, endDate: true },
      }),
      prisma.holiday.findMany({ where: { date: { gte: periodStart, lt: periodEnd } }, select: { date: true } }),
      prisma.timesheet.findMany({
        where: {
          weekStart: { gte: new Date(periodStart.getTime() - 7 * DAY - MS_13H), lt: new Date(periodEnd.getTime() + MS_13H) },
          status: { in: ["submitted", "approved"] },
          employee: { ...employedFrom(periodStart), ...empScopeWhere },
        },
        include: { entries: { include: { project: { select: { projectNumber: true, projectType: true } }, taskCode: { select: { code: true } } } } },
      }),
    ]);
    const holidays = holidayWeekdaySet(capHolidays);
    const startKey = toDateKey(periodStart), endKey = toDateKey(periodEnd);
    const baseCap = mode === "month" && monthParam
      ? monthCompanyCapacity(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, holidays)
      : weekCompanyCapacity(periodStart, holidays);

    // ชั่วโมงจริงของแต่ละคนในช่วงเวลา (ตามวันที่จริง)
    const byEmp = new Map<string, ReturnType<typeof emptyBreakdown>>();
    for (const ts of capTS) {
      for (const e of ts.entries) {
        const kind = classifyEntry(e);
        for (const [day, hrs] of entryDays(ts.weekStart, e)) {
          if (day < startKey || day >= endKey) continue;
          if (!byEmp.has(ts.employeeId)) byEmp.set(ts.employeeId, emptyBreakdown());
          addHours(byEmp.get(ts.employeeId)!, kind, day, hrs, holidays);
        }
      }
    }

    let companyHrs = 0, available = 0;
    const tot = emptyBreakdown();
    let counted = 0;
    for (const emp of capEmployees) {
      if (TIMESHEET_EXEMPT_IDS.has(emp.employeeId)) continue;
      // พนักงานใหม่: หักวันทำงานก่อนวันเริ่มงาน
      let cap = baseCap;
      if (emp.startDate) {
        const sd = toDateKey(normalizeDay(emp.startDate));
        if (sd >= endKey) continue;
        for (let t = periodStart.getTime(); toDateKey(new Date(t)) < sd; t += DAY) {
          const k = toDateKey(new Date(t)); const dow = new Date(t).getUTCDay();
          if (dow >= 1 && dow <= 5 && !holidays.has(k)) cap -= HRS_PER_DAY;
        }
        cap = Math.max(0, cap);
      }
      // ลาออก: หักวันทำงานหลังวันสุดท้ายที่ทำงาน
      if (emp.endDate) {
        const ed = toDateKey(normalizeDay(emp.endDate));
        if (ed < startKey) continue;
        for (let t = periodStart.getTime(); toDateKey(new Date(t)) < endKey; t += DAY) {
          const k = toDateKey(new Date(t)); const dow = new Date(t).getUTCDay();
          if (k > ed && dow >= 1 && dow <= 5 && !holidays.has(k)) cap -= HRS_PER_DAY;
        }
        cap = Math.max(0, cap);
      }
      const b = byEmp.get(emp.id) ?? emptyBreakdown();
      counted++;
      companyHrs += cap;
      available  += availableHrs(cap, b);
      tot.project += b.project; tot.overhead += b.overhead; tot.leave += b.leave;
    }
    const r1 = (n: number) => Math.round(n * 10) / 10;
    capacity = {
      employees: counted, companyHrs: r1(companyHrs), availableHrs: r1(available),
      projectHrs: r1(tot.project), overheadHrs: r1(tot.overhead), leaveHrs: r1(tot.leave),
      utilization: pctOf(tot.project, available), overheadPct: pctOf(tot.overhead, available),
      target: UTILIZATION_TARGET,
    };
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
    summary: {
      totalHours, totalWorkHours, totalPlanned, submittedCount: deduped.length, mode, totalLeaveHrs,
      totalProjectHours: Math.round(totalProjectHours * 10) / 10,
      totalOverheadHours: Math.round(totalOverheadHours * 10) / 10,
    },
    capacity,
  });
}
