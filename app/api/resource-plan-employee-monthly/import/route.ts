import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4,  May: 5,  Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseMonthLabel(label: string): { year: number; month: number } | null {
  if (!label || typeof label !== "string") return null;
  const parts = label.trim().split(" ");
  if (parts.length !== 2) return null;
  const month = MONTH_MAP[parts[0]];
  const year  = parseInt(parts[1]);
  if (!month || isNaN(year)) return null;
  return { year, month };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role    = (session.user as any).role;
  const empDbId = (session.user as any).id;

  if (!["pd", "admin", "md"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData  = await req.formData();
  const file      = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file || !projectId)
    return NextResponse.json({ error: "Missing file or projectId" }, { status: 400 });

  if (role === "pd") {
    const proj = await prisma.project.findFirst({ where: { id: projectId, OR: [{ pdId: empDbId }, { managerId: empDbId }] } });
    if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find header row: first row with "User ID" in column 0
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][0] || "").trim().toLowerCase();
    if (cell === "user id") { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1)
    return NextResponse.json({ error: 'ไม่พบ header row "User ID" ในไฟล์ กรุณาใช้ Template ที่ดาวน์โหลดจากระบบ' }, { status: 400 });

  const headerRow = rows[headerRowIdx] as string[];

  // Parse month columns (skip col 0 = User ID, col 1 = Name, col 2 = Dept)
  const monthCols: { colIdx: number; year: number; month: number }[] = [];
  for (let ci = 3; ci < headerRow.length; ci++) {
    const parsed = parseMonthLabel(String(headerRow[ci]));
    if (parsed) monthCols.push({ colIdx: ci, ...parsed });
  }
  if (monthCols.length === 0)
    return NextResponse.json({ error: "ไม่พบคอลัมน์เดือนในไฟล์" }, { status: 400 });

  // Build employee lookup map (employeeId → db id)
  const allEmployees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, employeeId: true },
  });
  const empLookup = new Map(allEmployees.map((e) => [e.employeeId.toUpperCase(), e.id]));

  // Standard hours per month used for MM multiplier conversion (1 MM = STD_HOURS_PER_MONTH hrs)
  // To revert to dynamic calculation (count actual working days minus holidays × 8 hr), replace this
  // constant with the block below and uncomment it:
  //
  // const stdHoursMap = new Map<string, number>();
  // for (const { year, month } of monthCols) {
  //   const key = `${year}|${month}`;
  //   if (stdHoursMap.has(key)) continue;
  //   const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  //   const mStart = new Date(Date.UTC(year, month - 1, 1));
  //   const mEnd   = new Date(Date.UTC(year, month, 1));
  //   const holidays = await prisma.holiday.findMany({ where: { date: { gte: mStart, lt: mEnd } }, select: { date: true } });
  //   const holidayDays = new Set(holidays.map((h) => new Date(h.date).getUTCDate()));
  //   let hrs = 0;
  //   for (let d = 1; d <= daysInMonth; d++) {
  //     const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
  //     if (dow >= 1 && dow <= 5 && !holidayDays.has(d)) hrs += 8;
  //   }
  //   stdHoursMap.set(key, hrs);
  // }
  // Then change resolveHrs to: return Math.round(v * (stdHoursMap.get(`${year}|${month}`) ?? 0));
  const STD_HOURS_PER_MONTH = 176;

  /** ถ้ากรอก 0 < v ≤ 1.5 → MM multiplier → แปลงเป็นชั่วโมงมาตรฐาน */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function resolveHrs(v: number, _year: number, _month: number): number {
    if (v > 0 && v <= 1.5) return Math.round(v * STD_HOURS_PER_MONTH);
    return v;
  }

  let savedCount = 0;
  const notFound: string[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawId = String(row[0] || "").trim();
    if (!rawId || rawId.toUpperCase() === "TOTAL" || rawId === "") continue;

    const dbEmpId = empLookup.get(rawId.toUpperCase());
    if (!dbEmpId) {
      notFound.push(rawId);
      continue;
    }

    for (const { colIdx, year, month } of monthCols) {
      const raw = row[colIdx];
      const parsed = parseFloat(String(raw));
      if (isNaN(parsed) || parsed < 0) continue;
      const hrs = resolveHrs(parsed, year, month);

      await prisma.resourcePlanEmployeeMonthly.upsert({
        where: { projectId_employeeId_year_month: { projectId, employeeId: dbEmpId, year, month } },
        update: { plannedHrs: hrs, createdBy: empDbId },
        create: { projectId, employeeId: dbEmpId, year, month, plannedHrs: hrs, createdBy: empDbId },
      });
      savedCount++;
    }
  }

  const msg = savedCount > 0
    ? `นำเข้าสำเร็จ ${savedCount} รายการ${notFound.length > 0 ? ` (ไม่พบ User ID: ${notFound.join(", ")})` : ""}`
    : `ไม่มีข้อมูลที่นำเข้าได้${notFound.length > 0 ? ` (ไม่พบ User ID: ${notFound.join(", ")})` : ""}`;

  return NextResponse.json({ success: savedCount > 0, message: msg, savedCount, notFound });
}
