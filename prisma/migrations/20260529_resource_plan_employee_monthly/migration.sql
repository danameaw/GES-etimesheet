-- Create ResourcePlanEmployeeMonthly table
CREATE TABLE IF NOT EXISTS "ResourcePlanEmployeeMonthly" (
  "id"          TEXT             NOT NULL,
  "projectId"   TEXT             NOT NULL,
  "employeeId"  TEXT             NOT NULL,
  "year"        INTEGER          NOT NULL,
  "month"       INTEGER          NOT NULL,
  "plannedHrs"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "planStatus"  TEXT             NOT NULL DEFAULT 'draft',
  "createdBy"   TEXT             NOT NULL,
  "updatedAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourcePlanEmployeeMonthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResourcePlanEmployeeMonthly_projectId_employeeId_year_month_key"
  ON "ResourcePlanEmployeeMonthly"("projectId", "employeeId", "year", "month");

ALTER TABLE "ResourcePlanEmployeeMonthly"
  ADD CONSTRAINT "ResourcePlanEmployeeMonthly_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResourcePlanEmployeeMonthly"
  ADD CONSTRAINT "ResourcePlanEmployeeMonthly_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
