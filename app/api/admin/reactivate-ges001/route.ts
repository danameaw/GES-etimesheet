/**
 * TEMPORARY endpoint — delete this file after use
 * Reactivates GES001 so admin can login
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const result = await prisma.employee.updateMany({
    where: { employeeId: "GES001" },
    data: { isActive: true },
  });
  const emp = await prisma.employee.findFirst({ where: { employeeId: "GES001" } });
  return NextResponse.json({
    updated: result.count,
    employee: { employeeId: emp?.employeeId, name: emp?.name, role: emp?.role, isActive: emp?.isActive },
  });
}
