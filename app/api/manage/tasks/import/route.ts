import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

/**
 * POST /api/manage/tasks/import
 * รับไฟล์ Excel (task.xlsx) แล้ว upsert task codes เข้า DB
 *
 * รูปแบบ Excel ที่รองรับ:
 *   Sheet "Project Task List" และ/หรือ "OH Task List"
 *   คอลัมน์: [ignore, Task Number, Task Name]
 *   - แถวที่ Task Number มีตัวอักษร (เช่น "001x", "Holiday") → เป็น category header
 *   - แถวที่ Task Number เป็นตัวเลขล้วน → เป็น task item
 */
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
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let currentCategory = "";

    for (const row of rows) {
      const rawCode = row[1];
      const rawName = row[2];

      if (!rawCode && !rawName) continue;

      const codeStr = String(rawCode ?? "").trim();
      const nameStr = String(rawName ?? "").trim();

      if (!codeStr) continue;

      // ตัดแถว header ที่ไม่มีชื่อ (เช่น "HO Support Tasks" ที่ col 1)
      // ถ้า codeStr มีตัวอักษร (เช่น "001x", "01xx", "Holiday", "Training") → category
      const isNumeric = /^\d+$/.test(codeStr);

      if (!isNumeric) {
        // เป็น category header — ใช้ชื่อ task (col 2) ถ้ามี ไม่งั้นใช้ codeStr
        const catName = nameStr || codeStr;
        // ข้าม header หลักอย่าง "HO Support Tasks" ที่ไม่มี col 2
        if (!nameStr && !/\d/.test(codeStr)) {
          currentCategory = codeStr; // เช่น "Holiday", "Training"
        } else {
          currentCategory = catName; // เช่น "Project Management&Administration"
        }
        continue;
      }

      // เป็น task item
      if (!nameStr || !currentCategory) continue;

      // Zero-pad code ให้ยาว 4 ตัว (เช่น 1001 → "1001", 11 → "0011")
      const paddedCode = codeStr.padStart(4, "0");

      tasks.push({ code: paddedCode, name: nameStr, category: currentCategory });
    }
  }

  if (tasks.length === 0)
    return NextResponse.json({ error: "ไม่พบ task codes ในไฟล์" }, { status: 400 });

  // Upsert ทั้งหมด
  let upserted = 0;
  for (const t of tasks) {
    await prisma.taskCode.upsert({
      where: { code: t.code },
      update: { name: t.name, category: t.category, isActive: true },
      create: { code: t.code, name: t.name, category: t.category },
    });
    upserted++;
  }

  return NextResponse.json({ success: true, upserted, tasks });
}
