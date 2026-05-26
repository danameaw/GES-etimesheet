import { startOfWeek, endOfWeek, addWeeks, format } from "date-fns";

export function getWeekRange(date: Date = new Date()) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 });     // Sunday
  return { weekStart, weekEnd };
}

export function getCurrentWeekRange() {
  return getWeekRange(new Date());
}

export function formatWeekLabel(weekStart: Date): string {
  return `${format(weekStart, "dd MMM")} - ${format(addWeeks(weekStart, 0).setDate(weekStart.getDate() + 6) as unknown as Date, "dd MMM yyyy")}`;
}

export function isSubmissionLocked(weekStart: Date): boolean {
  const now = new Date();
  const nextMonday = addWeeks(weekStart, 1);
  nextMonday.setHours(9, 0, 0, 0);
  nextMonday.setDate(nextMonday.getDate() - nextMonday.getDay() + 1); // Set to next Monday
  const lockTime = addWeeks(new Date(weekStart), 1);
  lockTime.setDate(lockTime.getDate() + (1 - lockTime.getDay() + 7) % 7 || 7);
  lockTime.setHours(9, 0, 0, 0);
  return now > lockTime;
}

export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}
