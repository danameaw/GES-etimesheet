/**
 * การอนุมัติ Resource Plan แยกตาม "คีย์" = แผนก + หน่วย (ดู lib/org-units.ts)
 * - พนักงานที่ไม่สังกัดหน่วย → อนุมัติระดับแผนก (unitId "") แบบเดิม
 * - พนักงานในหน่วย → หัวหน้าหน่วยนั้นอนุมัติ (หัวหน้าหน่วยเอง → หน่วยแม่)
 */
import { prisma } from "@/lib/prisma";
import { UnitIndex, ApprovalKey, approvalKeyFor } from "@/lib/org-units";

const keyStr = (k: ApprovalKey) => `${k.department}|${k.unitId}`;

/** คีย์การอนุมัติที่ต้องมีของโครงการ ตามพนักงานที่มีแผน */
export async function currentApprovalKeys(projectId: string, idx: UnitIndex): Promise<ApprovalKey[]> {
  const plans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: { projectId },
    select: { employee: { select: { id: true, department: true, orgUnitId: true } } },
  });
  const map = new Map<string, ApprovalKey>();
  for (const p of plans) {
    const k = approvalKeyFor(idx, p.employee);
    map.set(keyStr(k), k);
  }
  return Array.from(map.values());
}

/**
 * ทำให้แถวอนุมัติตรงกับคีย์ปัจจุบัน: สร้างที่ขาด (pending), ลบที่ไม่เกี่ยวแล้ว
 * resetAll = true → ทุกคีย์กลับเป็น pending (ตอน submit ใหม่)
 */
export async function syncPlanApprovals(projectId: string, idx: UnitIndex, resetAll = false) {
  const keys = await currentApprovalKeys(projectId, idx);
  const wanted = new Set(keys.map(keyStr));
  const existing = await prisma.resourcePlanDeptApproval.findMany({ where: { projectId } });
  const have = new Set(existing.map((e) => keyStr(e)));

  const stale = existing.filter((e) => !wanted.has(keyStr(e))).map((e) => e.id);
  await prisma.$transaction([
    ...(stale.length ? [prisma.resourcePlanDeptApproval.deleteMany({ where: { id: { in: stale } } })] : []),
    ...keys.filter((k) => !have.has(keyStr(k))).map((k) =>
      prisma.resourcePlanDeptApproval.create({ data: { projectId, department: k.department, unitId: k.unitId, status: "pending" } })),
    ...(resetAll
      ? [prisma.resourcePlanDeptApproval.updateMany({ where: { projectId }, data: { status: "pending", approvedById: null, approvedAt: null } })]
      : []),
  ]);
}

/** ชื่อที่แสดงของคีย์: "แผนก" หรือ "แผนก > หน่วย > …" */
export const approvalLabel = (idx: UnitIndex, k: ApprovalKey) => (k.unitId ? idx.fullPath(k.unitId) || k.department : k.department);

/** แถวอนุมัติของหลายโครงการ พร้อมชื่อหน่วย */
export async function approvalsWithLabels(projectIds: string[], idx: UnitIndex) {
  if (projectIds.length === 0) return [];
  const rows = await prisma.resourcePlanDeptApproval.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, department: true, unitId: true, status: true },
    orderBy: [{ department: "asc" }],
  });
  return rows
    .map((r) => ({ ...r, label: approvalLabel(idx, r) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
