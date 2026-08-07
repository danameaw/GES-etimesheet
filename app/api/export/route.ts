import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
async function computeUtilization(tsWeekFilter: { gte: Date; lt: Date }, projEntryFilter: any, weeksCount: number, isMonth: boolean) {
  const [allEmployees, timesheets] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
    prisma.timesheet.findMany({
      where: { weekStart: tsWeekFilter },
      include: { employee: true, entries: { where: projEntryFilter } },
    }),
  ]);

  const aggMap = new Map<string, { hrs: number; done: number; lastStatus: string }>();
  for (const t of timesheets) {
    const a = aggMap.get(t.employeeId) ?? { hrs: 0, done: 0, lastStatus: t.status };
    a.hrs += t.entries.reduce((s, e) => s + e.totalHrs, 0);
    if (DONE_STATUSES.includes(t.status)) a.done += 1;
    a.lastStatus = t.status;
    aggMap.set(t.employeeId, a);
  }

  const capacity = 40 * weeksCount;
  const submittedIds = new Set(timesheets.filter((t) => DONE_STATUSES.includes(t.status)).map((t) => t.employeeId));

  const rows: UtilizationRow[] = [];
  const missing: { employeeId: string; name: string; department: string; position: string; status: string }[] = [];

  for (const emp of allEmployees) {
    const a = aggMap.get(emp.id);
    const totalHrs = a?.hrs || 0;
    const utilization = Math.round((totalHrs / capacity) * 100);
    const status = !a ? "missing" : isMonth ? `${a.done}/${weeksCount} weeks` : a.lastStatus;
    rows.push({ employeeId: emp.employeeId, name: emp.name, department: emp.department, position: emp.position, hours: totalHrs, utilization, status });
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
  let weeksCount = 1; // for utilization capacity (weeks × 40h)

  if (isRange) {
    const first = mondayOfUTC(new Date(fromParam + "T00:00:00.000Z"));
    const last = mondayOfUTC(new Date(toParam + "T00:00:00.000Z"));
    weeksCount = Math.max(1, Math.round((last.getTime() - first.getTime()) / (7 * 86400000)) + 1);
    tsWeekFilter = { gte: new Date(first.getTime() - MS_13H), lt: new Date(last.getTime() + MS_13H) };
    periodLabel = `${format(first, "dd-MMM-yyyy")} to ${format(new Date(last.getTime() + 6 * 86400000), "dd-MMM-yyyy")}`;
    periodKey = `${format(first, "yyyyMMdd")}-${format(last, "yyyyMMdd")}`;
  } else if (isMonth) {
    const monthStart = new Date(monthParam + "T00:00:00.000Z");
    const weeks = weeksInMonthUTC(monthStart);
    weeksCount = weeks.length;
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    tsWeekFilter = { gte: new Date(first.getTime() - MS_13H), lt: new Date(last.getTime() + MS_13H) };
    periodLabel = format(monthStart, "MMMM yyyy");
    periodKey = format(monthStart, "yyyy-MM");
  } else {
    const weekStart = weekParam
      ? new Date(weekParam + "T00:00:00.000Z")
      : startOfWeek(new Date(), { weekStartsOn: 1 });
    tsWeekFilter = weekRange(weekStart);
    periodLabel = `${format(weekStart, "dd-MMM")} to ${format(new Date(weekStart.getTime() + 6 * 86400000), "dd-MMM-yyyy")}`;
    periodKey = format(weekStart, "yyyy-MM-dd");
  }

  const wb = new ExcelJS.Workbook();
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
    const { rows } = await computeUtilization(tsWeekFilter, projEntryFilter, weeksCount, isMonth);
    writeUtilizationSheet(wb, "GES E-Timesheet — Utilization Report", subtitle, rows);

  } else if (type === "missing") {
    const { missing } = await computeUtilization(tsWeekFilter, projEntryFilter, weeksCount, isMonth);
    writeMissingSheet(wb, "GES E-Timesheet — Missing Timesheet Report", subtitle, missing);

  } else if (type === "executive") {
    const [entries, util] = await Promise.all([
      fetchEntries(),
      computeUtilization(tsWeekFilter, projEntryFilter, weeksCount, isMonth),
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
    // Admin only
    if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
    const months = [1,2,3,4,5,6,7,8,9,10,11,12];
    const LEAVE_CODES = ["1001","1002","1003","1004","1005"];

    const projIdsParam = searchParams.get("projectIds");
    const projIdFilter = projIdsParam ? projIdsParam.split(",").filter(Boolean) : null;
    const projWhere = projIdFilter ? { projectId: { in: projIdFilter } } : {};

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd   = new Date(Date.UTC(year + 1, 0, 1));

    const [plans, rawEntries] = await Promise.all([
      prisma.resourcePlanEmployeeMonthly.findMany({
        where: { year, ...projWhere },
        include: {
          employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
          project:  { select: { id: true, projectNumber: true, projectName: true } },
        },
      }),
      prisma.timesheetEntry.findMany({
        where: {
          timesheet: {
            weekStart: { gte: new Date(yearStart.getTime() - MS_13H), lt: new Date(yearEnd.getTime() + MS_13H) },
            status: { in: DONE_STATUSES },
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
      const proj = getProj(p.projectId, p.project.projectNumber, p.project.projectName);
      const emp  = getEmp(proj, p.employee.id, p.employee.employeeId, p.employee.name, p.employee.department, p.employee.position ?? "");
      emp.months[p.month - 1].plan += p.plannedHrs;
    }

    for (const e of rawEntries) {
      if (e.totalHrs === 0) continue;
      const d = new Date(e.timesheet.weekStart);
      const m = d.getUTCMonth() + 1;
      if (d.getUTCFullYear() !== year) continue;
      const emp0 = e.timesheet.employee;
      const proj = getProj(e.project.id, e.project.projectNumber, e.project.projectName);
      const emp  = getEmp(proj, emp0.id, emp0.employeeId, emp0.name, emp0.department, emp0.position ?? "");
      emp.months[m - 1].actual += e.totalHrs;
    }

    const colCount = 4 + months.length * 2 + 3;
    const ws = wb.addWorksheet(`Plan vs Actual ${year}`, { views: [{ state: "frozen", xSplit: 4, ySplit: 5 }] });
    ws.columns = [
      { width: 28 }, { width: 13 }, { width: 28 }, { width: 18 },
      ...Array(months.length * 2).fill({ width: 10 }),
      { width: 14 }, { width: 14 }, { width: 10 },
    ];
    addTitleBand(ws, `GES E-Timesheet — Plan vs Actual ${year}`, `หน่วย: Man-Month (176 ชม.)   •   Generated: ${generatedAt}   •   Admin only`, colCount);

    const headerMonth: (string)[] = ["โครงการ / พนักงาน", "รหัสพนักงาน", "ตำแหน่ง", "แผนก"];
    const headerSub: string[] = ["", "", "", ""];
    for (const m of months) {
      headerMonth.push(`${MONTH_NAMES[m-1]} ${year}`, "");
      headerSub.push("Plan (MM)", "Actual (MM)");
    }
    headerMonth.push("รวม Plan (MM)", "รวม Actual (MM)", "Variance %");
    headerSub.push("", "", "");

    const headerRow1 = 3, headerRow2 = 4;
    ws.getRow(headerRow1).values = headerMonth;
    ws.getRow(headerRow2).values = headerSub;
    for (const m of months) {
      const startCol = 5 + (m - 1) * 2;
      ws.mergeCells(headerRow1, startCol, headerRow1, startCol + 1);
    }
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
        for (let mi = 0; mi < 12; mi++) {
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
  }

  const filename = type === "plan-actual"
    ? `GES_PlanActual_${searchParams.get("year") || new Date().getFullYear()}_${format(new Date(), "yyyyMMdd")}.xlsx`
    : `GES_Timesheet_${type}_${isRange ? "range_" : isMonth ? "month_" : ""}${periodKey}.xlsx`;

  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
