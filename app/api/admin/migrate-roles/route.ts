/**
 * ONE-TIME migration endpoint — delete after use.
 * 1) Rename roles:       pm → pd,  pd → ges_management
 * 2) Rename departments: old discipline names → new official names
 * 3) Deactivate dummy employees with names F–T (single letter, GES006–GES020)
 * Call: GET /api/admin/migrate-roles  (must be logged in as admin)
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DEPT_MAP: Record<string, string> = {
  "Process Engineering":   "Engineering",
  "Mechanical Engineering": "Engineering",
  "Electrical Engineering": "Engineering",
  "Civil & Structural":     "Construction",
  "Instrumentation":        "Engineering",
  "Piping Engineering":     "Engineering",
  "Document Control":       "Project Control",
  "Safety & Environment":   "HSE",
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── 1. Roles ──────────────────────────────────────────────────────────────
  const rolePD = await prisma.employee.updateMany({
    where: { role: "pd" },
    data:  { role: "ges_management" },
  });
  const rolePM = await prisma.employee.updateMany({
    where: { role: "pm" },
    data:  { role: "pd" },
  });

  // ── 2. Departments ────────────────────────────────────────────────────────
  const deptResults: Record<string, number> = {};
  for (const [oldDept, newDept] of Object.entries(DEPT_MAP)) {
    const r = await prisma.employee.updateMany({
      where: { department: oldDept },
      data:  { department: newDept },
    });
    if (r.count > 0) deptResults[`${oldDept} → ${newDept}`] = r.count;
  }

  // ── 3. Deactivate dummy employees F–T (GES006–GES020) ────────────────────
  const deactivated = await prisma.employee.updateMany({
    where: {
      employeeId: { in: ["GES006","GES007","GES008","GES009","GES010","GES011","GES012","GES013","GES014","GES015","GES016","GES017","GES018","GES019","GES020"] },
    },
    data: { isActive: false },
  });

  return NextResponse.json({
    message: "Migration complete",
    roles: { "pd → ges_management": rolePD.count, "pm → pd": rolePM.count },
    departments: deptResults,
    deactivated: deactivated.count,
  });
}
