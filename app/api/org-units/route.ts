import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadUnitIndex } from "@/lib/org-units";

const VIEW_ROLES = ["admin", "md", "ges_management", "ges_pd", "pd"];

// GET /api/org-units → every unit with its full path, head and direct member count
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!VIEW_ROLES.includes((session.user as any).role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [idx, units] = await Promise.all([
    loadUnitIndex(),
    prisma.orgUnit.findMany({
      include: {
        head: { select: { id: true, employeeId: true, name: true } },
        _count: { select: { members: true } },
      },
    }),
  ]);
  const rows = units
    .map((u) => ({
      id: u.id, name: u.name, department: u.department, parentId: u.parentId, sortOrder: u.sortOrder,
      path: idx.fullPath(u.id), depth: idx.names(u.id).length,
      head: u.head, memberCount: u._count.members,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return NextResponse.json({ units: rows });
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ((session.user as any).role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

// POST { name, department, parentId?, headId? } → create a unit
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { name, department, parentId, headId } = await req.json();
  if (!String(name || "").trim() || !String(department || "").trim())
    return NextResponse.json({ error: "ต้องระบุชื่อหน่วยและแผนก" }, { status: 400 });
  if (parentId) {
    const parent = await prisma.orgUnit.findUnique({ where: { id: parentId } });
    if (!parent || parent.department !== department)
      return NextResponse.json({ error: "หน่วยแม่ต้องอยู่ในแผนกเดียวกัน" }, { status: 400 });
  }
  const unit = await prisma.orgUnit.create({
    data: { name: String(name).trim(), department: String(department).trim(), parentId: parentId || null, headId: headId || null },
  });
  return NextResponse.json({ unit });
}

// PUT { id, name?, parentId?, headId?, sortOrder? } → update; moving under its own subtree is refused
export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id, name, parentId, headId, sortOrder } = await req.json();
  const unit = await prisma.orgUnit.findUnique({ where: { id } });
  if (!unit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parentId !== undefined && parentId) {
    const idx = await loadUnitIndex();
    if (idx.descendants(id).has(parentId))
      return NextResponse.json({ error: "ย้ายหน่วยไปอยู่ใต้หน่วยลูกของตัวเองไม่ได้" }, { status: 400 });
    if (idx.byId.get(parentId)?.department !== unit.department)
      return NextResponse.json({ error: "หน่วยแม่ต้องอยู่ในแผนกเดียวกัน" }, { status: 400 });
  }
  const updated = await prisma.orgUnit.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(headId !== undefined && { headId: headId || null }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) || 0 }),
    },
  });
  return NextResponse.json({ unit: updated });
}

// DELETE ?id= → only leaf units; members move up to the department level
export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const childCount = await prisma.orgUnit.count({ where: { parentId: id } });
  if (childCount > 0) return NextResponse.json({ error: "ลบหน่วยย่อยข้างใต้ก่อน" }, { status: 400 });
  await prisma.$transaction([
    prisma.employee.updateMany({ where: { orgUnitId: id }, data: { orgUnitId: null } }),
    prisma.employee.updateMany({ where: { managedUnitId: id }, data: { managedUnitId: null } }),
    prisma.resourcePlanDeptApproval.deleteMany({ where: { unitId: id } }),
    prisma.orgUnit.delete({ where: { id } }),
  ]);
  return NextResponse.json({ success: true });
}
