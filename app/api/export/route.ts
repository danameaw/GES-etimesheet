import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, endOfWeek, format } from "date-fns";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "weekly";
  const weekParam = searchParams.get("week");

  let weekStart: Date;
  if (weekParam) {
    weekStart = startOfWeek(new Date(weekParam), { weekStartsOn: 1 });
  } else {
    weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  }
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const wb = XLSX.utils.book_new();
  const weekLabel = `${format(weekStart, "dd-MMM")} to ${format(weekEnd, "dd-MMM-yyyy")}`;

  if (type === "weekly") {
    // Sheet 1: Timesheet Weekly Report
    const timesheets = await prisma.timesheet.findMany({
      where: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } },
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
    // Sheet: By Project Summary
    const entries = await prisma.timesheetEntry.findMany({
      where: { timesheet: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } } },
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
    // Sheet: Utilization by Employee
    const [allEmployees, timesheets] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
      prisma.timesheet.findMany({
        where: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } },
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
    // Sheet: Missing Timesheet Report
    const [allEmployees, timesheets] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
      prisma.timesheet.findMany({ where: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } } }),
    ]);

    const submittedIds = new Set(timesheets.filter((t) => t.status === "submitted").map((t) => t.employeeId));

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
