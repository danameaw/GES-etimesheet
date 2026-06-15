"use client";
import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MONTH_NAMES_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const MONTH_NAMES    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Project {
  id: string; projectNumber: string; projectName: string;
  startDate: string | null; endDate: string | null;
  planStatus: string;
  manager: { id: string; name: string; employeeId: string } | null;
  pd:      { id: string; name: string; employeeId: string } | null;
}
interface PlanRow      { id: string; projectId: string; department: string; year: number; month: number; plannedHrs: number; planStatus: string; }
interface ActualRow    { department: string; year: number; month: number; actualHrs: number; }
interface Employee     { id: string; employeeId: string; name: string; department: string; position: string; }
interface EmpPlanRow   { id: string; projectId: string; employeeId: string; year: number; month: number; plannedHrs: number; employee: Employee; }
interface EmpActualRow { employeeId: string; year: number; month: number; actualHrs: number; }

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
  const canAccess = ["pd", "admin"].includes(role);
  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  // ── State ──
  const [projects, setProjects]               = useState<Project[]>([]);
  const [departments, setDepartments]         = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [plans, setPlans]                     = useState<PlanRow[]>([]);
  const [actuals, setActuals]                 = useState<ActualRow[]>([]);
  const [saving, setSaving]                   = useState<string | null>(null);
  const [loading, setLoading]                 = useState(false);
  const [viewMode, setViewMode]               = useState<"employee" | "dept">("employee");

  // Employee view
  const [empPlans, setEmpPlans]                       = useState<EmpPlanRow[]>([]);
  const [empActuals, setEmpActuals]                   = useState<EmpActualRow[]>([]);
  const [allEmployees, setAllEmployees]               = useState<Employee[]>([]);
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<string[]>([]);
  const [loadingEmp, setLoadingEmp]                   = useState(false);

  // User ID lookup
  const [userIdInput, setUserIdInput]     = useState("");
  const [lookupResult, setLookupResult]   = useState<Employee | null | "notfound">(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Import
  const [importMsg, setImportMsg]    = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importing, startImport]     = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Standard hours per month (after holidays) — key: "year-month"
  const [stdHours, setStdHours] = useState<Record<string, number>>({});

  // ── Load dept plan ──
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
      setImportMsg(null); // reset import message when switching projects
      load(selectedProject);
      loadEmp(selectedProject);
    }
  }, [selectedProject, load, loadEmp]);

  // Fetch standard hours when months list is known
  useEffect(() => {
    if (months.length === 0) return;
    const param = months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(",");
    fetch(`/api/std-hours?months=${param}`)
      .then((r) => r.json())
      .then((d) => setStdHours(d.stdHours || {}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  const selectedProj = projects.find((p) => p.id === selectedProject);
  const months = selectedProj
    ? (() => {
        const start = selectedProj.startDate ? new Date(selectedProj.startDate) : new Date();
        const end   = selectedProj.endDate   ? new Date(selectedProj.endDate)   : new Date(start.getUTCFullYear() + 1, start.getUTCMonth(), 1);
        return monthsBetween(start, end);
      })()
    : [];

  // Plan status is stored on the project itself
  const planStatus = selectedProj?.planStatus || "draft";
  const canEditPlan = planStatus === "draft";

  /** ถ้ากรอก 0 < v ≤ 1.5 → ถือว่าเป็น MM multiplier แปลงเป็นชั่วโมงมาตรฐาน */
  function resolveHrs(v: number, year: number, month: number): number {
    if (v > 0 && v <= 1.5) {
      const std = stdHours[`${year}-${month}`] ?? 0;
      return Math.round(v * std);
    }
    return v;
  }

  // ── User ID lookup with debounce ──
  function handleUserIdChange(val: string) {
    setUserIdInput(val);
    setLookupResult(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const trimmed = val.trim().toUpperCase();
    if (!trimmed) return;
    lookupTimer.current = setTimeout(() => {
      setLookupLoading(true);
      const found = allEmployees.find((e) => e.employeeId.toUpperCase() === trimmed);
      setLookupResult(found ?? "notfound");
      setLookupLoading(false);
    }, 300);
  }

  async function confirmAddEmployee() {
    if (!selectedProject || !lookupResult || lookupResult === "notfound") return;
    if (assignedEmployeeIds.includes(lookupResult.id)) {
      setUserIdInput(""); setLookupResult(null); return;
    }
    setSaving("addEmp");
    const res = await fetch("/api/resource-plan-employee-monthly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: selectedProject, employeeId: lookupResult.id,
        year: months[0]?.year || new Date().getFullYear(),
        month: months[0]?.month || 1, plannedHrs: 0,
      }),
    });
    setSaving(null);
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Error");
      return;
    }
    setUserIdInput(""); setLookupResult(null);
    loadEmp(selectedProject);
  }

  // ── Plan actions ──
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

  async function requestRevision() {
    if (!selectedProject) return;
    if (!confirm("ส่งคำขอแก้ไขแผนไปให้ Management อนุมัติก่อน?")) return;
    setSaving("revision");
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revision_request", projectId: selectedProject }),
    });
    setSaving(null);
    load(selectedProject);
  }

  async function cancelRevision() {
    if (!selectedProject) return;
    if (!confirm("ถอนคำขอแก้ไข? แผนจะกลับเป็น Draft และสามารถแก้ไขได้ทันที")) return;
    setSaving("cancel_revision");
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel_revision", projectId: selectedProject }),
    });
    setSaving(null);
    load(selectedProject);
  }

  // ── Employee plan helpers ──
  function getEmpPlanned(empId: string, year: number, month: number) {
    return empPlans.find((p) => p.employeeId === empId && p.year === year && p.month === month)?.plannedHrs || 0;
  }
  function getEmpActual(empId: string, year: number, month: number) {
    return empActuals.find((a) => a.employeeId === empId && a.year === year && a.month === month)?.actualHrs || 0;
  }
  async function saveEmpPlan(empId: string, year: number, month: number, hrs: number) {
    if (!selectedProject) return;
    setSaving(`emp|${empId}|${year}|${month}`);
    const res = await fetch("/api/resource-plan-employee-monthly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, employeeId: empId, year, month, plannedHrs: hrs }),
    });
    setSaving(null);
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Error");
    }
    loadEmp(selectedProject);
  }
  async function removeEmployee(empId: string) {
    if (!selectedProject || !confirm("ลบพนักงานนี้ออกจากแผนทั้งหมด?")) return;
    const res = await fetch(`/api/resource-plan-employee-monthly?projectId=${selectedProject}&employeeId=${empId}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Error");
      return;
    }
    loadEmp(selectedProject);
  }

  // ── Dept plan helpers ──
  function getPlanned(dept: string, year: number, month: number) {
    return plans.find((p) => p.department === dept && p.year === year && p.month === month)?.plannedHrs || 0;
  }
  function getActual(dept: string, year: number, month: number) {
    return actuals.find((a) => a.department === dept && a.year === year && a.month === month)?.actualHrs || 0;
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;
    e.target.value = "";
    setImportMsg(null);
    startImport(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", selectedProject);
      const res  = await fetch("/api/resource-plan-employee-monthly/import", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setImportMsg({ type: "success", text: data.message });
        loadEmp(selectedProject);
      } else {
        setImportMsg({ type: "error", text: data.error || "นำเข้าไม่สำเร็จ" });
      }
    });
  }

  // ── Totals ──
  const assignedEmps        = allEmployees.filter((e) => assignedEmployeeIds.includes(e.id));
  const empRowTotals        = assignedEmps.map((e) => months.reduce((s, m) => s + getEmpPlanned(e.id, m.year, m.month), 0));
  const empMonthTotals      = months.map((m) => assignedEmps.reduce((s, e) => s + getEmpPlanned(e.id, m.year, m.month), 0));
  const empGrandTotal       = empRowTotals.reduce((s, v) => s + v, 0);
  const empActualRowTotals  = assignedEmps.map((e) => months.reduce((s, m) => s + getEmpActual(e.id, m.year, m.month), 0));
  const empActualMonthTotals = months.map((m) => assignedEmps.reduce((s, e) => s + getEmpActual(e.id, m.year, m.month), 0));
  const empGrandActualTotal = empActualRowTotals.reduce((s, v) => s + v, 0);

  const deptTotals          = departments.map((d) => months.reduce((s, m) => s + getPlanned(d, m.year, m.month), 0));
  const monthTotals         = months.map((m) => departments.reduce((s, d) => s + getPlanned(d, m.year, m.month), 0));
  const grandTotal          = deptTotals.reduce((s, v) => s + v, 0);
  const deptActualTotals    = departments.map((d) => months.reduce((s, m) => s + getActual(d, m.year, m.month), 0));
  const monthActualTotals   = months.map((m) => departments.reduce((s, d) => s + getActual(d, m.year, m.month), 0));
  const grandActualTotal    = deptActualTotals.reduce((s, v) => s + v, 0);

  const displayedTotal  = viewMode === "employee" ? empGrandTotal  : grandTotal;
  const displayedActual = viewMode === "employee" ? empGrandActualTotal : grandActualTotal;

  if (!canAccess) return null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource Plan</h1>
          <p className="text-gray-500 text-sm">วางแผนทรัพยากรระยะยาว แยกรายบุคคล รายเดือน</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
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
                    <div className="flex items-center justify-between gap-1">
                      <span className={`font-mono text-xs font-semibold ${selectedProject === p.id ? "text-blue-200" : "text-blue-600"}`}>{p.projectNumber}</span>
                      <PlanStatusDot status={p.planStatus} />
                    </div>
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
              <p className="text-3xl mb-2">👈</p><p>เลือกโครงการจากด้านซ้าย</p>
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
                      {selectedProj.pd && <span className="ml-2">· PD: {selectedProj.pd.name}</span>}
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
                    <div className="flex gap-2 flex-wrap">
                      {/* Excel template / import — only when editable */}
                      {canEditPlan && (
                        <>
                          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
                          <a href={`/api/resource-plan-employee-monthly/template?projectId=${selectedProject}`}
                            className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
                            📥 Excel Template
                          </a>
                          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
                            className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap border-green-300 text-green-700 hover:bg-green-50">
                            {importing ? "กำลัง Import…" : "📤 Import Excel"}
                          </button>
                        </>
                      )}

                      {/* Submit Plan button — only when draft */}
                      {canEditPlan && (
                        <button onClick={submitPlan}
                          disabled={saving === "submit" || empGrandTotal === 0}
                          className="ges-btn-primary text-xs px-3 py-1.5">
                          {saving === "submit" ? "กำลังส่ง…" : "📤 Submit Plan"}
                        </button>
                      )}

                      {/* Request for Revise Plan — when submitted or approved */}
                      {(planStatus === "submitted" || planStatus === "approved") && (
                        <button onClick={requestRevision}
                          disabled={saving === "revision"}
                          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 whitespace-nowrap font-medium disabled:opacity-50">
                          {saving === "revision" ? "กำลังส่ง…" : "🔄 Request for Revise Plan"}
                        </button>
                      )}

                      {/* Cancel revision request — when revision_requested */}
                      {planStatus === "revision_requested" && (
                        <button onClick={cancelRevision}
                          disabled={saving === "cancel_revision"}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 whitespace-nowrap font-medium disabled:opacity-50">
                          {saving === "cancel_revision" ? "กำลังถอน…" : "↩ ถอนคำขอแก้ไข"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Plan lock notice */}
              {!canEditPlan && planStatus !== "revision_requested" && (
                <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
                  planStatus === "approved"
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-amber-50 border border-amber-200 text-amber-800"
                }`}>
                  <span>🔒</span>
                  <span>
                    {planStatus === "approved"
                      ? "แผนได้รับการอนุมัติแล้ว — ไม่สามารถแก้ไขได้ กด \"Request for Revise Plan\" เพื่อขอแก้ไข"
                      : "แผนถูกส่งแล้ว — รอ GES Management / MD อนุมัติ หรือกด \"Request for Revise Plan\" เพื่อขอแก้ไข"}
                  </span>
                </div>
              )}
              {planStatus === "revision_requested" && (
                <div className="px-4 py-3 rounded-lg text-sm flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800">
                  <span>⏳</span>
                  <span>อยู่ระหว่างรอ GES Management / MD อนุมัติคำขอแก้ไข — ยังไม่สามารถแก้ไขแผนได้ในขณะนี้</span>
                </div>
              )}

              {/* Import message */}
              {importMsg && (
                <div className={`px-4 py-3 rounded-lg text-sm flex items-center justify-between ${
                  importMsg.type === "success" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  <span>{importMsg.type === "success" ? "✅" : "❌"} {importMsg.text}</span>
                  <button onClick={() => setImportMsg(null)} className="text-gray-400 hover:text-gray-600 ml-4">✕</button>
                </div>
              )}

              {/* View Toggle */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                <button onClick={() => setViewMode("employee")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "employee" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  👤 รายบุคคล
                </button>
                <button onClick={() => setViewMode("dept")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "dept" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  🏢 สรุปแผนก
                </button>
              </div>

              {/* ── EMPLOYEE VIEW ── */}
              {viewMode === "employee" && (
                <div className="ges-card overflow-x-auto">
                  {/* Add Employee by User ID — only when editable */}
                  {canEditPlan && (
                    <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-600 mb-2">เพิ่มพนักงาน</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 whitespace-nowrap">User ID:</span>
                          <input
                            type="text"
                            placeholder="เช่น GES-001"
                            value={userIdInput}
                            onChange={(e) => handleUserIdChange(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") confirmAddEmployee(); }}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono uppercase"
                          />
                        </div>
                        {lookupLoading && <span className="text-xs text-gray-400 animate-pulse">กำลังค้นหา…</span>}
                        {!lookupLoading && lookupResult && lookupResult !== "notfound" && (
                          <div className="flex items-center gap-2">
                            {assignedEmployeeIds.includes(lookupResult.id) ? (
                              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                                ⚠️ {lookupResult.name} อยู่ในแผนแล้ว
                              </span>
                            ) : (
                              <>
                                <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                  ✓ <strong>{lookupResult.name}</strong>
                                  <span className="text-green-500">·</span>
                                  {lookupResult.department}
                                </span>
                                <button onClick={confirmAddEmployee} disabled={saving === "addEmp"}
                                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                                  {saving === "addEmp" ? "กำลังเพิ่ม…" : "+ เพิ่มเข้าแผน"}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {!lookupLoading && lookupResult === "notfound" && userIdInput.trim() && (
                          <span className="text-xs text-red-500 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                            ❌ ไม่พบรหัส &ldquo;{userIdInput.trim()}&rdquo;
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Employee table */}
                  {loadingEmp ? (
                    <div className="p-8 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
                  ) : assignedEmps.length === 0 ? (
                    <div className="p-10 text-center text-gray-400">
                      <p className="text-3xl mb-2">👤</p>
                      <p className="text-sm font-medium">ยังไม่มีพนักงานในแผน</p>
                      <p className="text-xs mt-1">{canEditPlan ? "กรอก User ID ด้านบนเพื่อเพิ่มพนักงาน" : "ยังไม่มีข้อมูลพนักงาน"}</p>
                    </div>
                  ) : (
                    <table className="text-sm w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-3 py-2.5 font-semibold text-gray-700 min-w-[60px] sticky left-0 bg-gray-50 border-r border-gray-200 z-10">User ID</th>
                          <th className="text-left px-3 py-2.5 font-semibold text-gray-700 min-w-[150px] bg-gray-50 border-r border-gray-200">ชื่อ-นามสกุล</th>
                          {months.map((m) => (
                            <th key={`${m.year}-${m.month}`} className="px-2 py-2.5 font-medium text-center min-w-[80px] text-xs text-gray-600">
                              <div>{MONTH_NAMES_TH[m.month-1]}</div>
                              <div className="text-gray-400">{m.year}</div>
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-center min-w-[65px] font-semibold text-gray-700 border-l border-gray-200">รวม</th>
                          {canEditPlan && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {assignedEmps.map((emp, ei) => (
                          <tr key={emp.id} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 sticky left-0 bg-white border-r border-gray-200 z-10">
                              <span className="font-mono text-xs font-semibold text-blue-700">{emp.employeeId}</span>
                            </td>
                            <td className="px-3 py-2 border-r border-gray-100">
                              <p className="font-medium text-gray-900 text-sm whitespace-nowrap">{emp.name}</p>
                              <p className="text-xs text-gray-400">{emp.department}</p>
                            </td>
                            {months.map((m) => {
                              const key    = `emp|${emp.id}|${m.year}|${m.month}`;
                              const plan   = getEmpPlanned(emp.id, m.year, m.month);
                              const actual = getEmpActual(emp.id, m.year, m.month);
                              return (
                                <td key={`${m.year}-${m.month}`} className="px-1 py-1 text-center">
                                  {canEditPlan ? (
                                    <input type="number" min="0" step="0.5"
                                      defaultValue={plan}
                                      key={`${emp.id}-${m.year}-${m.month}-${plan}`}
                                      onBlur={(e) => {
                                        const raw = Number(e.target.value);
                                        const v = resolveHrs(raw, m.year, m.month);
                                        if (v !== raw) e.target.value = String(v);
                                        if (v !== plan) saveEmpPlan(emp.id, m.year, m.month, v);
                                      }}
                                      className={`w-16 text-center border rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                        saving === key ? "border-blue-300 bg-blue-50" :
                                        plan > 0 ? "border-blue-200 text-blue-900 font-semibold" : "border-gray-200 text-gray-400"
                                      }`}
                                    />
                                  ) : (
                                    <span className={plan > 0 ? "font-semibold text-blue-900 text-xs" : "text-gray-300 text-xs"}>{plan || "–"}</span>
                                  )}
                                  {actual > 0 && (
                                    <div className={`text-xs mt-0.5 ${actual > plan && plan > 0 ? "text-red-500" : "text-green-600"}`}>{actual}h จริง</div>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-center border-l border-gray-200">
                              <span className={`font-semibold text-sm ${empRowTotals[ei] > 0 ? "text-blue-900" : "text-gray-300"}`}>{empRowTotals[ei] || "–"}</span>
                              {empActualRowTotals[ei] > 0 && <div className="text-xs text-green-600">{empActualRowTotals[ei]}</div>}
                            </td>
                            {canEditPlan && (
                              <td className="px-2 py-2 text-center">
                                <button onClick={() => removeEmployee(emp.id)} className="text-gray-300 hover:text-red-500 transition-colors" title="ลบออกจากแผน">✕</button>
                              </td>
                            )}
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 bg-blue-50">
                          <td className="px-3 py-2.5 font-bold text-gray-800 sticky left-0 bg-blue-50 border-r border-gray-200 z-10" colSpan={2}>รวม / เดือน</td>
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
                          {canEditPlan && <td />}
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── DEPT SUMMARY VIEW ── */}
              {viewMode === "dept" && (
                <div className="ges-card overflow-x-auto">
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-800 text-sm">สรุปแผนก (ชั่วโมง/เดือน)</h3>
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
                              const plan   = getPlanned(dept, m.year, m.month);
                              const actual = getActual(dept, m.year, m.month);
                              return (
                                <td key={`${m.year}-${m.month}`} className="px-2 py-2 text-center">
                                  <span className={plan > 0 ? "font-semibold text-blue-900" : "text-gray-300"}>{plan || "–"}</span>
                                  {actual > 0 && (
                                    <div className={`text-xs mt-0.5 ${actual > plan && plan > 0 ? "text-red-500" : "text-green-600"}`}>{actual}h จริง</div>
                                  )}
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
                          <td className="px-4 py-2.5 font-bold text-gray-800 sticky left-0 bg-blue-50 border-r border-gray-200 z-10">รวม</td>
                          {months.map((m, mi) => (
                            <td key={`${m.year}-${m.month}`} className="px-2 py-2.5 text-center">
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

              {/* Legend */}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <span><span className="text-blue-900 font-semibold">●</span> ตัวเลขในตาราง = ชั่วโมงที่วางแผน</span>
                <span><span className="text-green-600 font-semibold">●</span> ตัวเลขสีเขียว = ชั่วโมงที่ลงจริงจาก Timesheet</span>
                <span><span className="text-red-500 font-semibold">●</span> สีแดง = เกินแผน</span>
              </div>

              {/* Summary cards */}
              {viewMode === "employee" && empGrandTotal > 0 && (
                <div className="ges-card p-5">
                  <h3 className="font-semibold text-gray-800 text-sm mb-3">สรุปรายบุคคล</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {assignedEmps.filter((_, i) => empRowTotals[i] > 0).map((emp, i) => {
                      const plan = empRowTotals[i]; const actual = empActualRowTotals[i];
                      const pct = plan > 0 ? Math.round((actual / plan) * 100) : 0;
                      return (
                        <div key={emp.id} className="bg-gray-50 rounded-xl p-3">
                          <p className="font-mono text-xs text-blue-600 font-semibold">{emp.employeeId}</p>
                          <p className="text-xs font-semibold text-gray-900 truncate">{emp.name}</p>
                          <p className="text-xs text-gray-400">{emp.department}</p>
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
    draft:              { label: "✏️ Draft",              cls: "bg-gray-100 text-gray-600" },
    submitted:          { label: "📤 รอ Management อนุมัติ",       cls: "bg-amber-100 text-amber-800" },
    revision_requested: { label: "🔄 รอ Management อนุมัติการแก้ไข", cls: "bg-blue-100 text-blue-800" },
    approved:           { label: "✓ Approved by PD",     cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function PlanStatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:              "text-gray-400",
    submitted:          "text-amber-500",
    revision_requested: "text-blue-500",
    approved:           "text-green-500",
  };
  return <span className={`text-xs ${map[status] || "text-gray-400"}`}>●</span>;
}
