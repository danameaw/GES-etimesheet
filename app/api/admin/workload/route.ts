import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  holidayWeekdaySet, monthCompanyCapacity, classifyEntry, entryDays, emptyBreakdown, addHours,
  availableHrs, plannableHrs, pctOf, HoursBreakdown, OH_ALLOWANCE_PCT,
} from "@/lib/capacity";

const MS_13H = 13 * 60 * 60 * 1000;

const MONTH_NAMES_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

// ความจุ (capacity) คิดตาม lib/capacity.ts:
// - standardHrs = 176 − วันหยุดบริษัท × 8 (ความจุตามปฏิทินบริษัท)
// - ต่อคน: available = standardHrs − วันลาส่วนตัว, plannable = available − Overhead (จริง หรือกันเผื่อ)

// GET /api/admin/workload?year=2026
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role       = (session.user as any).role;
  const empDbId    = (session.user as any).id;
  const employeeId = (session.user as any).employeeId;

  if (!["ges_management", "ges_pd", "admin", "md", "pd"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  // ges_management: only own department — use managedDept, fallback to department
  let myDept: string | null = null;
  if (role === "ges_management" || role === "ges_pd") {
    const me = await prisma.employee.findFirst({
      where: { OR: [{ id: empDbId }, { employeeId }] },
      select: { managedDept: true, department: true },
    });
    myDept = (me?.managedDept && me.managedDept.trim()) || me?.department || null;
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

  const holidays = holidayWeekdaySet(await prisma.holiday.findMany({
    where: { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    select: { date: true },
  }));
  const monthMeta = months.map((m) => ({
    month: m, name: MONTH_NAMES_TH[m - 1], standardHrs: monthCompanyCapacity(year, m, holidays),
  }));

  // ชั่วโมงจริงรายวัน (submitted/approved) แยก โครงการ / Overhead / วันลา — นับตามวันที่จริง
  // (สัปดาห์ที่คร่อมเดือนจะแบ่งเข้าแต่ละเดือนถูกต้อง) จึงดึงตั้งแต่สัปดาห์ก่อนต้นปี
  const timesheets = await prisma.timesheet.findMany({
    where: {
      weekStart: {
        gte: new Date(Date.UTC(year, 0, 1) - 7 * 86400000 - MS_13H),
        lt:  new Date(Date.UTC(year + 1, 0, 1) + MS_13H),
      },
      status: { in: ["submitted", "approved"] },
      ...(myDept ? { employee: { department: myDept } } : {}),
    },
    include: {
      employee: { select: { id: true } },
      entries:  { include: { project: { select: { projectNumber: true, projectType: true } }, taskCode: { select: { code: true } } } },
    },
  });
  // Map: employeeId|month -> breakdown
  const actualMap = new Map<string, HoursBreakdown>();
  for (const ts of timesheets) {
    for (const e of ts.entries) {
      const kind = classifyEntry(e);
      for (const [day, hrs] of entryDays(ts.weekStart, e)) {
        if (Number(day.slice(0, 4)) !== year) continue;
        const key = `${ts.employee.id}|${Number(day.slice(5, 7))}`;
        if (!actualMap.has(key)) actualMap.set(key, emptyBreakdown());
        addHours(actualMap.get(key)!, kind, day, hrs, holidays);
      }
    }
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const monthStats = (empId: string, m: number, companyCap: number) => {
    const b = actualMap.get(`${empId}|${m}`) ?? emptyBreakdown();
    const available = availableHrs(companyCap, b);
    return {
      project: round1(b.project), overhead: round1(b.overhead), leave: round1(b.leave),
      available: round1(available),
      plannable: plannableHrs(companyCap, b),
      utilization: pctOf(b.project, available),
    };
  };

  // Group: dept → employee → project → month plans
  type ProjEntry = {
    projectId: string; projectNumber: string; projectName: string; planStatus: string;
    monthPlans: Record<number, number>; // month → plannedHrs
  };
  type EmpEntry = {
    employee: any;
    projects: Map<string, ProjEntry>;
    monthStats: Record<number, ReturnType<typeof monthStats>>;
  };
  const deptMap = new Map<string, Map<string, EmpEntry>>();

  for (const p of plans) {
    const dept  = p.employee.department;
    const empId = p.employee.id;

    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const empMap = deptMap.get(dept)!;

    if (!empMap.has(empId)) {
      const stats: EmpEntry["monthStats"] = {};
      for (const meta of monthMeta) stats[meta.month] = monthStats(empId, meta.month, meta.standardHrs);
      empMap.set(empId, { employee: p.employee, projects: new Map(), monthStats: stats });
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
          monthStats: e.monthStats,
          projects: Array.from(e.projects.values())
            .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber)),
        })),
    }));

  // Auto-backfill dept approval records for submitted/approved projects that don't have them yet
  const projectIds = Array.from(new Set(plans.map((p) => p.project.id)));
  if (projectIds.length > 0) {
    const existingApprovals = await prisma.resourcePlanDeptApproval.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, department: true },
    });
    const existingSet = new Set(existingApprovals.map((a) => `${a.projectId}|${a.department}`));

    // Group plans by project+dept to find missing approval records
    const projDeptMap = new Map<string, { projectId: string; department: string; planStatus: string }>();
    for (const p of plans) {
      const proj = p.project as any;
      if (["submitted", "revision_requested", "approved"].includes(proj.planStatus)) {
        const key = `${proj.id}|${p.employee.department}`;
        if (!existingSet.has(key)) {
          projDeptMap.set(key, {
            projectId: proj.id,
            department: p.employee.department,
            planStatus: proj.planStatus,
          });
        }
      }
    }

    if (projDeptMap.size > 0) {
      await prisma.$transaction(
        Array.from(projDeptMap.values()).map(({ projectId: pid, department }) =>
          prisma.resourcePlanDeptApproval.upsert({
            where: { projectId_department: { projectId: pid, department } },
            create: { projectId: pid, department, status: "pending" },
            update: {},
          })
        )
      );
    }
  }

  // Fetch dept approval status for all projects in view
  const deptApprovals = projectIds.length > 0
    ? await prisma.resourcePlanDeptApproval.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, department: true, status: true },
      })
    : [];
  const deptApprovalMap: Record<string, { department: string; status: string }[]> = {};
  for (const da of deptApprovals) {
    if (!deptApprovalMap[da.projectId]) deptApprovalMap[da.projectId] = [];
    deptApprovalMap[da.projectId].push({ department: da.department, status: da.status });
  }

  return NextResponse.json({ year, months: monthMeta, departments, deptApprovalMap, ohAllowancePct: OH_ALLOWANCE_PCT });
}
