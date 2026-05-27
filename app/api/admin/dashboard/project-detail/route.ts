import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const MS_13H = 13 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "pd")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const weekParam  = searchParams.get("week");
  const monthParam = searchParams.get("month");

  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build timesheet date filter for the selected period
  const timesheetWhere: any = {
    status: { in: ["submitted", "approved"] },
    entries: { some: { projectId } },
  };

  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    const mStart = new Date(Date.UTC(y, m - 1, 1));
    const mEnd   = new Date(Date.UTC(y, m,     1));
    timesheetWhere.weekStart = {
      gte: new Date(mStart.getTime() - MS_13H),
      lt:  new Date(mEnd.getTime()   + MS_13H),
    };
  } else if (weekParam) {
    const wStart = new Date(weekParam + "T00:00:00.000Z");
    timesheetWhere.weekStart = {
      gte: new Date(wStart.getTime() - MS_13H),
      lt:  new Date(wStart.getTime() + MS_13H),
    };
  }

  // Fetch timesheets with entries for this project
  const timesheets = await prisma.timesheet.findMany({
    where: timesheetWhere,
    include: {
      employee: true,
      entries: { where: { projectId } },
    },
  });

  // Per-employee actual hours on this project
  const empActualMap = new Map<string, { name: string; employeeId: string; department: string; actualHrs: number }>();
  for (const ts of timesheets) {
    const hrs = ts.entries.reduce((s, e) => s + e.totalHrs, 0);
    if (hrs === 0) continue;
    const existing = empActualMap.get(ts.employeeId);
    if (existing) existing.actualHrs += hrs;
    else empActualMap.set(ts.employeeId, {
      name: ts.employee.name,
      employeeId: ts.employee.employeeId,
      department: ts.employee.department,
      actualHrs: hrs,
    });
  }

  // Planned hours per department from ResourcePlanMonthly
  let planRows: any[] = [];
  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    planRows = await prisma.resourcePlanMonthly.findMany({
      where: { projectId, year: y, month: m },
    });
  } else {
    // For week mode, get the full plan for the project
    planRows = await prisma.resourcePlanMonthly.findMany({ where: { projectId } });
  }

  const planByDept: Record<string, number> = {};
  for (const p of planRows) {
    planByDept[p.department] = (planByDept[p.department] || 0) + p.plannedHrs;
  }

  // Group actual per department
  const actualByDept: Record<string, number> = {};
  for (const v of empActualMap.values()) {
    actualByDept[v.department] = (actualByDept[v.department] || 0) + v.actualHrs;
  }

  return NextResponse.json({
    project: { id: project.id, projectNumber: project.projectNumber, projectName: project.projectName },
    employees: Array.from(empActualMap.values()).sort((a, b) => b.actualHrs - a.actualHrs),
    planByDept,
    actualByDept,
  });
}
