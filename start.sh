#!/bin/sh
echo "==> Running migrations..."
# migration ล้มเหลว = หยุด deploy (ไม่ปล่อยให้แอปขึ้นโดย schema ไม่ตรง)
npx prisma migrate deploy || exit 1

echo "==> Running seed (if empty)..."
node scripts/seed-prod.js || true

echo "==> Starting Next.js on port $PORT..."
exec npx next start -p $PORT
