import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";

// Parse a week param that may be "yyyy-MM-dd" (new) or ISO string (legacy)
function parseWeekStart(param: string): Date {
  if (param.length === 10) {
    return new Date(param + "T00:00:00.000Z");
  }
  return startOfWeek(new Date(param), { weekStartsOn: 1 });
}

// ±13h window to catch both old and new timezone-stored records
function weekRange(weekStart: Date) {
  const MS_13H = 13 * 60 * 60 * 1000;
  return {
    gte: new Date(weekStart.getTime() - MS_13H),
    lt:  new Date(weekStart.getTime() + MS_13H),
  };
}

// Map UTC day-of-week (0=Sun…6=Sat) to TimesheetEntry field name
const DAY_FIELDS: Record<number, string> = {
  1: "monHrs", 2: "tueHrs", 3: "wedHrs",
  4: "thuHrs", 5: "friHrs", 6: "satHrs", 0: "sunHrs",
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekParam     = searchParams.get("week");
  const employeeDbId  = (session.user as any).id;
  const role          = (session.user as any).role;

  const weekStart = weekParam
    ? parseWeekStart(weekParam)
    : startOfWeek(new Date(), { weekStartsOn: 1 });

  // Always filter by logged-in user's own ID first.
  // Admin can optionally override with ?employeeId= to view another employee's timesheet.
  const whereClause: any = {
    weekStart:  weekRange(weekStart),
    employeeId: employeeDbId,
  };
  if (role === "admin") {
    const targetEmpId = searchParams.get("employeeId");
    if (targetEmpId) whereClause.employeeId = targetEmpId;
  }

  const timesheet = await prisma.timesheet.findFirst({
    where: whereClause,
    include: {
      entries: { include: { project: true, taskCode: true } },
      employee: true,
    },
  });

  // Also return holidays for this week so frontend can disable cells
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: weekStart, lt: weekEnd } },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ timesheet, weekStart, weekEnd: addDays(weekStart, 6), holidays });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employeeDbId = (session.user as any).id;
  const body = await req.json();
  const { weekStart, weekEnd, entries, action } = body;

  // Parse weekStart/weekEnd
  const wsDate = weekStart.length === 10
    ? new Date(weekStart + "T00:00:00.000Z")
    : new Date(weekStart);
  const weDate = weekEnd.length === 10
    ? new Date(weekEnd + "T00:00:00.000Z")
    : new Date(weekEnd);

  // ── Fetch holidays for this week ──
  const weekEndDate = new Date(wsDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: wsDate, lt: weekEndDate } },
  });

  // Build set of holiday field names (monHrs, tueHrs, etc.) for this week
  const holidayFields = new Set<string>();
  for (const h of holidays) {
    const utcDay = new Date(h.date).getUTCDay();
    const field  = DAY_FIELDS[utcDay];
    if (field) holidayFields.add(field);
  }

  // Validate: no hours entered on holiday days
  if (holidayFields.size > 0 && entries) {
    for (const e of entries) {
      for (const field of Array.from(holidayFields)) {
        if ((e[field] || 0) > 0) {
          const hol = holidays.find((h) => DAY_FIELDS[new Date(h.date).getUTCDay()] === field);
          return NextResponse.json({
            error: `ไม่สามารถลงชั่วโมงในวันหยุด "${hol?.name || field}" ได้`,
          }, { status: 400 });
        }
      }
    }
  }

  // Find existing timesheet
  let timesheet = await prisma.timesheet.findFirst({
    where: { employeeId: employeeDbId, weekStart: weekRange(wsDate) },
  });

  // Block editing submitted or approved timesheets
  if (timesheet && ["submitted", "approved"].includes(timesheet.status)) {
    return NextResponse.json({
      error: "Timesheet is locked. Contact PD or Admin to unlock.",
    }, { status: 403 });
  }

  const status = action === "submit" ? "submitted" : "draft";

  if (timesheet) {
    await prisma.timesheetEntry.deleteMany({ where: { timesheetId: timesheet.id } });
    timesheet = await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: {
        weekStart: wsDate,
        weekEnd:   weDate,
        status,
        submittedAt: action === "submit" ? new Date() : null,
        updatedAt:   new Date(),
      },
    });
  } else {
    timesheet = await prisma.timesheet.create({
      data: {
        employeeId: employeeDbId,
        weekStart:  wsDate,
        weekEnd:    weDate,
        status,
        submittedAt: action === "submit" ? new Date() : null,
      },
    });
  }

  // Create entries (holiday fields already validated to be 0)
  if (entries && entries.length > 0) {
    await prisma.timesheetEntry.createMany({
      data: entries.map((e: any) => ({
        timesheetId: timesheet!.id,
        projectId:   e.projectId,
        taskCodeId:  e.taskCodeId,
        monHrs: e.monHrs || 0,
        tueHrs: e.tueHrs || 0,
        wedHrs: e.wedHrs || 0,
        thuHrs: e.thuHrs || 0,
        friHrs: e.friHrs || 0,
        satHrs: e.satHrs || 0,
        sunHrs: e.sunHrs || 0,
        totalHrs:
          (e.monHrs || 0) + (e.tueHrs || 0) + (e.wedHrs || 0) +
          (e.thuHrs || 0) + (e.friHrs || 0) + (e.satHrs || 0) + (e.sunHrs || 0),
      })),
    });
  }

  await prisma.auditLog.create({
    data: {
      employeeId: employeeDbId,
      action: action === "submit" ? "SUBMIT_TIMESHEET" : "SAVE_DRAFT",
      detail: `Week: ${weekStart}`,
    },
  });

  return NextResponse.json({ success: true, timesheetId: timesheet.id, status });
}
