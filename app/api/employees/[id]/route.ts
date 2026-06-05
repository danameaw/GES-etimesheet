import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  // PD can only update level; admin can update everything
  if (!["admin", "ges_management", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { employeeId, name, department, position, role: empRole, isActive, level } = body;

  // PD can ONLY change level
  if (role === "ges_management") {
    const employee = await prisma.employee.update({
      where: { id: params.id },
      data: { level: level !== undefined ? String(level) : undefined },
    });
    return NextResponse.json({ employee });
  }

  // Admin: full update
  if (employeeId) {
    const dup = await prisma.employee.findFirst({
      where: { employeeId: employeeId.trim().toUpperCase(), NOT: { id: params.id } },
    });
    if (dup) return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
  }

  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: {
      ...(employeeId && { employeeId: employeeId.trim().toUpperCase() }),
      ...(name && { name: name.trim() }),
      ...(department && { department: department.trim() }),
      ...(position && { position: position.trim() }),
      ...(empRole && { role: empRole }),
      ...(isActive !== undefined && { isActive }),
      ...(level !== undefined && { level: String(level) }),
    },
  });

  await prisma.auditLog.create({
    data: { employeeId: (session.user as any).id, action: "UPDATE_EMPLOYEE", detail: `Updated ${employee.employeeId}` },
  });

  return NextResponse.json({ employee });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  // ── Cascade: ลบ Plan data ทั้งหมดของพนักงานที่ deactivate ─────────────────
  await prisma.resourcePlanEmployeeMonthly.deleteMany({
    where: { employeeId: params.id },
  });

  // ── Cascade: Reset planStatus ของ project ที่ไม่มี employee plan เหลือ ────
  const affectedProjectIds = await prisma.resourcePlanMonthly.findMany({
    select: { projectId: true }, distinct: ["projectId"],
  });
  for (const { projectId } of affectedProjectIds) {
    const remaining = await prisma.resourcePlanEmployeeMonthly.count({ where: { projectId } });
    if (remaining === 0) {
      await prisma.project.updateMany({
        where: { id: projectId, planStatus: { not: "draft" } },
        data: { planStatus: "draft" },
      });
      await prisma.resourcePlanMonthly.deleteMany({ where: { projectId } });
    }
  }

  await prisma.auditLog.create({
    data: { employeeId: (session.user as any).id, action: "DEACTIVATE_EMPLOYEE", detail: `Deactivated ${employee.employeeId} + cleared plan data` },
  });

  return NextResponse.json({ success: true });
}
