/**
 * One-time script: re-activate GES001 so admin can login
 * Run: node scripts/reactivate-admin.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const result = await prisma.employee.updateMany({
  where: { employeeId: "GES001" },
  data: { isActive: true },
});

console.log(`Updated ${result.count} employee(s)`);

const emp = await prisma.employee.findFirst({ where: { employeeId: "GES001" } });
console.log("GES001:", emp?.name, "| role:", emp?.role, "| isActive:", emp?.isActive);

await prisma.$disconnect();
