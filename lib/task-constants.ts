export const TASK_CATEGORIES = [
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
] as const;

// โครงการ Overhead / Non-Project
// ข้อมูลจริงบน production ใช้ projectType = "overhead" (projectNumber = "10000")
// ส่วน seed/ตัวอย่างเดิมใช้ "support" หรือ projectNumber ขึ้นต้นด้วย "GES-OH" → รองรับทั้งหมด
export function isOverheadProject(p: { projectNumber?: string; projectType?: string } | null | undefined): boolean {
  if (!p) return false;
  const type = (p.projectType ?? "").toLowerCase();
  if (type === "overhead" || type === "support") return true;
  return (p.projectNumber ?? "").toUpperCase().startsWith("GES-OH");
}

export const OH_CATEGORIES = new Set([
  "Holiday",
  "Training",
  "Meetings",
  "Traveling",
  "Business Development",
  "Lessons Learned & Process Improvement",
  "Department/Corporate Work",
  "Unassigned",
]);
