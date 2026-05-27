import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthsBetween(start: Date, end: Date) {
  const result: { year: number; month: number; label: string }[] = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  while (cur < endUTC) {
    result.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1, label: `${MONTH_NAMES[cur.getUTCMonth()]} ${cur.getUTCFullYear()}` });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return result;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["pm", "admin"].includes((session.user as any).role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { manager: { select: { name: true } } },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const now = new Date();
  const startDate = project.startDate || new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate   = project.endDate   || new Date(now.getFullYear() + 1, now.getMonth(), 1);
  const months = monthsBetween(startDate, endDate);

  // Get existing employee plans + employee details
  const existingPlans = await prisma.resourcePlanEmployeeMonthly.findMany({
    where: { projectId },
    include: { employee: { select: { employeeId: true, name: true, department: true } } },
  });

  // Distinct assigned employees (ordered by dept then name)
  const empMap = new Map<string, { employeeId: string; name: string; department: string }>();
  for (const p of existingPlans) {
    if (!empMap.has(p.employeeId)) empMap.set(p.employeeId, p.employee);
  }
  const assignedEmps = Array.from(empMap.values()).sort((a, b) =>
    a.department.localeCompare(b.department) || a.name.localeCompare(b.name)
  );

  // Build workbook
  const wb = XLSX.utils.book_new();
  const wsData: any[][] = [];

  // Title
  wsData.push([`Resource Plan — ${project.projectNumber} : ${project.projectName}`]);
  wsData.push([`Manager: ${project.manager?.name || "-"}   |   Period: ${months[0]?.label || "-"} → ${months[months.length - 1]?.label || "-"}`]);
  wsData.push([`คำแนะนำ: กรอก User ID ในคอลัมน์แรก ระบบจะ link ชื่อให้อัตโนมัติเมื่อ Import`]);
  wsData.push([]);

  // Header
  wsData.push(["User ID", "ชื่อ-นามสกุล", "แผนก", ...months.map((m) => m.label), "Total"]);

  // Data rows — pre-fill assigned employees
  for (const emp of assignedEmps) {
    const row: any[] = [emp.employeeId, emp.name, emp.department];
    let total = 0;
    for (const m of months) {
      const plan = existingPlans.find(
        (p) => p.employee.employeeId === emp.employeeId && p.year === m.year && p.month === m.month
      );
      const hrs = plan?.plannedHrs || 0;
      row.push(hrs);
      total += hrs;
    }
    row.push(total);
    wsData.push(row);
  }

  // Empty rows for adding new employees
  for (let i = 0; i < 5; i++) {
    wsData.push(["", "", "", ...months.map(() => 0), 0]);
  }

  // Total row
  wsData.push([]);
  const totalRow: any[] = ["", "TOTAL", ""];
  for (const m of months) {
    const colTotal = existingPlans
      .filter((p) => p.year === m.year && p.month === m.month)
      .reduce((s, p) => s + p.plannedHrs, 0);
    totalRow.push(colTotal);
  }
  totalRow.push(totalRow.slice(3, -1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
  wsData.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{ wch: 12 }, { wch: 24 }, { wch: 22 }, ...months.map(() => ({ wch: 11 })), { wch: 8 }];
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
