-- Add startDate and endDate to Project
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "endDate"   TIMESTAMP(3);

-- Create Holiday table
CREATE TABLE IF NOT EXISTS "Holiday" (
  "id"        TEXT         NOT NULL,
  "date"      TIMESTAMP(3) NOT NULL,
  "name"      TEXT         NOT NULL,
  "type"      TEXT         NOT NULL DEFAULT 'public_holiday',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- Create ResourcePlanMonthly table
CREATE TABLE IF NOT EXISTS "ResourcePlanMonthly" (
  "id"         TEXT             NOT NULL,
  "projectId"  TEXT             NOT NULL,
  "department" TEXT             NOT NULL,
  "year"       INTEGER          NOT NULL,
  "month"      INTEGER          NOT NULL,
  "plannedHrs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "planStatus" TEXT             NOT NULL DEFAULT 'draft',
  "createdBy"  TEXT             NOT NULL,
  "updatedAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourcePlanMonthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResourcePlanMonthly_projectId_department_year_month_key"
  ON "ResourcePlanMonthly"("projectId", "department", "year", "month");

ALTER TABLE "ResourcePlanMonthly"
  ADD CONSTRAINT "ResourcePlanMonthly_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
