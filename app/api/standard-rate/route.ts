import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

async function requirePdOrAdmin(session: any) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  if (!["md"].includes(role))
    return NextResponse.json({ error: "PD or Admin only" }, { status: 403 });
  return null;
}

// GET — all active rates (ordered by order asc)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rates = await prisma.standardRate.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { level: "asc" }],
  });
  return NextResponse.json({ rates });
}

// POST — create new rate
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requirePdOrAdmin(session);
  if (err) return err;

  const { level, rate } = await req.json();
  if (!level?.trim()) return NextResponse.json({ error: "Level is required" }, { status: 400 });
  if (rate === undefined || rate === null || isNaN(Number(rate)))
    return NextResponse.json({ error: "Rate must be a number" }, { status: 400 });

  // Auto-assign order = max + 1
  const maxOrder = await prisma.standardRate.aggregate({ _max: { order: true } });
  const nextOrder = (maxOrder._max.order ?? 0) + 1;

  const created = await prisma.standardRate.create({
    data: { level: level.trim(), rate: Number(rate), order: nextOrder },
  });
  return NextResponse.json({ rate: created });
}

// PATCH — update rate or order
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requirePdOrAdmin(session);
  if (err) return err;

  const { id, level, rate, order, isActive } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updated = await prisma.standardRate.update({
    where: { id },
    data: {
      ...(level !== undefined  && { level: String(level).trim() }),
      ...(rate  !== undefined  && { rate:  Number(rate) }),
      ...(order !== undefined  && { order: Number(order) }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    },
  });
  return NextResponse.json({ rate: updated });
}

// DELETE — soft-delete (isActive = false)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requirePdOrAdmin(session);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.standardRate.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
