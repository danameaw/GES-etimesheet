-- Rename roles: pd -> ges_management, pm -> pd
-- Must rename pd first to avoid collision with pm->pd

-- Step 1: pd -> ges_management
UPDATE "Employee" SET role = 'ges_management' WHERE role = 'pd';

-- Step 2: pm -> pd
UPDATE "Employee" SET role = 'pd' WHERE role = 'pm';

-- Step 3: update ResourcePlan planStatus references (no changes needed, these are status values not roles)
-- Note: 'md' role can be assigned manually via Employees page after deploy
