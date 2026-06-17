import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  if (!["admin", "pd", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ts = await prisma.timesheet.findUnique({
    where: { id: params.id },
    include: {
      employee: { select: { name: true, employeeId: true, department: true } },
      entries: {
        include: {
          project: { select: { projectNumber: true, projectName: true } },
          taskCode: { select: { code: true, name: true, category: true } },
        },
        orderBy: { project: { projectNumber: "asc" } },
      },
    },
  });

  if (!ts) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ timesheet: ts });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (!["admin", "pd", "md"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { action } = await req.json();

  // ── ตรวจสิทธิ์ตาม role ก่อน approve/reject/unlock ─────────────────────────
  if (["approve", "reject", "unlock"].includes(action) && role !== "admin") {
    const ts = await prisma.timesheet.findUnique({
      where: { id: params.id },
      include: { entries: { include: { project: { select: { id: true, projectType: true, projectNumber: true, pdId: true, managerId: true } } } } },
    });
    if (!ts) return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });

    const empDbId = (session.user as any).id;

    if (role === "pd") {
      // PD: ต้องมี entry ที่อยู่ใน project ของตัวเอง (pdId หรือ managerId)
      const ownsAny = ts.entries.some(
        (e) => e.project.pdId === empDbId || e.project.managerId === empDbId
      );
      if (!ownsAny) {
        return NextResponse.json({ error: "PD สามารถอนุมัติได้เฉพาะ project ของตัวเองเท่านั้น" }, { status: 403 });
      }
    }

    if (role === "md") {
      // MD: ต้องเป็น GES-OH เท่านั้น
      const isOH = ts.entries.every(
        (e) => e.project.projectType === "support" || e.project.projectNumber.startsWith("GES-OH")
      );
      if (!isOH) {
        return NextResponse.json({ error: "MD สามารถอนุมัติได้เฉพาะ GES-OH เท่านั้น" }, { status: 403 });
      }
    }
  }

  if (action === "unlock") {
    await prisma.timesheet.update({
      where: { id: params.id },
      data: { status: "draft", submittedAt: null },
    });
    await prisma.auditLog.create({
      data: { employeeId: (session.user as any).id, action: "UNLOCK_TIMESHEET", detail: `Unlocked timesheet ${params.id}` },
    });
    return NextResponse.json({ success: true });
  }

  if (action === "approve") {
    // เฉพาะ PD และ MD เท่านั้น — Admin ดูได้แต่อนุมัติไม่ได้
    if (role !== "pd" && role !== "md")
      return NextResponse.json({ error: "เฉพาะ PD/MD เท่านั้นที่อนุมัติได้" }, { status: 403 });
    await prisma.timesheet.update({ where: { id: params.id }, data: { status: "approved" } });
    await prisma.auditLog.create({ data: { employeeId: (session.user as any).id, action: "APPROVE_TIMESHEET", detail: `Approved timesheet ${params.id}` } });
    return NextResponse.json({ success: true });
  }

  if (action === "reject") {
    // เฉพาะ PD และ MD เท่านั้น
    if (role !== "pd" && role !== "md")
      return NextResponse.json({ error: "เฉพาะ PD/MD เท่านั้นที่ reject ได้" }, { status: 403 });
    await prisma.timesheet.update({
      where: { id: params.id },
      data: { status: "rejected", submittedAt: null },
    });
    await prisma.auditLog.create({ data: { employeeId: (session.user as any).id, action: "REJECT_TIMESHEET", detail: `Rejected timesheet ${params.id}` } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
