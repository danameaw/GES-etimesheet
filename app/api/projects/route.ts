import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [projects, taskCodes] = await Promise.all([
    prisma.project.findMany({
      where: { isActive: true },
      orderBy: { projectNumber: "asc" },
      include: { manager: { select: { id: true, name: true, employeeId: true } } },
    }),
    prisma.taskCode.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    // Ensure task code 1001 Leave/Holiday always exists
    prisma.taskCode.upsert({
      where: { code: "1001" },
      update: { isActive: true },
      create: { code: "1001", name: "Leave/Holiday", category: "Leave", isActive: true },
    }),
  ]);

  return NextResponse.json({ projects, taskCodes });
}

// Admin can update project manager assignment
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { projectId, managerId } = body;

  const project = await prisma.project.update({
    where: { id: projectId },
    data: { managerId: managerId || null },
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
  });

  return NextResponse.json({ project });
}
