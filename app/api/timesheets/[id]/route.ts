import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (!["admin", "pd"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { action } = await req.json();

  if (action === "unlock") {
    // Admin AND PD can unlock
    await prisma.timesheet.update({
      where: { id: params.id },
      data: { status: "draft", submittedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        employeeId: (session.user as any).id,
        action: "UNLOCK_TIMESHEET",
        detail: `Unlocked timesheet ${params.id}`,
      },
    });
    return NextResponse.json({ success: true });
  }

  if (action === "approve") {
    // ONLY PD can approve timesheets
    if (role !== "pd") {
      return NextResponse.json({ error: "Only PD can approve timesheets" }, { status: 403 });
    }
    await prisma.timesheet.update({
      where: { id: params.id },
      data: { status: "approved" },
    });
    await prisma.auditLog.create({
      data: {
        employeeId: (session.user as any).id,
        action: "APPROVE_TIMESHEET",
        detail: `Approved timesheet ${params.id}`,
      },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
