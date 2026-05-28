import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // All authenticated users can read holidays (for timesheet display & blocking)

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const week = searchParams.get("week"); // "yyyy-MM-dd" Monday of the week

  let where: any = {};

  if (week) {
    // Return holidays for the 7-day window starting from the given Monday
    const weekStart = new Date(week + "T00:00:00.000Z");
    const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    where = { date: { gte: weekStart, lt: weekEnd } };
  } else if (year) {
    where = {
      date: {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt:  new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`),
      },
    };
  }

  const holidays = await prisma.holiday.findMany({ where, orderBy: { date: "asc" } });
  return NextResponse.json({ holidays });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
