import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";
import { OH_CATEGORIES, isOverheadProject } from "@/lib/task-constants";
import {
  HOLIDAY_AUTOFILL_FROM, HOLIDAY_TASK_CODE,
  weekDateStringsUTC, holidayHoursForWeek, applyHolidayHours,
} from "@/lib/holiday-autofill";

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


/**
 * Backstop ฝั่ง server: วันหยุด (จ.–ศ.) ตั้งแต่ HOLIDAY_AUTOFILL_FROM ต้องมี Holiday 8 ชม./วัน
 * ลงใต้ Project Overhead เสมอ — เติมเฉพาะวันที่ยังว่าง จึงไม่ทับค่าที่ user แก้เอง
 * และไม่กระทบชั่วโมงงานที่ user ลงเพิ่มในวันหยุด (คนละแถวกัน)
 */
async function withHolidayAutofill(weekStart: Date, entries: any[]): Promise<any[]> {
  const weekDates = weekDateStringsUTC(weekStart);
  if (weekDates[6] < HOLIDAY_AUTOFILL_FROM) return entries;

  const holidays = await prisma.holiday.findMany({
    where: {
      date: {
        gte: new Date(weekDates[0] + "T00:00:00.000Z"),
        lte: new Date(weekDates[6] + "T00:00:00.000Z"),
      },
    },
    select: { date: true },
  });
  const hours = holidayHoursForWeek(
    weekDates,
    holidays.map((h) => h.date.toISOString().slice(0, 10)),
  );
  if (Object.keys(hours).length === 0) return entries;

  const [ohProject, holidayTask] = await Promise.all([
    prisma.project.findFirst({
      where: { isActive: true, OR: [{ projectType: "overhead" }, { projectType: "support" }] },
      select: { id: true },
    }),
    prisma.taskCode.findFirst({ where: { code: HOLIDAY_TASK_CODE, isActive: true }, select: { id: true } }),
  ]);
  // ไม่มี Project Overhead หรือ Task 1001 → ข้ามไป ไม่บล็อคการบันทึกของ user
  if (!ohProject || !holidayTask) return entries;

  return applyHolidayHours(
    entries, ohProject.id, holidayTask.id, hours,
    (base) => ({ ...base }),
  ).rows;
}

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

  // ── Lock: task code กลุ่ม OH ต้องลงใต้ Project Overhead เท่านั้น ──
  // ตรวจก่อนแตะข้อมูลเดิม เพราะขั้นตอนบันทึกจะลบ entries ทั้งหมดแล้วสร้างใหม่
  if (Array.isArray(entries) && entries.length > 0) {
    const [projs, tasks] = await Promise.all([
      prisma.project.findMany({
        where: { id: { in: Array.from(new Set(entries.map((e: any) => e.projectId as string))) } },
        select: { id: true, projectNumber: true, projectType: true },
      }),
      prisma.taskCode.findMany({
        where: { id: { in: Array.from(new Set(entries.map((e: any) => e.taskCodeId as string))) } },
        select: { id: true, code: true, category: true },
      }),
    ]);
    const projById = new Map(projs.map((p) => [p.id, p]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const bad = entries.filter((e: any) => {
      const task = taskById.get(e.taskCodeId);
      return task && OH_CATEGORIES.has(task.category) && !isOverheadProject(projById.get(e.projectId));
    });

    if (bad.length > 0) {
      const ohProject = await prisma.project.findFirst({
        where: { OR: [{ projectType: "overhead" }, { projectType: "support" }] },
        select: { projectNumber: true, projectName: true },
      });
      const codes = Array.from(new Set(bad.map((e: any) => taskById.get(e.taskCodeId)?.code))).join(", ");
      const target = ohProject ? `${ohProject.projectNumber} ${ohProject.projectName}` : "Overhead / Non-Project";
      return NextResponse.json({
        error: `Task OH (${codes}) ต้องลงใต้ Project ${target} เท่านั้น`,
      }, { status: 400 });
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

  const finalEntries = await withHolidayAutofill(wsDate, entries || []);

  const entryData = finalEntries.map((e: any) => ({
    projectId:  e.projectId,
    taskCodeId: e.taskCodeId,
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
  }));

  // ลบ+สร้าง entries ต้องอยู่ใน transaction เดียวกัน
  // ไม่งั้นถ้า createMany พลาดหลัง deleteMany ข้อมูลทั้งสัปดาห์จะหายถาวร
  try {
    const existingId = timesheet?.id;
    timesheet = await prisma.$transaction(async (tx) => {
      const ts = existingId
        ? await tx.timesheet.update({
            where: { id: existingId },
            data: {
              weekStart: wsDate,
              weekEnd:   weDate,
              status,
              submittedAt: action === "submit" ? new Date() : null,
              updatedAt:   new Date(),
            },
          })
        : await tx.timesheet.create({
            data: {
              employeeId: employeeDbId,
              weekStart:  wsDate,
              weekEnd:    weDate,
              status,
              submittedAt: action === "submit" ? new Date() : null,
            },
          });

      if (existingId) {
        await tx.timesheetEntry.deleteMany({ where: { timesheetId: ts.id } });
      }
      if (entryData.length > 0) {
        await tx.timesheetEntry.createMany({
          data: entryData.map((e: any) => ({ ...e, timesheetId: ts.id })),
        });
      }
      return ts;
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `บันทึกไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ กรุณาลองใหม่ (${e?.message || "unknown error"})` },
      { status: 500 },
    );
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
