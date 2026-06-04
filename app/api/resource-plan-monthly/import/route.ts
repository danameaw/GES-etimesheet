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

  // Parse multipart form
  const formData  = await req.formData();
  const file      = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file || !projectId)
    return NextResponse.json({ error: "Missing file or projectId" }, { status: 400 });

  // Verify PM owns the project (skip for admin)
  if (role === "pd") {
    const proj = await prisma.project.findFirst({ where: { id: projectId, managerId: empDbId } });
    if (!proj) return NextResponse.json({ error: "Not your project" }, { status: 403 });
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the header row (first row containing "Department" in first column)
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === "department") {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1)
    return NextResponse.json({ error: 'ไม่พบ header row "Department" ในไฟล์' }, { status: 400 });

  // Parse month columns from header row
  const headerRow = rows[headerRowIdx] as string[];
  const monthCols: { colIdx: number; year: number; month: number }[] = [];
  for (let ci = 1; ci < headerRow.length; ci++) {
    const parsed = parseMonthLabel(String(headerRow[ci]));
    if (parsed) monthCols.push({ colIdx: ci, ...parsed });
  }
  if (monthCols.length === 0)
    return NextResponse.json({ error: "ไม่พบคอลัมน์เดือนในไฟล์" }, { status: 400 });

  // Parse data rows
  let savedCount = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dept = String(row[0] || "").trim();
    if (!dept || dept.toUpperCase() === "TOTAL" || dept === "") continue;

    for (const { colIdx, year, month } of monthCols) {
      const raw = row[colIdx];
      const hrs = parseFloat(String(raw));
      if (isNaN(hrs) || hrs < 0) continue;

      await prisma.resourcePlanMonthly.upsert({
        where: { projectId_department_year_month: { projectId, department: dept, year, month } },
        update: { plannedHrs: hrs, createdBy: empDbId },
        create: { projectId, department: dept, year, month, plannedHrs: hrs, createdBy: empDbId },
      });
      savedCount++;
    }
  }

  return NextResponse.json({
    success: true,
    message: `นำเข้าข้อมูลสำเร็จ ${savedCount} รายการ (${monthCols.length} เดือน)`,
    savedCount,
  });
}
