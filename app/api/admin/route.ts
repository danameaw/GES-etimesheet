import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";

const MS_13H = 13 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (!["admin", "pd", "md"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const view      = searchParams.get("view"); // "employee" (default) | "project"

  const weekStart = weekParam
    ? new Date(weekParam + "T00:00:00.000Z")
    : startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

  const weekStartMin = new Date(weekStart.getTime() - MS_13H);
  const weekStartMax = new Date(weekStart.getTime() + MS_13H);

  const [allEmployees, timesheets] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { employeeId: "asc" } }),
    prisma.timesheet.findMany({
      where: { weekStart: { gte: weekStartMin, lt: weekStartMax } },
      include: {
        employee: true,
        entries: {
          include: { project: { select: { id: true, projectNumber: true, projectName: true } } },
        },
      },
    }),
  ]);

  const timesheetMap = new Map(timesheets.map((t) => [t.employeeId, t]));

  const employeeRows = allEmployees.map((emp) => {
    const ts = timesheetMap.get(emp.id);
    const totalHrs = ts?.entries.reduce((sum, e) => sum + e.totalHrs, 0) || 0;
    return {
      id:          emp.id,
      employeeId:  emp.employeeId,
      name:        emp.name,
      department:  emp.department,
      position:    emp.position,
      timesheetId: ts?.id || null,
      status:      ts?.status || "missing",
      submittedAt: ts?.submittedAt || null,
      totalHrs,
    };
  });

  const submitted = employeeRows.filter((e) => e.status === "submitted").length;
  const draft     = employeeRows.filter((e) => e.status === "draft").length;
  const missing   = employeeRows.filter((e) => e.status === "missing").length;

  // ── Project-view grouping ──────────────────────────────────────────────────
  let projectRows: any[] = [];
  if (view === "project") {
    const projMap = new Map<string, {
      projectId: string; projectNumber: string; projectName: string;
      employees: { id: string; employeeId: string; name: string; department: string;
                   timesheetId: string; status: string; totalHrs: number; projectHrs: number }[];
    }>();

    for (const ts of timesheets) {
      const tsTotalHrs = ts.entries.reduce((s, e) => s + e.totalHrs, 0);
      for (const entry of ts.entries) {
        const p = entry.project;
        if (!projMap.has(p.id)) {
          projMap.set(p.id, { projectId: p.id, projectNumber: p.projectNumber, projectName: p.projectName, employees: [] });
        }
        const proj = projMap.get(p.id)!;
        const exists = proj.employees.find((e) => e.id === ts.employeeId);
        if (exists) {
          exists.projectHrs += entry.totalHrs;
        } else {
          proj.employees.push({
            id:          ts.employee.id,
            employeeId:  ts.employee.employeeId,
            name:        ts.employee.name,
            department:  ts.employee.department,
            timesheetId: ts.id,
            status:      ts.status,
            totalHrs:    tsTotalHrs,
            projectHrs:  entry.totalHrs,
          });
        }
      }
    }

    projectRows = Array.from(projMap.values())
      .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
  }

  return NextResponse.json({
    summary: { total: allEmployees.length, submitted, draft, missing, weekStart, weekEnd, weekCapacity: 40 },
    employees: employeeRows,
    projectRows,
  });
}
