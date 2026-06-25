import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, format } from "date-fns";
import * as XLSX from "xlsx";

const MS_13H = 13 * 60 * 60 * 1000;
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ±13h tolerance window for backward-compat with Thailand UTC+7 stored dates
function weekRange(weekStart: Date) {
  const MS_13H = 13 * 60 * 60 * 1000;
  return { gte: new Date(weekStart.getTime() - MS_13H), lt: new Date(weekStart.getTime() + MS_13H) };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "ges_management", "ges_pd", "md", "pd"].includes((session.user as any).role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "weekly";
  const weekParam = searchParams.get("week");
  const role = (session.user as any).role;

  // weekParam sent as "yyyy-MM-dd" to avoid timezone shifts
  const weekStart = weekParam
    ? new Date(weekParam + "T00:00:00.000Z")
    : startOfWeek(new Date(), { weekStartsOn: 1 });

  const wb = XLSX.utils.book_new();
  const weekLabel = `${format(weekStart, "dd-MMM")} to ${format(new Date(weekStart.getTime() + 6 * 86400000), "dd-MMM-yyyy")}`;

  // Only export submitted or approved timesheets
  const DONE_STATUSES = ["submitted", "approved"];

  if (type === "weekly") {
    const timesheets = await prisma.timesheet.findMany({
      where: { weekStart: weekRange(weekStart), status: { in: DONE_STATUSES } },
      include: {
        employee: true,
        entries: { include: { project: true, taskCode: true } },
      },
    });

    const rows: any[][] = [
      [`GES E-Timesheet - Weekly Report: ${weekLabel}`],
      [],
      ["Employee ID", "Employee Name", "Department", "Project No.", "Project Name", "Task Code", "Task Name", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Total", "Status"],
    ];

    for (const ts of timesheets) {
      for (const entry of ts.entries) {
        if (entry.totalHrs === 0) continue;
        rows.push([
          ts.employee.employeeId,
          ts.employee.name,
          ts.employee.department,
          entry.project.projectNumber,
          entry.project.projectName,
          entry.taskCode.code,
          entry.taskCode.name,
          entry.monHrs, entry.tueHrs, entry.wedHrs,
          entry.thuHrs, entry.friHrs, entry.satHrs, entry.sunHrs,
          entry.totalHrs,
          ts.status,
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 35 }, { wch: 8 }, { wch: 25 }, ...Array(8).fill({ wch: 6 }), { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Weekly Report");

  } else if (type === "project") {
    const entries = await prisma.timesheetEntry.findMany({
      where: { timesheet: { weekStart: weekRange(weekStart), status: { in: DONE_STATUSES } } },
      include: { project: true, taskCode: true, timesheet: { include: { employee: true } } },
    });

    const projectMap = new Map<string, { name: string; hours: number; employees: Set<string> }>();
    for (const e of entries) {
      const key = e.project.projectNumber;
      if (!projectMap.has(key)) {
        projectMap.set(key, { name: e.project.projectName, hours: 0, employees: new Set() });
      }
      projectMap.get(key)!.hours += e.totalHrs;
      projectMap.get(key)!.employees.add(e.timesheet.employee.employeeId);
    }

    const rows: any[][] = [
      [`GES E-Timesheet - Project Summary: ${weekLabel}`],
      [],
      ["Project No.", "Project Name", "Total Hours", "No. of Engineers"],
    ];

    for (const [num, data] of Array.from(projectMap.entries()).sort((a, b) => b[1].hours - a[1].hours)) {
      rows.push([num, data.name, data.hours, data.employees.size]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "By Project");

  } else if (type === "utilization") {
    const [allEmployees, timesheets] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
      prisma.timesheet.findMany({
        where: { weekStart: weekRange(weekStart) },
        include: { employee: true, entries: true },
      }),
    ]);

    const tsMap = new Map(timesheets.map((t) => [t.employeeId, t]));

    const rows: any[][] = [
      [`GES E-Timesheet - Utilization Report: ${weekLabel}`],
      [],
      ["Employee ID", "Employee Name", "Department", "Position", "Total Hours", "Utilization %", "Status"],
    ];

    for (const emp of allEmployees) {
      const ts = tsMap.get(emp.id);
      const totalHrs = ts?.entries.reduce((s, e) => s + e.totalHrs, 0) || 0;
      const utilization = Math.round((totalHrs / 40) * 100);
      rows.push([
        emp.employeeId,
        emp.name,
        emp.department,
        emp.position,
        totalHrs,
        `${utilization}%`,
        ts?.status || "missing",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Utilization");

  } else if (type === "missing") {
    const [allEmployees, timesheets] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
      prisma.timesheet.findMany({ where: { weekStart: weekRange(weekStart) } }),
    ]);

    const submittedIds = new Set(
      timesheets.filter((t) => DONE_STATUSES.includes(t.status)).map((t) => t.employeeId)
    );

    const rows: any[][] = [
      [`GES E-Timesheet - Missing Timesheet Report: ${weekLabel}`],
      [],
      ["Employee ID", "Employee Name", "Department", "Position", "Status"],
    ];

    for (const emp of allEmployees) {
      if (!submittedIds.has(emp.id)) {
        const ts = timesheets.find((t) => t.employeeId === emp.id);
        rows.push([emp.employeeId, emp.name, emp.department, emp.position, ts?.status || "missing"]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 30 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Missing");
  } else if (type === "plan-actual") {
    // Admin only
    if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
    const months = [1,2,3,4,5,6,7,8,9,10,11,12];
    const LEAVE_CODES = ["1001","1002","1003","1004","1005"];

    // optional project filter
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
    const fmtMM = (hrs: number) => hrs > 0 ? toMM(hrs) : "–";

    // Build structure: projectId → employeeId → monthIndex → { plan, actual }
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

    // Plans
    for (const p of plans) {
      const proj = getProj(p.projectId, p.project.projectNumber, p.project.projectName);
      const emp  = getEmp(proj, p.employee.id, p.employee.employeeId, p.employee.name, p.employee.department, p.employee.position ?? "");
      emp.months[p.month - 1].plan += p.plannedHrs;
    }

    // Actuals (only within the year)
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

    // Build header rows (Plan/Actual in MM)
    const headerMonth = ["โครงการ / พนักงาน", "รหัสพนักงาน", "ตำแหน่ง", "แผนก"];
    const headerSub   = ["", "", "", ""];
    for (const m of months) {
      headerMonth.push(`${MONTH_NAMES[m-1]} ${year}`, "");
      headerSub.push("Plan (MM)", "Actual (MM)");
    }
    headerMonth.push("รวม Plan (MM)", "รวม Actual (MM)", "Variance %");
    headerSub.push("", "", "");

    const rows: any[][] = [
      [`GES E-Timesheet — Plan vs Actual ${year}  (หน่วย: Man-Month = 176 ชม)`],
      [`Export: ${format(new Date(), "dd/MM/yyyy HH:mm")}  (Admin only)`],
      [],
      headerMonth,
      headerSub,
    ];

    // Sort projects by projectNumber
    const sortedProjs = Array.from(projMap.values()).sort((a, b) => a.num.localeCompare(b.num));

    for (const proj of sortedProjs) {
      // Project header
      rows.push([`${proj.num} — ${proj.name}`, "", "", "", ...Array(months.length * 2 + 3).fill("")]);

      const projMonthTotals = months.map(() => ({ plan: 0, actual: 0 }));

      // Employee rows sorted by employeeId
      const sortedEmps = Array.from(proj.emps.values()).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
      for (const emp of sortedEmps) {
        const row: any[] = [emp.name, emp.employeeId, emp.position, emp.dept];
        let totalPlan = 0, totalActual = 0;
        for (let mi = 0; mi < 12; mi++) {
          const { plan, actual } = emp.months[mi];
          row.push(fmtMM(plan), fmtMM(actual));
          totalPlan   += plan;
          totalActual += actual;
          projMonthTotals[mi].plan   += plan;
          projMonthTotals[mi].actual += actual;
        }
        const variance = totalPlan > 0 ? `${Math.round(((totalActual - totalPlan) / totalPlan) * 100)}%` : "–";
        row.push(fmtMM(totalPlan), fmtMM(totalActual), variance);
        rows.push(row);
      }

      // Project subtotal row (MM)
      const subRow: any[] = ["", "รวมโครงการ", "", ""];
      let ptPlan = 0, ptActual = 0;
      for (const m of projMonthTotals) {
        subRow.push(fmtMM(m.plan), fmtMM(m.actual));
        ptPlan += m.plan; ptActual += m.actual;
      }
      const ptVariance = ptPlan > 0 ? `${Math.round(((ptActual - ptPlan) / ptPlan) * 100)}%` : "–";
      subRow.push(fmtMM(ptPlan), fmtMM(ptActual), ptVariance);
      rows.push(subRow);
      rows.push([]); // blank separator
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Column widths: name, empId, position, dept + 2 cols per month + 3 summary cols
    ws["!cols"] = [
      { wch: 28 }, { wch: 13 }, { wch: 28 }, { wch: 18 },
      ...Array(24).fill({ wch: 10 }),
      { wch: 14 }, { wch: 14 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, `Plan vs Actual ${year}`);

    const buf2 = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const fname2 = `GES_PlanActual_${year}_${format(new Date(), "yyyyMMdd")}.xlsx`;
    return new NextResponse(buf2, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname2}"`,
      },
    });
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `GES_Timesheet_${type}_${format(weekStart, "yyyy-MM-dd")}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
