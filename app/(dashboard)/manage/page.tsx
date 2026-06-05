"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useRef } from "react";
import { OH_CATEGORIES } from "@/lib/task-constants";

// ──────────── Types ────────────
interface Project {
  id: string; projectNumber: string; projectName: string; projectType: string;
  isActive: boolean; managerId: string | null; pdId: string | null;
  startDate: string | null; endDate: string | null;
  manager: { id: string; name: string; employeeId: string } | null;
  pd:      { id: string; name: string; employeeId: string } | null;
}
interface TaskCode { id: string; code: string; name: string; category: string; isActive: boolean; }
interface Holiday  { id: string; date: string; name: string; type: string; }
interface Employee { id: string; name: string; employeeId: string; role: string; }

const TABS = ["📁 โครงการ", "✅ รหัสงาน", "📅 วันหยุด / ลา"] as const;

export default function ManagePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (session && role !== "admin") router.push("/timesheet");
  }, [session, role, router]);

  const [tab, setTab] = useState<0 | 1 | 2>(0);

  if (role !== "admin") return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Manage</h1>
        <p className="text-gray-500 text-sm">จัดการข้อมูลโครงการ รหัสงาน และวันหยุด</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i as 0|1|2)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === i ? "bg-white border border-b-white border-gray-200 -mb-px text-blue-900 font-semibold" : "text-gray-500 hover:text-gray-700"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <ProjectsTab />}
      {tab === 1 && <TasksTab />}
      {tab === 2 && <HolidaysTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PROJECTS TAB
// ══════════════════════════════════════════════════════════════════════════
function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const emptyForm = { projectNumber: "", projectName: "", projectType: "project", pdId: "", startDate: "", endDate: "" };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [projRes, empRes] = await Promise.all([
      fetch("/api/manage/projects"),
      fetch("/api/employees"),
    ]);
    const projData = await projRes.json();
    const empData  = await empRes.json();
    setProjects(projData.projects || []);
    // All employees with PM/PD/admin roles are selectable for both manager and pd fields
    setManagers((empData.employees || []).filter((e: any) => ["pd","admin","md"].includes(e.role)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (p: Project) => {
    setEditId(p.id);
    setForm({
      projectNumber: p.projectNumber,
      projectName:   p.projectName,
      projectType:   p.projectType,
      pdId:          p.pdId      || "",
      startDate:     p.startDate ? p.startDate.slice(0, 10) : "",
      endDate:       p.endDate   ? p.endDate.slice(0, 10)   : "",
    });
    setShowAdd(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const method = editId ? "PATCH" : "POST";
    const body   = editId ? { id: editId, ...form, isActive: true } : form;
    const res = await fetch("/api/manage/projects", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) { setEditId(null); setShowAdd(false); setForm(emptyForm); load(); }
    else alert("Error: " + (await res.json()).error);
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm("ปิดการใช้งานโครงการนี้?")) return;
    await fetch(`/api/manage/projects?id=${id}`, { method: "DELETE" });
    load();
  };

  const filtered = projects.filter((p) => {
    const matchSearch = !search || p.projectNumber.toLowerCase().includes(search.toLowerCase()) || p.projectName.toLowerCase().includes(search.toLowerCase());
    const matchActive = showInactive ? true : p.isActive;
    return matchSearch && matchActive;
  });

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <input className="ges-input max-w-xs" placeholder="ค้นหาโครงการ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
            แสดงที่ปิดแล้ว
          </label>
          <button onClick={() => { setShowAdd(true); setEditId(null); setForm(emptyForm); }}
            className="ges-btn-primary text-sm">+ เพิ่มโครงการ</button>
        </div>
      </div>

      {/* Add / Edit form */}
      {(showAdd || editId) && (
        <div className="ges-card p-5 border-2 border-blue-200">
          <h3 className="font-semibold text-gray-800 mb-4">{editId ? "✏️ แก้ไขโครงการ" : "➕ เพิ่มโครงการใหม่"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Project Number *</label>
              <input className="ges-input" value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} placeholder="e.g. GES-2026-001" />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Project Name *</label>
              <input className="ges-input" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} placeholder="ชื่อโครงการ" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ประเภท</label>
              <select className="ges-input" value={form.projectType} onChange={(e) => setForm({ ...form, projectType: e.target.value })}>
                <option value="project">Project</option>
                <option value="support">Support / Overhead</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Project Director (PD)</label>
              <select className="ges-input" value={form.pdId} onChange={(e) => setForm({ ...form, pdId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.employeeId} – {m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">วันเริ่มต้น</label>
              <input type="date" className="ges-input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">วันสิ้นสุด</label>
              <input type="date" className="ges-input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving} className="ges-btn-primary">{saving ? "Saving…" : "💾 บันทึก"}</button>
            <button onClick={() => { setEditId(null); setShowAdd(false); }} className="ges-btn-secondary">ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="ges-card overflow-x-auto">
        {loading ? <div className="p-10 text-center text-gray-400">กำลังโหลด…</div> : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-left">Project No.</th>
                <th className="text-left">ชื่อโครงการ</th>
                <th>ประเภท</th>
                <th>PD</th>
                <th>วันเริ่ม</th>
                <th>วันสิ้นสุด</th>
                <th>สถานะ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className={!p.isActive ? "opacity-50" : ""}>
                  <td className="font-mono text-xs font-semibold text-blue-900">{p.projectNumber}</td>
                  <td className="font-medium max-w-[200px] truncate">{p.projectName}</td>
                  <td className="text-center text-xs capitalize">{p.projectType}</td>
                  <td className="text-xs text-center">{p.pd?.name || "–"}</td>
                  <td className="text-xs text-center">{p.startDate ? format(new Date(p.startDate), "dd MMM yy") : "–"}</td>
                  <td className="text-xs text-center">{p.endDate   ? format(new Date(p.endDate),   "dd MMM yy") : "–"}</td>
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {p.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => startEdit(p)} className="text-xs text-blue-600 hover:underline">✏️</button>
                      {p.isActive && <button onClick={() => handleDeactivate(p.id)} className="text-xs text-red-400 hover:text-red-600 hover:underline">🚫</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 text-right">{filtered.length} โครงการ</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TASKS TAB — template data
// ══════════════════════════════════════════════════════════════════════════

// Template data removed — ใช้ Import Excel แทน
const _PROJECT_TASKS_TEMPLATE_UNUSED = [
  { code: "0011", name: "Project Administration - General",                    category: "Project Management & Administration" },
  { code: "0012", name: "BOI",                                                  category: "Project Management & Administration" },
  { code: "0013", name: "Project Director",                                     category: "Project Management & Administration" },
  { code: "0014", name: "Project Manager",                                      category: "Project Management & Administration" },
  { code: "0015", name: "Engineering Manager",                                  category: "Project Management & Administration" },
  { code: "0016", name: "Construction Manager",                                 category: "Project Management & Administration" },
  { code: "0017", name: "Commissioning Manager",                                category: "Project Management & Administration" },
  { code: "0110", name: "Civil Engineering Administration",                     category: "Civil Engineering" },
  { code: "0130", name: "Civil Engineering Permiting and Licensing",            category: "Civil Engineering" },
  { code: "0140", name: "Civil Engineering Conceptual Design",                  category: "Civil Engineering" },
  { code: "0150", name: "Civil Engineering Detailed Design",                    category: "Civil Engineering" },
  { code: "0161", name: "Civil Engineering - Preaward",                         category: "Civil Engineering" },
  { code: "0162", name: "Civil Engineering - Postaward",                        category: "Civil Engineering" },
  { code: "0163", name: "Civil Engineering - FAT",                              category: "Civil Engineering" },
  { code: "0180", name: "Civil Engineering - Construction Support",             category: "Civil Engineering" },
  { code: "0191", name: "Civil Engineering - As-Builts",                        category: "Civil Engineering" },
  { code: "0210", name: "Mechanical Engineering Administration",                category: "Mechanical Engineering" },
  { code: "0230", name: "Mechanical Engineering Permiting and Licensing",       category: "Mechanical Engineering" },
  { code: "0240", name: "Mechanical Engineering Conceptual Design",             category: "Mechanical Engineering" },
  { code: "0250", name: "Mechanical Engineering Detailed Design",               category: "Mechanical Engineering" },
  { code: "0261", name: "Mechanical Engineering - Preaward",                    category: "Mechanical Engineering" },
  { code: "0262", name: "Mechanical Engineering - Postaward",                   category: "Mechanical Engineering" },
  { code: "0263", name: "Mechanical Engineering - FAT",                         category: "Mechanical Engineering" },
  { code: "0280", name: "Mechanical Engineering - Construction Support",        category: "Mechanical Engineering" },
  { code: "0291", name: "Mechanical Engineering - As-Builts",                   category: "Mechanical Engineering" },
  { code: "0310", name: "Control/Electrical Engineering Administration",        category: "Control/Electrical Engineering" },
  { code: "0330", name: "Control/Electrical Engineering Permiting and Licensing", category: "Control/Electrical Engineering" },
  { code: "0340", name: "Control/Electrical Engineering Conceptual Design",     category: "Control/Electrical Engineering" },
  { code: "0350", name: "Control/Electrical Engineering Detailed Design",       category: "Control/Electrical Engineering" },
  { code: "0361", name: "Control/Electrical Engineering - Preaward",            category: "Control/Electrical Engineering" },
  { code: "0362", name: "Control/Electrical Engineering - Postaward",           category: "Control/Electrical Engineering" },
  { code: "0363", name: "Control/Electrical Engineering - FAT",                 category: "Control/Electrical Engineering" },
  { code: "0380", name: "Control/Electrical Engineering - Construction Support", category: "Control/Electrical Engineering" },
  { code: "0391", name: "Control/Electrical Engineering - As-Builts",           category: "Control/Electrical Engineering" },
  { code: "0510", name: "Project Controls Administration",                      category: "Project Controls" },
  { code: "0610", name: "Procurement Administration",                           category: "Procurement" },
  { code: "0660", name: "Procurement - Bid List Development (Equipment)",       category: "Procurement" },
  { code: "0661", name: "Procurement - Bidding & Evaluation (Equipment)",       category: "Procurement" },
  { code: "0662", name: "Procurement - Contract Negotiations & Award (Equipment)", category: "Procurement" },
  { code: "0663", name: "Procurement - Expediting (Equipment)",                 category: "Procurement" },
  { code: "0664", name: "Procurement - Logistics (Equipment)",                  category: "Procurement" },
  { code: "0665", name: "Procurement - Warranty Administration (Equipment)",    category: "Procurement" },
  { code: "0666", name: "Procurement - Bid List Development (EPC)",             category: "Procurement" },
  { code: "0667", name: "Procurement - Bidding & Evaluation (EPC)",             category: "Procurement" },
  { code: "0668", name: "Procurement - Contract Negotiations & Award (EPC)",    category: "Procurement" },
  { code: "1710", name: "Site Manager",                                         category: "Construction" },
  { code: "1711", name: "Site Engineer",                                        category: "Construction" },
  { code: "1712", name: "Safety Officer",                                       category: "Construction" },
  { code: "1713", name: "Commissioning Manager",                                category: "Construction" },
];

const _OH_TASKS_TEMPLATE_UNUSED = [
  { code: "1001", name: "Holidays",                                             category: "Holiday" },
  { code: "1002", name: "Annual Leave",                                         category: "Holiday" },
  { code: "1003", name: "Personal Leave",                                       category: "Holiday" },
  { code: "1004", name: "Sick Leave",                                           category: "Holiday" },
  { code: "1005", name: "Others",                                               category: "Holiday" },
  { code: "2001", name: "Internal Training",                                    category: "Training" },
  { code: "2002", name: "External Training",                                    category: "Training" },
  { code: "3001", name: "Gulf Corporate Meeting",                               category: "Meetings" },
  { code: "3002", name: "Business Units",                                       category: "Meetings" },
  { code: "3003", name: "Project Companies",                                    category: "Meetings" },
  { code: "3004", name: "GES Board",                                            category: "Meetings" },
  { code: "3005", name: "GES Inter Department",                                 category: "Meetings" },
  { code: "3101", name: "Domestic Traveling",                                   category: "Traveling" },
  { code: "3102", name: "Oversea Traveling",                                    category: "Traveling" },
  { code: "4001", name: "Gulf and Affiliates",                                  category: "Business Development" },
  { code: "4002", name: "External",                                             category: "Business Development" },
  { code: "4003", name: "Marketing",                                            category: "Business Development" },
  { code: "5001", name: "R&D / Technical Investigation / Procedure Development Work", category: "Lessons Learned & Process Improvement" },
  { code: "5002", name: "Project Review",                                       category: "Lessons Learned & Process Improvement" },
  { code: "8101", name: "General Administration",                               category: "Department/Corporate Work" },
  { code: "8102", name: "Compliance",                                           category: "Department/Corporate Work" },
  { code: "8103", name: "Strategic Planning",                                   category: "Department/Corporate Work" },
  { code: "8104", name: "Performance Management",                               category: "Department/Corporate Work" },
  { code: "8105", name: "HR Development",                                       category: "Department/Corporate Work" },
  { code: "8106", name: "Interview",                                            category: "Department/Corporate Work" },
  { code: "9001", name: "Unassigned / Waiting for Assignment",                  category: "Unassigned" },
];

// ══════════════════════════════════════════════════════════════════════════
// TASKS TAB
// ══════════════════════════════════════════════════════════════════════════
function TasksTab() {
  const [tasks, setTasks] = useState<TaskCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [taskType, setTaskType] = useState<"project" | "oh">("project");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const emptyForm = { code: "", name: "", category: "" };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/manage/tasks");
    const d = await res.json();
    setTasks(d.tasks || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Split tasks into project vs OH
  const isOH = (t: TaskCode) => OH_CATEGORIES.has(t.category);
  const displayTasks = tasks.filter((t) => taskType === "oh" ? isOH(t) : !isOH(t));

  const categories = Array.from(new Set(displayTasks.map((t) => t.category))).sort();
  // ใช้ categories จาก tasks ที่มีอยู่ใน DB เป็น dropdown options
  const templateCategories = categories;

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/manage/tasks/import", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (importRef.current) importRef.current.value = "";
    if (res.ok) {
      setImportMsg({ type: "success", text: `นำเข้าสำเร็จ ${data.upserted} รหัสงาน` });
      load();
    } else {
      setImportMsg({ type: "error", text: data.error || "เกิดข้อผิดพลาด" });
    }
  };

  const startEdit = (t: TaskCode) => {
    setEditId(t.id);
    setForm({ code: t.code, name: t.name, category: t.category });
    setShowAdd(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const method = editId ? "PATCH" : "POST";
    const body = editId ? { id: editId, ...form, isActive: true } : form;
    const res = await fetch("/api/manage/tasks", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { setEditId(null); setShowAdd(false); setForm(emptyForm); load(); }
    else alert("Error: " + (await res.json()).error);
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm("ปิดการใช้งานรหัสงานนี้?")) return;
    await fetch(`/api/manage/tasks?id=${id}`, { method: "DELETE" });
    load();
  };

  const filtered = displayTasks.filter((t) => {
    const matchSearch = !search || t.code.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (showInactive ? true : t.isActive);
  });

  return (
    <div className="space-y-5">
      {/* Sub-tabs: Project Tasks / OH Tasks */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => { setTaskType("project"); setShowAdd(false); setEditId(null); }}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${taskType === "project" ? "bg-white border border-b-white border-gray-200 -mb-px text-blue-900 font-semibold" : "text-gray-500 hover:text-gray-700"}`}>
          📋 Project Tasks
        </button>
        <button onClick={() => { setTaskType("oh"); setShowAdd(false); setEditId(null); }}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${taskType === "oh" ? "bg-white border border-b-white border-gray-200 -mb-px text-blue-900 font-semibold" : "text-gray-500 hover:text-gray-700"}`}>
          🏢 OH Tasks <span className="ml-1 text-xs text-orange-500 font-normal">(→ GES-OH)</span>
        </button>
      </div>

      {taskType === "oh" && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 text-sm text-orange-800 flex items-center gap-2">
          ⚠️ OH Tasks จะถูกบังคับให้เลือก Project เป็น <strong>GES-OH – Overhead/Non-Project</strong> อัตโนมัติใน Timesheet
        </div>
      )}

      {importMsg && (
        <div className={`px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${importMsg.type === "success" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          <span>{importMsg.type === "success" ? "✓" : "✗"} {importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-lg leading-none ml-4 opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <input className="ges-input max-w-xs" placeholder="ค้นหา code, ชื่อ, หมวดหมู่…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2 items-center flex-wrap">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
            แสดงที่ปิดแล้ว
          </label>
          {/* Import Excel */}
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
          <button onClick={() => importRef.current?.click()} disabled={importing}
            className="ges-btn-secondary text-sm">
            {importing ? "⏳ Importing…" : "📥 Import Excel"}
          </button>
          <button onClick={() => { setShowAdd(true); setEditId(null); setForm(emptyForm); }} className="ges-btn-primary text-sm">+ เพิ่มรหัสงาน</button>
        </div>
      </div>

      {(showAdd || editId) && (
        <div className="ges-card p-5 border-2 border-blue-200">
          <h3 className="font-semibold text-gray-800 mb-4">{editId ? "✏️ แก้ไขรหัสงาน" : "➕ เพิ่มรหัสงานใหม่"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Code *</label>
              <input className="ges-input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น 0011" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ชื่องาน *</label>
              <input className="ges-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ชื่อกิจกรรม" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">หมวดหมู่ (หัวข้อหลัก) *</label>
              <select className="ges-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">-- เลือกหมวดหมู่ --</option>
                {templateCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                {form.category && !templateCategories.includes(form.category) && (
                  <option value={form.category}>{form.category} (custom)</option>
                )}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving} className="ges-btn-primary">{saving ? "Saving…" : "💾 บันทึก"}</button>
            <button onClick={() => { setEditId(null); setShowAdd(false); }} className="ges-btn-secondary">ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Group by category */}
      {loading ? <div className="p-10 text-center text-gray-400">กำลังโหลด…</div> : (
        <div className="space-y-4">
          {categories.filter((cat) => filtered.some((t) => t.category === cat)).map((cat) => (
            <div key={cat} className="ges-card overflow-hidden">
              <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <span className="font-semibold text-sm text-gray-700">{cat}</span>
                <span className="text-xs text-gray-400">({filtered.filter((t) => t.category === cat).length} รายการ)</span>
                {OH_CATEGORIES.has(cat) && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">OH</span>}
              </div>
              <table className="ges-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Code</th>
                    <th className="text-left">ชื่องาน</th>
                    <th>สถานะ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.filter((t) => t.category === cat).map((t) => (
                    <tr key={t.id} className={!t.isActive ? "opacity-50" : ""}>
                      <td className="font-mono text-xs font-semibold text-blue-900">{t.code}</td>
                      <td>{t.name}</td>
                      <td className="text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {t.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex gap-2 justify-center">
                          <button onClick={() => startEdit(t)} className="text-xs text-blue-600 hover:underline">✏️</button>
                          {t.isActive && <button onClick={() => handleDeactivate(t.id)} className="text-xs text-red-400 hover:underline">🚫</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="ges-card p-10 text-center text-gray-400">
              <p>ยังไม่มีรหัสงาน</p>
              <button onClick={() => importRef.current?.click()} disabled={importing} className="ges-btn-primary text-sm mt-3">
                📥 Import Excel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOLIDAYS TAB
// ══════════════════════════════════════════════════════════════════════════
const TYPE_LABELS: Record<string, string> = {
  public_holiday: "วันหยุดราชการ",
  company_leave:  "วันหยุดบริษัท",
  special:        "พิเศษ",
};

function HolidaysTab() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: "", name: "", type: "public_holiday" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/manage/holidays?year=${year}`);
    const d = await res.json();
    setHolidays(d.holidays || []);
    setLoading(false);
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.date || !form.name) return alert("กรุณากรอกวันที่และชื่อ");
    setSaving(true);
    const res = await fetch("/api/manage/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    if (res.ok) { setShowAdd(false); setForm({ date: "", name: "", type: "public_holiday" }); load(); }
    else alert("Error");
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`ลบ "${name}"?`)) return;
    await fetch(`/api/manage/holidays?id=${id}`, { method: "DELETE" });
    load();
  };

  // Group by month
  const byMonth = new Map<number, Holiday[]>();
  for (const h of holidays) {
    const m = new Date(h.date).getUTCMonth();
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(h);
  }
  const MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

  return (
    <div className="space-y-5">
      {/* Year nav + add */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">‹</button>
          <span className="font-bold text-lg text-gray-800 min-w-[80px] text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">›</button>
          <span className="text-sm text-gray-500 ml-2">{holidays.length} วัน</span>
        </div>
        <button onClick={() => setShowAdd(true)} className="ges-btn-primary text-sm">+ เพิ่มวันหยุด</button>
      </div>

      {showAdd && (
        <div className="ges-card p-5 border-2 border-blue-200">
          <h3 className="font-semibold text-gray-800 mb-4">➕ เพิ่มวันหยุด</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">วันที่ *</label>
              <input type="date" className="ges-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ชื่อวันหยุด *</label>
              <input className="ges-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น วันสงกรานต์" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ประเภท</label>
              <select className="ges-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="public_holiday">วันหยุดราชการ</option>
                <option value="company_leave">วันหยุดบริษัท</option>
                <option value="special">พิเศษ</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAdd} disabled={saving} className="ges-btn-primary">{saving ? "Saving…" : "💾 บันทึก"}</button>
            <button onClick={() => setShowAdd(false)} className="ges-btn-secondary">ยกเลิก</button>
          </div>
        </div>
      )}

      {loading ? <div className="p-10 text-center text-gray-400">กำลังโหลด…</div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MONTHS.map((mName, mi) => {
            const mHols = byMonth.get(mi) || [];
            return (
              <div key={mi} className={`ges-card overflow-hidden ${mHols.length > 0 ? "" : "opacity-40"}`}>
                <div className="px-4 py-2.5 bg-blue-900 text-white text-sm font-semibold flex justify-between items-center">
                  <span>{mName}</span>
                  <span className="text-blue-200 text-xs">{mHols.length} วัน</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {mHols.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400 text-center">ไม่มีวันหยุด</p>
                  ) : mHols.map((h) => (
                    <div key={h.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{h.name}</p>
                        <p className="text-xs text-gray-500">{format(new Date(h.date), "EEEE d MMM yyyy")}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${h.type === "public_holiday" ? "bg-red-100 text-red-700" : h.type === "company_leave" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                          {TYPE_LABELS[h.type] || h.type}
                        </span>
                      </div>
                      <button onClick={() => handleDelete(h.id, h.name)} className="text-gray-300 hover:text-red-500 text-xl leading-none ml-3">×</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
