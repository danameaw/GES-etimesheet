import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";

const MS_13H = 13 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;
  if (!["admin", "pd", "ges_pd", "md", "ges_management"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const view      = searchParams.get("view"); // "employee" (default) | "project"

  const weekStart = weekParam
    ? new Date(weekParam + "T00:00:00.000Z")
    : startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

  const weekStartMin = new Date(weekStart.getTime() - MS_13H);
  const weekStartMax = new Date(weekStart.getTime() + MS_13H);

  // ── For PD: find their projects (pdId OR managerId) ──────────────────────
  let pdProjectIds: Set<string> | null = null;
  if (role === "pd" || role === "ges_pd") {
    const pdProjects = await prisma.project.findMany({
      where: { isActive: true, OR: [{ pdId: empDbId }, { managerId: empDbId }] },
      select: { id: true },
    });
    pdProjectIds = new Set(pdProjects.map((p) => p.id));
  }

  // ── For MD: เห็นเฉพาะโครงการ GES-OH (projectType = "support") ─────────────
  let mdProjectIds: Set<string> | null = null;
  if (role === "md") {
    const ohProjects = await prisma.project.findMany({
      where: { isActive: true, OR: [{ projectType: "support" }, { projectNumber: { startsWith: "GES-OH" } }] },
      select: { id: true },
    });
    mdProjectIds = new Set(ohProjects.map((p) => p.id));
  }

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

  // fetch per-project PD approvals โดยใช้ timesheetIds ที่ได้มาแล้ว
  const tsIds = timesheets.map((t) => t.id);
  const projApprovals = tsIds.length > 0
    ? await (prisma as any).timesheetProjectApproval.findMany({
        where: { timesheetId: { in: tsIds } },
        select: { timesheetId: true, projectId: true },
      })
    : [];

  // lookup set: "timesheetId|projectId" → approved by PD
  const projApprovalSet = new Set<string>(
    (projApprovals as { timesheetId: string; projectId: string }[])
      .map((a) => `${a.timesheetId}|${a.projectId}`)
  );

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
      status:      (ts?.status === "submitted" && totalHrs === 0) ? "draft" : ts?.status || "missing",
      submittedAt: ts?.submittedAt || null,
      totalHrs,
    };
  });

  // กรอง project IDs ตาม role
  const scopedProjectIds = pdProjectIds ?? mdProjectIds ?? null;

  const scopedEmpIds = scopedProjectIds
    ? new Set(
        timesheets
          .filter((ts) => ts.entries.some((e) => scopedProjectIds.has(e.project.id)))
          .map((ts) => ts.employeeId)
      )
    : null;

  const countRows = scopedEmpIds
    ? employeeRows.filter((e) => scopedEmpIds.has(e.id))
    : employeeRows;

  const submitted = countRows.filter((e) => e.status === "submitted").length;
  const draft     = countRows.filter((e) => e.status === "draft").length;
  const missing   = countRows.filter((e) => e.status === "missing").length;
  const rejected  = countRows.filter((e) => e.status === "rejected").length;

  // ── Project-view grouping ──────────────────────────────────────────────────
  let projectRows: any[] = [];
  if (view === "project") {
    // Planned hours for this month (week's month)
    const year  = weekStart.getUTCFullYear();
    const month = weekStart.getUTCMonth() + 1;
    const planData = await prisma.resourcePlanEmployeeMonthly.findMany({
      where: { year, month },
      select: { projectId: true, employeeId: true, plannedHrs: true },
    });
    const planMap = new Map<string, number>();
    for (const p of planData) planMap.set(`${p.projectId}|${p.employeeId}`, p.plannedHrs);

    const projMap = new Map<string, {
      projectId: string; projectNumber: string; projectName: string;
      employees: { id: string; employeeId: string; name: string; department: string;
                   timesheetId: string; status: string; totalHrs: number;
                   projectHrs: number; plannedHrs: number }[];
    }>();

    for (const ts of timesheets) {
      const tsTotalHrs = ts.entries.reduce((s, e) => s + e.totalHrs, 0);
      for (const entry of ts.entries) {
        if (entry.totalHrs === 0) continue;
        const p = entry.project;
        // กรองตาม scope (PD = projects ของตัวเอง, MD = GES-OH)
        if (scopedProjectIds && !scopedProjectIds.has(p.id)) continue;

        if (!projMap.has(p.id)) {
          projMap.set(p.id, { projectId: p.id, projectNumber: p.projectNumber, projectName: p.projectName, employees: [] });
        }
        const proj = projMap.get(p.id)!;
        const exists = proj.employees.find((e) => e.id === ts.employee.id);
        if (exists) {
          exists.projectHrs += entry.totalHrs;
        } else {
          // status priority: timesheet "approved" (admin) > "project-approved" (PD per-project) > timesheet.status
          const pdApproved = projApprovalSet.has(`${ts.id}|${p.id}`);
          const status = ts.status === "approved"
            ? "approved"
            : pdApproved
              ? "project-approved"
              : ts.status;
          proj.employees.push({
            id:          ts.employee.id,
            employeeId:  ts.employee.employeeId,
            name:        ts.employee.name,
            department:  ts.employee.department,
            timesheetId: ts.id,
            status,
            totalHrs:    tsTotalHrs,
            projectHrs:  entry.totalHrs,
            plannedHrs:  planMap.get(`${p.id}|${ts.employee.id}`) ?? 0,
          });
        }
      }
    }

    projectRows = Array.from(projMap.values())
      .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
  }

  // Summary: count only employees in scoped projects
  const summaryEmployees = scopedProjectIds
    ? allEmployees.filter((e) => {
        const ts = timesheetMap.get(e.id);
        return ts?.entries.some((en) => scopedProjectIds!.has(en.project.id));
      })
    : allEmployees;

  return NextResponse.json({
    summary: {
      total:        pdProjectIds ? summaryEmployees.length : allEmployees.length,
      submitted,
      draft,
      missing,
      rejected,
      weekStart,
      weekEnd,
      weekCapacity: 40,
    },
    employees: employeeRows,
    projectRows,
  });
}
