import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["pd", "admin", "md"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { manager: { select: { name: true } } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Get existing plans for pre-fill
  const existingPlans = await prisma.resourcePlanMonthly.findMany({ where: { projectId } });

  // Departments from active employees
  const empDepts = await prisma.employee.findMany({
    where: { isActive: true }, select: { department: true }, distinct: ["department"], orderBy: { department: "asc" },
  });
  const departments = empDepts.map((e) => e.department);

  // Build month range from project start/end (or ±6 months from now if not set)
  const now = new Date();
  const startDate = project.startDate || new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate   = project.endDate   || new Date(now.getFullYear() + 1, now.getMonth(), 1);

  const months: { year: number; month: number; label: string }[] = [];
  let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
  while (cur < end) {
    months.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1, label: `${MONTH_NAMES[cur.getUTCMonth()]} ${cur.getUTCFullYear()}` });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  // Build worksheet data
  const wb = XLSX.utils.book_new();
  const wsData: any[][] = [];

  // Title rows
  wsData.push([`Resource Plan — ${project.projectNumber} : ${project.projectName}`]);
  wsData.push([`Manager: ${project.manager?.name || "-"}   |   Period: ${months[0]?.label || "-"} to ${months[months.length - 1]?.label || "-"}`]);
  wsData.push([]);

  // Header row
  const headerRow = ["Department", ...months.map((m) => m.label), "Total"];
  wsData.push(headerRow);

  // Department rows
  for (const dept of departments) {
    const row: any[] = [dept];
    let total = 0;
    for (const m of months) {
      const existing = existingPlans.find(
        (p) => p.department === dept && p.year === m.year && p.month === m.month
      );
      const hrs = existing?.plannedHrs || 0;
      row.push(hrs);
      total += hrs;
    }
    row.push(total);
    wsData.push(row);
  }

  // Total row
  wsData.push([]);
  const totalRow: any[] = ["TOTAL"];
  let grandTotal = 0;
  for (let mi = 0; mi < months.length; mi++) {
    let colTotal = 0;
    for (const dept of departments) {
      const p = existingPlans.find((p) => p.department === dept && p.year === months[mi].year && p.month === months[mi].month);
      colTotal += p?.plannedHrs || 0;
    }
    totalRow.push(colTotal);
    grandTotal += colTotal;
  }
  totalRow.push(grandTotal);
  wsData.push(totalRow);

  // Instructions sheet
  wsData.push([]);
  wsData.push(["Instructions: Fill in planned hours per department per month. Upload back via the Resource Plan page."]);

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [{ wch: 28 }, ...months.map(() => ({ wch: 12 })), { wch: 10 }];

  XLSX.utils.book_append_sheet(wb, ws, "Resource Plan");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `ResourcePlan_${project.projectNumber}_${Date.now()}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
