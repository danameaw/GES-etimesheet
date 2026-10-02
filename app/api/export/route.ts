import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TIMESHEET_EXEMPT_IDS } from "@/lib/timesheet-exempt";
import { isEmployedInWeek } from "@/lib/employment-period";
import { LEAVE_TASK_CODES } from "@/lib/task-constants";
import {
  holidayWeekdaySet, weekCompanyCapacity, classifyEntry, entryDays, emptyBreakdown, addHours, availableHrs, pctOf,
  entryMonthHours, weekStartFilterForRange,
} from "@/lib/capacity";
import { isGesMgmt } from "@/lib/roles";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, format } from "date-fns";
import ExcelJS from "exceljs";

import { setWorkbookMeta, addTitleBand, styleHeaderRow, styleGroupRow, styleSubtotalRow, COLORS } from "@/lib/export/theme";
import {
  buildProjectTree, buildEmployeeTree, buildProjectTaskTree, departmentBreakdown, sortByHoursDesc, EntryRow,
} from "@/lib/export/aggregate";
import {
  writeProjectEmployeeTaskSheet, writeEmployeeProjectTaskSheet, writeProjectTaskSheet,
  writeUtilizationSheet, writeMissingSheet, writeDashboardSheet, writeFlatTableSheet,
  UtilizationRow, HRS_FMT,
} from "@/lib/export/sheets";

