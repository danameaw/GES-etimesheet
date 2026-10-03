-- Optional last working day: weeks after it are not required / counted
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "endDate" DATE;
