import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, endOfWeek, subWeeks, format } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Fetch all timesheet entries with relations
  const entries = await prisma.timesheetEntry.findMany({
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
    if (existing) {
      existing.hours += e.totalHrs;
    } else {
      projectHoursMap.set(key, { name: e.project.projectName, hours: e.totalHrs });
    }
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
  const [employees] = await Promise.all([
    prisma.employee.count({ where: { isActive: true } }),
  ]);

  for (let i = 5; i >= 0; i--) {
    const wStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
    const wEnd = endOfWeek(wStart, { weekStartsOn: 1 });

    const weekTimesheets = await prisma.timesheet.findMany({
      where: { weekStart: { gte: wStart }, weekEnd: { lte: wEnd }, status: "submitted" },
      include: { entries: true },
    });

    const totalHrs = weekTimesheets.reduce((sum, ts) => sum + ts.entries.reduce((s, e) => s + e.totalHrs, 0), 0);
    const expectedHrs = employees * 40;
    const utilization = expectedHrs > 0 ? Math.round((totalHrs / expectedHrs) * 100) : 0;

    weeklyTrend.push({
      week: format(wStart, "dd MMM"),
      utilization,
    });
  }

  return NextResponse.json({
    projectHours,
    categoryHours,
    deptHours,
    topEmployees,
    weeklyTrend,
  });
}
