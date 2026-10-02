import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPD, isGesMgmt } from "@/lib/roles";
import { entryHoursInRange, weekStartFilterForRange } from "@/lib/capacity";

// Drill-down endpoint สำหรับ Plan vs Actual Matrix
//   projectId + year + month  → รายชื่อพนักงานที่ลงเวลาใน project/เดือนนั้น
//   empId     + year + month  → รายชื่อ project ที่พนักงานคนนั้นลงเวลาในเดือนนั้น
// ชั่วโมงแบ่งเข้าเดือนตามวันที่จริง + นับเฉพาะ submitted/approved ให้ตรงกับ matrix เป๊ะ เพื่อให้ยอดตรงกับเซลล์

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;
  if (!["ges_management", "ges_pd", "admin", "md", "pd"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "";
  const empId     = searchParams.get("empId") || "";
  const year      = Number(searchParams.get("year"));
  const month     = Number(searchParams.get("month"));
  if (!year || !month || (!projectId && !empId))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // ช่วงเดือน: ดึงทุกสัปดาห์ที่มีวันตกในเดือน แล้วนับเฉพาะชั่วโมงของวันในเดือน
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end   = new Date(Date.UTC(year, month, 1));
  const weekFilter = weekStartFilterForRange(start, end);

  // ── Project drill-down: ใครลงเวลาใน project นี้เท่าไหร่ ──
  if (projectId) {
    // PD: จำกัดเฉพาะ project ที่ตัวเองดูแล
    if (isPD(role)) {
      const ok = await prisma.project.findFirst({
        where: { id: projectId, OR: [{ pdId: empDbId }, { managerId: empDbId }] },
        select: { id: true },
      });
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const entries = await prisma.timesheetEntry.findMany({
      where: {
        projectId,
        totalHrs: { gt: 0 },
        timesheet: { status: { in: ["submitted", "approved"] }, weekStart: weekFilter },
      },
      include: {
        taskCode: { select: { category: true } },
        timesheet: {
          select: {
            weekStart: true,
            employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
          },
        },
      },
    });

    const byEmp = new Map<string, {
      empId: string; employeeId: string; name: string; department: string; position: string; hours: number;
    }>();
    for (const e of entries) {
      const hrs = entryHoursInRange(e.timesheet.weekStart, e, start, end);
      if (hrs <= 0) continue;
      const emp = e.timesheet.employee;
      const x = byEmp.get(emp.id);
      if (x) x.hours += hrs;
      else byEmp.set(emp.id, {
        empId: emp.id, employeeId: emp.employeeId, name: emp.name,
        department: emp.department, position: emp.position, hours: hrs,
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectNumber: true, projectName: true },
    });

    const rows = Array.from(byEmp.values())
      .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);
    const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;

    return NextResponse.json({
      type: "project",
      projectNumber: project?.projectNumber ?? "?",
      projectName:   project?.projectName ?? "?",
      rows,
      totalHours,
    });
  }

  // ── Employee drill-down: พนักงานคนนี้ลงเวลาใน project ไหนบ้าง ──
  // GES Management: จำกัดเฉพาะพนักงานใน department ที่ตัวเองดูแล
  if (isGesMgmt(role)) {
    const me = await prisma.employee.findUnique({ where: { id: empDbId }, select: { managedDept: true } });
    const target = await prisma.employee.findUnique({ where: { id: empId }, select: { department: true } });
    if (me?.managedDept && target?.department !== me.managedDept)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      totalHrs: { gt: 0 },
      timesheet: {
        employeeId: empId,
        status: { in: ["submitted", "approved"] },
        weekStart: weekFilter,
      },
    },
    include: {
      timesheet: { select: { weekStart: true } },
      project:  { select: { id: true, projectNumber: true, projectName: true } },
      taskCode: { select: { category: true } },
    },
  });

  const byProj = new Map<string, {
    projectId: string; projectNumber: string; projectName: string; hours: number;
  }>();
  for (const e of entries) {
    const hrs = entryHoursInRange(e.timesheet.weekStart, e, start, end);
    if (hrs <= 0) continue;
    const x = byProj.get(e.projectId);
    if (x) x.hours += hrs;
    else byProj.set(e.projectId, {
      projectId: e.projectId,
      projectNumber: e.project?.projectNumber ?? "?",
      projectName:   e.project?.projectName ?? "?",
      hours: hrs,
    });
  }

  const emp = await prisma.employee.findUnique({
    where: { id: empId },
    select: { employeeId: true, name: true },
  });

  const rows = Array.from(byProj.values())
    .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
  const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;

  return NextResponse.json({
    type: "emp",
    employeeId: emp?.employeeId ?? "?",
    name:       emp?.name ?? "?",
    rows,
    totalHours,
  });
}
