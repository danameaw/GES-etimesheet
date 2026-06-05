import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

const CATEGORIES = [
  "Project Management & Administration",
  "Civil Engineering",
  "Mechanical Engineering",
  "Control/Electrical Engineering",
  "Project Controls",
  "Procurement",
  "Construction",
  "Holiday",
  "Training",
  "Meetings",
  "Traveling",
  "Business Development",
  "Lessons Learned & Process Improvement",
  "Department/Corporate Work",
  "Unassigned",
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Template กรอกข้อมูล ──
  const dataRows: any[][] = [
    ["Code", "Task Name", "Category"],
    ["", "", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(dataRows);

  // Column widths
  ws["!cols"] = [{ wch: 10 }, { wch: 55 }, { wch: 40 }];

  // Header style
  ["A1", "B1", "C1"].forEach((cell) => {
    if (!ws[cell]) return;
    ws[cell].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1E3A5F" } },
      alignment: { horizontal: "center" },
    };
  });

  // Data validation (dropdown) สำหรับคอลัมน์ Category (C)
  ws["!dataValidations"] = [
    {
      type: "list",
      sqref: "C2:C500",
      formula1: `"${CATEGORIES.join(",")}"`,
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: "Category ไม่ถูกต้อง",
      error: "กรุณาเลือก Category จากรายการ",
    },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Task Codes");

  // ── Sheet 2: รายชื่อ Category ──
  const catRows: any[][] = [["Category (หมวดหมู่)"]];
  CATEGORIES.forEach((c) => catRows.push([c]));
  const wsCat = XLSX.utils.aoa_to_sheet(catRows);
  wsCat["!cols"] = [{ wch: 45 }];
  if (wsCat["A1"]) {
    wsCat["A1"].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1E3A5F" } },
    };
  }
  XLSX.utils.book_append_sheet(wb, wsCat, "Categories");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="TaskCode_Template.xlsx"`,
    },
  });
}
