// Staff who join mid-period only owe timesheets from the week they started.
// startDate is optional: existing staff have none and owe every week. A week
// counts if any of its 7 days is on or after the startDate.
type EmploymentPeriod = { startDate?: Date | string | null };

const DAY_MS = 86400000;

export function isEmployedInWeek(emp: EmploymentPeriod, weekStart: Date): boolean {
  const weekLast = weekStart.getTime() + 6 * DAY_MS;
  return !emp.startDate || new Date(emp.startDate).getTime() <= weekLast;
}

// "yyyy-MM-dd" from a date input → UTC midnight Date; empty/missing → null (clears the field)
export function parseDateOnly(v: unknown): Date | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00.000Z") : null;
}
