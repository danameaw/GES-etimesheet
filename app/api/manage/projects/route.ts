import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

async function requireAdmin(session: any) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const projects = await prisma.project.findMany({
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
    orderBy: { projectNumber: "asc" },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const body = await req.json();
  const { projectNumber, projectName, projectType, managerId, startDate, endDate, isActive } = body;

  if (!projectNumber?.trim() || !projectName?.trim())
    return NextResponse.json({ error: "Project number and name are required" }, { status: 400 });

  const project = await prisma.project.create({
    data: {
      projectNumber: projectNumber.trim().toUpperCase(),
      projectName:   projectName.trim(),
      projectType:   projectType || "project",
      managerId:     managerId || null,
      startDate:     startDate ? new Date(startDate + "T00:00:00.000Z") : null,
      endDate:       endDate   ? new Date(endDate   + "T00:00:00.000Z") : null,
      isActive:      isActive !== false,
    },
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
  });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const body = await req.json();
  const { id, projectNumber, projectName, projectType, managerId, startDate, endDate, isActive } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const project = await prisma.project.update({
    where: { id },
    data: {
      projectNumber: projectNumber?.trim().toUpperCase(),
      projectName:   projectName?.trim(),
      projectType,
      managerId:  managerId || null,
      startDate:  startDate ? new Date(startDate + "T00:00:00.000Z") : null,
      endDate:    endDate   ? new Date(endDate   + "T00:00:00.000Z") : null,
      isActive,
    },
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
  });
  return NextResponse.json({ project });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Soft-delete: just mark inactive
  await prisma.project.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
