import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasRole, isPD } from "@/lib/roles";
import * as XLSX from "xlsx";
import { parsePlanRows, savePlans, sheetProjectNumber, sheetRows } from "@/lib/plan-template";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!hasRole(role, "pd", "admin", "md"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData  = await req.formData();
  const file      = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file || !projectId)
    return NextResponse.json({ error: "Missing file or projectId" }, { status: 400 });

  if (isPD(role)) {
    const proj = await prisma.project.findFirst({ where: { id: projectId, OR: [{ pdId: empDbId }, { managerId: empDbId }] } });
    if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectNumber: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // ไฟล์หลายโครงการ (bulk template) → ใช้ sheet ของโครงการนี้, ไม่งั้นใช้ sheet แรก
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = wb.SheetNames.map((n) => sheetRows(wb.Sheets[n]));
  const rows = sheets.find((r) => sheetProjectNumber(r) === project.projectNumber) ?? sheets[0];
  const { plans, error } = parsePlanRows(rows);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { savedCount, notFound } = await savePlans(projectId, plans, empDbId);
  const missing = notFound.length > 0 ? ` (ไม่พบ User ID: ${notFound.join(", ")})` : "";
  const msg = savedCount > 0 ? `นำเข้าสำเร็จ ${savedCount} รายการ${missing}` : `ไม่มีข้อมูลที่นำเข้าได้${missing}`;

  return NextResponse.json({ success: savedCount > 0, message: msg, savedCount, notFound });
}
