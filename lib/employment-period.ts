// Timesheets are submitted per week, but what an employee owes is counted per working day:
// from their startDate (the day itself, not the whole week) up to their endDate.
// A week is owed if at least one of its Mon–Fri days falls inside [startDate, endDate]
// (company holidays included — those days are logged as 1001 Holidays).
// Monthly views pass `within` (the month) so only that month's days of a straddling week count.
type EmploymentPeriod = { startDate?: Date | string | null; endDate?: Date | string | null };
export type DateWindow = { start: Date; end: Date }; // [start, end) — UTC midnights

const DAY_MS = 86400000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
// weekStart is stored as UTC midnight, or ~17:00Z the day before for old UTC+7 rows → round to the day
const roundDay = (d: Date | string) => Math.round(new Date(d).getTime() / DAY_MS) * DAY_MS;

/** Owed working days ("yyyy-MM-dd", Mon–Fri) of the week starting `weekStart`, optionally limited to `within` */
export function owedWorkdays(emp: EmploymentPeriod, weekStart: Date, within?: DateWindow | null): string[] {
  const start = emp.startDate ? dayKey(roundDay(emp.startDate)) : null;
  const end = emp.endDate ? dayKey(roundDay(emp.endDate)) : null;
  const winStart = within ? dayKey(within.start.getTime()) : null;
  const winEnd = within ? dayKey(within.end.getTime()) : null;
  const base = roundDay(weekStart);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {            // Mon..Fri
    const k = dayKey(base + i * DAY_MS);
    if (start && k < start) continue;
    if (end && k > end) continue;
    if (winStart && (k < winStart || k >= winEnd!)) continue;
    out.push(k);
  }
  return out;
}

export function isEmployedInWeek(emp: EmploymentPeriod, weekStart: Date, within?: DateWindow | null): boolean {
  return owedWorkdays(emp, weekStart, within).length > 0;
}

/** "yyyy-MM" or "yyyy-MM-dd" → that calendar month as [1st, 1st of next) in UTC; anything else → null */
export function monthWindow(v: string | null | undefined): DateWindow | null {
  const m = v?.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/**
 * Prisma filter for staff to include in reports from `periodStart` on:
 * active staff, plus staff who left (deactivated) on or after that date,
 * so past periods still count people who worked then.
 */
export function employedFrom(periodStart: Date) {
  return { OR: [{ isActive: true }, { endDate: { gte: periodStart } }] };
}

// "yyyy-MM-dd" from a date input → UTC midnight Date; empty/missing → null (clears the field)
export function parseDateOnly(v: unknown): Date | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00.000Z") : null;
}
