// Staff who join mid-period only owe timesheets from the week they started, and
// staff who leave only up to the week of their last working day.
// startDate / endDate are optional (null = open). A week counts if any of its
// 7 days falls inside [startDate, endDate].
type EmploymentPeriod = { startDate?: Date | string | null; endDate?: Date | string | null };

const DAY_MS = 86400000;

export function isEmployedInWeek(emp: EmploymentPeriod, weekStart: Date): boolean {
  const weekLast = weekStart.getTime() + 6 * DAY_MS;
  const started = !emp.startDate || new Date(emp.startDate).getTime() <= weekLast;
  const notLeft = !emp.endDate || new Date(emp.endDate).getTime() >= weekStart.getTime();
  return started && notLeft;
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
