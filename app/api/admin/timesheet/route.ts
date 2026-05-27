import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { addDays } from "date-fns";

// GET: admin fetches any employee's timesheet for editing
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const empId = searchParams.get("empId");    // DB cuid
  const weekParam = searchParams.get("week"); // yyyy-MM-dd

  if (!empId || !weekParam) return NextResponse.json({ error: "Missing empId or week" }, { status: 400 });

  const weekStart = new Date(weekParam + "T00:00:00.000Z");

  const employee = await prisma.employee.findUnique({
    where: { id: empId },
    select: { id: true, employeeId: true, name: true, department: true, position: true },
  });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const MS_13H = 13 * 60 * 60 * 1000;
  const timesheet = await prisma.timesheet.findFirst({
    where: { employeeId: empId, weekStart: { gte: new Date(weekStart.getTime() - MS_13H), lt: new Date(weekStart.getTime() + MS_13H) } },
    include: { entries: true },
  });

  const [projects, taskCodes] = await Promise.all([
    prisma.project.findMany({
      where: { isActive: true },
      orderBy: { projectNumber: "asc" },
      select: { id: true, projectNumber: true, projectName: true, projectType: true },
    }),
    prisma.taskCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, category: true },
    }),
  ]);

  return NextResponse.json({ employee, timesheet, projects, taskCodes });
}

// POST: admin saves/submits any employee's timesheet
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { empId, weekStart: ws, entries, action } = body;

  if (!empId || !ws) return NextResponse.json({ error: "Missing empId or weekStart" }, { status: 400 });

  const weekStart = new Date(ws + "T00:00:00.000Z");
  const weekEnd = addDays(weekStart, 6);

  const employee = await prisma.employee.findUnique({ where: { id: empId } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const newStatus = action === "submit" ? "submitted" : "draft";

  // Find or create timesheet
  const MS_13H = 13 * 60 * 60 * 1000;
  let timesheet = await prisma.timesheet.findFirst({
    where: { employeeId: empId, weekStart: { gte: new Date(weekStart.getTime() - MS_13H), lt: new Date(weekStart.getTime() + MS_13H) } },
  });

  if (timesheet) {
    timesheet = await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: {
        status: newStatus,
        submittedAt: action === "submit" ? new Date() : timesheet.submittedAt,
        updatedAt: new Date(),
      },
    });
  } else {
    timesheet = await prisma.timesheet.create({
      data: {
        employeeId: empId,
        weekStart,
        weekEnd,
        status: newStatus,
        submittedAt: action === "submit" ? new Date() : null,
      },
    });
  }

  // Replace all entries
  await prisma.timesheetEntry.deleteMany({ where: { timesheetId: timesheet.id } });

  for (const entry of (entries || [])) {
    if (!entry.projectId || !entry.taskCodeId) continue;
    const totalHrs =
      (Number(entry.monHrs) || 0) + (Number(entry.tueHrs) || 0) +
      (Number(entry.wedHrs) || 0) + (Number(entry.thuHrs) || 0) +
      (Number(entry.friHrs) || 0) + (Number(entry.satHrs) || 0) +
      (Number(entry.sunHrs) || 0);

    await prisma.timesheetEntry.create({
      data: {
        timesheetId: timesheet.id,
        projectId: entry.projectId,
        taskCodeId: entry.taskCodeId,
        monHrs: Number(entry.monHrs) || 0,
        tueHrs: Number(entry.tueHrs) || 0,
        wedHrs: Number(entry.wedHrs) || 0,
        thuHrs: Number(entry.thuHrs) || 0,
        friHrs: Number(entry.friHrs) || 0,
        satHrs: Number(entry.satHrs) || 0,
        sunHrs: Number(entry.sunHrs) || 0,
        totalHrs,
      },
    });
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      employeeId: (session.user as any).id,
      action: `admin_${action}`,
      detail: `Admin ${action === "submit" ? "submitted" : "edited"} timesheet for ${employee.name} (${employee.employeeId}) week ${ws}`,
    },
  });

  return NextResponse.json({ timesheetId: timesheet.id, status: timesheet.status });
}
