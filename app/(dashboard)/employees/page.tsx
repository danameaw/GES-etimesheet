"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

interface Employee {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  level: string;
  role: string;
  isActive: boolean;
  managedProjects: { id: string; projectNumber: string; projectName: string }[];
}

interface ImportRow {
  rowNum: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  level: string;
  role: string;
  errors: string[];
}

const ROLES = [
  { value: "employee", label: "Employee",        color: "bg-gray-100 text-gray-700" },
  { value: "pd",       label: "Project Director", color: "bg-blue-100 text-blue-700" },
  { value: "ges_management", label: "GES Management", color: "bg-purple-100 text-purple-700" },
  { value: "admin",    label: "Admin",            color: "bg-red-100 text-red-700" },
  { value: "md",          label: "MD",               color: "bg-rose-100 text-rose-700" },
];

const DEPARTMENTS = [
  "Management", "Project Management", "Engineering", "Construction",
  "Project Control", "Grid Connection", "BOI", "Admin", "Procurement", "HSE",
];

const emptyForm = { employeeId: "", name: "", department: "", position: "", level: "", role: "employee", isActive: true };

export default function EmployeesPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  // Add/Edit modal
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Import modal
  const [importModal, setImportModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      level: emp.level || "",
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

  // ─── Excel Import ─────────────────────────────────────────────────────────

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();

    // Data sheet
    const ws = XLSX.utils.aoa_to_sheet([
      ["employeeId", "name", "department", "position", "level", "role"],
      ["GES001", "Somchai Prasertphon", "Engineering", "Process Engineer", "Engineer I", "employee"],
    ]);
    ws["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 26 }, { wch: 24 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Employees");

    // Instructions sheet
    const inst = XLSX.utils.aoa_to_sheet([
      ["Column", "Required", "Valid Values / Notes"],
      ["employeeId", "Yes", "Unique code e.g. GES001"],
      ["name", "Yes", "Full name in English"],
      ["department", "Yes", DEPARTMENTS.join(", ")],
      ["position", "Yes", "Job title e.g. Process Engineer"],
      ["level", "No", "e.g. Engineer I, Senior Engineer II"],
      ["role", "No", "employee | pm | pd | admin  (default: employee)"],
    ]);
    inst["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, inst, "Instructions");

    XLSX.writeFile(wb, "employee_import_template.xlsx");
  }

  function parseExcel(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const existingIds = new Set(employees.map((emp) => emp.employeeId));

      const rows: ImportRow[] = raw.map((r, i) => {
        const empId = String(r.employeeId || "").trim().toUpperCase();
        const errs: string[] = [];
        if (!empId) errs.push("employeeId ว่าง");
        else if (existingIds.has(empId)) errs.push("Employee ID ซ้ำในระบบ");
        if (!r.name) errs.push("name ว่าง");
        if (!r.department) errs.push("department ว่าง");
        else if (!DEPARTMENTS.includes(r.department)) errs.push(`department "${r.department}" ไม่ถูกต้อง`);
        if (!r.position) errs.push("position ว่าง");
        const role = String(r.role || "").toLowerCase();
        if (role && !["employee", "pd", "ges_management", "admin", "md"].includes(role)) errs.push(`role "${r.role}" ไม่ถูกต้อง`);
        return {
          rowNum: i + 2,
          employeeId: empId,
          name: String(r.name || ""),
          department: String(r.department || ""),
          position: String(r.position || ""),
          level: String(r.level || ""),
          role: role || "employee",
          errors: errs,
        };
      });
      setImportRows(rows);
      setImportResult(null);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseExcel(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseExcel(file);
    e.target.value = "";
  }

  async function handleImport() {
    const validRows = importRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;
    setImporting(true);
    const res = await fetch("/api/employees/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: validRows }),
    });
    const data = await res.json();
    setImporting(false);
    setImportResult(data);
    load();
  }

  function closeImport() {
    setImportModal(false);
    setImportRows([]);
    setImportResult(null);
  }

  // ─────────────────────────────────────────────────────────────────────────

  const departments = ["all", ...Array.from(new Set(employees.map((e) => e.department))).sort()];

  const filtered = employees.filter((e) => {
    if (!showInactive && !e.isActive) return false;
    if (filterDept !== "all" && e.department !== filterDept) return false;
    if (filterRole !== "all" && e.role !== filterRole) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) &&
        !e.employeeId.toLowerCase().includes(search.toLowerCase()) &&
        !e.position.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const roleBadge = (role: string) => {
    const r = ROLES.find((x) => x.value === role);
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r?.color ?? "bg-gray-100"}`}>{r?.label ?? role}</span>;
  };

  if (!isAdmin) return null;

  const validCount = importRows.filter((r) => r.errors.length === 0).length;
  const errorCount = importRows.filter((r) => r.errors.length > 0).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">จัดการพนักงาน</h1>
          <p className="text-gray-500 text-sm">เพิ่ม / แก้ไข / ปิดใช้งานบัญชีพนักงาน</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setImportModal(true); setImportRows([]); setImportResult(null); }}
            className="ges-btn-secondary flex items-center gap-2"
          >
            <span>📥</span> Import Excel
          </button>
          <button onClick={openAdd} className="ges-btn-primary flex items-center gap-2">
            <span className="text-lg leading-none">+</span> เพิ่มพนักงาน
          </button>
        </div>
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
          placeholder="ค้นหาชื่อ / รหัสพนักงาน / ตำแหน่ง..."
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
                <th className="text-left">Level</th>
                <th>Role</th>
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
                  <td className="text-xs">
                    {emp.level
                      ? <span className="bg-purple-100 text-purple-800 font-medium px-2 py-0.5 rounded-full">{emp.level}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-center">{roleBadge(emp.role)}</td>
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

      {/* Add/Edit Modal */}
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

      {/* Import Excel Modal */}
      {importModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Import พนักงานจาก Excel</h2>
              <button onClick={closeImport} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {/* Drop zone */}
              {!importResult && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
                  }`}
                >
                  <p className="text-4xl mb-2">📂</p>
                  <p className="text-gray-600 font-medium">Drag & drop ไฟล์ Excel ที่นี่</p>
                  <p className="text-gray-400 text-sm mt-1">หรือคลิกเพื่อเลือกไฟล์ (.xlsx, .xls)</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              )}

              <div className="flex justify-between items-center">
                <button onClick={downloadTemplate} className="ges-btn-secondary text-sm flex items-center gap-2">
                  <span>⬇️</span> Download Template
                </button>
                {importRows.length > 0 && !importResult && (
                  <span className="text-sm text-gray-500">
                    พบ {importRows.length} แถว —{" "}
                    <span className="text-green-600 font-medium">{validCount} valid</span>
                    {errorCount > 0 && <>, <span className="text-red-600 font-medium">{errorCount} มี error</span></>}
                  </span>
                )}
              </div>

              {/* Import result */}
              {importResult && (
                <div className={`rounded-xl p-4 ${importResult.errors.length === 0 ? "bg-green-50 border border-green-200" : "bg-yellow-50 border border-yellow-200"}`}>
                  <p className="font-semibold text-gray-800">นำเข้าสำเร็จ {importResult.created} รายการ</p>
                  {importResult.errors.length > 0 && (
                    <ul className="mt-2 text-sm text-red-700 space-y-1 list-disc list-inside">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* Preview table */}
              {importRows.length > 0 && !importResult && (
                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="ges-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-center w-10">แถว</th>
                        <th>Employee ID</th>
                        <th>ชื่อ</th>
                        <th>แผนก</th>
                        <th>ตำแหน่ง</th>
                        <th>Level</th>
                        <th>Role</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((row) => (
                        <tr key={row.rowNum} className={row.errors.length > 0 ? "bg-red-50" : "bg-green-50"}>
                          <td className="text-center text-gray-400">{row.rowNum}</td>
                          <td className="font-mono font-semibold">{row.employeeId || "—"}</td>
                          <td>{row.name || "—"}</td>
                          <td>{row.department || "—"}</td>
                          <td>{row.position || "—"}</td>
                          <td>{row.level || "—"}</td>
                          <td>{row.role || "—"}</td>
                          <td>
                            {row.errors.length === 0 ? (
                              <span className="text-green-700 font-medium">✓ OK</span>
                            ) : (
                              <span className="text-red-600" title={row.errors.join(", ")}>
                                ✗ {row.errors.join(", ")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button onClick={closeImport} className="ges-btn-secondary">ปิด</button>
              {importRows.length > 0 && !importResult && (
                <button
                  onClick={handleImport}
                  disabled={importing || validCount === 0}
                  className="ges-btn-primary"
                >
                  {importing ? "กำลัง Import…" : `Import ${validCount} รายการ`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
