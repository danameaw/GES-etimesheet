import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/std-hours?months=2025-07,2025-08,...
 * Returns standard working hours per month (Mon–Fri × 8h minus public holidays)
 * Response: { stdHours: { "2025-7": 168, "2025-8": 176, ... } }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const monthsParam = searchParams.get("months"); // "2025-07,2025-08,..."

  if (!monthsParam) return NextResponse.json({ error: "Missing months param" }, { status: 400 });

  const monthList = monthsParam.split(",").map((s) => {
    const [y, m] = s.trim().split("-").map(Number);
    return { year: y, month: m };
  }).filter((x) => x.year && x.month);

  if (monthList.length === 0) return NextResponse.json({ stdHours: {} });

  // Fetch all holidays that fall within requested months
  const minDate = new Date(Date.UTC(Math.min(...monthList.map((m) => m.year)), Math.min(...monthList.map((m) => m.month)) - 1, 1));
  const maxDate = new Date(Date.UTC(Math.max(...monthList.map((m) => m.year)), Math.max(...monthList.map((m) => m.month)), 1));

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: minDate, lt: maxDate } },
    select: { date: true },
  });

  // Build set of holiday date strings "yyyy-M-d"
  const holidaySet = new Set(
    holidays.map((h) => {
      const d = new Date(h.date);
      return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    })
  );

  const stdHours: Record<string, number> = {};

  for (const { year, month } of monthList) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let workHrs = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (dow >= 1 && dow <= 5) {
        // Weekday — check if holiday
        const key = `${year}-${month}-${d}`;
        if (!holidaySet.has(key)) workHrs += 8;
      }
    }
    stdHours[`${year}-${month}`] = workHrs;
  }

  return NextResponse.json({ stdHours });
}
