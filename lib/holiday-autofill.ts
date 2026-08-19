/**
 * เติมวันหยุดให้อัตโนมัติ: Project Overhead + Task 1001 (Holidays) วันละ 8 ชม.
 *
 * ใช้ร่วมกันทั้งฝั่งหน้าจอ (pre-fill ให้ user เห็นก่อนบันทึก) และฝั่ง API
 * (backstop ตอน save เผื่อแถวหลุดหาย) — ตรรกะต้องตรงกันทั้งสองฝั่ง
 */

/** เริ่มเติมอัตโนมัติตั้งแต่วันนี้เป็นต้นไป (yyyy-MM-dd) — สัปดาห์ที่คร่อมเดือนจะเติมเฉพาะวันที่ถึงกำหนด */
export const HOLIDAY_AUTOFILL_FROM = "2026-09-01";

/** Task code ที่ใช้ลงวันหยุดนักขัตฤกษ์ */
export const HOLIDAY_TASK_CODE = "1001";

/** ชั่วโมงต่อวันหยุด 1 วัน */
export const HOLIDAY_HRS_PER_DAY = 8;

export const DAY_FIELDS = [
  "monHrs", "tueHrs", "wedHrs", "thuHrs", "friHrs", "satHrs", "sunHrs",
] as const;
export type DayField = (typeof DAY_FIELDS)[number];

/** "yyyy-MM-dd" ของวันจันทร์–อาทิตย์ในสัปดาห์นั้น (อ่านค่าแบบ UTC — weekStart เก็บเป็นเที่ยงคืน UTC) */
export function weekDateStringsUTC(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}

/**
 * ชั่วโมงวันหยุดที่ควรเติมให้ในสัปดาห์นี้ เช่น { friHrs: 8 }
 *
 * - เฉพาะวันจันทร์–ศุกร์ (เสาร์/อาทิตย์เป็นวันหยุดประจำสัปดาห์อยู่แล้ว ไม่ต้องลงชั่วโมง)
 * - เฉพาะวันหยุดตั้งแต่ HOLIDAY_AUTOFILL_FROM เป็นต้นไป
 *
 * @param weekDates    "yyyy-MM-dd" ของวันจันทร์–อาทิตย์ (7 ค่า เรียงตามลำดับ)
 * @param holidayDates "yyyy-MM-dd" ของวันหยุดที่อยู่ในสัปดาห์นั้น
 */
export function holidayHoursForWeek(
  weekDates: string[],
  holidayDates: Iterable<string>,
): Partial<Record<DayField, number>> {
  const holidaySet = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const hours: Partial<Record<DayField, number>> = {};

  for (let i = 0; i < 5; i++) {
    const date = weekDates[i];
    if (!date || date < HOLIDAY_AUTOFILL_FROM) continue;
    if (holidaySet.has(date)) hours[DAY_FIELDS[i]] = HOLIDAY_HRS_PER_DAY;
  }

  return hours;
}

/**
 * เติมชั่วโมงวันหยุดลงในแถว Holiday (คืนค่าใหม่ ไม่แก้ของเดิม)
 * เติมเฉพาะวันที่ยังเป็น 0 — ถ้า user แก้เป็นเลขอื่นไว้แล้วจะไม่ทับ
 *
 * @returns { rows, changed } — changed = true เมื่อมีการเติมจริง
 */
export function applyHolidayHours<T extends Record<string, any>>(
  rows: T[],
  holidayProjectId: string,
  holidayTaskCodeId: string,
  hours: Partial<Record<DayField, number>>,
  makeRow: (base: Partial<Record<DayField, number>> & { projectId: string; taskCodeId: string }) => T,
): { rows: T[]; changed: boolean } {
  const days = Object.keys(hours) as DayField[];
  if (days.length === 0) return { rows, changed: false };

  const index = rows.findIndex(
    (r) => r.projectId === holidayProjectId && r.taskCodeId === holidayTaskCodeId
  );

  if (index === -1) {
    return {
      rows: [...rows, makeRow({ projectId: holidayProjectId, taskCodeId: holidayTaskCodeId, ...hours })],
      changed: true,
    };
  }

  const target = rows[index];
  const missing = days.filter((d) => !(Number(target[d]) > 0));
  if (missing.length === 0) return { rows, changed: false };

  const patch: Partial<Record<DayField, number>> = {};
  for (const d of missing) patch[d] = hours[d];

  const next = [...rows];
  next[index] = { ...target, ...patch };
  return { rows: next, changed: true };
}
