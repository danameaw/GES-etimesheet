import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, endOfWeek } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const employeeDbId = (session.user as any).id;
  const role = (session.user as any).role;

  let weekStart: Date;
  if (weekParam) {
    weekStart = startOfWeek(new Date(weekParam), { weekStartsOn: 1 });
  } else {
    weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  }
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  // Employees can only see their own timesheets
  const whereClause: any = {
    weekStart: { gte: weekStart },
    weekEnd: { lte: weekEnd },
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
        include: {
          project: true,
          taskCode: true,
        },
      },
      employee: true,
    },
  });

  return NextResponse.json({ timesheet, weekStart, weekEnd });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employeeDbId = (session.user as any).id;
  const body = await req.json();
  const { weekStart, weekEnd, entries, action } = body;

  const wsDate = new Date(weekStart);
  const weDate = new Date(weekEnd);

  // Check cut-off: lock after following Monday 09:00
  const lockTime = new Date(wsDate);
  lockTime.setDate(lockTime.getDate() + 7);
  const dayOfWeek = lockTime.getDay();
  const daysToMonday = (1 - dayOfWeek + 7) % 7 || 7;
  lockTime.setDate(lockTime.getDate() + daysToMonday - 7);
  lockTime.setHours(9, 0, 0, 0);

  const now = new Date();

  // Find or create timesheet
  let timesheet = await prisma.timesheet.findFirst({
    where: { employeeId: employeeDbId, weekStart: wsDate },
  });

  if (timesheet?.status === "submitted" && action !== "unlock") {
    if (now > lockTime) {
      return NextResponse.json({ error: "Submission is locked after Monday 09:00" }, { status: 403 });
    }
  }

  const status = action === "submit" ? "submitted" : "draft";

  if (timesheet) {
    // Delete existing entries and update
    await prisma.timesheetEntry.deleteMany({ where: { timesheetId: timesheet.id } });
    timesheet = await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: {
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

  // Audit log
  await prisma.auditLog.create({
    data: {
      employeeId: employeeDbId,
      action: action === "submit" ? "SUBMIT_TIMESHEET" : "SAVE_DRAFT",
      detail: `Week: ${weekStart}`,
    },
  });

  return NextResponse.json({ success: true, timesheetId: timesheet.id, status });
}
