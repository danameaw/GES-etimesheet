-- GES Management may oversee one unit (and its sub-units) instead of the whole department
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "managedUnitId" TEXT;
