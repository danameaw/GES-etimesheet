"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, startOfWeek, addWeeks, subWeeks, addDays } from "date-fns";

interface EmployeeRow {
  id: string; employeeId: string; name: string; department: string; position: string;
  timesheetId: string | null; status: string; submittedAt: string | null; totalHrs: number;
}
interface ProjectRow {
  projectId: string; projectNumber: string; projectName: string;
  employees: {
    id: string; employeeId: string; name: string; department: string;
    timesheetId: string; status: string; totalHrs: number; projectHrs: number; plannedHrs: number;
  }[];
}
interface Summary {
  total: number; submitted: number; draft: number; missing: number; weekStart: string; weekEnd: string;
  weekCapacity: number; // holiday-adjusted weekly hours ceiling (default 40)
}

export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all"|"submitted"|"approved"|"draft"|"missing">("all");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"employee"|"project">("project");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());       // employee-view: timesheetIds
  const [selectedProjIds, setSelectedProjIds] = useState<Set<string>>(new Set()); // project-view: projectIds
  const [bulkLoading, setBulkLoading] = useState(false);

  const role    = (session?.user as any)?.role;
  const isAdmin = role === "admin";
  const isMD    = role === "md";
  const isPD    = role === "pd";   // Project Director — อนุมัติ Timesheet
  const canApprove = isPD || isAdmin || isMD;

  useEffect(() => {
    if (session && !canApprove) router.push("/timesheet");
  }, [session, canApprove, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    setSelectedProjIds(new Set());
    const weekStr = format(currentWeek, "yyyy-MM-dd");
    const [empRes, projRes] = await Promise.all([
      fetch(`/api/admin?week=${weekStr}`),
      fetch(`/api/admin?week=${weekStr}&view=project`),
    ]);
    const empData  = await empRes.json();
    const projData = await projRes.json();
    setSummary(empData.summary);
    setEmployees(empData.employees || []);
    setProjectRows(projData.projectRows || []);
    setLoading(false);
  }, [currentWeek]);

  useEffect(() => { load(); }, [load]);

  async function act(timesheetId: string, action: "approve" | "unlock") {
    setActing((s) => new Set(s).add(timesheetId));
    await fetch(`/api/timesheets/${timesheetId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setActing((s) => { const n = new Set(s); n.delete(timesheetId); return n; });
    load();
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/timesheets/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        })
      )
    );
    setBulkLoading(false);
    load();
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  const toggleSelectProj = (projId: string) => {
    setSelectedProjIds((s) => {
      const n = new Set(s);
      if (n.has(projId)) { n.delete(projId); } else { n.add(projId); }
      return n;
    });
  };

  // Approve all submitted employees in selected projects
  async function bulkApproveProjects() {
    if (selectedProjIds.size === 0) return;
    setBulkLoading(true);
    const tsIds = new Set<string>();
    for (const proj of projectRows) {
      if (!selectedProjIds.has(proj.projectId)) continue;
      for (const emp of proj.employees) {
        if (emp.status === "submitted" && emp.timesheetId) tsIds.add(emp.timesheetId);
      }
    }
    await Promise.all(
      Array.from(tsIds).map((id) =>
        fetch(`/api/timesheets/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        })
      )
    );
    setBulkLoading(false);
    load();
  }

  const selectAllSubmitted = () => {
    const submittedIds = employees.filter((e) => e.status === "submitted" && e.timesheetId).map((e) => e.timesheetId!);
    setSelectedIds(new Set(submittedIds));
  };

  const weekEnd = addDays(currentWeek, 6);
  const approvedCount = employees.filter((e) => e.status === "approved").length;

  const filtered = employees.filter((e) => {
    const matchFilter = filter === "all" || e.status === filter;
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(search.toLowerCase()) || e.department.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  if (!canApprove) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isPD ? "Timesheet Approval" : "Admin View"}
          </h1>
          <p className="text-gray-500 text-sm">
            {isPD ? "อนุมัติ Timesheet ประจำสัปดาห์" : "Timesheet submission overview"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
          <div className="text-center min-w-[200px]">
            <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
            <p className="text-xs text-gray-400">สัปดาห์ที่ {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
          <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">วันนี้</button>
          <button onClick={load} title="Refresh" className="text-xs text-gray-500 hover:text-blue-600 ml-1">🔄</button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <SummaryCard label="พนักงานทั้งหมด" value={summary.total}     color="bg-blue-900"  icon="👥" onClick={() => setFilter("all")}       active={filter === "all"} />
          <SummaryCard label="รออนุมัติ"       value={summary.submitted} color="bg-amber-500" icon="📋" onClick={() => setFilter("submitted")} active={filter === "submitted"} />
          <SummaryCard label="อนุมัติแล้ว"     value={approvedCount}     color="bg-green-600" icon="✓"  onClick={() => setFilter("approved")}  active={filter === "approved"} />
          <SummaryCard label="Draft"           value={summary.draft}     color="bg-gray-500"  icon="✏️" onClick={() => setFilter("draft")}     active={filter === "draft"} />
          <SummaryCard label="ยังไม่ส่ง"       value={summary.missing}   color="bg-red-600"   icon="⚠"  onClick={() => setFilter("missing")}   active={filter === "missing"} />
        </div>
      )}

      {/* Progress bar */}
      {summary && summary.total > 0 && (
        <div className="ges-card p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">{isPD ? "อนุมัติแล้ว" : "Submission Progress"}</span>
            <span className="text-gray-500">
              {isPD
                ? `อนุมัติ ${approvedCount}/${summary.total} (${Math.round((approvedCount / summary.total) * 100)}%)`
                : `${summary.submitted}/${summary.total} (${Math.round((summary.submitted / summary.total) * 100)}%)`}
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${isPD ? (approvedCount / summary.total) * 100 : (summary.submitted / summary.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
        <input type="text" placeholder="ค้นหาชื่อ, รหัส, แผนก…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="ges-input max-w-sm" />

        {/* View toggle — Admin only (PD is always project view) */}
        {!isPD && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setView("employee")}
              className={`px-3 py-1.5 font-medium transition-colors ${view === "employee" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              👤 รายบุคคล
            </button>
            <button onClick={() => setView("project")}
              className={`px-3 py-1.5 font-medium transition-colors border-l border-gray-200 ${view === "project" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              📁 ราย Project
            </button>
          </div>
        )}

        {view === "employee" && (
          <div className="flex gap-2 flex-wrap">
            {(["all","submitted","approved","draft","missing"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filter === f ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {f === "submitted" ? "รออนุมัติ" : f === "approved" ? "อนุมัติแล้ว" : f === "draft" ? "Draft" : f === "missing" ? "ยังไม่ส่ง" : "ทั้งหมด"}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 ml-auto flex-wrap items-center">
          {/* Bulk approve (PD only, employee view) */}
          {isPD && view === "employee" && (
            <>
              <button onClick={selectAllSubmitted}
                className="text-xs px-3 py-1.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50">
                เลือกทั้งหมดที่ส่งแล้ว
              </button>
              {selectedIds.size > 0 && (
                <button onClick={bulkApprove} disabled={bulkLoading}
                  className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-medium">
                  {bulkLoading ? "กำลังอนุมัติ…" : `✓ อนุมัติ ${selectedIds.size} รายการ`}
                </button>
              )}
            </>
          )}
          <ExportBtn type="weekly"      week={currentWeek} label="📥 Weekly" />
          <ExportBtn type="utilization" week={currentWeek} label="📊 Utilization" />
          <ExportBtn type="missing"     week={currentWeek} label="⚠ Missing" />
          <ExportBtn type="project"     week={currentWeek} label="🗂 By Project" />
        </div>
      </div>

      {/* ── EMPLOYEE VIEW ─────────────────────────────────────── */}
      {view === "employee" && (
        <div className="ges-card overflow-x-auto">
          {loading ? <div className="p-10 text-center text-gray-400">กำลังโหลด…</div> : (
            <table className="ges-table w-full">
              <thead>
                <tr>
                  {isPD && <th className="w-8"></th>}
                  <th className="text-left">รหัสพนักงาน</th>
                  <th className="text-left">ชื่อ-นามสกุล</th>
                  <th className="text-left">แผนก</th>
                  <th>ชั่วโมง</th>
                  <th>Util%</th>
                  <th>สถานะ</th>
                  <th>ส่งเมื่อ</th>
                  <th>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isPD ? 9 : 8} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
                ) : filtered.map((emp) => {
                  const capacity = summary?.weekCapacity ?? 40;
                  const util = capacity > 0 ? Math.round((emp.totalHrs / capacity) * 100) : 0;
                  const isSelected = emp.timesheetId ? selectedIds.has(emp.timesheetId) : false;
                  return (
                    <tr key={emp.id} className={isSelected ? "bg-amber-50" : ""}>
                      {isPD && (
                        <td className="text-center">
                          {emp.status === "submitted" && emp.timesheetId && (
                            <input type="checkbox" checked={isSelected}
                              onChange={() => toggleSelect(emp.timesheetId!)}
                              className="rounded border-gray-300" />
                          )}
                        </td>
                      )}
                      <td className="font-mono text-xs font-semibold text-blue-900">{emp.employeeId}</td>
                      <td className="font-medium">{emp.name}</td>
                      <td className="text-gray-600 text-xs">{emp.department}</td>
                      <td className="text-center font-semibold">
                        <span className={emp.totalHrs >= capacity ? "text-green-700" : emp.totalHrs > 0 ? "text-amber-600" : "text-gray-400"}>
                          {emp.totalHrs > 0 ? `${emp.totalHrs}h` : "–"}
                        </span>
                      </td>
                      <td className="text-center">
                        {emp.totalHrs > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${util >= 100 ? "bg-green-500" : util >= 75 ? "bg-amber-400" : "bg-red-400"}`}
                                style={{ width: `${Math.min(util, 100)}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 w-9">{util}%</span>
                          </div>
                        )}
                      </td>

                      <td className="text-center"><StatusBadge status={emp.status} /></td>
                      <td className="text-xs text-gray-500 text-center">
                        {emp.submittedAt ? format(new Date(emp.submittedAt), "dd/MM HH:mm") : "–"}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {isPD && emp.status === "submitted" && emp.timesheetId && (
                            <button onClick={() => act(emp.timesheetId!, "approve")}
                              disabled={acting.has(emp.timesheetId!)}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                              ✓ อนุมัติ
                            </button>
                          )}
                          {["submitted","approved"].includes(emp.status) && emp.timesheetId && (
                            <button onClick={() => act(emp.timesheetId!, "unlock")}
                              disabled={acting.has(emp.timesheetId!)}
                              className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50">
                              🔓 ปลดล็อค
                            </button>
                          )}
                          {isAdmin && (
                            <Link href={`/admin/edit?empId=${emp.id}&week=${format(currentWeek, "yyyy-MM-dd")}`}
                              className="text-xs text-blue-600 hover:underline">✏️ แก้ไข</Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── PROJECT VIEW ─────────────────────────────────────── */}
      {view === "project" && (
        <div className="space-y-4">
          {/* Multi-project bulk approve bar (PD only) */}
          {isPD && !loading && projectRows.length > 0 && (
            <div className="ges-card px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-gray-600 font-medium">เลือก Project ที่ต้องการอนุมัติ:</span>
              <button
                onClick={() => {
                  const submittedProjIds = projectRows.filter((p) => p.employees.some((e: any) => e.status === "submitted")).map((p) => p.projectId);
                  setSelectedProjIds(new Set(submittedProjIds));
                }}
                className="text-xs border border-amber-300 text-amber-700 px-3 py-1.5 rounded hover:bg-amber-50">
                เลือกทั้งหมดที่รออนุมัติ
              </button>
              {selectedProjIds.size > 0 && (
                <>
                  <button onClick={() => setSelectedProjIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">ยกเลิก</button>
                  <button onClick={bulkApproveProjects} disabled={bulkLoading}
                    className="text-xs bg-green-600 text-white px-4 py-1.5 rounded hover:bg-green-700 disabled:opacity-50 font-medium">
                    {bulkLoading ? "กำลังอนุมัติ…" : `✓ อนุมัติ ${selectedProjIds.size} Project ที่เลือก`}
                  </button>
                </>
              )}
            </div>
          )}

          {loading ? <div className="ges-card p-10 text-center text-gray-400">กำลังโหลด…</div> :
           projectRows.length === 0 ? (
            <div className="ges-card p-10 text-center text-gray-400">ไม่มีข้อมูล Timesheet สำหรับสัปดาห์นี้</div>
          ) : projectRows.map((proj) => {
            const submittedEmps = proj.employees.filter((e: any) => e.status === "submitted");
            const approvedEmps  = proj.employees.filter((e: any) => e.status === "approved");
            const isChecked     = selectedProjIds.has(proj.projectId);
            const hasSubmitted  = submittedEmps.length > 0;

            return (
              <div key={proj.projectId} className={`ges-card overflow-hidden transition-all ${isChecked ? "ring-2 ring-green-400" : ""}`}>
                {/* Project header */}
                <div className={`flex items-center justify-between px-5 py-3 border-b ${isChecked ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-100"}`}>
                  <div className="flex items-center gap-3">
                    {/* Project-level checkbox (PD only, only when there are submitted) */}
                    {isPD && hasSubmitted && (
                      <input type="checkbox" checked={isChecked}
                        onChange={() => toggleSelectProj(proj.projectId)}
                        className="rounded border-gray-300 text-green-600 cursor-pointer w-4 h-4" />
                    )}
                    <div>
                      <span className="font-mono text-xs text-blue-600 font-semibold">{proj.projectNumber}</span>
                      <span className="ml-2 font-semibold text-gray-800">{proj.projectName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 text-xs">{proj.employees.length} คน</span>
                    {approvedEmps.length > 0 && (
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">✓ อนุมัติแล้ว {approvedEmps.length}</span>
                    )}
                    {submittedEmps.length > 0 && (
                      <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">รออนุมัติ {submittedEmps.length}</span>
                    )}
                    {/* Approve this project's submitted employees */}
                    {isPD && submittedEmps.length > 0 && (
                      <button
                        onClick={async () => {
                          setBulkLoading(true);
                          const tsIds = submittedEmps.map((e: any) => e.timesheetId);
                          await Promise.all(tsIds.map((id: string) =>
                            fetch(`/api/timesheets/${id}`, {
                              method: "PATCH", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "approve" }),
                            })
                          ));
                          setBulkLoading(false);
                          load();
                        }}
                        disabled={bulkLoading}
                        className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50 font-medium">
                        ✓ อนุมัติ Project นี้ ({submittedEmps.length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Employees under this project */}
                <table className="ges-table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">พนักงาน</th>
                      <th className="text-left">แผนก</th>
                      <th>Plan (เดือนนี้)</th>
                      <th>Actual (project)</th>
                      <th>Actual (รวม)</th>
                      <th>สถานะ</th>
                      <th>การดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...proj.employees].sort((a, b) => a.employeeId.localeCompare(b.employeeId)).map((emp) => {
                      const overPlan = emp.plannedHrs > 0 && emp.projectHrs > emp.plannedHrs;
                      return (
                      <tr key={emp.id}>
                        <td>
                          <p className="font-medium text-sm">{emp.name}</p>
                          <p className="text-xs font-mono text-blue-600">{emp.employeeId}</p>
                        </td>
                        <td className="text-xs text-gray-500">{emp.department}</td>
                        <td className="text-center text-sm">
                          {emp.plannedHrs > 0
                            ? <span className="font-semibold text-purple-700">{emp.plannedHrs}h</span>
                            : <span className="text-gray-300">–</span>}
                        </td>
                        <td className="text-center font-semibold text-sm" style={{ color: overPlan ? "#dc2626" : "#1d4ed8" }}>
                          {emp.projectHrs}h{overPlan && <span className="text-xs text-red-500 ml-1">▲</span>}
                        </td>
                        <td className="text-center text-sm text-gray-600">{emp.totalHrs}h</td>
                        <td className="text-center"><StatusBadge status={emp.status} /></td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            {isPD && emp.status === "submitted" && (
                              <button onClick={() => act(emp.timesheetId, "approve")}
                                disabled={acting.has(emp.timesheetId)}
                                className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                                ✓
                              </button>
                            )}
                            {isAdmin && (
                              <Link href={`/admin/edit?empId=${emp.id}&week=${format(currentWeek, "yyyy-MM-dd")}`}
                                className="text-xs text-blue-600 hover:underline">✏️</Link>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3 text-right">
        {view === "employee" ? `แสดง ${filtered.length} จาก ${employees.length} คน` : `${projectRows.length} โครงการ`}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    submitted: { label: "รออนุมัติ",    cls: "bg-amber-100 text-amber-800" },
    approved:  { label: "✓ อนุมัติแล้ว", cls: "bg-green-100 text-green-800" },
    draft:     { label: "Draft",         cls: "bg-gray-100 text-gray-600" },
    missing:   { label: "ยังไม่ส่ง",    cls: "bg-red-100 text-red-700" },
  };
  const s = map[status] ?? map.missing;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function SummaryCard({ label, value, color, icon, onClick, active }: {
  label: string; value: number; color: string; icon: string; onClick: () => void; active: boolean;
}) {
  return (
    <button onClick={onClick} className={`ges-card p-4 text-left transition-all hover:shadow-md ${active ? "ring-2 ring-blue-500" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        </div>
        <div className={`${color} text-white w-10 h-10 rounded-xl flex items-center justify-center text-lg`}>{icon}</div>
      </div>
    </button>
  );
}

function ExportBtn({ type, week, label }: { type: string; week: Date; label: string }) {
  const weekStr = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;
  return (
    <a href={`/api/export?type=${type}&week=${weekStr}`}
      className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
      {label}
    </a>
  );
}
