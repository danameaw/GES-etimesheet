"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Rate {
  id: string;
  order: number;
  level: string;
  rate: number;
  isActive: boolean;
}

interface Employee {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  level: string;
}

const emptyForm = { level: "", rate: "" };

export default function StandardRatePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const canAccess = role === "pd";

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  // ── Rates state ──────────────────────────────────────────────
  const [rates, setRates]       = useState<Rate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState("");

  // ── Employee level editing ────────────────────────────────────
  const [levelSaving, setLevelSaving] = useState<string | null>(null); // empId being saved
  const [empSearch, setEmpSearch]     = useState("");
  const [levelFilter, setLevelFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, eRes] = await Promise.all([
      fetch("/api/standard-rate"),
      fetch("/api/employees"),
    ]);
    const rData = await rRes.json();
    const eData = await eRes.json();
    setRates(rData.rates || []);
    setEmployees(eData.employees || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  // ── Rate CRUD ─────────────────────────────────────────────────
  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(r: Rate) {
    setForm({ level: r.level, rate: String(r.rate) });
    setEditingId(r.id);
    setFormError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.level.trim()) { setFormError("กรุณากรอก Level"); return; }
    if (!form.rate || isNaN(Number(form.rate))) { setFormError("กรุณากรอก Standard Rate (ตัวเลข)"); return; }
    setSaving(true); setFormError("");

    const body = { level: form.level.trim(), rate: Number(form.rate) };
    const res = editingId
      ? await fetch("/api/standard-rate", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, ...body }) })
      : await fetch("/api/standard-rate", { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(data.error || "เกิดข้อผิดพลาด"); return; }
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string, level: string) {
    if (!confirm(`ลบ Level "${level}" ออกจากระบบ?`)) return;
    await fetch(`/api/standard-rate?id=${id}`, { method: "DELETE" });
    load();
  }

  // Move order up/down
  async function moveOrder(rate: Rate, dir: "up" | "down") {
    const sorted = [...rates].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((r) => r.id === rate.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swap = sorted[swapIdx];
    await Promise.all([
      fetch("/api/standard-rate", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rate.id, order: swap.order }) }),
      fetch("/api/standard-rate", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: swap.id, order: rate.order }) }),
    ]);
    load();
  }

  // ── Employee Level update ─────────────────────────────────────
  async function setEmpLevel(empId: string, level: string) {
    setLevelSaving(empId);
    await fetch(`/api/employees/${empId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    setLevelSaving(null);
    setEmployees((prev) => prev.map((e) => e.id === empId ? { ...e, level } : e));
  }

  const levelOptions = ["", ...rates.map((r) => r.level)];

  const filteredEmps = employees.filter((e) => {
    const matchSearch = !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(empSearch.toLowerCase());
    const matchLevel = levelFilter === "all" ? true :
      levelFilter === "none" ? !e.level :
      e.level === levelFilter;
    return matchSearch && matchLevel;
  });

  if (!canAccess) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Standard Rate</h1>
        <p className="text-gray-500 text-sm mt-0.5">กำหนด Level และ Standard Rate — ใช้อ้างอิงในการคิดต้นทุนโครงการ</p>
      </div>

      {/* ── Section 1: Rate Table ─────────────────────────────────── */}
      <div className="ges-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-800">💰 Standard Rate ตาม Level</h2>
            <p className="text-xs text-gray-400 mt-0.5">{rates.length} Level</p>
          </div>
          <button onClick={openAdd} className="ges-btn-primary flex items-center gap-2 text-sm">
            <span className="text-base leading-none">+</span> เพิ่ม Level
          </button>
        </div>

        {/* Add / Edit form */}
        {showForm && (
          <div className="px-5 py-4 bg-blue-50 border-b border-blue-100">
            <p className="text-sm font-semibold text-blue-800 mb-3">
              {editingId ? "✏️ แก้ไข Level" : "➕ เพิ่ม Level ใหม่"}
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Level *</label>
                <input
                  type="text"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  placeholder="เช่น Engineer I, Senior Engineer II"
                  className="ges-input w-64"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Standard Rate (บาท/ชั่วโมง) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="เช่น 500"
                  className="ges-input w-40"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="ges-btn-primary text-sm">
                  {saving ? "บันทึก…" : "บันทึก"}
                </button>
                <button onClick={() => setShowForm(false)} className="ges-btn-secondary text-sm">ยกเลิก</button>
              </div>
            </div>
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-gray-400">กำลังโหลด…</div>
        ) : rates.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">💼</p>
            <p className="font-medium">ยังไม่มี Standard Rate</p>
            <p className="text-sm mt-1">กดปุ่ม &quot;+ เพิ่ม Level&quot; เพื่อเริ่มต้น</p>
          </div>
        ) : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-center w-20">ลำดับที่</th>
                <th className="text-left">Level</th>
                <th className="text-right">Standard Rate (บาท/ชั่วโมง)</th>
                <th className="text-center w-16">จัดเรียง</th>
                <th className="text-center w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {[...rates].sort((a, b) => a.order - b.order).map((r, idx, arr) => (
                <tr key={r.id}>
                  <td className="text-center font-mono text-sm font-semibold text-blue-900">{idx + 1}</td>
                  <td>
                    <span className="inline-block bg-purple-100 text-purple-800 text-sm font-semibold px-3 py-0.5 rounded-full">
                      {r.level}
                    </span>
                  </td>
                  <td className="text-right font-semibold text-gray-800">
                    <span className="text-lg">{r.rate.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="text-xs text-gray-400 ml-1">บาท/ชม.</span>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => moveOrder(r, "up")} disabled={idx === 0}
                        className="text-gray-400 hover:text-blue-600 disabled:opacity-20 p-1 text-xs leading-none">▲</button>
                      <button onClick={() => moveOrder(r, "down")} disabled={idx === arr.length - 1}
                        className="text-gray-400 hover:text-blue-600 disabled:opacity-20 p-1 text-xs leading-none">▼</button>
                    </div>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-3">
                      <button onClick={() => openEdit(r)} className="text-xs text-blue-600 hover:underline">แก้ไข</button>
                      <button onClick={() => handleDelete(r.id, r.level)} className="text-xs text-red-500 hover:underline">ลบ</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Section 2: Employee Level Assignment ─────────────────── */}
      <div className="ges-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">👤 กำหนด Level ให้พนักงาน</h2>
          <p className="text-xs text-gray-400 mt-0.5">เลือก Level ของแต่ละพนักงานให้ตรงกับ Standard Rate ที่กำหนด</p>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3">
          <input type="text" placeholder="ค้นหาชื่อ / รหัส…" value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)} className="ges-input max-w-xs" />
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="ges-input w-auto">
            <option value="all">ทุก Level</option>
            <option value="none">ยังไม่กำหนด</option>
            {rates.map((r) => <option key={r.id} value={r.level}>{r.level}</option>)}
          </select>
          <span className="self-center text-sm text-gray-400">{filteredEmps.length} คน</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-400">กำลังโหลด…</div>
        ) : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-left">รหัสพนักงาน</th>
                <th className="text-left">ชื่อ-นามสกุล</th>
                <th className="text-left">แผนก / ตำแหน่ง</th>
                <th className="text-center w-52">Level</th>
                <th className="text-right w-36">Standard Rate</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmps.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
              ) : filteredEmps.map((emp) => {
                const matchedRate = rates.find((r) => r.level === emp.level);
                return (
                  <tr key={emp.id}>
                    <td className="font-mono text-xs font-semibold text-blue-900">{emp.employeeId}</td>
                    <td className="font-medium">{emp.name}</td>
                    <td className="text-xs text-gray-500">
                      <div>{emp.department}</div>
                      <div className="text-gray-400">{emp.position}</div>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <select
                          value={emp.level}
                          onChange={(e) => setEmpLevel(emp.id, e.target.value)}
                          disabled={levelSaving === emp.id}
                          className="ges-input w-full text-sm disabled:opacity-50"
                        >
                          {levelOptions.map((l) => (
                            <option key={l} value={l}>{l || "— ยังไม่กำหนด —"}</option>
                          ))}
                        </select>
                        {levelSaving === emp.id && (
                          <span className="text-xs text-gray-400 whitespace-nowrap">บันทึก…</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right text-sm">
                      {matchedRate ? (
                        <span className="font-semibold text-green-700">
                          {matchedRate.rate.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                          <span className="text-xs text-gray-400 ml-1">บาท/ชม.</span>
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
