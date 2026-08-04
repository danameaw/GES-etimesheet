import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";
import { PROJECT_TYPES } from "@/lib/project-template";

// แปลงค่า cell ให้เป็นวันที่รูปแบบ YYYY-MM-DD (รองรับ Date object / serial number / string)
function toDateStr(val: any): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "number") {
    // Excel serial date → JS Date
    const parsed = XLSX.SSF?.parse_date_code?.(val);
    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  // ISO อยู่แล้ว
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseActive(val: any): boolean {
  const s = String(val ?? "").trim().toLowerCase();
  if (!s) return true; // ค่าว่าง = ใช้งาน
  return !["no", "false", "0", "inactive", "ปิด", "ไม่", "n"].includes(s);
}

function normType(val: any): string {
  const s = String(val ?? "").trim().toLowerCase();
  if (!s) return "project";
  return PROJECT_TYPES.includes(s) ? s : "project";
}

// หา index ของคอลัมน์จาก header (ยืดหยุ่นตามคำสำคัญ)
function findCol(header: string[], ...keys: string[]): number {
  return header.findIndex((h) => {
    const hl = h.toLowerCase();
    return keys.some((k) => hl.includes(k));
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });

  // ใช้ชีต "Projects" ถ้ามี ไม่งั้นใช้ชีตแรกที่ไม่ใช่คู่มือ
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "projects") ||
    wb.SheetNames.find((n) => !n.toLowerCase().includes("guide") && !n.toLowerCase().includes("คู่มือ")) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return NextResponse.json({ error: "ไม่พบชีตข้อมูล" }, { status: 400 });

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rows.length < 2)
    return NextResponse.json({ error: "ไฟล์ไม่มีข้อมูล" }, { status: 400 });

  const header = rows[0].map((c: any) => String(c ?? "").trim());
  const cNum = findCol(header, "number", "เลขที่");
  const cName = findCol(header, "project name", "ชื่อ");
  const cType = findCol(header, "type", "ประเภท");
  const cPd = findCol(header, "pd");
  const cPm = findCol(header, "pm", "manager");
  const cStart = findCol(header, "start", "เริ่ม");
  const cEnd = findCol(header, "end", "สิ้นสุด");
  const cActive = findCol(header, "active", "สถานะ");

  if (cNum < 0 || cName < 0)
    return NextResponse.json(
      { error: "ไม่พบคอลัมน์ Project Number หรือ Project Name — กรุณาใช้ Template ที่ถูกต้อง" },
      { status: 400 }
    );

  // Map พนักงานสำหรับ resolve PD/PM ด้วย employeeId
  const employees = await prisma.employee.findMany({ select: { id: true, employeeId: true } });
  const empByCode = new Map<string, string>();
  for (const e of employees) empByCode.set(e.employeeId.trim().toUpperCase(), e.id);
  const resolveEmp = (code: string) => empByCode.get(code.trim().toUpperCase()) ?? null;

  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const projectNumber = String(row[cNum] ?? "").trim().toUpperCase();
    const projectName = String(row[cName] ?? "").trim();

    if (!projectNumber && !projectName) continue; // แถวว่าง
    // ข้ามแถวตัวอย่างจาก template
    if (projectName.includes("ลบแถวนี้ก่อนนำเข้า")) continue;
    if (!projectNumber || !projectName) {
      skipped++;
      warnings.push(`แถวที่ ${i + 1}: ข้าม (ต้องมีทั้ง Project Number และ Project Name)`);
      continue;
    }

    const projectType = cType >= 0 ? normType(row[cType]) : "project";
    const startStr = cStart >= 0 ? toDateStr(row[cStart]) : null;
    const endStr = cEnd >= 0 ? toDateStr(row[cEnd]) : null;
    const isActive = cActive >= 0 ? parseActive(row[cActive]) : true;

    let pdId: string | null = null;
    let managerId: string | null = null;
    if (cPd >= 0) {
      const code = String(row[cPd] ?? "").trim();
      if (code) {
        pdId = resolveEmp(code);
        if (!pdId) warnings.push(`แถวที่ ${i + 1}: ไม่พบพนักงาน PD รหัส "${code}" (ข้ามการตั้งค่า PD)`);
      }
    }
    if (cPm >= 0) {
      const code = String(row[cPm] ?? "").trim();
      if (code) {
        managerId = resolveEmp(code);
        if (!managerId) warnings.push(`แถวที่ ${i + 1}: ไม่พบพนักงาน PM รหัส "${code}" (ข้ามการตั้งค่า PM)`);
      }
    }

    const startDate = startStr ? new Date(startStr + "T00:00:00.000Z") : null;
    const endDate = endStr ? new Date(endStr + "T00:00:00.000Z") : null;

    const existing = await prisma.project.findUnique({ where: { projectNumber } });
    if (existing) {
      await prisma.project.update({
        where: { projectNumber },
        data: { projectName, projectType, pdId, managerId, startDate, endDate, isActive },
      });
      updated++;
    } else {
      await prisma.project.create({
        data: { projectNumber, projectName, projectType, pdId, managerId, startDate, endDate, isActive },
      });
      created++;
    }
  }

  if (created === 0 && updated === 0)
    return NextResponse.json(
      { error: "ไม่พบข้อมูลโครงการที่นำเข้าได้ กรุณาตรวจสอบไฟล์", warnings },
      { status: 400 }
    );

  return NextResponse.json({ success: true, created, updated, skipped, warnings });
}
