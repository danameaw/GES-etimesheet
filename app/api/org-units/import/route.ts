import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadUnitIndex, PATH_SEP } from "@/lib/org-units";

/**
 * POST /api/org-units/import  (admin)
 * body: {
 *   units:   [{ path: "Procurement > Procurement > Logistic Team", headEmployeeId?: "1234" }],
 *   members: [{ employeeId: "1234", path: "Procurement > Procurement > Logistic Team" }],
 *   apply:   boolean   // false = dry run (preview only)
 * }
 * - creates missing units along every path (idempotent — existing units are reused, never deleted)
 * - sets unit heads when headEmployeeId is given
 * - moves members into their unit; a path with only the department = directly under the department
 * - an employee whose department differs from the path's department is skipped
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const units: { path: string; headEmployeeId?: string }[] = Array.isArray(body.units) ? body.units : [];
  const members: { employeeId: string; path: string }[] = Array.isArray(body.members) ? body.members : [];
  const apply = body.apply === true;

  const split = (p: string) => String(p || "").split(PATH_SEP.trim()).map((x) => x.trim()).filter(Boolean);
  const norm = (p: string) => split(p).join(PATH_SEP);

  const employees = await prisma.employee.findMany({ select: { id: true, employeeId: true, name: true, department: true, orgUnitId: true } });
  const empByCode = new Map(employees.map((e) => [e.employeeId.toUpperCase(), e]));

  const errors: string[] = [];
  const idx = await loadUnitIndex();

  // every path that must exist (from both sheets), parents first
  const needed = new Set<string>();
  for (const p of [...units.map((u) => u.path), ...members.map((m) => m.path)]) {
    const parts = split(p);
    for (let i = 2; i <= parts.length; i++) needed.add(parts.slice(0, i).join(PATH_SEP));
  }
  const toCreate = Array.from(needed).filter((p) => !idx.findByPath(p)).sort((a, b) => split(a).length - split(b).length);

  // heads
  const headChanges: { path: string; empId: string; label: string }[] = [];
  for (const u of units) {
    const code = String(u.headEmployeeId || "").trim().toUpperCase();
    if (!code) continue;
    const emp = empByCode.get(code);
    if (!emp) { errors.push(`หัวหน้า ${code} (${norm(u.path)}): ไม่พบรหัสพนักงานในระบบ`); continue; }
    headChanges.push({ path: norm(u.path), empId: emp.id, label: `${emp.employeeId} ${emp.name}` });
  }

  // member moves
  const moves: { empId: string; path: string; label: string }[] = [];
  for (const m of members) {
    const code = String(m.employeeId || "").trim().toUpperCase();
    if (!code) continue; // rows without an employeeId are ignored (not yet matched)
    const emp = empByCode.get(code);
    const dept = split(m.path)[0];
    if (!emp) { errors.push(`${code}: ไม่พบรหัสพนักงานในระบบ`); continue; }
    if (!dept) { errors.push(`${code}: ไม่มีหน่วย`); continue; }
    if (emp.department !== dept) { errors.push(`${code} ${emp.name}: แผนกในระบบคือ "${emp.department}" แต่ไฟล์ระบุ "${dept}"`); continue; }
    moves.push({ empId: emp.id, path: norm(m.path), label: `${emp.employeeId} ${emp.name}` });
  }

  const summary = {
    unitsToCreate: toCreate,
    heads: headChanges.map((h) => `${h.path} ← ${h.label}`),
    membersToAssign: moves.length,
    errors,
  };
  if (!apply) return NextResponse.json({ preview: true, ...summary });

  // apply: create units top-down, then heads, then members
  const pathToId = new Map<string, string>();
  for (const p of Array.from(needed)) { const u = idx.findByPath(p); if (u) pathToId.set(p, u.id); }
  for (const p of toCreate) {
    const parts = split(p);
    const parentPath = parts.slice(0, -1).join(PATH_SEP);
    const created = await prisma.orgUnit.create({
      data: { name: parts[parts.length - 1], department: parts[0], parentId: parts.length > 2 ? pathToId.get(parentPath)! : null },
    });
    pathToId.set(p, created.id);
  }
  await prisma.$transaction([
    ...headChanges.filter((h) => pathToId.has(h.path)).map((h) =>
      prisma.orgUnit.update({ where: { id: pathToId.get(h.path)! }, data: { headId: h.empId } })),
    ...moves.map((m) =>
      prisma.employee.update({ where: { id: m.empId }, data: { orgUnitId: split(m.path).length > 1 ? pathToId.get(m.path)! : null } })),
  ]);
  await prisma.auditLog.create({
    data: {
      employeeId: (session.user as any).id,
      action: "IMPORT_ORG_UNITS",
      detail: `units created ${toCreate.length}, heads ${headChanges.length}, members ${moves.length}, errors ${errors.length}`,
    },
  });
  return NextResponse.json({ preview: false, ...summary });
}
