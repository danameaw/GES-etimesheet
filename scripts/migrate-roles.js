/**
 * One-time migration: rename roles in the database
 *   pm  → pd
 *   pd  → ges_management
 *
 * Run: node scripts/migrate-roles.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // Must rename pd → ges_management FIRST, before pm → pd,
  // to avoid double-renaming the same rows.
  const step1 = await prisma.employee.updateMany({
    where:  { role: "pd" },
    data:   { role: "ges_management" },
  });
  console.log(`pd  → ges_management : ${step1.count} rows`);

  const step2 = await prisma.employee.updateMany({
    where:  { role: "pm" },
    data:   { role: "pd" },
  });
  console.log(`pm  → pd             : ${step2.count} rows`);

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
