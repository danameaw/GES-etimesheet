import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backfillHoliday, type HolidayBackfillResult } from "@/lib/holiday-backfill";

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

  // วันหยุดที่เพิ่มย้อนหลัง → เติมให้ timesheet ที่มีอยู่แล้วของทุกคนทันที
  const backfill = await backfillHoliday(date);
  await logBackfill(session, holiday.name, backfill);
  return NextResponse.json({ holiday, backfill });
}

// เติม Holiday ให้ทุกคนซ้ำสำหรับวันหยุดที่มีอยู่แล้ว (เช่น เพิ่มไว้ก่อนมีระบบ backfill)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const backfill = await backfillHoliday(holiday.date.toISOString().slice(0, 10));
  await logBackfill(session, holiday.name, backfill);
  return NextResponse.json({ backfill });
}

async function logBackfill(session: any, name: string, b: HolidayBackfillResult) {
  const filled = Object.values(b.filled).reduce((s, n) => s + n, 0);
  await prisma.auditLog.create({
    data: {
      employeeId: session.user.id,
      action: "HOLIDAY_BACKFILL",
      detail: `${b.date} ${name}: filled ${filled}/${b.timesheets} timesheets ${JSON.stringify(b.filled)}${b.skipped ? ` (skipped: ${b.skipped})` : ""}`,
    },
  });
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