// Monday (UTC) of the week containing the given date
function mondayOfUTC(d: Date): Date {
  const m = new Date(d);
  const dow = m.getUTCDay(); // 0=Sun..6=Sat
  m.setUTCDate(m.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

// All Mon-starting weeks (UTC) that overlap the given month — matches admin monthly view
function weeksInMonthUTC(monthStart: Date): Date[] {
  const y = monthStart.getUTCFullYear();
  const m = monthStart.getUTCMonth();
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)); // last day of month
  const first = new Date(monthStart);
  const dow = first.getUTCDay();               // 0=Sun..6=Sat
  first.setUTCDate(first.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // back to Monday
  const weeks: Date[] = [];
  for (let w = new Date(first); w <= monthEnd; w = new Date(w.getTime() + 7 * 86400000)) {
    weeks.push(new Date(w));
  }
  return weeks;
}

const MS_13H = 13 * 60 * 60 * 1000;
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DONE_STATUSES = ["submitted", "approved"];

// ±13h tolerance window for backward-compat with Thailand UTC+7 stored dates
function weekRange(weekStart: Date) {
  return { gte: new Date(weekStart.getTime() - MS_13H), lt: new Date(weekStart.getTime() + MS_13H) };
}

// Per-employee utilization for the period, plus the aggregate stats the Dashboard needs.
// Capacity and required weeks are per employee: only weeks from their startDate count.
// Chargeable Utilization = project hrs / (capacity - personal leave); see lib/capacity.ts
async function computeUtilization(tsWeekFilter: { gte: Date; lt: Date }, projEntryFilter: any, weeks: Date[], isMonth: boolean) {
  const [allEmployeesRaw, timesheets, holidayRows] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
    prisma.timesheet.findMany({
      where: { weekStart: tsWeekFilter },
      include: {
        employee: true,
        // โหลดทุกสถานะเพื่อแสดงสถานะ/Weeks Logged — ชั่วโมงนับเฉพาะที่ส่งแล้ว (ดูด้านล่าง)
        entries: { where: projEntryFilter, include: { project: { select: { projectNumber: true, projectType: true } }, taskCode: { select: { code: true } } } },
      },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: weeks[0], lt: new Date(weeks[weeks.length - 1].getTime() + 7 * 86400000) } },
      select: { date: true },
    }),
  ]);
  const holidays = holidayWeekdaySet(holidayRows);
  const requiredWeeks = new Map(allEmployeesRaw.map((e) => [e.id, weeks.filter((w) => isEmployedInWeek(e, w)).length]));
  const allEmployees = allEmployeesRaw.filter((e) => !TIMESHEET_EXEMPT_IDS.has(e.employeeId) && requiredWeeks.get(e.id)! > 0);

  const aggMap = new Map<string, { hrs: number; b: ReturnType<typeof emptyBreakdown>; done: number; logged: number; lastStatus: string }>();
  for (const t of timesheets) {
    const a = aggMap.get(t.employeeId) ?? { hrs: 0, b: emptyBreakdown(), done: 0, logged: 0, lastStatus: t.status };
    const weekHrs = t.entries.reduce((s, e) => s + e.totalHrs, 0);
    a.hrs += weekHrs;
    // ชั่วโมงสำหรับ Utilization นับเฉพาะ timesheet ที่ส่งแล้ว (submitted/approved) เหมือนรายงานอื่น
    if (DONE_STATUSES.includes(t.status)) {
      for (const e of t.entries) {
        const kind = classifyEntry(e);
        for (const [day, hrs] of entryDays(t.weekStart, e)) addHours(a.b, kind, day, hrs, holidays);
      }
    }
    if (weekHrs > 0) a.logged += 1; // any hours entered that week, regardless of status (draft counts)
    if (DONE_STATUSES.includes(t.status)) a.done += 1;
    a.lastStatus = t.status;
    aggMap.set(t.employeeId, a);
  }

  const submittedIds = new Set(timesheets.filter((t) => DONE_STATUSES.includes(t.status)).map((t) => t.employeeId));

  const rows: UtilizationRow[] = [];
  const missing: { employeeId: string; name: string; department: string; position: string; status: string }[] = [];

  for (const emp of allEmployees) {
    const a = aggMap.get(emp.id);
    const empWeeks = requiredWeeks.get(emp.id)!;
    const b = a?.b ?? emptyBreakdown();
    const companyHrs = weeks.filter((w) => isEmployedInWeek(emp, w)).reduce((s, w) => s + weekCompanyCapacity(w, holidays), 0);
    const available = availableHrs(companyHrs, b);
    const status = !a ? "missing" : isMonth ? `${a.done}/${empWeeks} weeks` : a.lastStatus;
    rows.push({
      employeeId: emp.employeeId, name: emp.name, department: emp.department, position: emp.position,
      hours: b.project + b.overhead, utilization: pctOf(b.project, available), status,
      companyHrs, availableHrs: available, projectHrs: b.project, overheadHrs: b.overhead, leaveHrs: b.leave,
      overheadPct: pctOf(b.overhead, available),
      weeksLogged: a?.logged || 0, weeksSubmitted: a?.done || 0,
    });
    if (!submittedIds.has(emp.id)) {
      const ts = timesheets.find((t) => t.employeeId === emp.id);
      missing.push({ employeeId: emp.employeeId, name: emp.name, department: emp.department, position: emp.position, status: ts?.status || "missing" });
    }
  }

  const avgUtilization = rows.length > 0 ? rows.reduce((s, r) => s + r.utilization, 0) / rows.length : 0;
  const complianceRate = allEmployees.length > 0 ? (submittedIds.size / allEmployees.length) * 100 : 0;

  return { rows, missing, avgUtilization, complianceRate, totalActive: allEmployees.length };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "ges_management", "ges_pd", "md", "pd"].includes((session.user as any).role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "weekly";
  const weekParam = searchParams.get("week");
  const monthParam = searchParams.get("month"); // "yyyy-MM-dd" (first day of month)
  const fromParam = searchParams.get("from");   // "yyyy-MM-dd" (custom range start)
  const toParam = searchParams.get("to");       // "yyyy-MM-dd" (custom range end)
  const projectIdsParam = searchParams.get("projectIds"); // optional comma-separated project ids
  const role = (session.user as any).role;

  // Optional project filter (applies to entry-based reports)
  const projIds = projectIdsParam ? projectIdsParam.split(",").filter(Boolean) : null;
  const projEntryFilter = projIds ? { projectId: { in: projIds } } : {};

  // Period: custom range, monthly (all weeks in the month), or weekly.
  // Params sent as "yyyy-MM-dd" to avoid timezone shifts.
  const isRange = !!(fromParam && toParam);
  const isMonth = !isRange && !!monthParam;
  let tsWeekFilter: { gte: Date; lt: Date };
  let periodLabel: string;
  let periodKey: string;
  let weeks: Date[]; // Mon-starting weeks in the period — utilization capacity = employed weeks × 40h

  if (isRange) {
    const first = mondayOfUTC(new Date(fromParam + "T00:00:00.000Z"));
    const last = mondayOfUTC(new Date(toParam + "T00:00:00.000Z"));
    weeks = [];
    for (let w = first; w <= last; w = new Date(w.getTime() + 7 * 86400000)) weeks.push(w);
    tsWeekFilter = { gte: new Date(first.getTime() - MS_13H), lt: new Date(last.getTime() + MS_13H) };
    periodLabel = `${format(first, "dd-MMM-yyyy")} to ${format(new Date(last.getTime() + 6 * 86400000), "dd-MMM-yyyy")}`;
    periodKey = `${format(first, "yyyyMMdd")}-${format(last, "yyyyMMdd")}`;
  } else if (isMonth) {
    const monthStart = new Date(monthParam + "T00:00:00.000Z");
    weeks = weeksInMonthUTC(monthStart);
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    tsWeekFilter = { gte: new Date(first.getTime() - MS_13H), lt: new Date(last.getTime() + MS_13H) };
    periodLabel = format(monthStart, "MMMM yyyy");
    periodKey = format(monthStart, "yyyy-MM");
  } else {
    const weekStart = weekParam
      ? new Date(weekParam + "T00:00:00.000Z")
      : startOfWeek(new Date(), { weekStartsOn: 1 });
    weeks = [weekStart];
    tsWeekFilter = weekRange(weekStart);
    periodLabel = `${format(weekStart, "dd-MMM")} to ${format(new Date(weekStart.getTime() + 6 * 86400000), "dd-MMM-yyyy")}`;
    periodKey = format(weekStart, "yyyy-MM-dd");
  }

  const wb = new ExcelJS.Workbook();
  let planActualTag = ""; // set by the plan-actual report for its filename
  setWorkbookMeta(wb);
  const weekLabel = periodLabel;
  const generatedAt = format(new Date(), "dd/MM/yyyy HH:mm");
  const subtitle = `Period: ${weekLabel}   •   Generated: ${generatedAt}`;

  async function fetchEntries(): Promise<EntryRow[]> {
    return prisma.timesheetEntry.findMany({
      where: { timesheet: { weekStart: tsWeekFilter, status: { in: DONE_STATUSES } }, ...projEntryFilter },
      include: { project: true, taskCode: true, timesheet: { include: { employee: true } } },
    });
  }

  if (type === "weekly") {
    const timesheets = await prisma.timesheet.findMany({
      where: { weekStart: tsWeekFilter, status: { in: DONE_STATUSES } },
      include: {
        employee: true,
        entries: { where: projEntryFilter, include: { project: true, taskCode: true } },
      },
    });

    const rows: (string | number)[][] = [];
    for (const ts of timesheets) {
      for (const entry of ts.entries) {
        if (entry.totalHrs === 0) continue;
        rows.push([
          ts.employee.employeeId, ts.employee.name, ts.employee.department,
          entry.project.projectNumber, entry.project.projectName,
          entry.taskCode.code, entry.taskCode.name,
          entry.monHrs, entry.tueHrs, entry.wedHrs, entry.thuHrs, entry.friHrs, entry.satHrs, entry.sunHrs,
          entry.totalHrs, ts.status,
        ]);
      }
    }

    writeFlatTableSheet(
      wb, "Weekly Report",
      `GES E-Timesheet — ${isRange ? "Custom Range" : isMonth ? "Monthly" : "Weekly"} Detail Report`,
      subtitle,
      [
        { header: "Employee ID", width: 12 }, { header: "Employee Name", width: 25 }, { header: "Department", width: 20 },
        { header: "Project No.", width: 12 }, { header: "Project Name", width: 35 },
        { header: "Task Code", width: 8 }, { header: "Task Name", width: 25 },
        { header: "Mon", width: 7, numFmt: HRS_FMT }, { header: "Tue", width: 7, numFmt: HRS_FMT }, { header: "Wed", width: 7, numFmt: HRS_FMT },
        { header: "Thu", width: 7, numFmt: HRS_FMT }, { header: "Fri", width: 7, numFmt: HRS_FMT }, { header: "Sat", width: 7, numFmt: HRS_FMT }, { header: "Sun", width: 7, numFmt: HRS_FMT },
        { header: "Total", width: 12, numFmt: HRS_FMT }, { header: "Status", width: 14 },
      ],
      rows,
      16
    );

  } else if (type === "project") {
    const entries = await fetchEntries();
    const tree = buildProjectTree(entries);
    writeProjectEmployeeTaskSheet(wb, "By Project", "GES E-Timesheet — Project Detail Report", subtitle, tree);

  } else if (type === "employee") {
    const entries = await fetchEntries();
    const tree = buildEmployeeTree(entries);
    writeEmployeeProjectTaskSheet(wb, "By Employee", "GES E-Timesheet — Employee Detail Report", subtitle, tree);

  } else if (type === "task") {
    const entries = await fetchEntries();
    const tree = buildProjectTaskTree(entries);
    writeProjectTaskSheet(wb, "By Task", "GES E-Timesheet — Hours by Project & Task", subtitle, tree);

  } else if (type === "utilization") {
    const { rows } = await computeUtilization(tsWeekFilter, projEntryFilter, weeks, isMonth);
    writeUtilizationSheet(wb, "GES E-Timesheet — Utilization Report", subtitle, rows);

  } else if (type === "missing") {
    const { missing } = await computeUtilization(tsWeekFilter, projEntryFilter, weeks, isMonth);
    writeMissingSheet(wb, "GES E-Timesheet — Missing Timesheet Report", subtitle, missing);

  } else if (type === "executive") {
    const [entries, util] = await Promise.all([
      fetchEntries(),
      computeUtilization(tsWeekFilter, projEntryFilter, weeks, isMonth),
    ]);

    const projTree = buildProjectTree(entries);
    const empTree = buildEmployeeTree(entries);
    const taskTree = buildProjectTaskTree(entries);
    const deptHours = departmentBreakdown(entries);

    const totalHours = entries.reduce((s, e) => s + e.totalHrs, 0);
    const topProjects = sortByHoursDesc(projTree).slice(0, 10).map(([num, p]) => [num, { name: p.name, hours: p.hours }] as [string, { name: string; hours: number }]);
    const topEmployees = sortByHoursDesc(empTree).slice(0, 10).map(([id, e]) => [id, { name: e.name, department: e.department, hours: e.hours }] as [string, { name: string; department: string; hours: number }]);

    writeDashboardSheet(wb, {
      periodLabel: weekLabel,
      totalHours,
      totalProjects: projTree.size,
      totalEmployees: empTree.size,
      avgUtilization: util.avgUtilization,
      complianceRate: util.complianceRate,
      missingCount: util.missing.length,
      topProjects,
      topEmployees,
      deptHours: Array.from(deptHours.entries()),
    });
    writeProjectEmployeeTaskSheet(wb, "By Project", "By Project — Employee & Task Detail", subtitle, projTree);
    writeEmployeeProjectTaskSheet(wb, "By Employee", "By Employee — Project & Task Detail", subtitle, empTree);
    writeProjectTaskSheet(wb, "By Task", "Hours by Project & Task", subtitle, taskTree);
    writeUtilizationSheet(wb, "Utilization Report", subtitle, util.rows);
    writeMissingSheet(wb, "Missing Timesheet Report", subtitle, util.missing);

  } else if (type === "plan-actual") {
    // Admin: ทุกแผนก · GES Management: เฉพาะแผนกที่ดูแล (managedDept หรือแผนกตัวเอง)
    if (role !== "admin" && !isGesMgmt(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    let scopeDept: string | null = null;
    if (role !== "admin") {
      const me = await prisma.employee.findUnique({
        where: { id: (session.user as any).id }, select: { managedDept: true, department: true },
      });
      scopeDept = (me?.managedDept && me.managedDept.trim()) || me?.department || null;
      if (!scopeDept) return NextResponse.json({ error: "No department assigned" }, { status: 403 });
    }

    // Period: fromMonth/toMonth ("yyyy-MM", may span years) — falls back to ?year= (Jan–Dec)
    const yearParam = searchParams.get("year");
    const fallbackYear = yearParam ? parseInt(yearParam) : new Date().getFullYear();
    const parseYm = (v: string | null) => {
      const mt = v?.match(/^(\d{4})-(\d{2})$/);
      return mt && Number(mt[2]) >= 1 && Number(mt[2]) <= 12 ? { y: Number(mt[1]), m: Number(mt[2]) } : null;
    };
    let fromYm = parseYm(searchParams.get("fromMonth")) ?? { y: fallbackYear, m: 1 };
    let toYm   = parseYm(searchParams.get("toMonth"))   ?? { y: fromYm.y, m: 12 };
    if (toYm.y * 12 + toYm.m < fromYm.y * 12 + fromYm.m) [fromYm, toYm] = [toYm, fromYm];
    const months: { y: number; m: number }[] = [];
    for (let i = fromYm.y * 12 + fromYm.m - 1; i <= toYm.y * 12 + toYm.m - 1 && months.length < 36; i++) {
      months.push({ y: Math.floor(i / 12), m: (i % 12) + 1 });
    }
    const monthIdx = new Map(months.map((mo, i) => [`${mo.y}-${mo.m}`, i]));
    const idxOf = (y: number, m: number) => monthIdx.get(`${y}-${m}`);
    const first = months[0], last = months[months.length - 1];
    const isCalendarYear = months.length === 12 && first.m === 1;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    // sheet-name safe (≤ 15 chars) and human-readable period labels
    const periodTag = isCalendarYear ? `${first.y}` : `${first.y}-${pad2(first.m)}~${last.y}-${pad2(last.m)}`;
    const periodText = isCalendarYear ? `${first.y}` : `${MONTH_NAMES[first.m - 1]} ${first.y} – ${MONTH_NAMES[last.m - 1]} ${last.y}`;
    const monthLabel = (mo: { y: number; m: number }) => `${MONTH_NAMES[mo.m - 1]} ${mo.y}`;
    planActualTag = periodTag.replace("~", "_to_");
    const LEAVE_CODES = LEAVE_TASK_CODES;

    const projIdsParam = searchParams.get("projectIds");
    const projIdFilter = projIdsParam ? projIdsParam.split(",").filter(Boolean) : null;
    const projWhere = projIdFilter ? { projectId: { in: projIdFilter } } : {};

    const rangeStart = new Date(Date.UTC(first.y, first.m - 1, 1));
    const rangeEnd   = new Date(Date.UTC(last.y, last.m, 1));

    const [plans, rawEntries] = await Promise.all([
      prisma.resourcePlanEmployeeMonthly.findMany({
        where: { year: { gte: first.y, lte: last.y }, ...projWhere, ...(scopeDept ? { employee: { department: scopeDept } } : {}) },
        include: {
          employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
          project:  { select: { id: true, projectNumber: true, projectName: true } },
        },
      }),
      prisma.timesheetEntry.findMany({
        where: {
          // ทุกสัปดาห์ที่มีวันตกในช่วงที่เลือก — ชั่วโมงแบ่งเข้าเดือนตามวันที่จริง
          timesheet: {
            weekStart: weekStartFilterForRange(rangeStart, rangeEnd),
            status: { in: DONE_STATUSES },
            ...(scopeDept ? { employee: { department: scopeDept } } : {}),
          },
          taskCode: { code: { notIn: LEAVE_CODES } },
          ...(projIdFilter ? { projectId: { in: projIdFilter } } : {}),
        },
        include: {
          timesheet: { include: { employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } } } },
          project:   { select: { id: true, projectNumber: true, projectName: true } },
        },
      }),
    ]);

    const MM_HRS = 176; // 1 MM = 176 ชม (มาตรฐาน GES)
    const toMM = (hrs: number) => hrs > 0 ? Math.round((hrs / MM_HRS) * 100) / 100 : 0;
    const fmtMM = (hrs: number): number | string => hrs > 0 ? toMM(hrs) : "–";

    type EmpData = { employeeId: string; name: string; dept: string; position: string; months: { plan: number; actual: number }[] };
    type ProjData = { num: string; name: string; emps: Map<string, EmpData> };
    const projMap = new Map<string, ProjData>();

    const getProj = (id: string, num: string, name: string) => {
      if (!projMap.has(id)) projMap.set(id, { num, name, emps: new Map() });
      return projMap.get(id)!;
    };
    const getEmp = (proj: ProjData, empId: string, empNo: string, empName: string, dept: string, position: string) => {
      if (!proj.emps.has(empId)) proj.emps.set(empId, { employeeId: empNo, name: empName, dept, position, months: months.map(() => ({ plan: 0, actual: 0 })) });
      return proj.emps.get(empId)!;
    };

    for (const p of plans) {
      const i = idxOf(p.year, p.month);
      if (i === undefined) continue;
      const proj = getProj(p.projectId, p.project.projectNumber, p.project.projectName);
      const emp  = getEmp(proj, p.employee.id, p.employee.employeeId, p.employee.name, p.employee.department, p.employee.position ?? "");
      emp.months[i].plan += p.plannedHrs;
    }

    for (const e of rawEntries) {
      if (e.totalHrs === 0) continue;
      const emp0 = e.timesheet.employee;
      for (const [y, m, hrs] of entryMonthHours(e.timesheet.weekStart, e)) {
        const i = idxOf(y, m);
        if (i === undefined) continue;
        const proj = getProj(e.project.id, e.project.projectNumber, e.project.projectName);
        const emp  = getEmp(proj, emp0.id, emp0.employeeId, emp0.name, emp0.department, emp0.position ?? "");
        emp.months[i].actual += hrs;
      }
    }

    const colCount = 4 + months.length * 2 + 3;
    const ws = wb.addWorksheet(`Plan vs Actual ${periodTag}`, { views: [{ state: "frozen", xSplit: 4, ySplit: 5 }] });
    ws.columns = [
      { width: 28 }, { width: 13 }, { width: 28 }, { width: 18 },
      ...Array(months.length * 2).fill({ width: 10 }),
      { width: 14 }, { width: 14 }, { width: 10 },
    ];
    addTitleBand(ws, `GES E-Timesheet — Plan vs Actual ${periodText}`, `หน่วย: Man-Month (176 ชม.)   •   ${scopeDept ? `แผนก: ${scopeDept}` : "ทุกแผนก"}   •   Generated: ${generatedAt}`, colCount);

    const headerMonth: (string)[] = ["โครงการ / พนักงาน", "รหัสพนักงาน", "ตำแหน่ง", "แผนก"];
    const headerSub: string[] = ["", "", "", ""];
    for (const mo of months) {
      headerMonth.push(monthLabel(mo), "");
      headerSub.push("Plan (MM)", "Actual (MM)");
    }
    headerMonth.push("รวม Plan (MM)", "รวม Actual (MM)", "Variance %");
    headerSub.push("", "", "");

    const headerRow1 = 3, headerRow2 = 4;
    ws.getRow(headerRow1).values = headerMonth;
    ws.getRow(headerRow2).values = headerSub;
    months.forEach((_, i) => ws.mergeCells(headerRow1, 5 + i * 2, headerRow1, 6 + i * 2));
    ws.mergeCells(headerRow1, 1, headerRow2, 1);
    ws.mergeCells(headerRow1, 2, headerRow2, 2);
    ws.mergeCells(headerRow1, 3, headerRow2, 3);
    ws.mergeCells(headerRow1, 4, headerRow2, 4);
    const sumStart = 5 + months.length * 2;
    ws.mergeCells(headerRow1, sumStart, headerRow2, sumStart);
    ws.mergeCells(headerRow1, sumStart + 1, headerRow2, sumStart + 1);
    ws.mergeCells(headerRow1, sumStart + 2, headerRow2, sumStart + 2);
    styleHeaderRow(ws, headerRow1, colCount);
    styleHeaderRow(ws, headerRow2, colCount);
    ws.views = [{ state: "frozen", xSplit: 4, ySplit: headerRow2 }];

    let r = headerRow2 + 1;
    const sortedProjs = Array.from(projMap.values()).sort((a, b) => a.num.localeCompare(b.num));

    for (const proj of sortedProjs) {
      ws.getRow(r).values = [`${proj.num} — ${proj.name}`];
      styleGroupRow(ws, r, colCount);
      ws.mergeCells(r, 1, r, colCount);
      r++;

      const projMonthTotals = months.map(() => ({ plan: 0, actual: 0 }));
      const sortedEmps = Array.from(proj.emps.values()).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
      for (const emp of sortedEmps) {
        const row: (string | number)[] = [emp.name, emp.employeeId, emp.position, emp.dept];
        let totalPlan = 0, totalActual = 0;
        for (let mi = 0; mi < months.length; mi++) {
          const { plan, actual } = emp.months[mi];
          row.push(fmtMM(plan), fmtMM(actual));
          totalPlan += plan; totalActual += actual;
          projMonthTotals[mi].plan += plan; projMonthTotals[mi].actual += actual;
        }
        const variance = totalPlan > 0 ? Math.round(((totalActual - totalPlan) / totalPlan) * 100) : null;
        row.push(fmtMM(totalPlan), fmtMM(totalActual), variance !== null ? `${variance}%` : "–");
        ws.getRow(r).values = row;
        for (let c = 1; c <= colCount; c++) {
          const cell = ws.getRow(r).getCell(c);
          cell.border = { top: { style: "hair", color: { argb: COLORS.border } }, bottom: { style: "hair", color: { argb: COLORS.border } } };
          cell.font = { size: 9.5, color: { argb: COLORS.textDark } };
        }
        if (variance !== null) {
          const varCell = ws.getRow(r).getCell(colCount);
          varCell.font = { size: 9.5, bold: true, color: { argb: variance < 0 ? COLORS.danger : COLORS.success } };
        }
        r++;
      }

      const subRow: (string | number)[] = ["", "รวมโครงการ", "", ""];
      let ptPlan = 0, ptActual = 0;
      for (const m of projMonthTotals) {
        subRow.push(fmtMM(m.plan), fmtMM(m.actual));
        ptPlan += m.plan; ptActual += m.actual;
      }
      const ptVariance = ptPlan > 0 ? Math.round(((ptActual - ptPlan) / ptPlan) * 100) : null;
      subRow.push(fmtMM(ptPlan), fmtMM(ptActual), ptVariance !== null ? `${ptVariance}%` : "–");
      ws.getRow(r).values = subRow;
      styleSubtotalRow(ws, r, colCount);
      r++;
      r++; // blank separator
    }

    // ── Sheet 2: per-project summary by department ──
    // Plan = employee plans grouped by the employee's department (same as Workload / Dashboard);
    // Actual = hours logged by employees of that department
    type MonthPair = { plan: number; actual: number }[];
    const newMonths = (): MonthPair => months.map(() => ({ plan: 0, actual: 0 }));
    const deptProjMap = new Map<string, { num: string; name: string; depts: Map<string, MonthPair> }>();
    const getDeptRow = (projId: string, num: string, name: string, dept: string) => {
      if (!deptProjMap.has(projId)) deptProjMap.set(projId, { num, name, depts: new Map() });
      const p = deptProjMap.get(projId)!;
      if (!p.depts.has(dept)) p.depts.set(dept, newMonths());
      return p.depts.get(dept)!;
    };
    for (const p of plans) {
      const i = idxOf(p.year, p.month);
      if (i === undefined) continue;
      getDeptRow(p.projectId, p.project.projectNumber, p.project.projectName, p.employee.department || "(ไม่ระบุแผนก)")[i].plan += p.plannedHrs;
    }
    for (const e of rawEntries) {
      if (e.totalHrs === 0) continue;
      for (const [y, m, hrs] of entryMonthHours(e.timesheet.weekStart, e)) {
        const i = idxOf(y, m);
        if (i === undefined) continue;
        getDeptRow(e.project.id, e.project.projectNumber, e.project.projectName, e.timesheet.employee.department || "(ไม่ระบุแผนก)")[i].actual += hrs;
      }
    }

    // Builds a "label + 12 × (Plan, Actual) + totals + variance" sheet; returns row writers bound to it
    const dsColCount = 1 + months.length * 2 + 3;
    const addMMSheet = (sheetName: string, title: string, firstHeader: string) => {
      const ws = wb.addWorksheet(sheetName);
      ws.columns = [{ width: 40 }, ...Array(months.length * 2).fill({ width: 10 }), { width: 14 }, { width: 14 }, { width: 10 }];
      addTitleBand(ws, title, `หน่วย: Man-Month (176 ชม.)   •   Plan / Actual = รวมของพนักงานในแผนก   •   ${scopeDept ? `แผนก: ${scopeDept}` : "ทุกแผนก"}   •   Generated: ${generatedAt}`, dsColCount);
      const head1: string[] = [firstHeader];
      const head2: string[] = [""];
      for (const mo of months) {
        head1.push(monthLabel(mo), "");
        head2.push("Plan (MM)", "Actual (MM)");
      }
      head1.push("รวม Plan (MM)", "รวม Actual (MM)", "Variance %");
      head2.push("", "", "");
      ws.getRow(headerRow1).values = head1;
      ws.getRow(headerRow2).values = head2;
      months.forEach((_, i) => ws.mergeCells(headerRow1, 2 + i * 2, headerRow1, 3 + i * 2));
      ws.mergeCells(headerRow1, 1, headerRow2, 1);
      const sumStart = 2 + months.length * 2;
      for (let c = sumStart; c < sumStart + 3; c++) ws.mergeCells(headerRow1, c, headerRow2, c);
      styleHeaderRow(ws, headerRow1, dsColCount);
      styleHeaderRow(ws, headerRow2, dsColCount);
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow2 }];

      // label + months + totals + variance; adds into `acc` when given; detail rows get hairline styling
      const writeRow = (rowNo: number, label: string, data: MonthPair, opts: { acc?: MonthPair; detail?: boolean } = {}) => {
        const row: (string | number)[] = [label];
        let tPlan = 0, tActual = 0;
        data.forEach(({ plan, actual }, mi) => {
          row.push(fmtMM(plan), fmtMM(actual));
          tPlan += plan; tActual += actual;
          if (opts.acc) { opts.acc[mi].plan += plan; opts.acc[mi].actual += actual; }
        });
        const variance = tPlan > 0 ? Math.round(((tActual - tPlan) / tPlan) * 100) : null;
        row.push(fmtMM(tPlan), fmtMM(tActual), variance !== null ? `${variance}%` : "–");
        ws.getRow(rowNo).values = row;
        if (!opts.detail) { styleSubtotalRow(ws, rowNo, dsColCount); return; }
        for (let c = 1; c <= dsColCount; c++) {
          const cell = ws.getRow(rowNo).getCell(c);
          cell.border = { top: { style: "hair", color: { argb: COLORS.border } }, bottom: { style: "hair", color: { argb: COLORS.border } } };
          cell.font = { size: 9.5, color: { argb: COLORS.textDark } };
        }
        if (variance !== null) {
          ws.getRow(rowNo).getCell(dsColCount).font = { size: 9.5, bold: true, color: { argb: variance < 0 ? COLORS.danger : COLORS.success } };
        }
      };
      const writeGroup = (rowNo: number, label: string) => {
        ws.getRow(rowNo).values = [label];
        styleGroupRow(ws, rowNo, dsColCount);
        ws.mergeCells(rowNo, 1, rowNo, dsColCount);
      };
      return { writeRow, writeGroup };
    };
    const byName = <T,>(a: [string, T], b: [string, T]) => a[0].localeCompare(b[0]);
    const sortedDeptProjs = Array.from(deptProjMap.values()).sort((a, b) => a.num.localeCompare(b.num));

    // Sheet 2: project → departments, then all departments across projects
    {
      const { writeRow, writeGroup } = addMMSheet(`Summary by Dept ${periodTag}`, `GES E-Timesheet — สรุปรายโครงการ แยกตามแผนก ${periodText}`, "โครงการ / แผนก");
      let dr = headerRow2 + 1;
      const allDeptTotals = new Map<string, MonthPair>();
      for (const proj of sortedDeptProjs) {
        writeGroup(dr++, `${proj.num} — ${proj.name}`);
        const projTotals = newMonths();
        for (const [dept, data] of Array.from(proj.depts.entries()).sort(byName)) {
          if (!allDeptTotals.has(dept)) allDeptTotals.set(dept, newMonths());
          const acc = allDeptTotals.get(dept)!;
          data.forEach((m, mi) => { acc[mi].plan += m.plan; acc[mi].actual += m.actual; });
          writeRow(dr++, `    ${dept}`, data, { acc: projTotals, detail: true });
        }
        writeRow(dr, "รวมโครงการ", projTotals);
        dr += 2;
      }
      if (allDeptTotals.size > 0) {
        writeGroup(dr++, "รวมทุกโครงการ — แยกตามแผนก");
        const grand = newMonths();
        for (const [dept, data] of Array.from(allDeptTotals.entries()).sort(byName)) {
          writeRow(dr++, `    ${dept}`, data, { acc: grand, detail: true });
        }
        writeRow(dr, "รวมทั้งหมด", grand);
      }
    }

    // Sheet 3: department → projects (each department sees its projects with Plan/Actual MM)
    {
      const { writeRow, writeGroup } = addMMSheet(`Dept by Project ${periodTag}`, `GES E-Timesheet — สรุปรายแผนก แยกตามโครงการ ${periodText}`, "แผนก / โครงการ");
      const deptMap = new Map<string, { label: string; data: MonthPair }[]>();
      for (const proj of sortedDeptProjs) {
        for (const [dept, data] of Array.from(proj.depts.entries())) {
          if (!deptMap.has(dept)) deptMap.set(dept, []);
          deptMap.get(dept)!.push({ label: `    ${proj.num} — ${proj.name}`, data });
        }
      }
      let dr = headerRow2 + 1;
      const grand = newMonths();
      for (const [dept, projs] of Array.from(deptMap.entries()).sort(byName)) {
        writeGroup(dr++, dept);
        const deptTotals = newMonths();
        for (const p of projs) writeRow(dr++, p.label, p.data, { acc: deptTotals, detail: true });
        deptTotals.forEach((m, mi) => { grand[mi].plan += m.plan; grand[mi].actual += m.actual; });
        writeRow(dr, `รวม ${dept}`, deptTotals);
        dr += 2;
      }
      if (deptMap.size > 1) writeRow(dr, "รวมทุกแผนก", grand);
    }
  }

  const filename = type === "plan-actual"
    ? `GES_PlanActual_${planActualTag}${role !== "admin" ? "_dept" : ""}_${format(new Date(), "yyyyMMdd")}.xlsx`
    : `GES_Timesheet_${type}_${isRange ? "range_" : isMonth ? "month_" : ""}${periodKey}.xlsx`;

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
