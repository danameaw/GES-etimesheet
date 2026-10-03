import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDateOnly } from "@/lib/employment-period";
import { loadUnitIndex, PATH_SEP } from "@/lib/org-units";

const DEPARTMENTS = [
  "Management", "Project Management", "Engineering", "Construction",
  "Project Control", "Grid Connection", "BOI", "Admin", "Procurement", "HSE",
];
const ROLES = ["employee", "pd", "ges_pd", "ges_management", "admin", "md"];
const CLEAR = "-"; // a cell with "-" clears the field; an empty cell leaves it unchanged

type Row = {
  employeeId: string; name?: string; department?: string; position?: string; level?: string; role?: string;
  managedDept?: string; managedUnit?: string; unit?: string; startDate?: string; endDate?: string; active?: string;
};

/**
 * POST /api/employees/bulk-update  (admin)
 * body: { rows: Row[], apply: boolean }   — apply=false → preview only
 * Updates existing employees matched by employeeId. Only non-empty cells change a field.
 * unit / managedUnit are paths "แผนก > หน่วย > …"; missing units are created on apply.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { rows, apply } = (await req.json()) as { rows: Row[]; apply?: boolean };
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "No rows" }, { status: 400 });

  const idx = await loadUnitIndex();
  const employees = await prisma.employee.findMany();
  const byCode = new Map(employees.map((e) => [e.employeeId.toUpperCase(), e]));
  const str = (v: unknown) => String(v ?? "").trim();
  const splitPath = (p: string) => p.split(PATH_SEP.trim()).map((x) => x.trim()).filter(Boolean);
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  const unitLabel = (id: string | null) => (id ? idx.fullPath(id) || id : "—");

  const errors: string[] = [];
  const changes: { employeeId: string; name: string; fields: string[] }[] = [];
  const updates: { id: string; data: Record<string, unknown>; unitPath?: string | null; managedUnitPath?: string | null }[] = [];
  const unitsToCreate = new Set<string>();

  for (const r of rows) {
    const code = str(r.employeeId).toUpperCase();
    if (!code) continue;
    const emp = byCode.get(code);
    if (!emp) { errors.push(`${code}: ไม่พบรหัสพนักงาน`); continue; }
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    const rowErr: string[] = [];
    const set = (key: string, label: string, oldV: string, newV: unknown, shown: string) => {
      if (shown === oldV) return;
      data[key] = newV; fields.push(`${label}: ${oldV || "—"} → ${shown || "—"}`);
    };

    if (str(r.name)) set("name", "ชื่อ", emp.name, str(r.name), str(r.name));
    const dept = str(r.department) || emp.department;
    if (str(r.department)) {
      if (!DEPARTMENTS.includes(dept)) rowErr.push(`แผนก "${dept}" ไม่ถูกต้อง`);
      else set("department", "แผนก", emp.department, dept, dept);
    }
    if (str(r.position)) set("position", "Position", emp.position, str(r.position), str(r.position));
    if (str(r.level)) { const v = str(r.level) === CLEAR ? "" : str(r.level); set("level", "Level", emp.level, v, v); }
    if (str(r.role)) {
      const v = str(r.role).toLowerCase();
      if (!ROLES.includes(v)) rowErr.push(`role "${r.role}" ไม่ถูกต้อง`); else set("role", "Role", emp.role, v, v);
    }
    const mDept = str(r.managedDept) === CLEAR ? "" : (str(r.managedDept) || emp.managedDept);
    if (str(r.managedDept)) {
      if (mDept && !DEPARTMENTS.includes(mDept)) rowErr.push(`แผนกที่ดูแล "${mDept}" ไม่ถูกต้อง`);
      else set("managedDept", "แผนกที่ดูแล", emp.managedDept, mDept, mDept);
    }
    for (const [key, label] of [["startDate", "วันเริ่มงาน"], ["endDate", "วันสุดท้าย"]] as const) {
      const raw = str(r[key]);
      if (!raw) continue;
      const d = raw === CLEAR ? null : parseDateOnly(raw);
      if (raw !== CLEAR && !d) { rowErr.push(`${label} "${raw}" ต้องเป็น yyyy-MM-dd`); continue; }
      set(key, label, fmt(emp[key]), d, fmt(d));
    }
    if (str(r.active)) {
      const v = str(r.active).toLowerCase();
      const on = ["y", "yes", "true", "active", "1"].includes(v), off = ["n", "no", "false", "inactive", "0"].includes(v);
      if (!on && !off) rowErr.push(`active "${r.active}" ใช้ Y / N`);
      else set("isActive", "สถานะ", emp.isActive ? "Active" : "Inactive", on, on ? "Active" : "Inactive");
    }

    // unit paths must start with the (new) department / managed department
    let unitPath: string | null | undefined;
    if (str(r.unit)) {
      if (str(r.unit) === CLEAR || splitPath(str(r.unit)).length < 2) unitPath = null;
      else if (splitPath(str(r.unit))[0] !== dept) rowErr.push(`หน่วย "${r.unit}" ไม่อยู่ในแผนก ${dept}`);
      else unitPath = splitPath(str(r.unit)).join(PATH_SEP);
      if (unitPath !== undefined && (unitPath ?? "—") !== unitLabel(emp.orgUnitId)) fields.push(`หน่วย: ${unitLabel(emp.orgUnitId)} → ${unitPath ?? "— (ขึ้นตรงกับแผนก)"}`);
      else unitPath = undefined;
    }
    let managedUnitPath: string | null | undefined;
    if (str(r.managedUnit)) {
      if (str(r.managedUnit) === CLEAR) managedUnitPath = null;
      else if (splitPath(str(r.managedUnit))[0] !== mDept || splitPath(str(r.managedUnit)).length < 2) rowErr.push(`หน่วยที่ดูแล "${r.managedUnit}" ต้องเป็นหน่วยในแผนกที่ดูแล (${mDept || "ยังไม่ระบุ"})`);
      else managedUnitPath = splitPath(str(r.managedUnit)).join(PATH_SEP);
      if (managedUnitPath !== undefined && (managedUnitPath ?? "—") !== unitLabel(emp.managedUnitId)) fields.push(`หน่วยที่ดูแล: ${unitLabel(emp.managedUnitId)} → ${managedUnitPath ?? "— (ทั้งแผนก)"}`);
      else managedUnitPath = undefined;
    }
    // department changed without a new unit → the old unit (other department) is dropped
    if (data.department && unitPath === undefined && emp.orgUnitId && idx.byId.get(emp.orgUnitId)?.department !== dept) {
      unitPath = null; fields.push(`หน่วย: ${unitLabel(emp.orgUnitId)} → — (ย้ายแผนก)`);
    }

    if (rowErr.length) { errors.push(`${code} ${emp.name}: ${rowErr.join(" · ")}`); continue; }
    for (const p of [unitPath, managedUnitPath]) if (p && !idx.findByPath(p)) unitsToCreate.add(p);
    if (fields.length === 0) continue;
    changes.push({ employeeId: emp.employeeId, name: emp.name, fields });
    updates.push({ id: emp.id, data, unitPath, managedUnitPath });
  }

  const result = { changes, errors, unitsToCreate: Array.from(unitsToCreate) };
  if (!apply) return NextResponse.json({ preview: true, ...result });

  // create missing units (parents first), then update employees
  const pathToId = new Map<string, string>();
  const ensureUnit = async (path: string): Promise<string> => {
    const found = idx.findByPath(path)?.id ?? pathToId.get(path);
    if (found) return found;
    const parts = splitPath(path);
    const parentId = parts.length > 2 ? await ensureUnit(parts.slice(0, -1).join(PATH_SEP)) : null;
    const created = await prisma.orgUnit.create({ data: { name: parts[parts.length - 1], department: parts[0], parentId } });
    pathToId.set(path, created.id);
    return created.id;
  };
  for (const u of updates) {
    if (u.unitPath !== undefined) u.data.orgUnitId = u.unitPath ? await ensureUnit(u.unitPath) : null;
    if (u.managedUnitPath !== undefined) u.data.managedUnitId = u.managedUnitPath ? await ensureUnit(u.managedUnitPath) : null;
  }
  await prisma.$transaction(updates.map((u) => prisma.employee.update({ where: { id: u.id }, data: u.data })));
  await prisma.auditLog.create({
    data: {
      employeeId: (session.user as any).id,
      action: "BULK_UPDATE_EMPLOYEES",
      detail: changes.map((c) => `${c.employeeId}: ${c.fields.join("; ")}`).join(" | ").slice(0, 4000),
    },
  });
  return NextResponse.json({ preview: false, ...result });
}
