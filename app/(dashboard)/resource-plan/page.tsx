"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_NAMES_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

interface Project {
  id: string; projectNumber: string; projectName: string;
  startDate: string | null; endDate: string | null;
  manager: { id: string; name: string; employeeId: string } | null;
}
interface PlanRow  { id: string; projectId: string; department: string; year: number; month: number; plannedHrs: number; planStatus: string; }
interface ActualRow { department: string; year: number; month: number; actualHrs: number; }

// Generate month list between two dates (inclusive)
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
  const canAccess = role === "pm";

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [actuals, setActuals] = useState<ActualRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (projectId?: string) => {
    setLoading(true);
    const url = projectId
      ? `/api/resource-plan-monthly?projectId=${projectId}`
      : `/api/resource-plan-monthly`;
    const res = await fetch(url);
    const d = await res.json();
    setProjects(d.projects || []);
    setDepartments(d.departments || []);
    setPlans(d.plans || []);
    setActuals(d.actuals || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [canAccess, load]);
  useEffect(() => { if (selectedProject) load(selectedProject); }, [selectedProject, load]);

  const selectedProj = projects.find((p) => p.id === selectedProject);

  // Derive months from project dates (or show a 12-month rolling window)
  const months = selectedProj
    ? (() => {
        const start = selectedProj.startDate ? new Date(selectedProj.startDate) : new Date();
        const end   = selectedProj.endDate   ? new Date(selectedProj.endDate)   : new Date(start.getUTCFullYear() + 1, start.getUTCMonth(), 1);
        return monthsBetween(start, end);
      })()
    : [];

  const planStatus = plans.length > 0 ? plans[0].planStatus : "draft";

  function getPlanned(dept: string, year: number, month: number): number {
    return plans.find((p) => p.department === dept && p.year === year && p.month === month)?.plannedHrs || 0;
  }
  function getActual(dept: string, year: number, month: number): number {
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

  // Totals
  const deptTotals = departments.map((dept) => months.reduce((s, m) => s + getPlanned(dept, m.year, m.month), 0));
  const monthTotals = months.map((m) => departments.reduce((s, dept) => s + getPlanned(dept, m.year, m.month), 0));
  const grandTotal  = deptTotals.reduce((s, v) => s + v, 0);

  const deptActualTotals  = departments.map((dept) => months.reduce((s, m) => s + getActual(dept, m.year, m.month), 0));
  const monthActualTotals = months.map((m) => departments.reduce((s, dept) => s + getActual(dept, m.year, m.month), 0));
  const grandActualTotal  = deptActualTotals.reduce((s, v) => s + v, 0);

  if (!canAccess) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource Plan</h1>
          <p className="text-gray-500 text-sm">วางแผนทรัพยากรระยะยาว แยกตามแผนก รายเดือน</p>
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
                      <p className="text-xl font-bold text-blue-900">{grandTotal}h</p>
                      <p className="text-xs text-gray-500">วางแผนรวม</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="text-center">
                      <p className={`text-xl font-bold ${grandActualTotal > 0 ? "text-green-600" : "text-gray-400"}`}>{grandActualTotal}h</p>
                      <p className="text-xs text-gray-500">จริงรวม</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    {/* Actions */}
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

              {/* Plan Matrix */}
              <div className="ges-card overflow-x-auto">
                <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="font-semibold text-gray-800 text-sm">ตารางแผน (ชั่วโมง/เดือน/แผนก)</h3>
                  <p className="text-xs text-gray-400">{months.length > 0 ? `${MONTH_NAMES[months[0].month-1]} ${months[0].year} – ${MONTH_NAMES[months[months.length-1].month-1]} ${months[months.length-1].year}` : ""}</p>
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
                            const key   = `${dept}|${m.year}|${m.month}`;
                            const plan  = getPlanned(dept, m.year, m.month);
                            const actual = getActual(dept, m.year, m.month);
                            const isLocked = planStatus === "approved";
                            return (
                              <td key={`${m.year}-${m.month}`} className="px-1 py-1 text-center">
                                <div className="relative">
                                  <input
                                    type="number" min="0" step="8"
                                    defaultValue={plan}
                                    key={`${dept}-${m.year}-${m.month}-${plan}`}
                                    disabled={isLocked}
                                    onBlur={(e) => {
                                      const v = Number(e.target.value);
                                      if (v !== plan) savePlan(dept, m.year, m.month, v);
                                    }}
                                    className={`w-16 text-center border rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                      isLocked ? "bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed" :
                                      saving === key ? "border-blue-300 bg-blue-50" :
                                      plan > 0 ? "border-blue-200 text-blue-900 font-semibold" : "border-gray-200 text-gray-400"
                                    }`}
                                  />
                                  {actual > 0 && (
                                    <div className={`text-xs mt-0.5 ${actual > plan && plan > 0 ? "text-red-500" : "text-green-600"}`}>
                                      {actual}h จริง
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          {/* Row total */}
                          <td className="px-3 py-2 text-center border-l border-gray-200">
                            <span className={`font-semibold text-sm ${deptTotals[di] > 0 ? "text-blue-900" : "text-gray-300"}`}>{deptTotals[di] || "–"}</span>
                            {deptActualTotals[di] > 0 && <div className="text-xs text-green-600">{deptActualTotals[di]}</div>}
                          </td>
                        </tr>
                      ))}

                      {/* Month totals row */}
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

              {/* Legend */}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="text-blue-900 font-semibold">●</span> ตัวเลขในตาราง = ชั่วโมงที่วางแผน</span>
                <span className="flex items-center gap-1"><span className="text-green-600 font-semibold">●</span> ตัวเลขสีเขียว = ชั่วโมงที่ลงจริงจาก Timesheet</span>
                <span className="flex items-center gap-1"><span className="text-red-500 font-semibold">●</span> สีแดง = เกินแผน</span>
              </div>

              {/* Summary by dept */}
              {grandTotal > 0 && (
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
