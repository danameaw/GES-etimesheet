-- Optional first working day: weeks before it are not required for timesheets
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "startDate" DATE;
