import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startOfWeek, addDays } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  // PM, admin: manage own projects | pd: read all for approval
  if (!["pm", "admin", "pd"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const projectId = searchParams.get("projectId");

  // weekParam is sent as "yyyy-MM-dd" (date-only) to avoid timezone shift
  const weekStart = weekParam
    ? new Date(weekParam + "T00:00:00.000Z")
    : startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

  // Determine which projects this user can see
  // PD and admin see all projects; PM only sees their own
  const projectWhere = role === "pm" ? { managerId: empDbId } : {};
  const myProjects = await prisma.project.findMany({
    where: { ...projectWhere, isActive: true },
    include: { manager: { select: { id: true, name: true, employeeId: true } } },
    orderBy: { projectNumber: "asc" },
  });

  if (myProjects.length === 0) {
    return NextResponse.json({ projects: [], plans: [], actuals: [], allEmployees: [], weekStart, weekEnd });
  }

  const projectIds = projectId
    ? [projectId]
    : myProjects.map((p) => p.id);

  // Fetch resource plans for the week
  const plans = await prisma.resourcePlan.findMany({
    where: { projectId: { in: projectIds }, weekStart },
    include: { employee: { select: { id: true, employeeId: true, name: true, department: true, position: true } } },
  });

  // Fetch actual hours from timesheet entries for the same week
  const actuals = await prisma.timesheetEntry.findMany({
    where: {
      projectId: { in: projectIds },
      timesheet: { weekStart: { gte: weekStart }, weekEnd: { lte: weekEnd } },
    },
    include: {
      timesheet: {
        include: { employee: { select: { id: true, employeeId: true, name: true, department: true } } },
      },
    },
  });

  // Fetch all active employees for dropdown (only for PM/admin)
  const allEmployees = role !== "pd"
    ? await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ department: "asc" }, { name: "asc" }],
        select: { id: true, employeeId: true, name: true, department: true, position: true },
      })
    : [];

  return NextResponse.json({ projects: myProjects, plans, actuals, allEmployees, weekStart, weekEnd });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pm", "admin"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { projectId, employeeId, weekStart, plannedHrs } = body;

  // Verify this PM owns the project (skip for admin)
  if (role !== "admin") {
    const project = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
    if (!project) return NextResponse.json({ error: "Not your project" }, { status: 403 });
  }

  // weekStart is sent as "yyyy-MM-dd" from frontend — parse as UTC midnight
  const wsDate = weekStart.length === 10
    ? new Date(weekStart + "T00:00:00.000Z")
    : new Date(weekStart);

  const plan = await prisma.resourcePlan.upsert({
    where: { projectId_employeeId_weekStart: { projectId, employeeId, weekStart: wsDate } },
    update: { plannedHrs: Number(plannedHrs), createdBy: empDbId },
    create: { projectId, employeeId, weekStart: wsDate, plannedHrs: Number(plannedHrs), createdBy: empDbId },
  });

  return NextResponse.json({ plan });
}

// PATCH: PM submits plan, or PD approves a project-week plan
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pm", "admin", "pd"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { action, projectId, weekStart } = body; // action: "submit" | "approve" | "reject"

  const wsDate = weekStart.length === 10
    ? new Date(weekStart + "T00:00:00.000Z")
    : new Date(weekStart);

  if (action === "submit") {
    // PM submits their plan for this project-week
    if (role !== "pm" && role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await prisma.resourcePlan.updateMany({
      where: { projectId, weekStart: wsDate },
      data: { planStatus: "submitted" },
    });
    return NextResponse.json({ success: true, planStatus: "submitted" });
  }

  if (action === "approve" || action === "reject") {
    // ONLY PD can approve/reject resource plans
    if (role !== "pd") return NextResponse.json({ error: "Only PD can approve resource plans" }, { status: 403 });
    const newStatus = action === "approve" ? "approved" : "draft";
    await prisma.resourcePlan.updateMany({
      where: { projectId, weekStart: wsDate },
      data: { planStatus: newStatus },
    });
    return NextResponse.json({ success: true, planStatus: newStatus });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["pm", "pd", "admin"].includes((session.user as any).role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.resourcePlan.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
