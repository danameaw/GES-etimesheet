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

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");

  const where = year
    ? {
        date: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lt:  new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`),
        },
      }
    : {};

  const holidays = await prisma.holiday.findMany({ where, orderBy: { date: "asc" } });
  return NextResponse.json({ holidays });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { date, name, type } = await req.json();
  if (!date || !name?.trim())
    return NextResponse.json({ error: "date and name required" }, { status: 400 });

  const holiday = await prisma.holiday.create({
    data: {
      date: new Date(date + "T00:00:00.000Z"),
      name: name.trim(),
      type: type || "public_holiday",
    },
  });
  return NextResponse.json({ holiday });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const err = await requireAdmin(session);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
