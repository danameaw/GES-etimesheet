import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const employeeId = (session.user as any).id;

  const favorites = await prisma.timesheetFavorite.findMany({
    where: { employeeId },
    include: {
      project: { select: { id: true, projectNumber: true, projectName: true } },
      taskCode: { select: { id: true, code: true, name: true, category: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ favorites });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const employeeId = (session.user as any).id;

  const { projectId, taskCodeId } = await req.json();
  if (!projectId || !taskCodeId)
    return NextResponse.json({ error: "Missing projectId or taskCodeId" }, { status: 400 });

  const existing = await prisma.timesheetFavorite.findUnique({
    where: { employeeId_projectId_taskCodeId: { employeeId, projectId, taskCodeId } },
  });
  if (existing) return NextResponse.json({ error: "Already saved" }, { status: 409 });

  const count = await prisma.timesheetFavorite.count({ where: { employeeId } });
  const fav = await prisma.timesheetFavorite.create({
    data: { employeeId, projectId, taskCodeId, sortOrder: count },
    include: {
      project: { select: { id: true, projectNumber: true, projectName: true } },
      taskCode: { select: { id: true, code: true, name: true, category: true } },
    },
  });

  return NextResponse.json({ favorite: fav });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const employeeId = (session.user as any).id;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.timesheetFavorite.deleteMany({ where: { id, employeeId } });
  return NextResponse.json({ success: true });
}
