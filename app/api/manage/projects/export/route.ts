import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";
import { PROJECT_HEADERS } from "@/lib/project-template";

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "1E3A5F" } },
  alignment: { horizontal: "center" as const },
};

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("all") === "1";

  const projects = await prisma.project.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: {
      manager: { select: { employeeId: true } },
      pd: { select: { employeeId: true } },
    },
    orderBy: { projectNumber: "asc" },
  });

  const dataRows: any[][] = [
    PROJECT_HEADERS,
    ...projects.map((p) => [
      p.projectNumber,
      p.projectName,
      p.projectType,
      p.pd?.employeeId || "",
      p.manager?.employeeId || "",
      fmtDate(p.startDate),
      fmtDate(p.endDate),
      p.isActive ? "Yes" : "No",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  ws["!cols"] = [
    { wch: 18 }, { wch: 45 }, { wch: 12 }, { wch: 18 },
    { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 14 },
  ];
  ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1"].forEach((cell) => {
    if (ws[cell]) ws[cell].s = HEADER_STYLE;
  });
  XLSX.utils.book_append_sheet(wb, ws, "Projects");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Projects_${stamp}.xlsx"`,
    },
  });
}
