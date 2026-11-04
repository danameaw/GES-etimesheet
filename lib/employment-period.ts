// Staff who join mid-period only owe timesheets from the week they started, and
// staff who leave only up to the week of their last working day.
// startDate / endDate are optional (null = open). A week counts if any of its
// 7 days falls inside [startDate, endDate].
// Monthly views pass `within` (the month): only the week's days inside that month count,
// so a week that straddles two months is owed to a month only if the employee worked
// one of that month's days in it (e.g. starting Tue 1 Sep doesn't make week 31 Aug owed to August).
type EmploymentPeriod = { startDate?: Date | string | null; endDate?: Date | string | null };
export type DateWindow = { start: Date; end: Date }; // [start, end) — UTC midnights

const DAY_MS = 86400000;

export function isEmployedInWeek(emp: EmploymentPeriod, weekStart: Date, within?: DateWindow | null): boolean {
  let from = weekStart.getTime();
  let last = from + 6 * DAY_MS;
  if (within) {
    from = Math.max(from, within.start.getTime());
    last = Math.min(last, within.end.getTime() - DAY_MS);
    if (from > last) return false;
  }
  const started = !emp.startDate || new Date(emp.startDate).getTime() <= last;
  const notLeft = !emp.endDate || new Date(emp.endDate).getTime() >= from;
  return started && notLeft;
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
