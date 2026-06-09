import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const MONTH_NAMES_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

// Fixed standard hours per month (1 MM = 176 hr)
// To revert to dynamic calculation (working days × 8 hr minus holidays), restore the
// calcStandardHrs function below and replace STD_HOURS_PER_MONTH usage with its result:
//
// async function calcStandardHrs(year: number, month: number) {
//   const daysInMonth = new Date(year, month, 0).getDate();
//   let workingDays = 0;
//   for (let d = 1; d <= daysInMonth; d++) {
//     const dow = new Date(year, month - 1, d).getDay();
//     if (dow >= 1 && dow <= 5) workingDays++;
//   }
//   const holidays = await prisma.holiday.findMany({
//     where: { date: { gte: new Date(year, month - 1, 1), lte: new Date(year, month - 1, daysInMonth) } },
//   });
//   const seen = new Set<string>();
//   let holidayWorkdays = 0;
//   for (const h of holidays) {
//     const key = new Date(h.date).toISOString().slice(0, 10);
//     if (!seen.has(key)) {
//       seen.add(key);
//       const dow = new Date(h.date).getDay();
//       if (dow >= 1 && dow <= 5) holidayWorkdays++;
//     }
//   }
//   return (workingDays - holidayWorkdays) * 8;
// }
const STD_HOURS_PER_MONTH = 176;

// GET /api/admin/workload?year=2026
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["ges_management", "admin", "md", "pd"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  // ges_management: only own department
  let myDept: string | null = null;
  if (role === "ges_management") {
    const me = await prisma.employee.findUnique({ where: { id: empDbId }, select: { department: true } });
    myDept = me?.department ?? null;
  }

  // Fetch all plans for this year
  const plans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: {
      year,
      ...(myDept ? { employee: { department: myDept } } : {}),
    },
    include: {
      employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
      project:  { select: { id: true, projectNumber: true, projectName: true, planStatus: true } },
    },
    orderBy: [{ employee: { department: "asc" } }, { employee: { name: "asc" } }, { month: "asc" }],
  });

  // Distinct months that have plans
  const monthSet = new Set<number>();
  for (const p of plans) monthSet.add(p.month);
  const months = Array.from(monthSet).sort((a, b) => a - b);

  const monthMeta = months.map((m) => ({
    month: m, name: MONTH_NAMES_TH[m - 1], standardHrs: STD_HOURS_PER_MONTH,
  }));

  // Fetch actual hours per employee per month in this year (submitted/approved timesheets)
  const timesheets = await prisma.timesheet.findMany({
    where: {
      weekStart: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) },
      status: { in: ["submitted", "approved"] },
      ...(myDept ? { employee: { department: myDept } } : {}),
    },
    include: {
      employee: { select: { id: true } },
      entries:  { select: { totalHrs: true } },
    },
  });
  // Map: employeeId|month -> actualHrs
  const actualMap = new Map<string, number>();
  for (const ts of timesheets) {
    const m = new Date(ts.weekStart).getUTCMonth() + 1;
    const key = `${ts.employee.id}|${m}`;
    actualMap.set(key, (actualMap.get(key) ?? 0) + ts.entries.reduce((s, e) => s + e.totalHrs, 0));
  }

  // Group: dept → employee → project → month plans
  type ProjEntry = {
    projectId: string; projectNumber: string; projectName: string; planStatus: string;
    monthPlans: Record<number, number>; // month → plannedHrs
  };
  type EmpEntry = {
    employee: any;
    projects: Map<string, ProjEntry>;
    monthActuals: Record<number, number>;
  };
  const deptMap = new Map<string, Map<string, EmpEntry>>();

  for (const p of plans) {
    const dept  = p.employee.department;
    const empId = p.employee.id;

    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const empMap = deptMap.get(dept)!;

    if (!empMap.has(empId)) {
      const actuals: Record<number, number> = {};
      for (const m of months) actuals[m] = actualMap.get(`${empId}|${m}`) ?? 0;
      empMap.set(empId, { employee: p.employee, projects: new Map(), monthActuals: actuals });
    }
    const emp = empMap.get(empId)!;

    const projId = p.project.id;
    if (!emp.projects.has(projId)) {
      emp.projects.set(projId, {
        projectId: projId, projectNumber: p.project.projectNumber,
        projectName: p.project.projectName, planStatus: p.project.planStatus,
        monthPlans: {},
      });
    }
    emp.projects.get(projId)!.monthPlans[p.month] = (emp.projects.get(projId)!.monthPlans[p.month] ?? 0) + p.plannedHrs;
  }

  const departments = Array.from(deptMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, empMap]) => ({
      name,
      employees: Array.from(empMap.values())
        .sort((a, b) => a.employee.name.localeCompare(b.employee.name))
        .map((e) => ({
          employee: e.employee,
          monthActuals: e.monthActuals,
          projects: Array.from(e.projects.values())
            .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber)),
        })),
    }));

  return NextResponse.json({ year, months: monthMeta, departments });
}
