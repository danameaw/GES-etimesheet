-- Add pdId (Project Director) and planStatus to Project table
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pdId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "planStatus" TEXT NOT NULL DEFAULT 'draft';

-- Add FK constraint for pdId (safe to add even if column already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Project_pdId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_pdId_fkey"
      FOREIGN KEY ("pdId") REFERENCES "Employee"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Update planStatus on ResourcePlanMonthly to support revision_requested
-- (column already exists, just adding support for new value string — no schema change needed)
