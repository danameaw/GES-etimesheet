"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, startOfWeek, addWeeks, subWeeks, addDays, addMonths, subMonths, startOfMonth, endOfMonth } from "date-fns";

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
  total: number; submitted: number; approved: number; draft: number; missing: number; rejected: number; weekStart: string; weekEnd: string;
  weekCapacity: number;
}

export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [navMode, setNavMode] = useState<"week" | "month">("week");
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthWeeks, setMonthWeeks] = useState<{ week: Date; label: string; projectRows: ProjectRow[]; employees: EmployeeRow[]; summary: Summary | null }[]>([]);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all"|"submitted"|"approved"|"rejected"|"draft"|"missing">("all");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"employee"|"project">("project");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());       // employee-view: timesheetIds
  const [selectedProjIds, setSelectedProjIds] = useState<Set<string>>(new Set()); // project-view: projectIds
  const [bulkLoading, setBulkLoading] = useState(false);
  const [detailTs, setDetailTs] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function openDetail(timesheetId: string | null) {
    if (!timesheetId) return;
    setDetailLoading(true);
    setDetailTs(null);
    const res = await fetch(`/api/timesheets/${timesheetId}`);
    const d = await res.json();
    setDetailTs(d.timesheet ?? null);
    setDetailLoading(false);
  }

  const role    = (session?.user as any)?.role;
  const isAdmin = role === "admin";
  const isMD    = role === "md";
  const isPD    = role === "pd" || role === "ges_pd";
  const canApprove    = isPD || isAdmin || isMD;  // เข้าหน้า approval ได้
  const canActApprove = isPD || isMD;             // อนุมัติ/reject ได้ (Admin ทำได้แค่ unlock)

  useEffect(() => {
    if (session && !canApprove) router.push("/timesheet");
  }, [session, canApprove, router]);

  // helper: get all Mon-starting weeks that overlap with a month
  function getWeeksInMonth(month: Date): Date[] {
    const mEnd = endOfMonth(month);
    let w = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const weeks: Date[] = [];
    while (w <= mEnd) { weeks.push(w); w = addWeeks(w, 1); }
    return weeks;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    setSelectedProjIds(new Set());

    if (navMode === "week") {
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
    } else {
      // Month mode — fetch all weeks in parallel
      const weeks = getWeeksInMonth(currentMonth);
      const results = await Promise.all(
        weeks.map(async (w) => {
          const wStr = format(w, "yyyy-MM-dd");
          const [eRes, pRes] = await Promise.all([
            fetch(`/api/admin?week=${wStr}`),
            fetch(`/api/admin?week=${wStr}&view=project`),
          ]);
          const eData = await eRes.json();
          const pData = await pRes.json();
          return {
            week: w,
            label: `${format(w, "dd MMM")} – ${format(addDays(w, 6), "dd MMM")}`,
            projectRows: pData.projectRows || [],
            employees: eData.employees || [],
            summary: eData.summary || null,
          };
        })
      );
      setMonthWeeks(results);
      // auto-expand all weeks
      setExpandedWeeks(new Set(results.map((r) => format(r.week, "yyyy-MM-dd"))));
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMode, currentWeek, currentMonth]);

  useEffect(() => { load(); }, [load]);

  async function act(timesheetId: string, action: "approve" | "reject" | "unlock") {
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

  // Approve selected projects (per-project approval, ไม่กระทบ project อื่น)
  async function bulkApproveProjects() {
    if (selectedProjIds.size === 0) return;
    setBulkLoading(true);
    await Promise.all(
      Array.from(selectedProjIds).map((projectId) => {
        const proj = projectRows.find((p: any) => p.projectId === projectId);
        if (!proj) return Promise.resolve();
        const tsIds = proj.employees
          .filter((e: any) => e.status === "submitted" && e.timesheetId)
          .map((e: any) => e.timesheetId as string);
        if (tsIds.length === 0) return Promise.resolve();
        return fetch("/api/timesheets/project-approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timesheetIds: tsIds, projectId }),
        });
      })
    );
    setBulkLoading(false);
    load();
  }

  const selectAllSubmitted = () => {
    const submittedIds = employees.filter((e) => e.status === "submitted" && e.timesheetId).map((e) => e.timesheetId!);
    setSelectedIds(new Set(submittedIds));
  };

  const weekEnd = addDays(currentWeek, 6);
  const approvedCount = summary?.approved ?? employees.filter((e) => e.status === "approved" || e.status === "project-approved").length;

  const filtered = employees.filter((e) => {
    const matchFilter = filter === "all" || e.status === filter;
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(search.toLowerCase()) || e.department.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  if (!canApprove) return null;

  return (
    <>
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle week/month */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setNavMode("week")}
              className={`px-3 py-1.5 transition-colors ${navMode === "week" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              สัปดาห์
            </button>
            <button onClick={() => setNavMode("month")}
              className={`px-3 py-1.5 transition-colors ${navMode === "month" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              เดือน
            </button>
          </div>

          {navMode === "week" ? (
            <>
              <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
              <div className="text-center min-w-[200px]">
                <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
                <p className="text-xs text-gray-400">สัปดาห์ที่ {format(currentWeek, "w, yyyy")}</p>
              </div>
              <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
              <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">วันนี้</button>
            </>
          ) : (
            <>
              <button onClick={() => setCurrentMonth((m) => subMonths(m, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
              <div className="text-center min-w-[160px]">
                <p className="font-semibold text-sm">{format(currentMonth, "MMMM yyyy")}</p>
                <p className="text-xs text-gray-400">{getWeeksInMonth(currentMonth).length} สัปดาห์</p>
              </div>
              <button onClick={() => setCurrentMonth((m) => addMonths(m, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
              <button onClick={() => setCurrentMonth(startOfMonth(new Date()))} className="text-xs text-blue-600 hover:underline ml-1">เดือนนี้</button>
            </>
          )}
          <button onClick={load} title="Refresh" className="text-xs text-gray-500 hover:text-blue-600 ml-1">🔄</button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <SummaryCard label="พนักงานทั้งหมด" value={summary.total}          color="bg-blue-900"  icon="👥" onClick={() => setFilter("all")}       active={filter === "all"} />
          <SummaryCard label="รออนุมัติ"       value={summary.submitted}      color="bg-amber-500" icon="📋" onClick={() => setFilter("submitted")} active={filter === "submitted"} />
          <SummaryCard label="อนุมัติแล้ว"     value={approvedCount}          color="bg-green-600" icon="✓"  onClick={() => setFilter("approved")}  active={filter === "approved"} />
          <SummaryCard label="ไม่อนุมัติ"      value={summary.rejected ?? 0}  color="bg-red-700"   icon="✗"  onClick={() => setFilter("rejected")}  active={filter === "rejected"} />
          <SummaryCard label="Draft"           value={summary.draft}          color="bg-gray-500"  icon="✏️" onClick={() => setFilter("draft")}     active={filter === "draft"} />
          <SummaryCard label="ยังไม่ส่ง"       value={summary.missing}        color="bg-red-600"   icon="⚠"  onClick={() => setFilter("missing")}   active={filter === "missing"} />
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

      {/* ── MONTH VIEW ── */}
      {navMode === "month" && (
        <div className="space-y-3 mb-4">
          {loading ? (
            <div className="ges-card p-10 text-center text-gray-400">กำลังโหลดข้อมูลทุกสัปดาห์…</div>
          ) : monthWeeks.length === 0 ? (
            <div className="ges-card p-10 text-center text-gray-400">ไม่มีข้อมูล</div>
          ) : monthWeeks.map((wk) => {
            const wkKey = format(wk.week, "yyyy-MM-dd");
            const isOpen = expandedWeeks.has(wkKey);
            const s = wk.summary;
            const submitted = s?.submitted ?? 0;
            const approved  = wk.employees.filter((e) => e.status === "approved").length;
            const total     = s?.total ?? 0;
            return (
              <div key={wkKey} className="ges-card overflow-hidden">
                {/* Week header row */}
                <button
                  className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => setExpandedWeeks((prev) => {
                    const n = new Set(prev);
                    if (isOpen) { n.delete(wkKey); } else { n.add(wkKey); }
                    return n;
                  })}>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-gray-800">{wk.label}</span>
                    <span className="text-xs text-gray-400">สัปดาห์ที่ {format(wk.week, "w")}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {total > 0 && (
                      <>
                        <span className="text-amber-600 font-medium">{submitted} รออนุมัติ</span>
                        <span className="text-green-600 font-medium">{approved} อนุมัติแล้ว</span>
                        <span className="text-gray-400">{total} คน</span>
                      </>
                    )}
                    <span className="text-gray-400 ml-1">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>

                {/* Week content */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    {wk.projectRows.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-gray-400">ไม่มีข้อมูล Timesheet สำหรับสัปดาห์นี้</p>
                    ) : wk.projectRows.map((proj) => (
                      <div key={proj.projectId} className="border-t border-gray-100">
                        <div className="px-5 py-2 bg-blue-50 flex items-center gap-2">
                          <span className="text-xs font-mono text-blue-600">{proj.projectNumber}</span>
                          <span className="text-sm font-semibold text-blue-900">{proj.projectName}</span>
                          <span className="ml-auto text-xs text-gray-400">{proj.employees.length} คน</span>
                        </div>
                        <table className="w-full text-sm">
                          <tbody>
                            {proj.employees.map((emp) => {
                              const statusMap: Record<string, string> = {
                                submitted: "bg-amber-100 text-amber-800",
                                approved:  "bg-green-100 text-green-800",
                                rejected:  "bg-red-100 text-red-800",
                                draft:     "bg-gray-100 text-gray-600",
                              };
                              const isBusy = acting.has(emp.timesheetId);
                              return (
                                <tr key={emp.id} className="border-t border-gray-50 hover:bg-gray-50">
                                  <td className="px-5 py-2">
                                    <span className="font-medium">{emp.name}</span>
                                    <span className="text-xs text-gray-400 ml-2">{emp.employeeId}</span>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-500">{emp.department}</td>
                                  <td className="px-3 py-2 text-right text-xs text-blue-700 font-medium">{emp.projectHrs}h</td>
                                  <td className="px-3 py-2">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMap[emp.status] ?? "bg-gray-100 text-gray-500"}`}>
                                      {emp.status === "submitted" ? "รออนุมัติ" : emp.status === "approved" ? "✓ อนุมัติแล้ว" : emp.status === "rejected" ? "✗ ไม่อนุมัติ" : emp.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {canActApprove && emp.status === "submitted" && (
                                      <div className="flex gap-1 justify-end">
                                        <button onClick={() => act(emp.timesheetId, "approve")} disabled={isBusy}
                                          className="text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700 disabled:opacity-50">
                                          {isBusy ? "…" : "✓"}
                                        </button>
                                        <button onClick={() => act(emp.timesheetId, "reject")} disabled={isBusy}
                                          className="text-xs bg-red-500 text-white px-2 py-0.5 rounded hover:bg-red-600 disabled:opacity-50">
                                          ✗
                                        </button>
                                      </div>
                                    )}
                                    {canApprove && emp.status === "approved" && (
                                      <button onClick={() => act(emp.timesheetId, "unlock")} disabled={isBusy}
                                        className="text-xs text-gray-400 hover:text-orange-600 disabled:opacity-50">🔓</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {navMode === "week" && (
      <>{/* Toolbar */}
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
            {(["all","submitted","approved","rejected","draft","missing"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filter === f ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {f === "submitted" ? "รออนุมัติ" : f === "approved" ? "อนุมัติแล้ว" : f === "rejected" ? "ไม่อนุมัติ" : f === "draft" ? "Draft" : f === "missing" ? "ยังไม่ส่ง" : "ทั้งหมด"}
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
          {isAdmin && <PlanActualExportBtn week={currentWeek} />}
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
                      <td className="font-medium">
                        <button onClick={() => openDetail(emp.timesheetId)} disabled={!emp.timesheetId}
                          className="text-left hover:text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-default">
                          {emp.name}
                        </button>
                      </td>
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
                          {canActApprove && emp.status === "submitted" && emp.timesheetId && (
                            <>
                              <button onClick={() => act(emp.timesheetId!, "approve")}
                                disabled={acting.has(emp.timesheetId!)}
                                className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                                ✓ อนุมัติ
                              </button>
                              <button onClick={() => act(emp.timesheetId!, "reject")}
                                disabled={acting.has(emp.timesheetId!)}
                                className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-50">
                                ✗ ไม่อนุมัติ
                              </button>
                            </>
                          )}
                          {["submitted","approved","rejected"].includes(emp.status) && emp.timesheetId && (
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
            const approvedEmps  = proj.employees.filter((e: any) => e.status === "approved" || e.status === "project-approved");
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
                    {/* Approve this project's submitted employees (per-project, ไม่กระทบ project อื่น) */}
                    {canActApprove && submittedEmps.length > 0 && (
                      <button
                        onClick={async () => {
                          setBulkLoading(true);
                          const tsIds = submittedEmps
                            .map((e: any) => e.timesheetId)
                            .filter(Boolean) as string[];
                          await fetch("/api/timesheets/project-approve", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ timesheetIds: tsIds, projectId: proj.projectId }),
                          });
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
                <table className="ges-table w-full table-fixed">
                  <colgroup>
                    <col className="w-48" />
                    <col className="w-36" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-24" />
                    <col className="w-28" />
                    <col className="w-36" />
                  </colgroup>
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
                          <button onClick={() => openDetail(emp.timesheetId)} disabled={!emp.timesheetId}
                            className="text-left hover:text-blue-600 group disabled:cursor-default">
                            <p className="font-medium text-sm group-hover:underline">{emp.name}</p>
                            <p className="text-xs font-mono text-blue-600">{emp.employeeId}</p>
                          </button>
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
                            {canActApprove && emp.status === "submitted" && (
                              <>
                                <button onClick={() => act(emp.timesheetId, "approve")}
                                  disabled={acting.has(emp.timesheetId)}
                                  className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                                  ✓ อนุมัติ
                                </button>
                                <button onClick={() => act(emp.timesheetId, "reject")}
                                  disabled={acting.has(emp.timesheetId)}
                                  className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-50">
                                  ✗ ไม่อนุมัติ
                                </button>
                              </>
                            )}
                            {canActApprove && emp.status === "project-approved" && (
                              <button
                                onClick={async () => {
                                  await fetch("/api/timesheets/project-approve", {
                                    method: "DELETE",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ timesheetId: emp.timesheetId, projectId: proj.projectId }),
                                  });
                                  load();
                                }}
                                className="text-xs text-amber-600 hover:text-amber-700 border border-amber-300 px-2 py-1 rounded hover:bg-amber-50">
                                🔓 ยกเลิก PD อนุมัติ
                              </button>
                            )}
                            {canApprove && ["approved","rejected"].includes(emp.status) && (
                              <button onClick={() => act(emp.timesheetId, "unlock")}
                                disabled={acting.has(emp.timesheetId)}
                                className="text-xs text-amber-600 hover:text-amber-700 border border-amber-300 px-2 py-1 rounded hover:bg-amber-50 disabled:opacity-50">
                                🔓 ยกเลิก
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
      </>
      )}
    </div>

    {/* Timesheet detail modal */}
    {(detailLoading || detailTs) && (
      <TimesheetDetailModal
        ts={detailTs}
        loading={detailLoading}
        onClose={() => { setDetailTs(null); setDetailLoading(false); }}
      />
    )}
    </>
  );
}

const DAYS_SHORT = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

function TimesheetDetailModal({ ts, loading, onClose }: { ts: any | null; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          {loading ? (
            <p className="text-sm text-gray-500">กำลังโหลด…</p>
          ) : ts ? (
            <div>
              <p className="font-semibold text-gray-800">{ts.employee.name} <span className="text-xs font-mono text-blue-600 ml-1">{ts.employee.employeeId}</span></p>
              <p className="text-xs text-gray-400 mt-0.5">{ts.employee.department} · สัปดาห์ {new Date(ts.weekStart).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} – {new Date(ts.weekEnd).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          ) : <p className="text-sm text-gray-500">ไม่พบข้อมูล</p>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">×</button>
        </div>

        {ts && (
          <div className="px-5 py-4">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left py-2 px-2 font-medium">โครงการ</th>
                  <th className="text-left py-2 px-2 font-medium">Task</th>
                  {DAYS_SHORT.map((d) => (
                    <th key={d} className="text-center py-2 px-1 font-medium w-8">{d}</th>
                  ))}
                  <th className="text-center py-2 px-2 font-medium">รวม</th>
                </tr>
              </thead>
              <tbody>
                {ts.entries.map((e: any) => {
                  const hrs = [e.monHrs, e.tueHrs, e.wedHrs, e.thuHrs, e.friHrs, e.satHrs, e.sunHrs];
                  return (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="py-2 px-2">
                        <span className="font-medium text-blue-700">{e.project.projectNumber}</span>
                        <span className="text-gray-500 ml-1 text-xs">{e.project.projectName.length > 28 ? e.project.projectName.slice(0, 26) + "…" : e.project.projectName}</span>
                      </td>
                      <td className="py-2 px-2 text-gray-600">{e.taskCode.code} – {e.taskCode.name}</td>
                      {hrs.map((h, i) => (
                        <td key={i} className={`text-center py-2 px-1 ${h > 0 ? "text-gray-800 font-medium" : "text-gray-300"}`}>
                          {h > 0 ? h : "–"}
                        </td>
                      ))}
                      <td className="text-center py-2 px-2 font-semibold text-blue-800">{e.totalHrs}h</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-blue-50">
                  <td colSpan={2} className="py-2 px-2 font-semibold text-gray-700 text-xs">รวมทั้งหมด</td>
                  {[0,1,2,3,4,5,6].map((i) => {
                    const dayKey = ["monHrs","tueHrs","wedHrs","thuHrs","friHrs","satHrs","sunHrs"][i];
                    const total = ts.entries.reduce((s: number, e: any) => s + (e[dayKey] || 0), 0);
                    return <td key={i} className={`text-center py-2 px-1 font-bold text-xs ${total > 0 ? "text-blue-900" : "text-gray-300"}`}>{total > 0 ? total : "–"}</td>;
                  })}
                  <td className="text-center py-2 px-2 font-bold text-blue-900 text-sm">
                    {ts.entries.reduce((s: number, e: any) => s + e.totalHrs, 0)}h
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    submitted:        { label: "รออนุมัติ",        cls: "bg-amber-100 text-amber-800" },
    approved:         { label: "✓ อนุมัติแล้ว",    cls: "bg-green-100 text-green-800" },
    "project-approved": { label: "✓ PD อนุมัติแล้ว", cls: "bg-teal-100 text-teal-800" },
    rejected:         { label: "✗ ไม่อนุมัติ",     cls: "bg-red-100 text-red-800" },
    draft:            { label: "Draft",             cls: "bg-gray-100 text-gray-600" },
    missing:          { label: "ยังไม่ส่ง",        cls: "bg-red-50 text-red-500" },
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

function PlanActualExportBtn({ week }: { week: Date }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; projectNumber: string; projectName: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingProj, setLoadingProj] = useState(false);
  const year = week.getFullYear();

  const openModal = async () => {
    setOpen(true);
    if (projects.length > 0) return;
    setLoadingProj(true);
    const res = await fetch("/api/projects");
    const data = await res.json();
    const list = (data.projects || []) as { id: string; projectNumber: string; projectName: string }[];
    setProjects(list);
    setSelected(new Set(list.map((p) => p.id))); // default: all selected
    setLoadingProj(false);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(selected.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)));
  };

  const doExport = () => {
    const ids = Array.from(selected).join(",");
    const url = `/api/export?type=plan-actual&year=${year}${ids ? `&projectIds=${ids}` : ""}`;
    window.location.href = url;
    setOpen(false);
  };

  return (
    <>
      <button onClick={openModal}
        className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
        📋 Plan vs Actual
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">Export Plan vs Actual</h2>
                <p className="text-xs text-gray-500 mt-0.5">ปี {year} · หน่วย Man-Month (176 ชม)</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* Project list */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingProj ? (
                <div className="text-center text-gray-400 py-8">กำลังโหลดโครงการ…</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{selected.size}/{projects.length} โครงการ</span>
                    <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                      {selected.size === projects.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {projects.map((p) => (
                      <label key={p.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                          className="rounded border-gray-300 text-blue-600 w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-mono text-blue-700 w-16 flex-shrink-0">{p.projectNumber}</span>
                        <span className="text-sm text-gray-700 truncate">{p.projectName}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex items-center justify-end gap-3">
              <button onClick={() => setOpen(false)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button onClick={doExport} disabled={selected.size === 0}
                className="text-sm px-4 py-2 rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 font-medium">
                ⬇ Export {selected.size > 0 ? `(${selected.size} โครงการ)` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
