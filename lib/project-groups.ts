import { isOverheadProject } from "./task-constants";

// ── กลุ่มโครงการ (Business Group) ────────────────────────────────────────────
// ใช้จัดกลุ่ม dropdown "Project" ในหน้ากรอก Timesheet ให้หาโครงการง่ายขึ้น
// ลำดับใน array = ลำดับที่แสดงใน dropdown
export type ProjectGroupKey =
  "solar" | "wind" | "gas" | "datacenter" | "procurement" | "overhead" | "other";

export const PROJECT_GROUPS: { key: ProjectGroupKey; label: string; icon: string }[] = [
  { key: "solar",       label: "Solar",                   icon: "☀️" },
  { key: "wind",        label: "Wind",                    icon: "💨" },
  { key: "gas",         label: "Gas / LNG",               icon: "🔥" },
  { key: "datacenter",  label: "Data Center",             icon: "🖥️" },
  { key: "procurement", label: "Procurement / Logistics", icon: "📦" },
  { key: "overhead",    label: "Overhead / Non-Project",  icon: "🏢" },
  { key: "other",       label: "อื่นๆ",                    icon: "📁" },
];

const GROUP_KEYS = new Set<string>(PROJECT_GROUPS.map((g) => g.key));

// เดากลุ่มจากชื่อ/เลขโครงการ — ใช้เมื่อ Admin ยังไม่ได้ตั้ง Type ของโครงการนั้น
// (ตั้ง Type ได้ที่หน้า Manage › โครงการ ซึ่งจะ override การเดาทั้งหมด)
// เรียงตามลำดับการตรวจ — เจอ pattern แรกที่ตรงแล้วหยุด
// (procurement มาก่อน datacenter เพราะ "Data center Support (for procurement/Logistics)" = งานจัดซื้อ)
const GROUP_KEYWORDS: { key: ProjectGroupKey; pattern: RegExp }[] = [
  { key: "procurement", pattern: /procurement|logistic|fuel supply/i },
  { key: "wind",        pattern: /wind/i },
  { key: "solar",       pattern: /solar|sosb|gso|tso|sol\d/i },
  { key: "gas",         pattern: /\bgas\b|lng|gmtp|thai tank|\bttt\b/i },
  { key: "datacenter",  pattern: /gsa|gedc|data ?cent/i },
];

type ProjectLike = { projectNumber?: string; projectName?: string; projectType?: string };

export function projectGroupKey(p: ProjectLike | null | undefined): ProjectGroupKey {
  if (!p) return "other";
  if (isOverheadProject(p)) return "overhead";

  // Type ที่ Admin ตั้งไว้มาก่อนเสมอ
  const type = (p.projectType ?? "").toLowerCase();
  if (GROUP_KEYS.has(type)) return type as ProjectGroupKey;

  const text = `${p.projectNumber ?? ""} ${p.projectName ?? ""}`;
  return GROUP_KEYWORDS.find((g) => g.pattern.test(text))?.key ?? "other";
}

// จัดโครงการเข้ากลุ่มตามลำดับใน PROJECT_GROUPS — กลุ่มที่ไม่มีโครงการจะถูกตัดออก
export function groupProjects<T extends ProjectLike>(projects: T[]) {
  return PROJECT_GROUPS.map((g) => ({
    ...g,
    projects: projects.filter((p) => projectGroupKey(p) === g.key),
  })).filter((g) => g.projects.length > 0);
}
