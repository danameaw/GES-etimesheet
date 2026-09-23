-- Add engineering-track level to StandardRate
ALTER TABLE "StandardRate" ADD COLUMN IF NOT EXISTS "engLevel" TEXT NOT NULL DEFAULT '';
