import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  const tasks: { code: string; name: string; category: string }[] = [];

  for (const sheetName of wb.SheetNames) {
    // ข้าม sheet Categories
    if (sheetName.toLowerCase().includes("categor")) continue;

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length === 0) continue;

    // ตรวจว่าเป็น format ไหน
    // Format A (Template ใหม่): header row = ["Code", "Task Name", "Category"]
    // Format B (task.xlsx เดิม): col[0]=blank, col[1]=code/category, col[2]=name
    const headerRow = rows[0].map((c: any) => String(c ?? "").trim().toLowerCase());
    const isTemplateFormat = headerRow[0] === "code" && headerRow[2] === "category";

    if (isTemplateFormat) {
      // ── Format A: Code | Task Name | Category ──
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const codeRaw     = String(row[0] ?? "").trim();
        const nameRaw     = String(row[1] ?? "").trim();
        const categoryRaw = String(row[2] ?? "").trim();

        if (!codeRaw || !nameRaw || !categoryRaw) continue;

        // Zero-pad code 4 ตัว
        const isNumeric = /^\d+$/.test(codeRaw);
        const paddedCode = isNumeric ? codeRaw.padStart(4, "0") : codeRaw.toUpperCase();

        tasks.push({ code: paddedCode, name: nameRaw, category: categoryRaw });
      }
    } else {
      // ── Format B: task.xlsx เดิม [blank, code/header, name] ──
      let currentCategory = "";
      for (const row of rows) {
        const rawCode = row[1];
        const rawName = row[2];
        if (!rawCode && !rawName) continue;

        const codeStr = String(rawCode ?? "").trim();
        const nameStr = String(rawName ?? "").trim();
        if (!codeStr) continue;

        const isNumeric = /^\d+$/.test(codeStr);
        if (!isNumeric) {
          currentCategory = nameStr || codeStr;
          continue;
        }
        if (!nameStr || !currentCategory) continue;
        tasks.push({ code: codeStr.padStart(4, "0"), name: nameStr, category: currentCategory });
      }
    }
  }

  if (tasks.length === 0)
    return NextResponse.json({ error: "ไม่พบ task codes ในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลครบ (Code, Task Name, Category)" }, { status: 400 });

  let upserted = 0;
  for (const t of tasks) {
    await prisma.taskCode.upsert({
      where: { code: t.code },
      update: { name: t.name, category: t.category, isActive: true },
      create: { code: t.code, name: t.name, category: t.category },
    });
    upserted++;
  }

  return NextResponse.json({ success: true, upserted });
}
