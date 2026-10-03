import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  holidayWeekdaySet, monthCompanyCapacity, classifyEntry, entryDays, emptyBreakdown, addHours,
  availableHrs, plannableHrs, pctOf, HoursBreakdown, OH_ALLOWANCE_PCT,
} from "@/lib/capacity";
import { loadUnitIndex, approvalKeyFor, canApproveKey, PATH_SEP, mgmtScope, scopeEmployeeWhere } from "@/lib/org-units";
import { syncPlanApprovals, approvalsWithLabels, approvalLabel } from "@/lib/plan-approvals";

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

  // Unit heads (any role) see the units they lead and everything below them
  const idx = await loadUnitIndex();
  const headedUnits = idx.headedSubtree(empDbId);
  const fullAccess = ["ges_management", "ges_pd", "admin", "md", "pd"].includes(role);
  if (!fullAccess && headedUnits.size === 0)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  // ges_management: own department (managedDept, fallback to department), or only their managed unit
  const scope = await mgmtScope(empDbId, role, idx);
  const myDept = scope.dept;

  // Scope: GES Management → their department; unit head only → their units
  // (a PD who also heads units sees those units; admin / md see everything)
  const empScope = myDept ? scopeEmployeeWhere(scope)
    : !["admin", "md"].includes(role) && headedUnits.size > 0 ? { orgUnitId: { in: Array.from(headedUnits) } }
    : null;

  // Fetch all plans for this year
  const plans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: {
      year,
      ...(empScope ? { employee: empScope } : {}),
    },
    include: {
      employee: { select: { id: true, employeeId: true, name: true, department: true, position: true, orgUnitId: true } },
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
      ...(empScope ? { employee: empScope } : {}),
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
        .map((e) => {
          const key = approvalKeyFor(idx, e.employee);
          return {
          employee: e.employee,
          unitPath: e.employee.orgUnitId ? idx.names(e.employee.orgUnitId).join(PATH_SEP) : "",
          approver: { ...key, label: approvalLabel(idx, key) },
          monthStats: e.monthStats,
          projects: Array.from(e.projects.values())
            .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber)),
          };
        })
        // group people by unit inside the department
        .sort((a, b) => a.unitPath.localeCompare(b.unitPath) || a.employee.name.localeCompare(b.employee.name)),
    }));

  // Keep approval rows (department / unit) in sync for plans awaiting or past approval
  const projectIds = Array.from(new Set(plans.map((p) => p.project.id)));
  const lockedIds = Array.from(new Set(plans
    .filter((p) => ["submitted", "revision_requested", "approved"].includes(p.project.planStatus))
    .map((p) => p.project.id)));
  for (const pid of lockedIds) await syncPlanApprovals(pid, idx);

  // Approval status per project, with whether the viewer may approve each part
  const me = { id: empDbId, role, scopeDept: myDept, managedUnitId: scope.managedUnitId };
  const deptApprovalMap: Record<string, { department: string; unitId: string; label: string; status: string; canApprove: boolean }[]> = {};
  for (const da of await approvalsWithLabels(projectIds, idx)) {
    (deptApprovalMap[da.projectId] ??= []).push({
      department: da.department, unitId: da.unitId, label: da.label, status: da.status,
      canApprove: canApproveKey(idx, me, da),
    });
  }

  return NextResponse.json({
    year, months: monthMeta, departments, deptApprovalMap, ohAllowancePct: OH_ALLOWANCE_PCT,
    // whole-department approve / revision buttons are for GES Management, admin, md
    canManagePlans: ["ges_management", "ges_pd", "admin", "md"].includes(role),
  });
}
