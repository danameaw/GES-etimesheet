// คอลัมน์มาตรฐานของ Excel template โครงการ — ใช้ร่วมกันทั้ง Template / Export / Import
export const PROJECT_HEADERS = [
  "Project Number",
  "Project Name",
  "Type",
  "PD (Employee ID)",
  "PM (Employee ID)",
  "Start Date (YYYY-MM-DD)",
  "End Date (YYYY-MM-DD)",
  "Active (Yes/No)",
];

// ชนิดโครงการที่รองรับ (ต้องตรงกับ dropdown ในหน้า Manage)
// solar/wind/gas/datacenter/procurement/overhead = กลุ่มที่ใช้จัด dropdown Project ในหน้า Timesheet
// (ดู lib/project-groups.ts) — "project" = ยังไม่ระบุกลุ่ม ระบบจะเดากลุ่มจากชื่อโครงการให้
export const PROJECT_TYPES = [
  "project", "solar", "wind", "gas", "datacenter", "procurement", "overhead", "support", "admin",
];
