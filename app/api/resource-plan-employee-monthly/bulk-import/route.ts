import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";
import { parsePlanRows, savePlans, sheetProjectNumber, sheetRows } from "@/lib/plan-template";

type SheetResult = { sheet: string; projectNumber: string | null; status: "saved" | "skipped" | "error"; message: string };

/**
 * Import ไฟล์ template หลายโครงการ (1 sheet ต่อโครงการ) — แผนเข้าระบบเป็น draft
 * จากนั้น PD ตรวจและ Submit ในระบบ → Head of Dept อนุมัติ
 * โครงการที่แผนไม่ใช่ draft (ส่ง/อนุมัติแล้ว) จะถูกข้าม ไม่ทับ
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "md"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const empDbId = (session.user as any).id;

  const file = (await req.formData()).get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });

  const results: SheetResult[] = [];
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name]);
    const projectNumber = sheetProjectNumber(rows);
    if (!projectNumber) continue; // README / sheet อื่นที่ไม่ใช่โครงการ

    const project = await prisma.project.findUnique({ where: { projectNumber }, select: { id: true, planStatus: true } });
    if (!project) { results.push({ sheet: name, projectNumber, status: "error", message: "ไม่พบโครงการนี้ในระบบ" }); continue; }
    if (project.planStatus !== "draft") {
      results.push({ sheet: name, projectNumber, status: "skipped", message: `แผนสถานะ "${project.planStatus}" — ไม่ทับ` });
      continue;
    }

    const { plans, error } = parsePlanRows(rows);
    if (error) { results.push({ sheet: name, projectNumber, status: "error", message: error }); continue; }

    const { savedCount, notFound } = await savePlans(project.id, plans, empDbId);
    const people = new Set(plans.map((p) => p.userId)).size - notFound.length;
    results.push({
      sheet: name, projectNumber, status: "saved",
      message: `${people} คน, ${savedCount} รายการ${notFound.length ? ` · ไม่พบ User ID: ${notFound.join(", ")}` : ""}`,
    });
  }

  if (results.length === 0)
    return NextResponse.json({ error: 'ไม่พบ sheet โครงการในไฟล์ (ต้องมีแถว "Project No.") กรุณาใช้ Template จากระบบ' }, { status: 400 });

  const saved = results.filter((r) => r.status === "saved").length;
  return NextResponse.json({
    success: saved > 0,
    message: `นำเข้าแล้ว ${saved}/${results.length} โครงการ (เป็น draft — PD ต้องตรวจและกด Submit ในระบบ)`,
    results,
  });
}
