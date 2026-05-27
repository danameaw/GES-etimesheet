"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MONTH_NAMES    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_NAMES_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

interface Project {
  id: string; projectNumber: string; projectName: string;
  startDate: string | null; endDate: string | null;
  manager: { id: string; name: string; employeeId: string } | null;
}
interface PlanRow        { id: string; projectId: string; department: string; year: number; month: number; plannedHrs: number; planStatus: string; }
interface ActualRow      { department: string; year: number; month: number; actualHrs: number; }
interface Employee       { id: string; employeeId: string; name: string; department: string; position: string; }
interface EmpPlanRow     { id: string; projectId: string; employeeId: string; year: number; month: number; plannedHrs: number; employee: Employee; }
interface EmpActualRow   { employeeId: string; year: number; month: number; actualHrs: number; }

function monthsBetween(start: Date, end: Date) {
  const result: { year: number; month: number }[] = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  while (cur < endUTC) {
    result.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1 });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return result;
}

export default function ResourcePlanPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const canAccess = ["pm", "admin"].includes(role);

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  // ── Dept view state ──
  const [projects, setProjects]         = useState<Project[]>([]);
  const [departments, setDepartments]   = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [plans, setPlans]               = useState<PlanRow[]>([]);
  const [actuals, setActuals]           = useState<ActualRow[]>([]);
  const [saving, setSaving]             = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);

  // ── Employee view state ──
  const [viewMode, setViewMode]                       = useState<"dept" | "employee">("dept");
  const [empPlans, setEmpPlans]                       = useState<EmpPlanRow[]>([]);
  const [empActuals, setEmpActuals]                   = useState<EmpActualRow[]>([]);
  const [allEmployees, setAllEmployees]               = useState<Employee[]>([]);
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<string[]>([]);
  const [loadingEmp, setLoadingEmp]                   = useState(false);
  const [empSearch, setEmpSearch]                     = useState("");
  const [showEmpDropdown, setShowEmpDropdown]         = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Load department plan ──
  const load = useCallback(async (projectId?: string) => {
    setLoading(true);
    const url = projectId ? `/api/resource-plan-monthly?projectId=${projectId}` : `/api/resource-plan-monthly`;
    const res = await fetch(url);
    const d = await res.json();
    setProjects(d.projects || []);
    setDepartments(d.departments || []);
    setPlans(d.plans || []);
    setActuals(d.actuals || []);
    setLoading(false);
  }, []);

  // ── Load employee plan ──
  const loadEmp = useCallback(async (projectId: string) => {
    setLoadingEmp(true);
    const res = await fetch(`/api/resource-plan-employee-monthly?projectId=${projectId}`);
    const d = await res.json();
    setEmpPlans(d.plans || []);
    setEmpActuals(d.actuals || []);
    setAllEmployees(d.allEmployees || []);
    setAssignedEmployeeIds(d.assignedEmployeeIds || []);
    setLoadingEmp(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);

  useEffect(() => {
    if (selectedProject) {
      load(selectedProject);
      if (viewMode === "employee") loadEmp(selectedProject);
    }
  }, [selectedProject, load, loadEmp, viewMode]);

  const selectedProj = projects.find((p) => p.id === selectedProject);
  const months = selectedProj
    ? (() => {
        const start = selectedProj.startDate ? new Date(selectedProj.startDate) : new Date();
        const end   = selectedProj.endDate   ? new Date(selectedProj.endDate)   : new Date(start.getUTCFullYear() + 1, start.getUTCMonth(), 1);
        return monthsBetween(start, end);
      })()
    : [];

  const planStatus = plans.length > 0 ? plans[0].planStatus : "draft";

  // ── Dept helpers ──
  function getPlanned(dept: string, year: number, month: number) {
    return plans.find((p) => p.department === dept && p.year === year && p.month === month)?.plannedHrs || 0;
  }
  function getActual(dept: string, year: number, month: number) {
    return actuals.find((a) => a.department === dept && a.year === year && a.month === month)?.actualHrs || 0;
  }
  async function savePlan(dept: string, year: number, month: number, hrs: number) {
    if (!selectedProject) return;
    const key = `${dept}|${year}|${month}`;
    setSaving(key);
    await fetch("/api/resource-plan-monthly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, department: dept, year, month, plannedHrs: hrs }),
    });
    setSaving(null);
    load(selectedProject);
  }

  // ── Employee helpers ──
  function getEmpPlanned(empId: string, year: number, month: number) {
    return empPlans.find((p) => p.employeeId === empId && p.year === year && p.month === month)?.plannedHrs || 0;
  }
  function getEmpActual(empId: string, year: number, month: number) {
    return empActuals.find((a) => a.employeeId === empId && a.year === year && a.month === month)?.actualHrs || 0;
  }
  async function saveEmpPlan(empId: string, year: number, month: number, hrs: number) {
    if (!selectedProject) return;
    const key = `emp|${empId}|${year}|${month}`;
    setSaving(key);
    await fetch("/api/resource-plan-employee-monthly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, employeeId: empId, year, month, plannedHrs: hrs }),
    });
    setSaving(null);
    loadEmp(selectedProject);
  }
  async function addEmployee(emp: Employee) {
    if (!selectedProject || assignedEmployeeIds.includes(emp.id)) return;
    setSaving("addEmp");
    // Create a zero-entry for the first month to "register" the employee
    await fetch("/api/resource-plan-employee-monthly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, employeeId: emp.id, year: months[0]?.year || new Date().getFullYear(), month: months[0]?.month || 1, plannedHrs: 0 }),
    });
    setSaving(null);
    setEmpSearch("");
    setShowEmpDropdown(false);
    loadEmp(selectedProject);
  }
  async function removeEmployee(empId: string) {
    if (!selectedProject) return;
    if (!confirm("ลบพนักงานนี้ออกจากแผนทั้งหมด?")) return;
    await fetch(`/api/resource-plan-employee-monthly?projectId=${selectedProject}&employeeId=${empId}`, { method: "DELETE" });
    loadEmp(selectedProject);
  }

  async function submitPlan() {
    if (!selectedProject) return;
    setSaving("submit");
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", projectId: selectedProject }),
    });
    setSaving(null);
    load(selectedProject);
  }

  // ── Dept totals ──
  const deptTotals        = departments.map((d) => months.reduce((s, m) => s + getPlanned(d, m.year, m.month), 0));
  const monthTotals       = months.map((m) => departments.reduce((s, d) => s + getPlanned(d, m.year, m.month), 0));
  const grandTotal        = deptTotals.reduce((s, v) => s + v, 0);
  const deptActualTotals  = departments.map((d) => months.reduce((s, m) => s + getActual(d, m.year, m.month), 0));
  const monthActualTotals = months.map((m) => departments.reduce((s, d) => s + getActual(d, m.year, m.month), 0));
  const grandActualTotal  = deptActualTotals.reduce((s, v) => s + v, 0);

  // ── Employee totals ──
  const assignedEmps = allEmployees.filter((e) => assignedEmployeeIds.includes(e.id));
  const empRowTotals = assignedEmps.map((e) => months.reduce((s, m) => s + getEmpPlanned(e.id, m.year, m.month), 0));
  const empMonthTotals = months.map((m) => assignedEmps.reduce((s, e) => s + getEmpPlanned(e.id, m.year, m.month), 0));
  const empGrandTotal = empRowTotals.reduce((s, v) => s + v, 0);
  const empActualRowTotals = assignedEmps.map((e) => months.reduce((s, m) => s + getEmpActual(e.id, m.year, m.month), 0));
  const empActualMonthTotals = months.map((m) => assignedEmps.reduce((s, e) => s + getEmpActual(e.id, m.year, m.month), 0));
  const empGrandActualTotal = empActualRowTotals.reduce((s, v) => s + v, 0);

  // Employee search dropdown
  const filteredEmps = allEmployees.filter((e) =>
    !assignedEmployeeIds.includes(e.id) &&
    (e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
     e.employeeId.toLowerCase().includes(empSearch.toLowerCase()) ||
     e.department.toLowerCase().includes(empSearch.toLowerCase()))
  ).slice(0, 10);

  if (!canAccess) return null;

  const displayedTotal  = viewMode === "dept" ? grandTotal       : empGrandTotal;
  const displayedActual = viewMode === "dept" ? grandActualTotal : empGrandActualTotal;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource Plan</h1>
          <p className="text-gray-500 text-sm">วางแผนทรัพยากรระยะยาว รายเดือน</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Project Sidebar */}
        <div className="lg:col-span-1">
          <div className="ges-card p-4">
            <h2 className="font-semibold text-gray-800 text-sm mb-3">โครงการของฉัน ({projects.length})</h2>
            {projects.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-xs text-gray-400">ยังไม่มีโครงการ</p>
                <p className="text-xs text-gray-400 mt-1">ให้ Admin assign โครงการให้ก่อน</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[540px] overflow-y-auto">
                {projects.map((p) => (
                  <button key={p.id} onClick={() => setSelectedProject(p.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${selectedProject === p.id ? "bg-blue-900 text-white" : "bg-gray-50 hover:bg-gray-100 text-gray-800"}`}>
                    <p className={`font-mono text-xs font-semibold ${selectedProject === p.id ? "text-blue-200" : "text-blue-600"}`}>{p.projectNumber}</p>
                    <p className="text-xs mt-0.5 leading-tight line-clamp-2">{p.projectName}</p>
                    {p.startDate && p.endDate && (
                      <p className={`text-xs mt-0.5 ${selectedProject === p.id ? "text-blue-300" : "text-gray-400"}`}>
                        {new Date(p.startDate).getUTCFullYear()} – {new Date(p.endDate).getUTCFullYear()}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Panel */}
        <div className="lg:col-span-3 space-y-5">
          {!selectedProject ? (
            <div className="ges-card p-12 text-center text-gray-400">
              <p className="text-3xl mb-2">👈</p>
              <p>เลือกโครงการจากด้านซ้าย</p>
            </div>
          ) : !selectedProj?.startDate || !selectedProj?.endDate ? (
            <div className="ges-card p-8 text-center">
              <p className="text-3xl mb-3">📅</p>
              <p className="text-gray-700 font-semibold">ยังไม่ได้ตั้งวันเริ่มต้น/สิ้นสุดโครงการ</p>
              <p className="text-gray-500 text-sm mt-1">ให้ Admin ตั้งค่าวันที่โครงการในหน้า Manage → โครงการ</p>
            </div>
          ) : (
            <>
              {/* Project Header */}
              <div className="ges-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-blue-600 font-semibold">{selectedProj.projectNumber}</span>
                      <PlanStatusBadge status={planStatus} />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mt-0.5">{selectedProj.projectName}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {selectedProj.startDate ? new Date(selectedProj.startDate).toLocaleDateString("th-TH") : "–"}
                      {" → "}
                      {selectedProj.endDate   ? new Date(selectedProj.endDate).toLocaleDateString("th-TH") : "–"}
                      {" · "}{months.length} เดือน
                    </p>
                  </div>
                  <div className="flex gap-3 items-center flex-wrap">
                    <div className="text-center">
                      <p className="text-xl font-bold text-blue-900">{displayedTotal}h</p>
                      <p className="text-xs text-gray-500">วางแผนรวม</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="text-center">
                      <p className={`text-xl font-bold ${displayedActual > 0 ? "text-green-600" : "text-gray-400"}`}>{displayedActual}h</p>
                      <p className="text-xs text-gray-500">จริงรวม</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="flex gap-2">
                      <a href={`/api/resource-plan-monthly/template?projectId=${selectedProject}`}
                        className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
                        📥 Excel Template
                      </a>
                      {planStatus !== "approved" && (
                        <button onClick={submitPlan} disabled={saving === "submit" || grandTotal === 0}
                          className="ges-btn-primary text-xs px-3 py-1.5">
                          {saving === "submit" ? "กำลังส่ง…" : planStatus === "submitted" ? "✓ ส่งแล้ว" : "📤 Submit Plan"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* View Toggle */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                <button onClick={() => setViewMode("dept")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "dept" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  🏢 แยกตามแผนก
                </button>
                <button onClick={() => { setViewMode("employee"); if (selectedProject) loadEmp(selectedProject); }}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "employee" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  👤 แยกรายบุคคล
                </button>
              </div>

              {/* ── DEPARTMENT VIEW ── */}
              {viewMode === "dept" && (
                <div className="ges-card overflow-x-auto">
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-800 text-sm">ตารางแผน (ชั่วโมง/เดือน/แผนก)</h3>
                    <p className="text-xs text-gray-400">
                      {months.length > 0 ? `${MONTH_NAMES[months[0].month-1]} ${months[0].year} – ${MONTH_NAMES[months[months.length-1].month-1]} ${months[months.length-1].year}` : ""}
                    </p>
                  </div>
                  {loading ? <div className="p-8 text-center text-gray-400 animate-pulse">กำลังโหลด…</div> : (
                    <table className="text-sm w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-4 py-2.5 font-semibold text-gray-700 min-w-[160px] sticky left-0 bg-gray-50 border-r border-gray-200 z-10">แผนก</th>
                          {months.map((m) => (
                            <th key={`${m.year}-${m.month}`} className="px-2 py-2.5 font-medium text-center min-w-[80px] text-xs text-gray-600">
                              <div>{MONTH_NAMES_TH[m.month-1]}</div>
                              <div className="text-gray-400">{m.year}</div>
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-center min-w-[70px] font-semibold text-gray-700 border-l border-gray-200">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map((dept, di) => (
                          <tr key={dept} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white border-r border-gray-200 z-10">{dept}</td>
                            {months.map((m) => {
                              const key    = `${dept}|${m.year}|${m.month}`;
                              const plan   = getPlanned(dept, m.year, m.month);
                              const actual = getActual(dept, m.year, m.month);
                              const isLocked = planStatus === "approved";
                              return (
                                <td key={`${m.year}-${m.month}`} className="px-1 py-1 text-center">
                                  <div className="relative">
                                    <input type="number" min="0" step="8"
                                      defaultValue={plan}
                                      key={`${dept}-${m.year}-${m.month}-${plan}`}
                                      disabled={isLocked}
                                      onBlur={(e) => { const v = Number(e.target.value); if (v !== plan) savePlan(dept, m.year, m.month, v); }}
                                      className={`w-16 text-center border rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                        isLocked ? "bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed" :
                                        saving === key ? "border-blue-300 bg-blue-50" :
                                        plan > 0 ? "border-blue-200 text-blue-900 font-semibold" : "border-gray-200 text-gray-400"
                                      }`}
                                    />
                                    {actual > 0 && (
                                      <div className={`text-xs mt-0.5 ${actual > plan && plan > 0 ? "text-red-500" : "text-green-600"}`}>{actual}h จริง</div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-center border-l border-gray-200">
                              <span className={`font-semibold text-sm ${deptTotals[di] > 0 ? "text-blue-900" : "text-gray-300"}`}>{deptTotals[di] || "–"}</span>
                              {deptActualTotals[di] > 0 && <div className="text-xs text-green-600">{deptActualTotals[di]}</div>}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-blue-50">
                          <td className="px-4 py-2.5 font-bold text-gray-800 sticky left-0 bg-blue-50 border-r border-gray-200 z-10">รวม / เดือน</td>
                          {months.map((m, mi) => (
                            <td key={`${m.year}-${m.month}`} className="px-1 py-2.5 text-center">
                              <span className={`font-bold text-sm ${monthTotals[mi] > 0 ? "text-blue-900" : "text-gray-300"}`}>{monthTotals[mi] || "–"}</span>
                              {monthActualTotals[mi] > 0 && <div className="text-xs text-green-600">{monthActualTotals[mi]}</div>}
                            </td>
                          ))}
                          <td className="px-3 py-2.5 text-center border-l border-gray-200">
                            <span className="font-bold text-blue-900 text-sm">{grandTotal || "–"}</span>
                            {grandActualTotal > 0 && <div className="text-xs text-green-600">{grandActualTotal}</div>}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── EMPLOYEE VIEW ── */}
              {viewMode === "employee" && (
                <div className="ges-card overflow-x-auto">
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center flex-wrap gap-3">
                    <h3 className="font-semibold text-gray-800 text-sm">ตารางแผน (ชั่วโมง/เดือน/คน)</h3>
                    {/* Add Employee */}
                    <div className="relative" ref={searchRef as any}>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="🔍 ค้นหาพนักงาน (ชื่อ / รหัส / แผนก)"
                            value={empSearch}
                            onChange={(e) => { setEmpSearch(e.target.value); setShowEmpDropdown(true); }}
                            onFocus={() => setShowEmpDropdown(true)}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          {showEmpDropdown && empSearch.length > 0 && filteredEmps.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
                              {filteredEmps.map((emp) => (
                                <button key={emp.id} onMouseDown={() => addEmployee(emp)}
                                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                                      <p className="text-xs text-gray-500">{emp.employeeId} · {emp.department}</p>
                                    </div>
                                    <span className="text-xs text-blue-600 font-medium">+ เพิ่ม</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {showEmpDropdown && empSearch.length > 0 && filteredEmps.length === 0 && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-3 text-xs text-gray-400 text-center">
                              ไม่พบพนักงาน
                            </div>
                          )}
                        </div>
                        {empSearch && (
                          <button onClick={() => { setEmpSearch(""); setShowEmpDropdown(false); }}
                            className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {loadingEmp ? <div className="p-8 text-center text-gray-400 animate-pulse">กำลังโหลด…</div> : (
                    <>
                      {assignedEmps.length === 0 ? (
                        <div className="p-10 text-center text-gray-400">
                          <p className="text-3xl mb-2">👤</p>
                          <p className="text-sm">ยังไม่มีพนักงานในแผน</p>
                          <p className="text-xs mt-1">ค้นหาและเพิ่มพนักงานด้านบน</p>
                        </div>
                      ) : (
                        <table className="text-sm w-full">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="text-left px-4 py-2.5 font-semibold text-gray-700 min-w-[200px] sticky left-0 bg-gray-50 border-r border-gray-200 z-10">พนักงาน</th>
                              {months.map((m) => (
                                <th key={`${m.year}-${m.month}`} className="px-2 py-2.5 font-medium text-center min-w-[80px] text-xs text-gray-600">
                                  <div>{MONTH_NAMES_TH[m.month-1]}</div>
                                  <div className="text-gray-400">{m.year}</div>
                                </th>
                              ))}
                              <th className="px-3 py-2.5 text-center min-w-[70px] font-semibold text-gray-700 border-l border-gray-200">รวม</th>
                              <th className="px-2 py-2.5 w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {assignedEmps.map((emp, ei) => (
                              <tr key={emp.id} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="px-4 py-2 sticky left-0 bg-white border-r border-gray-200 z-10">
                                  <p className="font-medium text-gray-900 text-sm">{emp.name}</p>
                                  <p className="text-xs text-gray-400">{emp.employeeId} · {emp.department}</p>
                                </td>
                                {months.map((m) => {
                                  const key    = `emp|${emp.id}|${m.year}|${m.month}`;
                                  const plan   = getEmpPlanned(emp.id, m.year, m.month);
                                  const actual = getEmpActual(emp.id, m.year, m.month);
                                  return (
                                    <td key={`${m.year}-${m.month}`} className="px-1 py-1 text-center">
                                      <div className="relative">
                                        <input type="number" min="0" step="8"
                                          defaultValue={plan}
                                          key={`${emp.id}-${m.year}-${m.month}-${plan}`}
                                          onBlur={(e) => { const v = Number(e.target.value); if (v !== plan) saveEmpPlan(emp.id, m.year, m.month, v); }}
                                          className={`w-16 text-center border rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                            saving === key ? "border-blue-300 bg-blue-50" :
                                            plan > 0 ? "border-blue-200 text-blue-900 font-semibold" : "border-gray-200 text-gray-400"
                                          }`}
                                        />
                                        {actual > 0 && (
                                          <div className={`text-xs mt-0.5 ${actual > plan && plan > 0 ? "text-red-500" : "text-green-600"}`}>{actual}h จริง</div>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-center border-l border-gray-200">
                                  <span className={`font-semibold text-sm ${empRowTotals[ei] > 0 ? "text-blue-900" : "text-gray-300"}`}>{empRowTotals[ei] || "–"}</span>
                                  {empActualRowTotals[ei] > 0 && <div className="text-xs text-green-600">{empActualRowTotals[ei]}</div>}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <button onClick={() => removeEmployee(emp.id)}
                                    className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none" title="ลบพนักงานออกจากแผน">
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {/* Month totals */}
                            <tr className="border-t-2 border-gray-300 bg-blue-50">
                              <td className="px-4 py-2.5 font-bold text-gray-800 sticky left-0 bg-blue-50 border-r border-gray-200 z-10">รวม / เดือน</td>
                              {months.map((m, mi) => (
                                <td key={`${m.year}-${m.month}`} className="px-1 py-2.5 text-center">
                                  <span className={`font-bold text-sm ${empMonthTotals[mi] > 0 ? "text-blue-900" : "text-gray-300"}`}>{empMonthTotals[mi] || "–"}</span>
                                  {empActualMonthTotals[mi] > 0 && <div className="text-xs text-green-600">{empActualMonthTotals[mi]}</div>}
                                </td>
                              ))}
                              <td className="px-3 py-2.5 text-center border-l border-gray-200">
                                <span className="font-bold text-blue-900 text-sm">{empGrandTotal || "–"}</span>
                                {empGrandActualTotal > 0 && <div className="text-xs text-green-600">{empGrandActualTotal}</div>}
                              </td>
                              <td />
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="text-blue-900 font-semibold">●</span> ตัวเลขในตาราง = ชั่วโมงที่วางแผน</span>
                <span className="flex items-center gap-1"><span className="text-green-600 font-semibold">●</span> ตัวเลขสีเขียว = ชั่วโมงที่ลงจริงจาก Timesheet</span>
                <span className="flex items-center gap-1"><span className="text-red-500 font-semibold">●</span> สีแดง = เกินแผน</span>
              </div>

              {/* Dept Summary (dept view only) */}
              {viewMode === "dept" && grandTotal > 0 && (
                <div className="ges-card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-3">สรุปแผนกทั้งหมด</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {departments.filter((_, i) => deptTotals[i] > 0).map((dept, i) => {
                      const plan   = deptTotals[i];
                      const actual = deptActualTotals[i];
                      const pct    = plan > 0 ? Math.round((actual / plan) * 100) : 0;
                      return (
                        <div key={dept} className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-700 truncate">{dept}</p>
                          <p className="text-lg font-bold text-blue-900 mt-1">{plan}h</p>
                          {actual > 0 && (
                            <>
                              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-green-500" : "bg-amber-400"}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">จริง {actual}h ({pct}%)</p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Employee Summary (emp view only) */}
              {viewMode === "employee" && empGrandTotal > 0 && (
                <div className="ges-card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-3">สรุปรายบุคคล</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {assignedEmps.filter((_, i) => empRowTotals[i] > 0).map((emp, i) => {
                      const plan   = empRowTotals[i];
                      const actual = empActualRowTotals[i];
                      const pct    = plan > 0 ? Math.round((actual / plan) * 100) : 0;
                      return (
                        <div key={emp.id} className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-900 truncate">{emp.name}</p>
                          <p className="text-xs text-gray-400 truncate">{emp.department}</p>
                          <p className="text-lg font-bold text-blue-900 mt-1">{plan}h</p>
                          {actual > 0 && (
                            <>
                              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-green-500" : "bg-amber-400"}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">จริง {actual}h ({pct}%)</p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:     { label: "Draft",             cls: "bg-gray-100 text-gray-600" },
    submitted: { label: "📤 รอ Approve",      cls: "bg-amber-100 text-amber-800" },
    approved:  { label: "✓ Approved by PD",  cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
