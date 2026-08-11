/**
 * ย้าย TimesheetEntry ที่ใช้ task code กลุ่ม Overhead แต่ผูกกับ project อื่น
 * ให้ไปอยู่ใต้ project Overhead / Non-Project
 *
 *   node scripts/fix-oh-project.js            # dry run (ไม่แก้ข้อมูล)
 *   node scripts/fix-oh-project.js --apply    # แก้จริง (สำรองข้อมูลก่อนเสมอ)
 *   node scripts/fix-oh-project.js --restore <backup.json>   # ย้อนกลับ
 */
require("dotenv").config();
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const OH_CATEGORIES = new Set([
  "Holiday", "Training", "Meetings", "Traveling", "Business Development",
  "Lessons Learned & Process Improvement", "Department/Corporate Work", "Unassigned",
]);
const d = (x) => new Date(x).toISOString().slice(0, 10);

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Restoring ${backup.rows.length} entries from ${file} …`);
  let n = 0;
  for (const r of backup.rows) {
    const exists = await prisma.timesheetEntry.findUnique({ where: { id: r.entryId } });
    if (!exists) {
      console.log(`  skip ${r.entryId} (ไม่พบแล้ว)`);
      continue;
    }
    await prisma.timesheetEntry.update({
      where: { id: r.entryId },
      data: { projectId: r.oldProjectId },
    });
    n++;
  }
  console.log(`Restored ${n} entries.`);
}

(async () => {
  const args = process.argv.slice(2);
  const restoreIdx = args.indexOf("--restore");
  if (restoreIdx >= 0) {
    await restore(args[restoreIdx + 1]);
    await prisma.$disconnect();
    return;
  }
  const apply = args.includes("--apply");

  const oh = await prisma.project.findFirst({
    where: { OR: [{ projectType: "overhead" }, { projectType: "support" }] },
  });
  if (!oh) throw new Error("ไม่พบ project Overhead");
  console.log(`Target project: ${oh.projectNumber} ${oh.projectName} (${oh.id})\n`);

  const entries = await prisma.timesheetEntry.findMany({
    include: {
      project: { select: { projectNumber: true, projectName: true } },
      taskCode: { select: { code: true, name: true, category: true } },
      timesheet: {
        select: {
          id: true, weekStart: true, status: true,
          employee: { select: { id: true, employeeId: true, name: true } },
        },
      },
    },
  });
  const wrong = entries.filter((e) => OH_CATEGORIES.has(e.taskCode.category) && e.projectId !== oh.id);
  const hrs = (e) => e.totalHrs || (e.monHrs + e.tueHrs + e.wedHrs + e.thuHrs + e.friHrs + e.satHrs + e.sunHrs);

  console.log(`พบ ${wrong.length} รายการที่ต้องย้าย (${wrong.reduce((s, e) => s + hrs(e), 0).toFixed(2)} ชม.)\n`);
  if (wrong.length === 0) { await prisma.$disconnect(); return; }

  // ตรวจว่าย้ายแล้วจะไปซ้ำกับแถวเดิมใน timesheet เดียวกันหรือไม่ (project+task ซ้ำ)
  const existingKeys = new Set(
    entries.filter((e) => e.projectId === oh.id).map((e) => `${e.timesheetId}|${e.taskCodeId}`)
  );
  const dupes = wrong.filter((e) => existingKeys.has(`${e.timesheetId}|${e.taskCodeId}`));

  console.log("=== รายการที่จะย้าย ===");
  for (const e of wrong) {
    const emp = e.timesheet.employee;
    const dup = existingKeys.has(`${e.timesheetId}|${e.taskCodeId}`) ? "  ← ซ้ำกับแถวเดิม" : "";
    console.log(`  ${emp.employeeId} ${emp.name.padEnd(15)} ${d(e.timesheet.weekStart)} ${e.timesheet.status.padEnd(9)} ${e.project.projectNumber} → ${oh.projectNumber}  ${e.taskCode.code} ${e.taskCode.name.slice(0, 24).padEnd(24)} ${hrs(e)}h${dup}`);
  }
  if (dupes.length) {
    console.log(`\n⚠️  ${dupes.length} รายการจะกลายเป็นแถวซ้ำ (project+task เดียวกันในสัปดาห์เดียวกัน) — สคริปต์นี้ไม่รวมแถวให้ ชั่วโมงรวมยังถูกต้อง แต่จะเห็นเป็น 2 บรรทัด`);
  }

  if (!apply) {
    console.log("\n[DRY RUN] ยังไม่แก้ข้อมูล — รันซ้ำด้วย --apply เพื่อแก้จริง");
    await prisma.$disconnect();
    return;
  }

  // ---- backup ----
  const stamp = process.env.FIX_STAMP || "backup";
  const backupFile = `oh-fix-${stamp}.json`;
  fs.writeFileSync(backupFile, JSON.stringify({
    targetProjectId: oh.id,
    targetProjectNumber: oh.projectNumber,
    rows: wrong.map((e) => ({
      entryId: e.id,
      timesheetId: e.timesheetId,
      oldProjectId: e.projectId,
      oldProjectNumber: e.project.projectNumber,
      taskCode: e.taskCode.code,
      employeeId: e.timesheet.employee.employeeId,
      weekStart: d(e.timesheet.weekStart),
      status: e.timesheet.status,
      hrs: hrs(e),
    })),
  }, null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  // ---- apply ----
  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.timesheetEntry.updateMany({
      where: { id: { in: wrong.map((e) => e.id) } },
      data: { projectId: oh.id },
    });
    const byEmp = new Map();
    for (const e of wrong) {
      const k = e.timesheet.employee.id;
      byEmp.set(k, (byEmp.get(k) || 0) + 1);
    }
    await tx.auditLog.createMany({
      data: Array.from(byEmp.entries()).map(([empDbId, n]) => ({
        employeeId: empDbId,
        action: "ADMIN_FIX_OH_PROJECT",
        detail: `ย้าย ${n} รายการ (OH task) ไปอยู่ใต้ project ${oh.projectNumber} ${oh.projectName} — backup: ${backupFile}`,
      })),
    });
    return upd.count;
  }, { timeout: 60000, maxWait: 30000 });
  console.log(`อัปเดตแล้ว ${result} รายการ`);

  // ---- verify ----
  const after = await prisma.timesheetEntry.findMany({
    include: { taskCode: { select: { category: true } } },
  });
  const stillWrong = after.filter((e) => OH_CATEGORIES.has(e.taskCode.category) && e.projectId !== oh.id);
  console.log(`ตรวจซ้ำ: เหลือรายการที่ยังผิด ${stillWrong.length} รายการ`);
  console.log(`ย้อนกลับได้ด้วย: node scripts/fix-oh-project.js --restore ${backupFile}`);

  await prisma.$disconnect();
})();
