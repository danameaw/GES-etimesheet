import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, subWeeks, format } from "date-fns";

// ±13h tolerance for backward-compat with old UTC+7 stored dates
const MS_13H = 13 * 60 * 60 * 1000;
function weekRange(wStart: Date) {
  return { gte: new Date(wStart.getTime() - MS_13H), lt: new Date(wStart.getTime() + MS_13H) };
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "pd"].includes((session.user as any).role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only count submitted + approved timesheets
  const entries = await prisma.timesheetEntry.findMany({
    where: { timesheet: { status: { in: ["submitted", "approved"] } } },
    include: {
      project: true,
      taskCode: true,
      timesheet: { include: { employee: true } },
    },
  });

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

  // Weekly utilization trend (last 6 weeks)
  const now = new Date();
  const weeklyTrend: { week: string; utilization: number }[] = [];
  const totalEmployees = await prisma.employee.count({ where: { isActive: true } });

  for (let i = 5; i >= 0; i--) {
    const wStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
    const weekTimesheets = await prisma.timesheet.findMany({
      where: { weekStart: weekRange(wStart), status: { in: ["submitted", "approved"] } },
      include: { entries: true },
    });
    const totalHrs = weekTimesheets.reduce((sum, ts) => sum + ts.entries.reduce((s, e) => s + e.totalHrs, 0), 0);
    const expectedHrs = totalEmployees * 40;
    weeklyTrend.push({
      week: format(wStart, "dd MMM"),
      utilization: expectedHrs > 0 ? Math.round((totalHrs / expectedHrs) * 100) : 0,
    });
  }

  // Plan vs Actual per project (for projects that have resource plans)
  const resourcePlans = await prisma.resourcePlan.findMany({
    include: { project: true },
  });

  // Actual hours per project (from submitted/approved timesheets)
  const actualByProject = new Map<string, number>();
  for (const e of entries) {
    const key = e.project.projectNumber;
    actualByProject.set(key, (actualByProject.get(key) || 0) + e.totalHrs);
  }

  // Sum planned hours per project
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
  });
}
