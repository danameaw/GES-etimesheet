import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, subWeeks, format, addDays } from "date-fns";

// ±13h tolerance for backward-compat with old UTC+7 stored dates
const MS_13H = 13 * 60 * 60 * 1000;
function weekRange(wStart: Date) {
  return { gte: new Date(wStart.getTime() - MS_13H), lt: new Date(wStart.getTime() + MS_13H) };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Dashboard is PD-only
  if ((session.user as any).role !== "pd") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");   // yyyy-MM-dd  (specific week)
  const monthParam = searchParams.get("month"); // yyyy-MM     (full month)
  const mode = monthParam ? "month" : "week";

  // Build timesheet date filter
  let timesheetDateFilter: any = {};
  if (mode === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    const mStart = new Date(Date.UTC(y, m - 1, 1));
    const mEnd   = new Date(Date.UTC(y, m,     1)); // exclusive start of next month
    // Cast a wide net: any weekStart that could belong to this month (±13h on both ends)
    timesheetDateFilter = { gte: new Date(mStart.getTime() - MS_13H), lt: new Date(mEnd.getTime() + MS_13H) };
  } else if (weekParam) {
    const wStart = new Date(weekParam + "T00:00:00.000Z");
    timesheetDateFilter = weekRange(wStart);
  }
  // No filter = all-time (fallback)

  const whereClause: any = { status: { in: ["submitted", "approved"] } };
  if (Object.keys(timesheetDateFilter).length > 0) {
    whereClause.weekStart = timesheetDateFilter;
  }

  const allTimesheets = await prisma.timesheet.findMany({
    where: whereClause,
    include: { entries: { include: { project: true, taskCode: true } }, employee: true },
    orderBy: { updatedAt: "desc" },
  });

  // Deduplicate: keep one timesheet per (employeeId + weekStart-rounded)
  const seen = new Set<string>();
  const dedupedTimesheets = allTimesheets.filter((ts) => {
    const dayKey = new Date(Math.round(ts.weekStart.getTime() / 86400000) * 86400000).toISOString().slice(0, 10);
    const key = `${ts.employeeId}-${dayKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const entries = dedupedTimesheets.flatMap((ts) =>
    ts.entries.map((e) => ({ ...e, timesheet: ts as any }))
  );

  // Hours by project (top 10)
  const projectHoursMap = new Map<string, { name: string; hours: number }>();
  for (const e of entries) {
    const key = e.project.projectNumber;
    const existing = projectHoursMap.get(key);
    if (existing) existing.hours += e.totalHrs;
    else projectHoursMap.set(key, { name: e.project.projectName, hours: e.totalHrs });
  }
  const projectHours = Array.from(projectHoursMap.entries())
    .map(([num, v]) => ({ projectNumber: num, projectName: v.name, hours: v.hours }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  // Hours by task category
  const categoryMap = new Map<string, number>();
  for (const e of entries) {
    const cat = e.taskCode.category;
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + e.totalHrs);
  }
  const categoryHours = Array.from(categoryMap.entries())
    .map(([category, hours]) => ({ category, hours }))
    .sort((a, b) => b.hours - a.hours);

  // Workload by department
  const deptMap = new Map<string, number>();
  for (const e of entries) {
    const dept = e.timesheet.employee.department;
    deptMap.set(dept, (deptMap.get(dept) || 0) + e.totalHrs);
  }
  const deptHours = Array.from(deptMap.entries())
    .map(([department, hours]) => ({ department, hours }))
    .sort((a, b) => b.hours - a.hours);

  // Top 8 employees by hours
  const empHoursMap = new Map<string, { name: string; hours: number }>();
  for (const e of entries) {
    const emp = e.timesheet.employee;
    const existing = empHoursMap.get(emp.id);
    if (existing) existing.hours += e.totalHrs;
    else empHoursMap.set(emp.id, { name: emp.name, hours: e.totalHrs });
  }
  const topEmployees = Array.from(empHoursMap.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8);

  // Summary stats for the selected period
  const totalHours = entries.reduce((sum, e) => sum + e.totalHrs, 0);
  const submittedCount = dedupedTimesheets.length;
  const totalEmployees = await prisma.employee.count({ where: { isActive: true } });

  // Weekly utilization trend:
  //   - week mode  → last 6 weeks ending at selected week
  //   - month mode → each week in selected month
  const weeklyTrend: { week: string; utilization: number; totalHrs: number }[] = [];

  if (mode === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    const mStart = new Date(Date.UTC(y, m - 1, 1));
    const mEnd   = new Date(Date.UTC(y, m,     1));
    // All Monday-starts that overlap this month
    const firstMonday = startOfWeek(mStart, { weekStartsOn: 1 });
    const weeks: Date[] = [];
    let w = firstMonday;
    while (w < mEnd) {
      weeks.push(w);
      w = addDays(w, 7);
    }
    for (const wStart of weeks) {
      const weekTs = await prisma.timesheet.findMany({
        where: { weekStart: weekRange(wStart), status: { in: ["submitted", "approved"] } },
        include: { entries: true },
      });
      const hrs = weekTs.reduce((sum, ts) => sum + ts.entries.reduce((s, e) => s + e.totalHrs, 0), 0);
      const expectedHrs = totalEmployees * 40;
      weeklyTrend.push({
        week: format(wStart, "dd MMM"),
        utilization: expectedHrs > 0 ? Math.round((hrs / expectedHrs) * 100) : 0,
        totalHrs: hrs,
      });
    }
  } else {
    // Last 6 weeks anchored at selected week (or today)
    const anchor = weekParam ? new Date(weekParam + "T00:00:00.000Z") : new Date();
    for (let i = 5; i >= 0; i--) {
      const wStart = startOfWeek(subWeeks(anchor, i), { weekStartsOn: 1 });
      const weekTs = await prisma.timesheet.findMany({
        where: { weekStart: weekRange(wStart), status: { in: ["submitted", "approved"] } },
        include: { entries: true },
      });
      const hrs = weekTs.reduce((sum, ts) => sum + ts.entries.reduce((s, e) => s + e.totalHrs, 0), 0);
      const expectedHrs = totalEmployees * 40;
      weeklyTrend.push({
        week: format(wStart, "dd MMM"),
        utilization: expectedHrs > 0 ? Math.round((hrs / expectedHrs) * 100) : 0,
        totalHrs: hrs,
      });
    }
  }

  // Plan vs Actual per project
  const resourcePlans = await prisma.resourcePlan.findMany({
    include: { project: true },
  });

  const actualByProject = new Map<string, number>();
  for (const e of entries) {
    const key = e.project.projectNumber;
    actualByProject.set(key, (actualByProject.get(key) || 0) + e.totalHrs);
  }

  const planMap = new Map<string, { projectName: string; planned: number }>();
  for (const rp of resourcePlans) {
    const key = rp.project.projectNumber;
    if (!planMap.has(key)) {
      planMap.set(key, { projectName: rp.project.projectName, planned: 0 });
    }
    planMap.get(key)!.planned += rp.plannedHrs;
  }

  const planVsActual = Array.from(planMap.entries())
    .map(([projectNumber, v]) => ({
      projectNumber,
      projectName: v.projectName,
      planned: v.planned,
      actual: actualByProject.get(projectNumber) || 0,
    }))
    .filter((p) => p.planned > 0)
    .sort((a, b) => b.planned - a.planned)
    .slice(0, 10);

  return NextResponse.json({
    projectHours,
    categoryHours,
    deptHours,
    topEmployees,
    weeklyTrend,
    planVsActual,
    summary: { totalHours, submittedCount, totalEmployees, mode },
  });
}
