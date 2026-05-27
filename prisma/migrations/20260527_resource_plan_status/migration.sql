-- Add planStatus column to ResourcePlan table
ALTER TABLE "ResourcePlan" ADD COLUMN IF NOT EXISTS "planStatus" TEXT NOT NULL DEFAULT 'draft';
