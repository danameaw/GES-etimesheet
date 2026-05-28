-- Add level column to Employee
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "level" TEXT NOT NULL DEFAULT '';

-- Create StandardRate table
CREATE TABLE IF NOT EXISTS "StandardRate" (
  "id"        TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "level"     TEXT NOT NULL,
  "rate"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StandardRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StandardRate_level_key" ON "StandardRate"("level");
