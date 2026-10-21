import { prisma } from "@/lib/prisma";
import {
  HOLIDAY_TASK_CODE, DAY_FIELDS,
  weekDateStringsUTC, holidayHoursForWeek, applyHolidayHours,
} from "@/lib/holiday-autofill";

export interface HolidayBackfillResult {
  date: string;
  weekStart: string;
  /** timesheet ทั้งหมดในสัปดาห์นั้น */
  timesheets: number;
  /** timesheet ที่เติมชั่วโมงวันหยุดให้จริง แยกตามสถานะ */
  filled: Record<string, number>;
  /** เหตุผลที่ไม่ได้เติม (เช่น เป็นเสาร์/อาทิตย์ หรือก่อน HOLIDAY_AUTOFILL_FROM) */
  skipped?: string;
}

/**
 * เติม Holiday 8 ชม. ให้ timesheet ที่มีอยู่แล้วของทุกคนในสัปดาห์ของวันหยุดนั้น
 * — ใช้ตอน admin เพิ่มวันหยุดย้อนหลัง (คนที่ยังไม่มี timesheet จะได้จาก pre-fill/backstop ตอนเปิด/บันทึกเอง)
 *
 * เติมเฉพาะวันที่ยังว่างในแถว Overhead/1001 ตามตรรกะเดียวกับ applyHolidayHours
 * จึงรันซ้ำได้โดยไม่ทับค่าที่ user แก้เอง — เติมให้ทุกสถานะ รวม submitted/approved
 */
export async function backfillHoliday(dateStr: string): Promise<HolidayBackfillResult> {
  const date = new Date(dateStr + "T00:00:00.000Z");
  const dow = date.getUTCDay();
  const weekStart = new Date(date.getTime() - ((dow + 6) % 7) * 24 * 60 * 60 * 1000);
  const weekDates = weekDateStringsUTC(weekStart);
  const result: HolidayBackfillResult = { date: dateStr, weekStart: weekDates[0], timesheets: 0, filled: {} };

  const hours = holidayHoursForWeek(weekDates, [dateStr]);
  if (Object.keys(hours).length === 0) {
    result.skipped = "วันเสาร์/อาทิตย์ หรือก่อนวันที่เริ่มเติมอัตโนมัติ";
    return result;
  }

  const [ohProject, holidayTask] = await Promise.all([
    prisma.project.findFirst({
      where: { isActive: true, OR: [{ projectType: "overhead" }, { projectType: "support" }] },
      select: { id: true },
    }),
    prisma.taskCode.findFirst({ where: { code: HOLIDAY_TASK_CODE, isActive: true }, select: { id: true } }),
  ]);
  if (!ohProject || !holidayTask) {
    result.skipped = "ไม่พบ Project Overhead หรือ Task 1001";
    return result;
  }

  // ±13h เหมือน weekRange ใน /api/timesheets — รองรับ record เก่าที่เก็บเวลาตาม timezone
  const MS_13H = 13 * 60 * 60 * 1000;
  const timesheets = await prisma.timesheet.findMany({
    where: { weekStart: { gte: new Date(weekStart.getTime() - MS_13H), lt: new Date(weekStart.getTime() + MS_13H) } },
    select: { id: true, status: true, entries: true },
  });
  result.timesheets = timesheets.length;

  for (const ts of timesheets) {
    const { rows, changed } = applyHolidayHours(
      ts.entries as any[], ohProject.id, holidayTask.id, hours,
      (base) => ({ ...base, id: undefined }),
    );
    if (!changed) continue;

    const row = rows.find((r) => r.projectId === ohProject.id && r.taskCodeId === holidayTask.id)!;
    const dayHrs = Object.fromEntries(DAY_FIELDS.map((d) => [d, Number(row[d]) || 0]));
    const totalHrs = Object.values(dayHrs).reduce((s, h) => s + h, 0);

    if (row.id) {
      await prisma.timesheetEntry.update({ where: { id: row.id }, data: { ...dayHrs, totalHrs } });
    } else {
      await prisma.timesheetEntry.create({
        data: { timesheetId: ts.id, projectId: ohProject.id, taskCodeId: holidayTask.id, ...dayHrs, totalHrs },
      });
    }
    result.filled[ts.status] = (result.filled[ts.status] || 0) + 1;
  }

  return result;
}
