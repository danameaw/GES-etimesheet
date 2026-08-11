/**
 * ตรวจว่าวันหยุดแต่ละวัน มีใครยังไม่ได้ลง task code 1001 Holidays บ้าง
 *   node scripts/audit-holiday-missing.js
 */
require("dotenv").config();
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const HOLIDAY_CODE = "1001";
const DAY_KEYS = ["sunHrs", "monHrs", "tueHrs", "wedHrs", "thuHrs", "friHrs", "satHrs"];
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (x) => new Date(x).toISOString().slice(0, 10);
const TODAY = process.env.AUDIT_TODAY || "2026-08-11";

// weekStart (จันทร์) ของวันที่ที่กำหนด — คำนวณแบบ UTC
function weekStartOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  const dow = d.getUTCDay();               // 0=Sun
  const back = dow === 0 ? 6 : dow - 1;    // ย้อนกลับไปวันจันทร์
  d.setUTCDate(d.getUTCDate() - back);
  return iso(d);
}

(async () => {
  const holidays = (await prisma.holiday.findMany({ orderBy: { date: "asc" } }))
    .map((h) => ({ ...h, dateStr: iso(h.date), dow: new Date(h.date).getUTCDay() }))
    .filter((h) => h.dateStr < TODAY);   // เฉพาะวันหยุดที่ผ่านมาแล้ว

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, employeeId: true, name: true, department: true },
    orderBy: { employeeId: "asc" },
  });

  const timesheets = await prisma.timesheet.findMany({
    include: { entries: { include: { taskCode: { select: { code: true, name: true } },
                                     project: { select: { projectNumber: true } } } } },
  });
  // key: employeeDbId|weekStart
  const tsBy = new Map();
  for (const t of timesheets) tsBy.set(`${t.employeeId}|${iso(t.weekStart)}`, t);

  // พนักงานที่ไม่เคยกรอก timesheet เลยสักสัปดาห์ — แยกออกจากรายชื่อที่ต้องไล่แจ้ง
  const everUsed = new Set(timesheets.map((t) => t.employeeId));
  const activeUsers = employees.filter((e) => everUsed.has(e.id));
  console.log(`พนักงาน active ${employees.length} คน — เคยกรอก timesheet ${activeUsers.length} คน, ไม่เคยกรอกเลย ${employees.length - activeUsers.length} คน`);
  console.log(`(รายงานนี้นับเฉพาะ ${activeUsers.length} คนที่เคยใช้ระบบ)\n`);

  const findings = [];   // แถวสำหรับ Excel
  console.log(`วันหยุดที่ผ่านมาแล้ว (ก่อน ${TODAY}): ${holidays.length} วัน\n`);

  for (const h of holidays) {
    const ws = weekStartOf(h.dateStr);
    const dayKey = DAY_KEYS[h.dow];
    const missing = { noTimesheet: [], otherLeave: [], workedThatDay: [], loggedNothing: [], wrongDay: [] };

    for (const emp of activeUsers) {
      const ts = tsBy.get(`${emp.id}|${ws}`);
      if (!ts) { missing.noTimesheet.push({ emp }); continue; }

      const holEntries = ts.entries.filter((e) => e.taskCode.code === HOLIDAY_CODE);
      const onDay = holEntries.reduce((s, e) => s + (e[dayKey] || 0), 0);
      if (onDay > 0) continue;   // ลงถูกต้องแล้ว

      const elsewhere = holEntries.reduce((s, e) => s + DAY_KEYS.reduce((a, k) => a + (e[k] || 0), 0), 0);
      // วันนั้นลงอะไรไว้แทน
      const loggedThatDay = ts.entries
        .filter((e) => (e[dayKey] || 0) > 0)
        .map((e) => `${e.project.projectNumber}/${e.taskCode.code} ${e.taskCode.name} ${e[dayKey]}h`);

      const otherLeaveCodes = ["1002", "1003", "1004", "1005"];
      const otherLeave = ts.entries
        .filter((e) => otherLeaveCodes.includes(e.taskCode.code) && (e[dayKey] || 0) > 0)
        .map((e) => `${e.taskCode.code} ${e.taskCode.name} ${e[dayKey]}h`);

      const rec = { emp, ts, elsewhere, loggedThatDay, otherLeave };
      if (elsewhere > 0) missing.wrongDay.push(rec);
      else if (otherLeave.length > 0) missing.otherLeave.push(rec);
      else if (loggedThatDay.length > 0) missing.workedThatDay.push(rec);
      else missing.loggedNothing.push(rec);
    }

    const total = missing.noTimesheet.length + missing.otherLeave.length
      + missing.workedThatDay.length + missing.loggedNothing.length + missing.wrongDay.length;
    console.log(`### ${h.dateStr} (${DOW_EN[h.dow]}) ${h.name}  — week ${ws}`);
    console.log(`    ลงถูกต้องแล้ว ${activeUsers.length - total} / ${activeUsers.length} คน`);
    console.log(`    ลงลาประเภทอื่นแทน 1001:        ${missing.otherLeave.length}`);
    console.log(`    ลงงานโครงการในวันหยุด:          ${missing.workedThatDay.length}`);
    console.log(`    ไม่ได้ลงอะไรเลยในวันนั้น:        ${missing.loggedNothing.length}`);
    console.log(`    ลง 1001 ในสัปดาห์นั้นแต่คนละวัน: ${missing.wrongDay.length}`);
    console.log(`    ไม่มี timesheet ทั้งสัปดาห์:      ${missing.noTimesheet.length}`);

    const dump = (label, list, fmt) => {
      if (!list.length) return;
      console.log(`    --- ${label} ---`);
      for (const r of list) console.log(`      ${r.emp.employeeId} ${r.emp.name.padEnd(16)} ${r.ts.status.padEnd(9)} ${fmt(r)}`);
    };
    dump("ลงลาประเภทอื่นแทน", missing.otherLeave, (r) => r.otherLeave.join(" | "));
    dump("ลงงานโครงการในวันหยุด", missing.workedThatDay, (r) => r.loggedThatDay.join(" | "));
    dump("ลง 1001 ผิดวัน", missing.wrongDay, (r) => `ลง 1001 รวม ${r.elsewhere}h แต่ไม่ได้อยู่วัน ${DOW_EN[h.dow]}`);
    dump("ไม่ได้ลงอะไรเลย", missing.loggedNothing, () => "(วันนั้นว่าง)");
    console.log("");

    for (const [type, list] of [
      ["ลงลาประเภทอื่นแทน 1001", missing.otherLeave],
      ["ลงงานโครงการในวันหยุด", missing.workedThatDay],
      ["ลง 1001 ผิดวัน", missing.wrongDay],
      ["ไม่ได้ลงอะไรเลยในวันนั้น", missing.loggedNothing],
      ["ไม่มี timesheet ทั้งสัปดาห์", missing.noTimesheet],
    ]) {
      for (const r of list) {
        findings.push({
          date: h.dateStr, dow: DOW_EN[h.dow], hol: h.name, week: ws, type,
          eid: r.emp.employeeId, name: r.emp.name, dept: r.emp.department,
          status: r.ts ? r.ts.status : "-",
          logged: r.loggedThatDay ? r.loggedThatDay.join(" | ") : "",
          note: r.elsewhere ? `ลง 1001 ในสัปดาห์นี้รวม ${r.elsewhere}h แต่คนละวัน` : "",
        });
      }
    }
  }

  // ---- Excel ----
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet("ยังไม่ได้ลงวันหยุด");
  ws1.columns = [
    { header: "วันหยุด", key: "date", width: 12 },
    { header: "วัน", key: "dow", width: 6 },
    { header: "ชื่อวันหยุด", key: "hol", width: 34 },
    { header: "Week Start", key: "week", width: 12 },
    { header: "ประเภทปัญหา", key: "type", width: 26 },
    { header: "Employee ID", key: "eid", width: 12 },
    { header: "ชื่อ", key: "name", width: 24 },
    { header: "แผนก", key: "dept", width: 22 },
    { header: "สถานะ Timesheet", key: "status", width: 14 },
    { header: "วันนั้นลงอะไรไว้", key: "logged", width: 50 },
    { header: "หมายเหตุ", key: "note", width: 40 },
  ];
  ws1.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws1.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } };
  ws1.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of findings) ws1.addRow(f);
  ws1.autoFilter = { from: "A1", to: { row: 1, column: ws1.columns.length } };

  const out = "Holiday-missing-report.xlsx";
  await wb.xlsx.writeFile(out);
  console.log(`Excel written: ${out} (${findings.length} rows)`);

  await prisma.$disconnect();
})();
