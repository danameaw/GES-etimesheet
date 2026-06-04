/**
 * ONE-TIME migration endpoint — delete after use.
 * Renames roles in the database:  pm → pd,  pd → ges_management
 * Call: GET /api/admin/migrate-roles  (must be logged in as admin)
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Step 1: pd → ges_management  (must go first to avoid double-rename)
  const step1 = await prisma.employee.updateMany({
    where: { role: "pd" },
    data:  { role: "ges_management" },
  });

  // Step 2: pm → pd
  const step2 = await prisma.employee.updateMany({
    where: { role: "pm" },
    data:  { role: "pd" },
  });

  return NextResponse.json({
    message: "Migration complete",
    "pd → ges_management": step1.count,
    "pm → pd": step2.count,
  });
}
