const { PrismaClient } = require("@prisma/client");
const XLSX = require("xlsx");
const path = require("path");

const prisma = new PrismaClient();

// Normalize helpers
function fixDept(d) {
  if (!d) return "";
  const map = {
    "management":        "Management",
    "project management":"Project Management",
    "admin":             "Admin",
  };
  return map[d.trim().toLowerCase()] ?? d.trim();
}

function fixRole(r) {
  if (!r) return "employee";
  const map = {
    "ges management": "ges_management",
    "project director": "pd",
    "employee": "employee",
    "pd": "pd",
    "admin": "admin",
    "md": "md",
  };
  return map[r.trim().toLowerCase()] ?? "employee";
}

function fixPosition(p) {
  if (!p) return "";
  return p
    .replace(/ElectricalEngineering/g, "Electrical Engineering")
    .replace(/MechanicalEngineering/g, "Mechanical Engineering")
    .replace(/RenewableEngineering/g, "Renewable Engineering")
    .replace(/Control & InstrumentationEngineering/g, "Control & Instrumentation Engineering")
    .replace(/Electical Engineer/g, "Electrical Engineer")
    .trim();
}

async function main() {
  const filePath = path.join(
    "C:\\Users\\danaya.th\\Downloads",
    "employee_import_template (9) (1).xlsx"
  );

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets["Employees"];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  console.log(`Found ${rows.length} rows in Excel`);

  let created = 0, skipped = 0, errors = [];

  for (const row of rows) {
    const employeeId = String(row.employeeId ?? "").trim();
    if (!employeeId) { skipped++; continue; }

    const name       = String(row.name ?? "").trim();
    const department = fixDept(String(row.department ?? ""));
    const position   = fixPosition(String(row.position ?? ""));
    const level      = String(row.level ?? "").trim();
    const role       = fixRole(String(row.role ?? ""));

    if (!name || !department || !position) {
      errors.push(`Row ${employeeId}: missing required fields`);
      skipped++;
      continue;
    }

    // Check duplicate
    const existing = await prisma.employee.findUnique({ where: { employeeId } });
    if (existing) {
      console.log(`  SKIP (exists): ${employeeId} — ${name}`);
      skipped++;
      continue;
    }

    try {
      await prisma.employee.create({
        data: { employeeId, name, department, position, level, role, isActive: true },
      });
      console.log(`  OK: ${employeeId} — ${name} [${department}] [${role}]`);
      created++;
    } catch (e) {
      errors.push(`Row ${employeeId}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`\n===== DONE =====`);
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  if (errors.length) {
    console.log(`Errors (${errors.length}):`);
    errors.forEach(e => console.log(`  - ${e}`));
  }

  await prisma.auditLog.create({
    data: {
      employeeId: "system",
      action: "BULK_IMPORT",
      detail: `Imported ${created} employees from Excel (${new Date().toISOString()})`,
    },
  }).catch(() => {}); // auditLog requires valid employeeId FK — skip if fails
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
