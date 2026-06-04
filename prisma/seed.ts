import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ---------- EMPLOYEES ----------
  const employees = [
    { employeeId: "GES001", name: "Somchai Prasertphon",    department: "Management",            position: "Managing Director",          role: "admin" },
    { employeeId: "GES002", name: "Wanchai Srisuwan",       department: "Management",            position: "Deputy Managing Director",   role: "admin" },
    { employeeId: "GES003", name: "Pichit Boonrod",         department: "Project Management",    position: "Project Director",           role: "ges_management" },
    { employeeId: "GES004", name: "Sunisa Mahakhan",        department: "Project Management",    position: "Project Manager",            role: "pd" },
    { employeeId: "GES005", name: "Nopporn Thamrongsak",    department: "Project Management",    position: "Project Manager",            role: "pd" },
    { employeeId: "GES006", name: "Nattapong Rattanakul",   department: "Process Engineering",   position: "Senior Process Engineer",    role: "employee" },
    { employeeId: "GES007", name: "Siriporn Thaweekiat",    department: "Process Engineering",   position: "Process Engineer",           role: "employee" },
    { employeeId: "GES008", name: "Prayuth Chalermpong",    department: "Mechanical Engineering",position: "Senior Mechanical Engineer", role: "employee" },
    { employeeId: "GES009", name: "Kulthida Boonsong",      department: "Mechanical Engineering",position: "Mechanical Engineer",        role: "employee" },
    { employeeId: "GES010", name: "Thanawat Wichiansri",    department: "Civil & Structural",    position: "Senior Structural Engineer", role: "employee" },
    { employeeId: "GES011", name: "Anchisa Nimitmongkol",   department: "Civil & Structural",    position: "Structural Engineer",        role: "employee" },
    { employeeId: "GES012", name: "Surachai Phetcharoen",   department: "Electrical Engineering",position: "Senior Electrical Engineer", role: "employee" },
    { employeeId: "GES013", name: "Natthanan Srisombat",    department: "Electrical Engineering",position: "Electrical Engineer",        role: "employee" },
    { employeeId: "GES014", name: "Anurak Sombatpanich",    department: "Instrumentation",       position: "Senior Instrument Engineer", role: "employee" },
    { employeeId: "GES015", name: "Parichat Klomchit",      department: "Instrumentation",       position: "Instrument Engineer",        role: "employee" },
    { employeeId: "GES016", name: "Worawit Phothisarn",     department: "Piping Engineering",    position: "Senior Piping Engineer",     role: "employee" },
    { employeeId: "GES017", name: "Monphet Saengchan",      department: "Piping Engineering",    position: "Piping Designer",            role: "employee" },
    { employeeId: "GES018", name: "Kritsana Jitjamnong",    department: "Safety & Environment",  position: "Senior HSE Engineer",        role: "employee" },
    { employeeId: "GES019", name: "Waraporn Chaiyabutr",    department: "Safety & Environment",  position: "Environmental Engineer",     role: "employee" },
    { employeeId: "GES020", name: "Oranuch Suksomboon",     department: "Document Control",      position: "Document Controller",        role: "employee" },
  ];

  for (const e of employees) {
    await prisma.employee.upsert({
      where: { employeeId: e.employeeId },
      update: {},
      create: e,
    });
  }
  console.log("✓ Employees seeded");

  // Get employee IDs for PM/PD assignment
  const pd = await prisma.employee.findUnique({ where: { employeeId: "GES003" } });
  const pm1 = await prisma.employee.findUnique({ where: { employeeId: "GES004" } });
  const pm2 = await prisma.employee.findUnique({ where: { employeeId: "GES005" } });

  // ---------- PROJECTS ----------
  const projects = [
    { projectNumber: "GES-OH",   projectName: "Overhead / Non-Project",              projectType: "overhead", managerId: null },
    { projectNumber: "GES-2301", projectName: "PTT Rayong Pipeline Inspection",       projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2302", projectName: "IRPC Structural Assessment",           projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2303", projectName: "PTTEP Offshore Platform Study",        projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2304", projectName: "SCG Cement Plant Engineering",         projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2305", projectName: "GULF Cogeneration FEED",               projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2306", projectName: "EGAT EIA Study",                       projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2307", projectName: "Bangkok Expressway Structural Review", projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2308", projectName: "Vinythai VCM Plant Revamp",            projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2309", projectName: "Bangchak Refinery Upgrade",            projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2310", projectName: "TPI Polene Power Plant",               projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2311", projectName: "Map Ta Phut Industrial Estate",        projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2312", projectName: "Thai Oil Pipeline Feasibility",        projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2313", projectName: "Amata WIE Solar Rooftop",              projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2314", projectName: "NPC Safety & Environmental",           projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2315", projectName: "RATCH Biomass Power Study",            projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2316", projectName: "Eastern Water Resources",              projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2317", projectName: "Siam Steel Structural Design",         projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2318", projectName: "PTT Tank Farm Inspection",             projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2319", projectName: "Rayong WWTP Engineering",              projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2320", projectName: "Chonburi Petrochemical Complex",       projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2321", projectName: "GPSC Green Energy Integration",        projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2322", projectName: "Dow Chemical Process Safety",          projectType: "project",  managerId: pm1?.id ?? null },
    { projectNumber: "GES-2323", projectName: "HMC Polymers Plant Extension",         projectType: "project",  managerId: pm2?.id ?? null },
    { projectNumber: "GES-2324", projectName: "Indorama Ventures EPC Support",        projectType: "project",  managerId: pd?.id ?? null },
    { projectNumber: "GES-2325", projectName: "PTTGC Cracker Revamp Study",           projectType: "project",  managerId: pm1?.id ?? null },
  ];

  for (const p of projects) {
    await prisma.project.upsert({
      where: { projectNumber: p.projectNumber },
      update: { managerId: p.managerId },
      create: p,
    });
  }
  console.log("✓ Projects seeded");

  // ---------- TASK CODES ----------
  const taskCodes = [
    { code: "1001", name: "Leave / Holiday",         category: "OH" },
    { code: "1002", name: "Training & Development",  category: "OH" },
    { code: "1003", name: "Business Development",    category: "OH" },
    { code: "1004", name: "Administration",          category: "OH" },
    { code: "1005", name: "Company Meeting",         category: "OH" },
    { code: "0011", name: "Project Management",      category: "Project" },
    { code: "0012", name: "Project Coordination",    category: "Project" },
    { code: "0013", name: "Document Control",        category: "Project" },
    { code: "0111", name: "Feasibility Study",       category: "Study" },
    { code: "0112", name: "Conceptual Design",       category: "Study" },
    { code: "0113", name: "Pre-FEED",                category: "Study" },
    { code: "0211", name: "Process Engineering",     category: "Engineering" },
    { code: "0212", name: "Process Simulation",      category: "Engineering" },
    { code: "0213", name: "Heat & Mass Balance",     category: "Engineering" },
    { code: "0311", name: "Mechanical Engineering",  category: "Engineering" },
    { code: "0312", name: "Equipment Sizing",        category: "Engineering" },
    { code: "0313", name: "Vessel Design",           category: "Engineering" },
    { code: "0411", name: "Civil & Structural",      category: "Engineering" },
    { code: "0412", name: "Foundation Design",       category: "Engineering" },
    { code: "0413", name: "Steel Structure",         category: "Engineering" },
    { code: "0511", name: "Electrical Engineering",  category: "Engineering" },
    { code: "0512", name: "Power Distribution",      category: "Engineering" },
    { code: "0611", name: "Instrumentation & Control",category: "Engineering" },
    { code: "0612", name: "PLC/DCS Programming",     category: "Engineering" },
    { code: "0711", name: "Piping Engineering",      category: "Engineering" },
    { code: "0712", name: "Piping Layout",           category: "Engineering" },
    { code: "0811", name: "Safety & Risk Analysis",  category: "Safety" },
    { code: "0812", name: "HAZOP Study",             category: "Safety" },
    { code: "0813", name: "Fire & Gas System",       category: "Safety" },
    { code: "0911", name: "Environmental Assessment",category: "Environmental" },
    { code: "0912", name: "EIA Report",              category: "Environmental" },
    { code: "1011", name: "Procurement Support",     category: "Procurement" },
    { code: "1012", name: "Vendor Evaluation",       category: "Procurement" },
    { code: "1111", name: "Construction Supervision",category: "Construction" },
    { code: "1112", name: "Site Inspection",         category: "Construction" },
    { code: "1211", name: "Commissioning",           category: "Commissioning" },
    { code: "1212", name: "Start-up Support",        category: "Commissioning" },
    { code: "1311", name: "Inspection & Testing",    category: "Inspection" },
    { code: "1312", name: "NDT & Integrity",         category: "Inspection" },
    { code: "1411", name: "Technical Report Writing",category: "Documentation" },
    { code: "1412", name: "Drawing & Drafting",      category: "Documentation" },
    { code: "1511", name: "Client Meeting",          category: "Client" },
    { code: "1512", name: "Site Visit",              category: "Client" },
    { code: "1611", name: "Review & QA/QC",          category: "QA/QC" },
    { code: "1612", name: "Design Verification",     category: "QA/QC" },
    { code: "1711", name: "Research & Development",  category: "R&D" },
    { code: "1712", name: "Technology Assessment",   category: "R&D" },
    { code: "1713", name: "Innovation Project",      category: "R&D" },
  ];

  for (const t of taskCodes) {
    await prisma.taskCode.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    });
  }
  console.log("✓ Task codes seeded");
  console.log("Seed completed: 26 projects, 48 task codes, 20 employees");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
