/**
 * ความจุ (capacity) และ Utilization ตามหลัก HR / Resource Management
 *
 * - หน่วย MM คงที่ 1 MM = 176 ชม. (ใช้แปลงหน่วยในรายงาน + Standard Rate)
 * - ความจุตามปฏิทินบริษัท = ชม.มาตรฐาน − วันหยุดบริษัท (วันจันทร์–ศุกร์) × 8
 * - ชม.ที่พร้อมทำงาน (Available) = ความจุตามปฏิทินบริษัท − วันลาส่วนตัว
 * - Chargeable Utilization = ชม.โครงการ ÷ ชม.ที่พร้อมทำงาน   (ไม่นับ Overhead / วันลา)
 * - สัดส่วน Overhead       = ชม. Overhead ÷ ชม.ที่พร้อมทำงาน
 *
 * ประเภทชั่วโมง:
 * - leave    = task 1001 (Leave/Holiday) — ถ้าตรงกับวันหยุดบริษัทจะไม่นับซ้ำ (หักจากความจุไปแล้ว)
 * - overhead = ชั่วโมงอื่นใน Project Overhead (Training, BD, Admin, Meeting ฯลฯ)
 * - project  = ชั่วโมงในโครงการปกติ
 */
import { LEAVE_TASK_CODES, isOverheadProject } from "@/lib/task-constants";
import { DAY_FIELDS, DayField } from "@/lib/holiday-autofill";

export const STD_MM_HRS = 176;
export const HRS_PER_DAY = 8;
export const STD_WEEK_HRS = 40;
/** กันเผื่อ Overhead ไว้กี่ % ของความจุ เวลาตรวจแผนเดือนที่ยังไม่มีชั่วโมงจริง */
export const OH_ALLOWANCE_PCT = 0.10;
/** เป้า Chargeable Utilization (%) */
export const UTILIZATION_TARGET = 80;

const DAY_MS = 86400000;

export const toDateKey = (d: Date) => d.toISOString().slice(0, 10);

/** weekStart เก็บเป็นเที่ยงคืน UTC หรือ ~17:00Z ของวันก่อนหน้า (ข้อมูลเก่าที่บันทึกแบบ UTC+7) → ปัดเป็นเที่ยงคืน UTC */
export const normalizeDay = (d: Date) => new Date(Math.round(new Date(d).getTime() / DAY_MS) * DAY_MS);

const isWeekday = (dateKey: string) => {
  const dow = new Date(dateKey + "T00:00:00.000Z").getUTCDay();
  return dow >= 1 && dow <= 5;
};

/** ชุดวันหยุดบริษัทที่ตรงกับวันจันทร์–ศุกร์ ("yyyy-MM-dd") */
export function holidayWeekdaySet(holidays: { date: Date }[]): Set<string> {
  const s = new Set<string>();
  for (const h of holidays) {
    const k = toDateKey(normalizeDay(h.date));
    if (isWeekday(k)) s.add(k);
  }
  return s;
}

/** ความจุตามปฏิทินบริษัทของเดือน: 176 − วันหยุดบริษัท × 8 */
export function monthCompanyCapacity(year: number, month: number, holidays: Set<string>): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  let n = 0;
  holidays.forEach((k) => { if (k.startsWith(prefix)) n++; });
  return Math.max(0, STD_MM_HRS - n * HRS_PER_DAY);
}

/** ความจุตามปฏิทินบริษัทของสัปดาห์: 40 − วันหยุดบริษัท × 8 */
export function weekCompanyCapacity(weekStart: Date, holidays: Set<string>): number {
  const start = normalizeDay(weekStart).getTime();
  let n = 0;
  for (let i = 0; i < 5; i++) if (holidays.has(toDateKey(new Date(start + i * DAY_MS)))) n++;
  return Math.max(0, STD_WEEK_HRS - n * HRS_PER_DAY);
}

export type HourKind = "project" | "overhead" | "leave";

export function classifyEntry(e: {
  project: { projectNumber?: string; projectType?: string } | null;
  taskCode: { code: string } | null;
}): HourKind {
  if (e.taskCode && LEAVE_TASK_CODES.includes(e.taskCode.code)) return "leave";
  return isOverheadProject(e.project) ? "overhead" : "project";
}

/** ชั่วโมงรายวันของ entry: [["yyyy-MM-dd", hrs], ...] (เฉพาะวันที่มีชั่วโมง) */
export function entryDays(weekStart: Date, entry: Partial<Record<DayField, number>>): [string, number][] {
  const start = normalizeDay(weekStart).getTime();
  const out: [string, number][] = [];
  DAY_FIELDS.forEach((f, i) => {
    const hrs = Number(entry[f]) || 0;
    if (hrs > 0) out.push([toDateKey(new Date(start + i * DAY_MS)), hrs]);
  });
  return out;
}

export type HoursBreakdown = { project: number; overhead: number; leave: number };
export const emptyBreakdown = (): HoursBreakdown => ({ project: 0, overhead: 0, leave: 0 });

/** บวกชั่วโมง 1 วันเข้า breakdown — วันลาที่ตรงกับวันหยุดบริษัทไม่นับเป็นวันลาส่วนตัว */
export function addHours(b: HoursBreakdown, kind: HourKind, dateKey: string, hrs: number, holidays: Set<string>) {
  if (kind === "leave") {
    if (!holidays.has(dateKey)) b.leave += hrs;
  } else {
    b[kind] += hrs;
  }
}

/** ชม.ที่พร้อมทำงาน = ความจุตามปฏิทินบริษัท − วันลาส่วนตัว */
export const availableHrs = (companyCapacity: number, b: HoursBreakdown) => Math.max(0, companyCapacity - b.leave);

export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * ชั่วโมงที่วางแผนงานโครงการได้ในเดือนนั้น:
 * ความจุตามปฏิทินบริษัท − วันลาส่วนตัว − Overhead (ใช้ค่าจริง หรือค่ากันเผื่อ ถ้าค่าจริงยังน้อยกว่า)
 */
export function plannableHrs(companyCapacity: number, b: HoursBreakdown): number {
  const oh = Math.max(b.overhead, companyCapacity * OH_ALLOWANCE_PCT);
  return Math.max(0, Math.round(companyCapacity - b.leave - oh));
}
