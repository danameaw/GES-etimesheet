-- Sub-units inside departments (any depth)
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "parentId" TEXT,
    "headId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrgUnit_department_idx" ON "OrgUnit"("department");
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_headId_fkey" FOREIGN KEY ("headId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Employee belongs to at most one unit
ALTER TABLE "Employee" ADD COLUMN "orgUnitId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plan approvals can be per unit ("" = department-level, the previous behaviour)
ALTER TABLE "ResourcePlanDeptApproval" ADD COLUMN "unitId" TEXT NOT NULL DEFAULT '';
DROP INDEX "ResourcePlanDeptApproval_projectId_department_key";
CREATE UNIQUE INDEX "ResourcePlanDeptApproval_projectId_department_unitId_key" ON "ResourcePlanDeptApproval"("projectId", "department", "unitId");
