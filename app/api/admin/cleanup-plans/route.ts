/**
 * Cleanup endpoint — safe to call multiple times.
 * ล้าง Plan data ทั้งหมดที่ยังไม่ได้รับการอนุมัติ (draft + submitted)
 * รวมถึง Plan ของพนักงานที่ inactive ด้วย
 * Call: GET /api/admin/cleanup-plans  (must be logged in as admin)
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── 1. ลบ ResourcePlanEmployeeMonthly ที่ยัง draft หรือ submitted ──────────
  //    (ทั้งของพนักงาน active และ inactive)
  const deletedEmpPlansDraft = await prisma.resourcePlanEmployeeMonthly.deleteMany({
    where: { planStatus: { in: ["draft", "submitted", "revision_requested"] } },
  });

  // ── 2. ลบ ResourcePlanEmployeeMonthly ของพนักงาน inactive (กรณี approved) ──
  const inactiveEmps = await prisma.employee.findMany({
    where: { isActive: false },
    select: { id: true, employeeId: true, name: true },
  });
  const deletedInactiveEmpPlans = await prisma.resourcePlanEmployeeMonthly.deleteMany({
    where: { employeeId: { in: inactiveEmps.map((e) => e.id) } },
  });

  // ── 3. ลบ ResourcePlanMonthly (dept-level) ที่ยัง draft หรือ submitted ─────
  const deletedDeptPlans = await prisma.resourcePlanMonthly.deleteMany({
    where: { planStatus: { in: ["draft", "submitted", "revision_requested"] } },
  });

  // ── 4. Reset planStatus ของทุก project กลับเป็น draft ────────────────────
  const resetProjects = await prisma.project.updateMany({
    where: { planStatus: { not: "draft" }, isActive: true },
    data: { planStatus: "draft" },
  });

  // ── 5. ลบ Timesheets ทั้งหมดของ employee ที่ inactive (ทุก status) ──────────
  const deletedInactiveTimesheets = await prisma.timesheet.deleteMany({
    where: { employee: { isActive: false } },
  });

  // ── 6. ลบ Timesheets ที่ไม่มี entries (orphaned) ──────────────────────────
  const emptyTimesheets = await prisma.timesheet.findMany({
    where: { entries: { none: {} } },
    select: { id: true },
  });
  const deletedTimesheets = await prisma.timesheet.deleteMany({
    where: { id: { in: emptyTimesheets.map((t) => t.id) } },
  });

  return NextResponse.json({
    message: "Cleanup complete",
    deletedEmpPlans_draftOrSubmitted: deletedEmpPlansDraft.count,
    deletedEmpPlans_inactiveEmployees: deletedInactiveEmpPlans.count,
    deletedDeptPlans: deletedDeptPlans.count,
    projectsResetToDraft: resetProjects.count,
    deletedTimesheets_inactiveEmployees: deletedInactiveTimesheets.count,
    deletedEmptyTimesheets: deletedTimesheets.count,
    inactiveEmployeesAffected: inactiveEmps.map((e) => `${e.employeeId} – ${e.name}`),
  });
}
