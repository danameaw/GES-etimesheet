import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { employeeId, name, department, position, role, isActive } = body;

  // Check duplicate ID (excluding self)
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
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
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

  // Soft delete — deactivate only
  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: { employeeId: (session.user as any).id, action: "DEACTIVATE_EMPLOYEE", detail: `Deactivated ${employee.employeeId}` },
  });

  return NextResponse.json({ success: true });
}
