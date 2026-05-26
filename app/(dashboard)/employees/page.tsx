"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Employee {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  role: string;
  isActive: boolean;
  managedProjects: { id: string; projectNumber: string; projectName: string }[];
}

const ROLES = [
  { value: "employee", label: "Employee",        color: "bg-gray-100 text-gray-700" },
  { value: "pm",       label: "Project Manager", color: "bg-blue-100 text-blue-700" },
  { value: "pd",       label: "Project Director",color: "bg-purple-100 text-purple-700" },
  { value: "admin",    label: "Admin",            color: "bg-red-100 text-red-700" },
];

const DEPARTMENTS = [
  "Management", "Project Management", "Process Engineering", "Mechanical Engineering",
  "Civil & Structural", "Electrical Engineering", "Instrumentation", "Piping Engineering",
  "Safety & Environment", "Procurement", "Document Control", "Finance & Accounting", "HR & Admin",
];

const emptyForm = { employeeId: "", name: "", department: "", position: "", role: "employee", isActive: true };

export default function EmployeesPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const isAdmin = (session?.user as any)?.role === "admin";
  useEffect(() => { if (session && !isAdmin) router.push("/timesheet"); }, [session, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employees");
    const data = await res.json();
    setEmployees(data.employees || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(emptyForm);
    setFormError("");
    setEditingId(null);
    setModal("add");
  }

  function openEdit(emp: Employee) {
    setForm({
      employeeId: emp.employeeId,
      name: emp.name,
      department: emp.department,
      position: emp.position,
      role: emp.role,
      isActive: emp.isActive,
    });
    setFormError("");
    setEditingId(emp.id);
    setModal("edit");
  }

  async function handleSave() {
    if (!form.employeeId || !form.name || !form.department || !form.position) {
      setFormError("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      return;
    }
    setSaving(true);
    setFormError("");

    const url = modal === "add" ? "/api/employees" : `/api/employees/${editingId}`;
    const method = modal === "add" ? "POST" : "PUT";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setFormError(data.error || "เกิดข้อผิดพลาด");
      return;
    }
    setModal(null);
    load();
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`ปิดการใช้งานบัญชี "${name}"?`)) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
    load();
  }

  async function handleReactivate(id: string) {
    await fetch(`/api/employees/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    load();
  }

  const departments = ["all", ...Array.from(new Set(employees.map((e) => e.department))).sort()];

  const filtered = employees.filter((e) => {
    if (!showInactive && !e.isActive) return false;
    if (filterDept !== "all" && e.department !== filterDept) return false;
    if (filterRole !== "all" && e.role !== filterRole) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) &&
        !e.employeeId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const roleBadge = (role: string) => {
    const r = ROLES.find((x) => x.value === role);
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r?.color ?? "bg-gray-100"}`}>{r?.label ?? role}</span>;
  };

  if (!isAdmin) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">จัดการพนักงาน</h1>
          <p className="text-gray-500 text-sm">เพิ่ม / แก้ไข / ปิดใช้งานบัญชีพนักงาน</p>
        </div>
        <button onClick={openAdd} className="ges-btn-primary flex items-center gap-2">
          <span className="text-lg leading-none">+</span> เพิ่มพนักงาน
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {ROLES.map((r) => {
          const count = employees.filter((e) => e.isActive && e.role === r.value).length;
          return (
            <div key={r.value} className="ges-card p-4">
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-sm text-gray-500 mt-0.5">{r.label}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อหรือรหัสพนักงาน..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ges-input max-w-xs"
        />
        <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="ges-input w-auto">
          {departments.map((d) => <option key={d} value={d}>{d === "all" ? "ทุกแผนก" : d}</option>)}
        </select>
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="ges-input w-auto">
          <option value="all">ทุก Role</option>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
          แสดงบัญชีที่ปิดแล้ว
        </label>
        <span className="ml-auto text-sm text-gray-400 self-center">{filtered.length} คน</span>
      </div>

      {/* Table */}
      <div className="ges-card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400">กำลังโหลด…</div>
        ) : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-left">รหัสพนักงาน</th>
                <th className="text-left">ชื่อ-นามสกุล</th>
                <th className="text-left">แผนก</th>
                <th className="text-left">ตำแหน่ง</th>
                <th>Role</th>
                <th>โครงการที่ดูแล</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
              ) : filtered.map((emp) => (
                <tr key={emp.id} className={!emp.isActive ? "opacity-50" : ""}>
                  <td className="font-mono text-xs font-semibold text-blue-900">{emp.employeeId}</td>
                  <td className="font-medium">{emp.name}</td>
                  <td className="text-xs text-gray-600">{emp.department}</td>
                  <td className="text-xs text-gray-600">{emp.position}</td>
                  <td className="text-center">{roleBadge(emp.role)}</td>
                  <td className="text-center text-xs text-gray-500">
                    {emp.managedProjects.length > 0 ? (
                      <span className="text-blue-700 font-medium">{emp.managedProjects.length} โครงการ</span>
                    ) : "-"}
                  </td>
                  <td className="text-center">
                    {emp.isActive
                      ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                      : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(emp)} className="text-blue-600 hover:text-blue-800 text-xs hover:underline">
                        แก้ไข
                      </button>
                      {emp.isActive ? (
                        <button onClick={() => handleDeactivate(emp.id, emp.name)} className="text-red-500 hover:text-red-700 text-xs hover:underline">
                          ปิด
                        </button>
                      ) : (
                        <button onClick={() => handleReactivate(emp.id)} className="text-green-600 hover:text-green-800 text-xs hover:underline">
                          เปิด
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {modal === "add" ? "เพิ่มพนักงานใหม่" : "แก้ไขข้อมูลพนักงาน"}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">รหัสพนักงาน *</label>
                  <input
                    type="text"
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value.toUpperCase() })}
                    placeholder="เช่น GES021"
                    className="ges-input font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="ges-input">
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ชื่อภาษาอังกฤษ เช่น Somchai Prasertphon"
                  className="ges-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">แผนก *</label>
                  <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="ges-input">
                    <option value="">-- เลือกแผนก --</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ตำแหน่ง *</label>
                  <input
                    type="text"
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                    placeholder="เช่น Process Engineer"
                    className="ges-input"
                  />
                </div>
              </div>
              {modal === "edit" && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="isActive" className="text-sm text-gray-700">บัญชีใช้งานได้ (Active)</label>
                </div>
              )}

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
                  {formError}
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="ges-btn-secondary">ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} className="ges-btn-primary">
                {saving ? "กำลังบันทึก…" : modal === "add" ? "เพิ่มพนักงาน" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
