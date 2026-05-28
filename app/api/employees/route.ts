import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  if (!["admin", "pd"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ employeeId: "asc" }],
    include: {
      managedProjects: { select: { id: true, projectNumber: true, projectName: true } },
    },
  });
  return NextResponse.json({ employees });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { employeeId, name, department, position, role, isActive } = body;

  if (!employeeId || !name || !department || !position) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await prisma.employee.findUnique({ where: { employeeId: employeeId.trim().toUpperCase() } });
  if (existing) return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });

  const employee = await prisma.employee.create({
    data: {
      employeeId: employeeId.trim().toUpperCase(),
      name: name.trim(),
      department: department.trim(),
      position: position.trim(),
      role: role || "employee",
      isActive: isActive !== false,
    },
  });

  await prisma.auditLog.create({
    data: { employeeId: (session.user as any).id, action: "CREATE_EMPLOYEE", detail: `Created ${employee.employeeId}` },
  });

  return NextResponse.json({ employee }, { status: 201 });
}
