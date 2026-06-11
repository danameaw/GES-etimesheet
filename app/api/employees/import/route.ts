import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DEPARTMENTS = [
  "Management", "Project Management", "Engineering", "Construction",
  "Project Control", "Grid Connection", "BOI", "Admin", "Procurement", "HSE",
];
const ROLES = ["employee", "pd", "ges_pd", "ges_management", "admin", "md"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { rows } = body as { rows: any[] };

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  // Fetch existing employee IDs
  const existing = await prisma.employee.findMany({ select: { employeeId: true } });
  const existingIds = new Set(existing.map((e) => e.employeeId));

  let created = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const empId = String(row.employeeId || "").trim().toUpperCase();
    if (existingIds.has(empId)) {
      errors.push(`${empId}: Employee ID ซ้ำ — ข้ามแถวนี้`);
      continue;
    }
    try {
      await prisma.employee.create({
        data: {
          employeeId: empId,
          name: String(row.name || "").trim(),
          department: String(row.department || "").trim(),
          position: String(row.position || "").trim(),
          level: String(row.level || "").trim(),
          role: ROLES.includes(String(row.role || "").toLowerCase()) ? String(row.role).toLowerCase() : "employee",
          isActive: true,
        },
      });
      existingIds.add(empId);
      created++;
    } catch (e: any) {
      errors.push(`${empId}: ${e.message}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      employeeId: (session.user as any).id,
      action: "IMPORT_EMPLOYEES",
      detail: `Imported ${created} employees via Excel`,
    },
  });

  return NextResponse.json({ created, errors });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Return validation metadata for frontend
  return NextResponse.json({ departments: DEPARTMENTS, roles: ROLES });
}
