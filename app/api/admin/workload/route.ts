import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/admin/workload?year=2026&month=6
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["ges_management", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year  = Number(searchParams.get("year")  ?? new Date().getFullYear());
  const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

  // ges_management sees only their own department
  let myDept: string | null = null;
  if (role === "ges_management") {
    const me = await prisma.employee.findUnique({ where: { id: empDbId }, select: { department: true } });
    myDept = me?.department ?? null;
  }

  // ── Plans ──────────────────────────────────────────────────────────────────
  const plans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: {
      year,
      month,
      ...(myDept ? { employee: { department: myDept } } : {}),
    },
    include: {
      employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
      project:  { select: { id: true, projectNumber: true, projectName: true, planStatus: true } },
    },
    orderBy: [{ employee: { department: "asc" } }, { employee: { name: "asc" } }],
  });

  // ── Actual hours from approved/submitted timesheets in this month ──────────
  // A "week" belongs to month M if weekStart falls within that month
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);   // last day of month

  const timesheets = await prisma.timesheet.findMany({
    where: {
      weekStart: { gte: monthStart, lte: monthEnd },
      status: { in: ["submitted", "approved"] },
      ...(myDept ? { employee: { department: myDept } } : {}),
    },
    include: {
      employee: { select: { id: true } },
      entries:  { select: { totalHrs: true } },
    },
  });

  // Sum actual hours per employee DB id
  const actualMap = new Map<string, number>();
  for (const ts of timesheets) {
    const hrs = ts.entries.reduce((s, e) => s + e.totalHrs, 0);
    actualMap.set(ts.employee.id, (actualMap.get(ts.employee.id) ?? 0) + hrs);
  }

  // ── Standard hours ─────────────────────────────────────────────────────────
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow >= 1 && dow <= 5) workingDays++;
  }
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
  });
  let holidayWorkdays = 0;
  const seen = new Set<string>();
  for (const h of holidays) {
    const key = new Date(h.date).toISOString().slice(0, 10);
    if (!seen.has(key)) {
      seen.add(key);
      const dow = new Date(h.date).getDay();
      if (dow >= 1 && dow <= 5) holidayWorkdays++;
    }
  }
  const standardHrs = (workingDays - holidayWorkdays) * 8;

  // ── Group by dept → employee ───────────────────────────────────────────────
  const deptMap = new Map<string, Map<string, { employee: any; totalPlanned: number; actualHrs: number; projects: any[] }>>();
  for (const p of plans) {
    const dept  = p.employee.department;
    const empId = p.employee.id;
    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const empMap = deptMap.get(dept)!;
    if (!empMap.has(empId)) {
      empMap.set(empId, {
        employee:     p.employee,
        totalPlanned: 0,
        actualHrs:    actualMap.get(empId) ?? 0,
        projects:     [],
      });
    }
    const emp = empMap.get(empId)!;
    emp.totalPlanned += p.plannedHrs;
    emp.projects.push({
      projectId:     p.projectId,
      projectNumber: p.project.projectNumber,
      projectName:   p.project.projectName,
      planStatus:    p.project.planStatus,
      plannedHrs:    p.plannedHrs,
    });
  }

  const departments = Array.from(deptMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, empMap]) => ({
      name,
      employees: Array.from(empMap.values())
        .sort((a, b) => a.employee.name.localeCompare(b.employee.name)),
    }));

  return NextResponse.json({
    year, month, standardHrs,
    workingDays: workingDays - holidayWorkdays,
    holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
    departments,
  });
}
