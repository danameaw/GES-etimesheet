import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";
import { PROJECT_HEADERS, PROJECT_TYPES } from "@/lib/project-template";

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "1E3A5F" } },
  alignment: { horizontal: "center" as const },
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  // รายชื่อพนักงานที่เลือกเป็น PD/PM ได้ (อ้างอิงใน sheet คู่มือ)
  const refEmployees = await prisma.employee.findMany({
    where: { isActive: true, role: { in: ["pd", "admin", "md"] } },
    select: { employeeId: true, name: true, role: true, department: true },
    orderBy: { employeeId: "asc" },
  });

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Template กรอกข้อมูล ──
  const dataRows: any[][] = [
    PROJECT_HEADERS,
    ["GES-2026-001", "ตัวอย่างชื่อโครงการ (ลบแถวนี้ก่อนนำเข้า)", "project", "", "", "2026-01-01", "2026-12-31", "Yes"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  ws["!cols"] = [
    { wch: 18 }, { wch: 45 }, { wch: 12 }, { wch: 18 },
    { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 14 },
  ];
  // Header style
  ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1"].forEach((cell) => {
    if (ws[cell]) ws[cell].s = HEADER_STYLE;
  });
  // Dropdown: Type (C) และ Active (H)
  ws["!dataValidations"] = [
    {
      type: "list",
      sqref: "C2:C1000",
      formula1: `"${PROJECT_TYPES.join(",")}"`,
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: "Type ไม่ถูกต้อง",
      error: `กรุณาเลือกจาก: ${PROJECT_TYPES.join(", ")}`,
    },
    {
      type: "list",
      sqref: "H2:H1000",
      formula1: `"Yes,No"`,
      showDropDown: false,
    },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Projects");

  // ── Sheet 2: คู่มือ / รายชื่อ PD-PM ──
  const guideRows: any[][] = [
    ["วิธีใช้ Template โครงการ"],
    [""],
    ["1. กรอกข้อมูลในชีต \"Projects\" หนึ่งโครงการต่อหนึ่งแถว"],
    ["2. Project Number และ Project Name จำเป็นต้องกรอก"],
    ["3. Type เลือกได้: project / support / admin (ค่าว่าง = project)"],
    ["4. PD/PM ให้ใส่รหัสพนักงาน (Employee ID) จากรายการด้านล่าง (เว้นว่างได้)"],
    ["5. วันที่ใช้รูปแบบ YYYY-MM-DD (เว้นว่างได้)"],
    ["6. Active: Yes = ใช้งาน, No = ปิดใช้งาน (ค่าว่าง = Yes)"],
    ["7. การนำเข้าจะอัปเดตโครงการเดิมที่มี Project Number ตรงกัน และสร้างใหม่หากยังไม่มี"],
    [""],
    ["รายชื่อพนักงานที่ใช้เป็น PD/PM ได้"],
    ["Employee ID", "ชื่อ", "แผนก", "Role"],
    ...refEmployees.map((e) => [e.employeeId, e.name, e.department, e.role]),
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 16 }, { wch: 35 }, { wch: 24 }, { wch: 12 }];
  if (wsGuide["A1"]) wsGuide["A1"].s = { font: { bold: true, sz: 14 } };
  if (wsGuide["A11"]) wsGuide["A11"].s = { font: { bold: true } };
  ["A12", "B12", "C12", "D12"].forEach((cell) => {
    if (wsGuide[cell]) wsGuide[cell].s = HEADER_STYLE;
  });
  XLSX.utils.book_append_sheet(wb, wsGuide, "Guide");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Project_Template.xlsx"`,
    },
  });
}
