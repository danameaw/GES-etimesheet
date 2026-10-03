/**
 * แผนผังหน่วยย่อยในแผนก (OrgUnit) — ลึกกี่ชั้นก็ได้
 *
 * - ชั้นบนสุด = แผนก (Employee.department) ไม่ได้เก็บเป็น OrgUnit
 * - พนักงานสังกัดได้ 1 หน่วย (Employee.orgUnitId) หรือไม่สังกัด (= ขึ้นตรงกับแผนก)
 * - หัวหน้าหน่วยเห็น/อนุมัติหน่วยตัวเอง + ทุกหน่วยใต้ลงไป
 * - แผนของพนักงานอนุมัติโดยหัวหน้าหน่วยที่พนักงานสังกัด
 *   (ถ้าพนักงานเป็นหัวหน้าหน่วยนั้นเอง → หน่วยแม่ หรือระดับแผนกถ้าไม่มีหน่วยแม่)
 */
import { prisma } from "@/lib/prisma";

export type UnitRow = {
  id: string; name: string; department: string;
  parentId: string | null; headId: string | null; sortOrder: number;
};

export const PATH_SEP = " > ";

export class UnitIndex {
  readonly byId = new Map<string, UnitRow>();
  private readonly kids = new Map<string, UnitRow[]>(); // parentId ("" = top of department) → children

  constructor(rows: UnitRow[]) {
    for (const u of rows) this.byId.set(u.id, u);
    for (const u of rows) {
      const k = u.parentId ?? `dept:${u.department}`;
      if (!this.kids.has(k)) this.kids.set(k, []);
      this.kids.get(k)!.push(u);
    }
    this.kids.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  }

  children(parentId: string | null, department?: string): UnitRow[] {
    return this.kids.get(parentId ?? `dept:${department}`) ?? [];
  }

  /** ชื่อหน่วยจากบนลงล่าง (ไม่รวมชื่อแผนก) */
  names(id: string): string[] {
    const out: string[] = [];
    for (let u = this.byId.get(id); u; u = u.parentId ? this.byId.get(u.parentId) : undefined) out.unshift(u.name);
    return out;
  }

  /** "แผนก > หน่วย > หน่วยย่อย" */
  fullPath(id: string): string {
    const u = this.byId.get(id);
    return u ? [u.department, ...this.names(id)].join(PATH_SEP) : "";
  }

  /** ตัวเอง + ทุกหน่วยใต้ลงไป */
  descendants(id: string): Set<string> {
    const out = new Set<string>();
    const walk = (uid: string) => {
      out.add(uid);
      this.kids.get(uid)?.forEach((c) => walk(c.id));
    };
    if (this.byId.has(id)) walk(id);
    return out;
  }

  ancestorsAndSelf(id: string): UnitRow[] {
    const out: UnitRow[] = [];
    for (let u = this.byId.get(id); u; u = u.parentId ? this.byId.get(u.parentId) : undefined) out.push(u);
    return out;
  }

  /** ทุกหน่วยที่พนักงานคนนี้เป็นหัวหน้า + หน่วยใต้ลงไป */
  headedSubtree(empDbId: string): Set<string> {
    const out = new Set<string>();
    this.byId.forEach((u) => { if (u.headId === empDbId) this.descendants(u.id).forEach((x) => out.add(x)); });
    return out;
  }

  /** หน่วยที่อนุมัติแผนของพนักงานคนนี้ (null = ระดับแผนก) */
  approvalUnitFor(emp: { id: string; orgUnitId: string | null }): UnitRow | null {
    let u = emp.orgUnitId ? this.byId.get(emp.orgUnitId) : undefined;
    if (u && u.headId === emp.id) u = u.parentId ? this.byId.get(u.parentId) : undefined;
    return u ?? null;
  }

  /** หาหน่วยจาก path "แผนก > A > B" */
  findByPath(path: string): UnitRow | null {
    const [dept, ...names] = path.split(PATH_SEP).map((x) => x.trim()).filter(Boolean);
    let parent: UnitRow | null = null;
    for (const n of names) {
      const next: UnitRow | undefined = this.children(parent ? parent.id : null, dept).find((c) => c.name === n);
      if (!next) return null;
      parent = next;
    }
    return parent;
  }
}

export async function loadUnitIndex(): Promise<UnitIndex> {
  const rows = await prisma.orgUnit.findMany({
    select: { id: true, name: true, department: true, parentId: true, headId: true, sortOrder: true },
  });
  return new UnitIndex(rows);
}

/** คีย์การอนุมัติแผน: แผนก + หน่วย ("" = ระดับแผนก) */
export type ApprovalKey = { department: string; unitId: string };

export function approvalKeyFor(idx: UnitIndex, emp: { id: string; department: string; orgUnitId: string | null }): ApprovalKey {
  const u = idx.approvalUnitFor(emp);
  return { department: emp.department, unitId: u?.id ?? "" };
}

export type Approver = { id: string; role: string; scopeDept: string | null; managedUnitId?: string | null };

/**
 * อนุมัติคีย์นี้ได้ไหม:
 * - admin / md: ได้ทั้งหมด
 * - GES Management: ทุกคีย์ในแผนกที่ดูแล
 * - หัวหน้าหน่วย: หน่วยตัวเองและหน่วยใต้ลงไป
 */
export function canApproveKey(idx: UnitIndex, me: Approver, key: ApprovalKey): boolean {
  if (me.role === "admin" || me.role === "md") return true;
  if ((me.role === "ges_management" || me.role === "ges_pd") && me.scopeDept === key.department) {
    // limited to one unit → only that unit and below (not department-level parts)
    if (!me.managedUnitId) return true;
    if (key.unitId && idx.ancestorsAndSelf(key.unitId).some((u) => u.id === me.managedUnitId)) return true;
  }
  if (!key.unitId) return false;
  return idx.ancestorsAndSelf(key.unitId).some((u) => u.headId === me.id);
}

/** แผนกที่ GES Management ดูแล (managedDept หรือแผนกตัวเอง) */
export async function scopeDeptOf(empDbId: string, role: string): Promise<string | null> {
  return (await mgmtScope(empDbId, role)).dept;
}

export type MgmtScope = {
  dept: string | null;            // department overseen (null = not GES Management)
  managedUnitId: string | null;   // limited to this unit…
  unitIds: string[] | null;       // …and these (unit + all sub-units); null = whole department
};

/** ขอบเขตของ GES Management: ทั้งแผนก หรือเฉพาะหน่วยที่ดูแล (managedUnitId) + หน่วยย่อย */
export async function mgmtScope(empDbId: string, role: string, idx?: UnitIndex): Promise<MgmtScope> {
  if (role !== "ges_management" && role !== "ges_pd") return { dept: null, managedUnitId: null, unitIds: null };
  const me = await prisma.employee.findUnique({
    where: { id: empDbId }, select: { managedDept: true, department: true, managedUnitId: true },
  });
  const dept = (me?.managedDept && me.managedDept.trim()) || me?.department || null;
  if (!me?.managedUnitId) return { dept, managedUnitId: null, unitIds: null };
  const index = idx ?? await loadUnitIndex();
  return { dept, managedUnitId: me.managedUnitId, unitIds: Array.from(index.descendants(me.managedUnitId)) };
}

/** Prisma employee filter for a management scope ({} = no restriction) */
export function scopeEmployeeWhere(scope: { dept: string | null; unitIds: string[] | null }) {
  return {
    ...(scope.dept ? { department: scope.dept } : {}),
    ...(scope.unitIds ? { orgUnitId: { in: scope.unitIds } } : {}),
  };
}
