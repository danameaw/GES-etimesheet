/**
 * Run seed only if database is empty (first deploy).
 * Called from `npm run build` on Railway.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.employee.count();
  if (count > 0) {
    console.log(`Database already has ${count} employees — skipping seed.`);
    return;
  }
  console.log("Database is empty — running seed...");
  // Dynamically import seed
  await import("../prisma/seed");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
