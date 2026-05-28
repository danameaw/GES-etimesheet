-- Add Leave/Holiday task code 1001 if it does not already exist
INSERT INTO "TaskCode" (id, code, name, category, "isActive")
SELECT gen_random_uuid()::text, '1001', 'Leave/Holiday', 'Leave', true
WHERE NOT EXISTS (
  SELECT 1 FROM "TaskCode" WHERE code = '1001'
);
