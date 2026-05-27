import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";

// Parse a week param that may be "yyyy-MM-dd" (new) or ISO string (legacy)
// Returns UTC midnight for the date
function parseWeekStart(param: string): Date {
  if (param.length === 10) {
    return new Date(param + "T00:00:00.000Z");
  }
  // Legacy ISO string: compute the Monday of that week
  return startOfWeek(new Date(param), { weekStartsOn: 1 });
}

// For backward-compat: old timesheets were saved with Thailand UTC+7 offset
// (Mon midnight Thai = Sun 17:00 UTC). Use ±13h window to catch both old and new.
function weekRange(weekStart: Date) {
  const MS_12H = 13 * 60 * 60 * 1000;
  return {
    gte: new Date(weekStart.getTime() - MS_12H),
    lt:  new Date(weekStart.getTime() + MS_12H),
  };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const employeeDbId = (session.user as any).id;
  const role = (session.user as any).role;

  const weekStart = weekParam
    ? parseWeekStart(weekParam)
    : startOfWeek(new Date(), { weekStartsOn: 1 });

  const whereClause: any = {
    weekStart: weekRange(weekStart),
  };
  if (role !== "admin") {
    whereClause.employeeId = employeeDbId;
  } else {
    const targetEmpId = searchParams.get("employeeId");
    if (targetEmpId) whereClause.employeeId = targetEmpId;
  }

  const timesheet = await prisma.timesheet.findFirst({
    where: whereClause,
    include: {
      entries: {
        include: { project: true, taskCode: true },
      },
      employee: true,
    },
  });

  return NextResponse.json({ timesheet, weekStart, weekEnd: addDays(weekStart, 6) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employeeDbId = (session.user as any).id;
  const body = await req.json();
  const { weekStart, weekEnd, entries, action } = body;

  // Parse weekStart/weekEnd — support both "yyyy-MM-dd" and legacy ISO
  const wsDate = weekStart.length === 10
    ? new Date(weekStart + "T00:00:00.000Z")
    : new Date(weekStart);
  const weDate = weekEnd.length === 10
    ? new Date(weekEnd + "T00:00:00.000Z")
    : new Date(weekEnd);

  // Find existing timesheet (use tolerance window for old data)
  let timesheet = await prisma.timesheet.findFirst({
    where: { employeeId: employeeDbId, weekStart: weekRange(wsDate) },
  });

  // Block editing submitted or approved timesheets (must be unlocked by PD/Admin first)
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
        // Normalize weekStart to UTC midnight on update
        weekStart: wsDate,
        weekEnd: weDate,
        status,
        submittedAt: action === "submit" ? new Date() : null,
        updatedAt: new Date(),
      },
    });
  } else {
    timesheet = await prisma.timesheet.create({
      data: {
        employeeId: employeeDbId,
        weekStart: wsDate,
        weekEnd: weDate,
        status,
        submittedAt: action === "submit" ? new Date() : null,
      },
    });
  }

  // Create new entries
  if (entries && entries.length > 0) {
    await prisma.timesheetEntry.createMany({
      data: entries.map((e: any) => ({
        timesheetId: timesheet!.id,
        projectId: e.projectId,
        taskCodeId: e.taskCodeId,
        monHrs: e.monHrs || 0,
        tueHrs: e.tueHrs || 0,
        wedHrs: e.wedHrs || 0,
        thuHrs: e.thuHrs || 0,
        friHrs: e.friHrs || 0,
        satHrs: e.satHrs || 0,
        sunHrs: e.sunHrs || 0,
        totalHrs: (e.monHrs || 0) + (e.tueHrs || 0) + (e.wedHrs || 0) +
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
