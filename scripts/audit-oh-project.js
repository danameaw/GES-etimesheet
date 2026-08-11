// Read-only audit: OH task codes logged against a non-Overhead project
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();

const OH_CATEGORIES = new Set([
  "Holiday", "Training", "Meetings", "Traveling", "Business Development",
  "Lessons Learned & Process Improvement", "Department/Corporate Work", "Unassigned",
]);

const d = (x) => new Date(x).toISOString().slice(0, 10);

(async () => {
  const ohProject = await prisma.project.findFirst({ where: { projectType: "overhead" } });
  console.log(`OH project = ${ohProject.projectNumber} (${ohProject.projectName}) id=${ohProject.id}\n`);

  const entries = await prisma.timesheetEntry.findMany({
    include: {
      project: { select: { projectNumber: true, projectName: true, projectType: true } },
      taskCode: { select: { code: true, name: true, category: true } },
      timesheet: {
        select: {
          weekStart: true, weekEnd: true, status: true, submittedAt: true,
          employee: { select: { employeeId: true, name: true, department: true, position: true, isActive: true } },
        },
      },
    },
  });

  const wrong = entries
    .filter((e) => OH_CATEGORIES.has(e.taskCode.category) && e.projectId !== ohProject.id)
    .sort((a, b) =>
      a.timesheet.employee.employeeId.localeCompare(b.timesheet.employee.employeeId) ||
      +new Date(a.timesheet.weekStart) - +new Date(b.timesheet.weekStart));

  // reverse case (FYI only): non-OH task logged against the Overhead project
  const reverse = entries.filter((e) => !OH_CATEGORIES.has(e.taskCode.category) && e.projectId === ohProject.id);

  const hrs = (e) => e.totalHrs || (e.monHrs + e.tueHrs + e.wedHrs + e.thuHrs + e.friHrs + e.satHrs + e.sunHrs);

  console.log(`TOTAL entries: ${entries.length}`);
  console.log(`WRONG (OH task on non-OH project): ${wrong.length} entries, ${wrong.reduce((s, e) => s + hrs(e), 0)} hrs`);
  console.log(`FYI  (project task on OH project): ${reverse.length} entries, ${reverse.reduce((s, e) => s + hrs(e), 0)} hrs\n`);

  // ---- group by employee ----
  const byEmp = new Map();
  for (const e of wrong) {
    const emp = e.timesheet.employee;
    const k = emp.employeeId;
    if (!byEmp.has(k)) byEmp.set(k, { emp, rows: [] });
    byEmp.get(k).rows.push(e);
  }

  console.log("=== BY EMPLOYEE ===");
  for (const [id, { emp, rows }] of [...byEmp.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
    const weeks = [...new Set(rows.map((r) => d(r.timesheet.weekStart)))].sort();
    console.log(`\n${id} ${emp.name} (${emp.department})  — ${rows.length} rows, ${rows.reduce((s, e) => s + hrs(e), 0)} hrs, ${weeks.length} weeks`);
    for (const r of rows) {
      console.log(`   ${d(r.timesheet.weekStart)}  ${r.timesheet.status.padEnd(9)}  ${r.project.projectNumber} ${r.project.projectName.slice(0, 24).padEnd(24)}  ${r.taskCode.code} ${r.taskCode.name.slice(0, 28).padEnd(28)} [${r.taskCode.category}]  ${hrs(r)}h`);
    }
  }

  console.log("\n=== BY STATUS ===");
  const byStatus = {};
  for (const e of wrong) byStatus[e.timesheet.status] = (byStatus[e.timesheet.status] || 0) + 1;
  console.log(byStatus);

  console.log("\n=== BY TASK CATEGORY ===");
  const byCat = {};
  for (const e of wrong) byCat[e.taskCode.category] = (byCat[e.taskCode.category] || 0) + 1;
  console.log(byCat);

  console.log("\n=== BY PROJECT (wrongly used) ===");
  const byProj = {};
  for (const e of wrong) {
    const k = `${e.project.projectNumber} ${e.project.projectName}`;
    byProj[k] = (byProj[k] || 0) + 1;
  }
  console.log(byProj);

  // ---- Excel ----
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("OH ลงผิด Project");
  ws.columns = [
    { header: "Employee ID", key: "eid", width: 12 },
    { header: "ชื่อ", key: "name", width: 26 },
    { header: "แผนก", key: "dept", width: 22 },
    { header: "ตำแหน่ง", key: "pos", width: 22 },
    { header: "Week Start", key: "ws", width: 12 },
    { header: "Week End", key: "we", width: 12 },
    { header: "Status", key: "st", width: 11 },
    { header: "Project ที่ลง (ผิด)", key: "pno", width: 12 },
    { header: "ชื่อ Project", key: "pname", width: 30 },
    { header: "Task Code", key: "tcode", width: 10 },
    { header: "Task Name", key: "tname", width: 30 },
    { header: "Category", key: "cat", width: 28 },
    { header: "Mon", key: "mon", width: 6 }, { header: "Tue", key: "tue", width: 6 },
    { header: "Wed", key: "wed", width: 6 }, { header: "Thu", key: "thu", width: 6 },
    { header: "Fri", key: "fri", width: 6 }, { header: "Sat", key: "sat", width: 6 },
    { header: "Sun", key: "sun", width: 6 },
    { header: "รวม (hrs)", key: "tot", width: 10 },
    { header: "ควรลงเป็น", key: "fix", width: 26 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const e of wrong) {
    const emp = e.timesheet.employee;
    ws.addRow({
      eid: emp.employeeId, name: emp.name, dept: emp.department, pos: emp.position,
      ws: d(e.timesheet.weekStart), we: d(e.timesheet.weekEnd), st: e.timesheet.status,
      pno: e.project.projectNumber, pname: e.project.projectName,
      tcode: e.taskCode.code, tname: e.taskCode.name, cat: e.taskCode.category,
      mon: e.monHrs, tue: e.tueHrs, wed: e.wedHrs, thu: e.thuHrs, fri: e.friHrs, sat: e.satHrs, sun: e.sunHrs,
      tot: hrs(e),
      fix: `${ohProject.projectNumber} ${ohProject.projectName}`,
    });
  }
  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };

  const ws2 = wb.addWorksheet("สรุปรายคน");
  ws2.columns = [
    { header: "Employee ID", key: "eid", width: 12 },
    { header: "ชื่อ", key: "name", width: 26 },
    { header: "แผนก", key: "dept", width: 22 },
    { header: "จำนวนรายการ", key: "n", width: 13 },
    { header: "รวมชั่วโมง", key: "h", width: 11 },
    { header: "สัปดาห์ที่ต้องแก้", key: "w", width: 60 },
    { header: "สถานะ Timesheet", key: "st", width: 24 },
  ];
  ws2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  for (const [id, { emp, rows }] of [...byEmp.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
    ws2.addRow({
      eid: id, name: emp.name, dept: emp.department,
      n: rows.length, h: rows.reduce((s, e) => s + hrs(e), 0),
      w: [...new Set(rows.map((r) => d(r.timesheet.weekStart)))].sort().join(", "),
      st: [...new Set(rows.map((r) => r.timesheet.status))].join(", "),
    });
  }

  const ws3 = wb.addWorksheet("สรุปรายสัปดาห์");
  ws3.columns = [
    { header: "Week Start", key: "ws", width: 12 },
    { header: "Week End", key: "we", width: 12 },
    { header: "จำนวนรายการ", key: "n", width: 13 },
    { header: "รวมชั่วโมง", key: "h", width: 11 },
    { header: "จำนวนคน", key: "e", width: 10 },
    { header: "draft", key: "dr", width: 8 },
    { header: "submitted", key: "sb", width: 10 },
    { header: "approved", key: "ap", width: 10 },
    { header: "รายชื่อ (Employee ID)", key: "list", width: 70 },
  ];
  ws3.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws3.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  const byWeek = new Map();
  for (const e of wrong) {
    const k = d(e.timesheet.weekStart);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(e);
  }
  for (const [w, rows] of [...byWeek.entries()].sort()) {
    const cnt = (s) => rows.filter((r) => r.timesheet.status === s).length;
    ws3.addRow({
      ws: w, we: d(rows[0].timesheet.weekEnd),
      n: rows.length, h: +rows.reduce((s, e) => s + hrs(e), 0).toFixed(2),
      e: new Set(rows.map((r) => r.timesheet.employee.employeeId)).size,
      dr: cnt("draft"), sb: cnt("submitted"), ap: cnt("approved"),
      list: [...new Set(rows.map((r) => `${r.timesheet.employee.employeeId} ${r.timesheet.employee.name}`))].sort().join(", "),
    });
  }

  const out = "OH-wrong-project-report.xlsx";
  await wb.xlsx.writeFile(out);
  console.log(`\nExcel written: ${out}`);

  await prisma.$disconnect();
})();
