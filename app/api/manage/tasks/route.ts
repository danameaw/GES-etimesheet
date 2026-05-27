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

export async function GET() {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const tasks = await prisma.taskCode.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] });
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { code, name, category } = await req.json();
  if (!code?.trim() || !name?.trim() || !category?.trim())
    return NextResponse.json({ error: "code, name, category required" }, { status: 400 });

  const task = await prisma.taskCode.create({
    data: { code: code.trim().toUpperCase(), name: name.trim(), category: category.trim() },
  });
  return NextResponse.json({ task });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { id, code, name, category, isActive } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const task = await prisma.taskCode.update({
    where: { id },
    data: { code: code?.trim().toUpperCase(), name: name?.trim(), category: category?.trim(), isActive },
  });
  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.taskCode.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
