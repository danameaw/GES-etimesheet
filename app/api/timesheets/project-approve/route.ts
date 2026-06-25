import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPD } from "@/lib/roles";

// POST: อนุมัติ project สำหรับ timesheets ที่ระบุ (per-project approval โดย PD)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;
  if (!isPD(role) && role !== "md" && role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { timesheetIds, projectId } = await req.json() as { timesheetIds: string[]; projectId: string };
  if (!projectId || !Array.isArray(timesheetIds) || timesheetIds.length === 0)
    return NextResponse.json({ error: "timesheetIds and projectId are required" }, { status: 400 });

  // สร้าง / update approval records (upsert ตาม unique key)
  await prisma.$transaction(
    timesheetIds.map((tsId) =>
      (prisma as any).timesheetProjectApproval.upsert({
        where:  { timesheetId_projectId: { timesheetId: tsId, projectId } },
        create: { timesheetId: tsId, projectId, approvedById: empDbId },
        update: { approvedById: empDbId, approvedAt: new Date() },
      })
    )
  );

  return NextResponse.json({ ok: true, count: timesheetIds.length });
}

// DELETE: ยกเลิก per-project approval
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role;
  if (!isPD(role) && role !== "md" && role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { timesheetId, projectId } = await req.json() as { timesheetId: string; projectId: string };
  if (!timesheetId || !projectId)
    return NextResponse.json({ error: "timesheetId and projectId are required" }, { status: 400 });

  await (prisma as any).timesheetProjectApproval.deleteMany({
    where: { timesheetId, projectId },
  });

  return NextResponse.json({ ok: true });
}
