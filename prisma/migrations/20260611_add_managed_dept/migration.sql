-- Add managedDept field for ges_management/ges_pd to specify the department they oversee
ALTER TABLE "Employee" ADD COLUMN "managedDept" TEXT NOT NULL DEFAULT '';
