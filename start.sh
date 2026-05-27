#!/bin/sh
echo "==> Running migrations..."
npx prisma migrate deploy || true

echo "==> Running seed (if empty)..."
node scripts/seed-prod.js || true

echo "==> Starting Next.js on port $PORT..."
exec npx next start -p $PORT
