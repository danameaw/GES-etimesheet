/**
 * Export รายชื่อพนักงานทั้งหมด (รวมที่ลาออก/inactive) เป็น Excel — read-only
 *   node scripts/export-employees.js
 * Output: employee_list_<YYYY-MM-DD>.xlsx (ถูก .gitignore ไว้แล้ว)
 */
require("dotenv").config();
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const iso = (x) => (x ? new Date(x).toISOString().slice(0, 10) : "");

(async () => {
  const [emps, units] = await Promise.all([
    prisma.employee.findMany({ orderBy: [{ department: "asc" }, { name: "asc" }] }),
    prisma.orgUnit.findMany(),
  ]);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const empById = new Map(emps.map((e) => [e.id, e]));
  const unitPath = (id) => {
    const parts = [];
    let u = id ? unitById.get(id) : null;
    while (u) { parts.unshift(u.name); u = u.parentId ? unitById.get(u.parentId) : null; }
    return parts.join(" > ");
  };
  const headOf = new Map(); // employee.id -> units they head
  for (const u of units) if (u.headId) {
    if (!headOf.has(u.headId)) headOf.set(u.headId, []);
    headOf.get(u.headId).push(u.name);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employees");
  ws.columns = [
    { header: "No.", key: "no", width: 6 },
    { header: "Employee ID", key: "employeeId", width: 13 },
    { header: "Name", key: "name", width: 32 },
    { header: "Department", key: "department", width: 28 },
    { header: "Sub-unit", key: "unit", width: 34 },
    { header: "Position", key: "position", width: 36 },
    { header: "Level", key: "level", width: 10 },
    { header: "System Role", key: "role", width: 16 },
    { header: "Managed Dept", key: "managedDept", width: 22 },
    { header: "Managed Unit", key: "managedUnit", width: 24 },
    { header: "Head of Unit", key: "headOf", width: 28 },
    { header: "Status", key: "status", width: 10 },
    { header: "Start Date", key: "startDate", width: 12 },
    { header: "End Date", key: "endDate", width: 12 },
    { header: "Created in System", key: "createdAt", width: 16 },
  ];
  emps.forEach((e, i) => {
    ws.addRow({
      no: i + 1,
      employeeId: e.employeeId,
      name: e.name,
      department: e.department,
      unit: unitPath(e.orgUnitId),
      position: e.position,
      level: e.level,
      role: e.role,
      managedDept: e.managedDept,
      managedUnit: e.managedUnitId ? unitPath(e.managedUnitId) : "",
      headOf: (headOf.get(e.id) || []).join(", "),
      status: e.isActive && !(e.endDate && new Date(e.endDate) < new Date()) ? "Active" : "Inactive",
      startDate: iso(e.startDate),
      endDate: iso(e.endDate),
      createdAt: iso(e.createdAt),
    });
  });
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "O1" };

  // สรุปตามแผนก
  const sum = wb.addWorksheet("Summary by Dept");
  sum.columns = [
    { header: "Department", key: "d", width: 30 },
    { header: "Active", key: "a", width: 10 },
    { header: "Inactive", key: "i", width: 10 },
    { header: "Total", key: "t", width: 10 },
    { header: "No Start Date", key: "ns", width: 14 },
    { header: "No Level", key: "nl", width: 10 },
  ];
  const byDept = new Map();
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const d = r.getCell("department").value || "(none)";
    const s = byDept.get(d) || { d, a: 0, i: 0, t: 0, ns: 0, nl: 0 };
    r.getCell("status").value === "Active" ? s.a++ : s.i++;
    s.t++;
    if (!r.getCell("startDate").value) s.ns++;
    if (!r.getCell("level").value) s.nl++;
    byDept.set(d, s);
  });
  [...byDept.values()].forEach((s) => sum.addRow(s));
  sum.getRow(1).font = { bold: true };

  const out = `employee_list_${iso(new Date())}.xlsx`;
  await wb.xlsx.writeFile(out);
  const active = emps.filter((e) => e.isActive).length;
  console.log(`Wrote ${out}: ${emps.length} employees (${active} isActive), ${byDept.size} departments`);
  console.log(`Missing startDate: ${emps.filter((e) => !e.startDate).length}, missing level: ${emps.filter((e) => !e.level).length}`);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
