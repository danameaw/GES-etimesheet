import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (!["admin", "pd", "md"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { action } = await req.json();

  // ── MD: ตรวจว่า timesheet มี entry ใน GES-OH project เท่านั้น ────────────
  if (role === "md" && ["approve", "reject", "unlock"].includes(action)) {
    const ts = await prisma.timesheet.findUnique({
      where: { id: params.id },
      include: { entries: { include: { project: { select: { projectType: true, projectNumber: true } } } } },
    });
    const isOH = ts?.entries.every(
      (e) => e.project.projectType === "support" || e.project.projectNumber.startsWith("GES-OH")
    );
    if (!isOH) {
      return NextResponse.json({ error: "MD สามารถอนุมัติได้เฉพาะ GES-OH เท่านั้น" }, { status: 403 });
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
    if (role !== "pd" && role !== "md" && role !== "admin")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await prisma.timesheet.update({ where: { id: params.id }, data: { status: "approved" } });
    await prisma.auditLog.create({ data: { employeeId: (session.user as any).id, action: "APPROVE_TIMESHEET", detail: `Approved timesheet ${params.id}` } });
    return NextResponse.json({ success: true });
  }

  if (action === "reject") {
    if (role !== "pd" && role !== "md" && role !== "admin")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await prisma.timesheet.update({
      where: { id: params.id },
      data: { status: "rejected", submittedAt: null },
    });
    await prisma.auditLog.create({ data: { employeeId: (session.user as any).id, action: "REJECT_TIMESHEET", detail: `Rejected timesheet ${params.id}` } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
