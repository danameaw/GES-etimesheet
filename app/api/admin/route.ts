import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, endOfWeek } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");

  let weekStart: Date;
  if (weekParam) {
    weekStart = startOfWeek(new Date(weekParam), { weekStartsOn: 1 });
  } else {
    weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  }
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const [allEmployees, timesheets] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { department: "asc" } }),
    prisma.timesheet.findMany({
      where: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } },
      include: { employee: true, entries: true },
    }),
  ]);

  const timesheetMap = new Map(timesheets.map((t) => [t.employeeId, t]));

  const employeeRows = allEmployees.map((emp) => {
    const ts = timesheetMap.get(emp.id);
    const totalHrs = ts?.entries.reduce((sum, e) => sum + e.totalHrs, 0) || 0;
    return {
      id: emp.id,
      employeeId: emp.employeeId,
      name: emp.name,
      department: emp.department,
      position: emp.position,
      timesheetId: ts?.id || null,
      status: ts?.status || "missing",
      submittedAt: ts?.submittedAt || null,
      totalHrs,
    };
  });

  const submitted = employeeRows.filter((e) => e.status === "submitted").length;
  const draft = employeeRows.filter((e) => e.status === "draft").length;
  const missing = employeeRows.filter((e) => e.status === "missing").length;

  return NextResponse.json({
    summary: {
      total: allEmployees.length,
      submitted,
      draft,
      missing,
      weekStart,
      weekEnd,
    },
    employees: employeeRows,
  });
}
