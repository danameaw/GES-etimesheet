"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";

interface Employee { id: string; employeeId: string; name: string; department: string; position: string; }
interface Project { id: string; projectNumber: string; projectName: string; manager: { id: string; name: string; employeeId: string } | null; }
interface ResourcePlan { id: string; projectId: string; employeeId: string; weekStart: string; plannedHrs: number; employee: Employee; }
interface ActualEntry { id: string; projectId: string; totalHrs: number; timesheet: { employee: Employee & { department: string } }; }
interface ResourceRow { employee: Employee; planId?: string; plannedHrs: number; actualHrs: number; }

export default function ResourcePlanPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [plans, setPlans] = useState<ResourcePlan[]>([]);
  const [actuals, setActuals] = useState<ActualEntry[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [addEmpId, setAddEmpId] = useState("");
  const [addHrs, setAddHrs] = useState<number>(40);

  const role = (session?.user as any)?.role;
  // Resource Plan: PM + Admin only (NOT PD)
  const canAccess = ["pm", "admin"].includes(role);

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const weekEnd = new Date(currentWeek); weekEnd.setDate(weekEnd.getDate() + 6);

  // Separate: load projects list and load week data
  const loadProjects = useCallback(async () => {
    const res = await fetch(`/api/resource-plan?week=${format(currentWeek, 'yyyy-MM-dd')}`);
    const data = await res.json();
    setProjects(data.projects || []);
    setAllEmployees(data.allEmployees || []);
    // Auto-select first project on first load
    if (data.projects?.length > 0) {
      setSelectedProject((prev) => prev || data.projects[0].id);
    }
  }, [currentWeek]);

  const loadWeekData = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoading(true);
    const res = await fetch(`/api/resource-plan?week=${format(currentWeek, 'yyyy-MM-dd')}&projectId=${projectId}`);
    const data = await res.json();
    setPlans(data.plans || []);
    setActuals(data.actuals || []);
    setLoading(false);
  }, [currentWeek]);

  // Load projects when week changes
  useEffect(() => { if (canAccess) loadProjects(); }, [loadProjects, canAccess]);

  // Load week data when project or week changes
  useEffect(() => { if (selectedProject) loadWeekData(selectedProject); }, [loadWeekData, selectedProject]);

  // Build merged rows
  const buildRows = (): ResourceRow[] => {
    const map = new Map<string, ResourceRow>();
    for (const p of plans) {
      map.set(p.employeeId, { employee: p.employee, planId: p.id, plannedHrs: p.plannedHrs, actualHrs: 0 });
    }
    for (const a of actuals) {
      const empId = a.timesheet.employee.id;
      if (map.has(empId)) { map.get(empId)!.actualHrs += a.totalHrs; }
      else {
        const emp = allEmployees.find((e) => e.id === empId);
        if (emp) map.set(empId, { employee: emp, plannedHrs: 0, actualHrs: a.totalHrs });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  };

  const rows = buildRows();
  const totalPlanned = rows.reduce((s, r) => s + r.plannedHrs, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualHrs, 0);

  async function savePlan(empId: string, hrs: number) {
    if (!selectedProject) return;
    setSaving(empId);
    await fetch("/api/resource-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, employeeId: empId, weekStart: format(currentWeek, 'yyyy-MM-dd'), plannedHrs: hrs }),
    });
    setSaving(null);
    loadWeekData(selectedProject);
  }

  async function removePlan(planId: string) {
    await fetch(`/api/resource-plan?id=${planId}`, { method: "DELETE" });
    loadWeekData(selectedProject);
  }

  async function handleAddMember() {
    if (!addEmpId || !selectedProject) return;
    setSaving("add");
    const res = await fetch("/api/resource-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject, employeeId: addEmpId, weekStart: format(currentWeek, 'yyyy-MM-dd'), plannedHrs: addHrs }),
    });
    setSaving(null);
    if (res.ok) {
      setAddEmpId("");
      setAddHrs(40);
      await loadWeekData(selectedProject);
      await loadProjects(); // refresh employee list
    } else {
      alert("เกิดข้อผิดพลาด: " + (await res.json()).error);
    }
  }

  const assignedIds = new Set(rows.map((r) => r.employee.id));
  const availableToAdd = allEmployees.filter((e) => !assignedIds.has(e.id));
  const selectedProj = projects.find((p) => p.id === selectedProject);

  if (!canAccess) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">วางแผนทรัพยากร</h1>
          <p className="text-gray-500 text-sm">กำหนดชั่วโมงทำงานที่คาดหวังต่อสัปดาห์</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setCurrentWeek((w) => subWeeks(w, 1)); setSelectedProject(""); }} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
          <div className="text-center min-w-[180px]">
            <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
            <p className="text-xs text-gray-400">สัปดาห์ที่ {format(currentWeek, "w")}</p>
          </div>
          <button onClick={() => { setCurrentWeek((w) => addWeeks(w, 1)); setSelectedProject(""); }} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
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
          ) : (
            <>
              {/* Project header */}
              <div className="ges-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-mono text-blue-600 font-semibold">{selectedProj?.projectNumber}</p>
                    <h2 className="text-lg font-bold text-gray-900 mt-0.5">{selectedProj?.projectName}</h2>
                  </div>
                  <div className="flex gap-4 flex-shrink-0 text-center">
                    <div><p className="text-xl font-bold text-blue-900">{totalPlanned}h</p><p className="text-xs text-gray-500">วางแผน</p></div>
                    <div className="w-px bg-gray-200" />
                    <div><p className={`text-xl font-bold ${totalActual >= totalPlanned && totalPlanned > 0 ? "text-green-600" : "text-amber-600"}`}>{totalActual}h</p><p className="text-xs text-gray-500">จริง</p></div>
                    <div className="w-px bg-gray-200" />
                    <div><p className={`text-xl font-bold ${totalPlanned > 0 && Math.round(totalActual/totalPlanned*100) >= 80 ? "text-green-600" : "text-gray-500"}`}>{totalPlanned > 0 ? Math.round(totalActual/totalPlanned*100) : 0}%</p><p className="text-xs text-gray-500">Utilization</p></div>
                  </div>
                </div>
                {totalPlanned > 0 && (
                  <div className="mt-4">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${totalActual >= totalPlanned ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${Math.min(totalActual/totalPlanned*100, 100)}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{totalActual}h จาก {totalPlanned}h ที่วางแผน</p>
                  </div>
                )}
              </div>

              {/* Resource Table */}
              <div className="ges-card overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800 text-sm">ทรัพยากรในโครงการ ({rows.length} คน)</h3>
                </div>
                {loading ? <div className="p-8 text-center text-gray-400">กำลังโหลด…</div> : (
                  <table className="ges-table w-full">
                    <thead><tr>
                      <th className="text-left">พนักงาน</th>
                      <th className="text-left">แผนก</th>
                      <th>วางแผน (h)</th>
                      <th>จริง (h)</th>
                      <th>% Util</th>
                      <th>สถานะ</th>
                      <th className="w-12"></th>
                    </tr></thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-gray-400">ยังไม่มีทรัพยากร — เพิ่มด้านล่างได้เลย</td></tr>
                      ) : rows.map((row) => {
                        const util = row.plannedHrs > 0 ? Math.round(row.actualHrs/row.plannedHrs*100) : null;
                        const over = row.plannedHrs > 0 && row.actualHrs > row.plannedHrs;
                        return (
                          <tr key={row.employee.id}>
                            <td><p className="font-medium text-sm">{row.employee.name}</p><p className="text-xs text-gray-400 font-mono">{row.employee.employeeId}</p></td>
                            <td className="text-xs text-gray-500">{row.employee.department}</td>
                            <td className="text-center">
                              <input type="number" min="0" max="80" step="4" defaultValue={row.plannedHrs}
                                key={`${row.employee.id}-${row.plannedHrs}`}
                                onBlur={(e) => { const v = Number(e.target.value); if (v !== row.plannedHrs) savePlan(row.employee.id, v); }}
                                className="w-16 text-center border border-gray-200 rounded px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            </td>
                            <td className="text-center font-semibold text-sm">
                              <span className={row.actualHrs > 0 ? (over ? "text-red-600" : "text-green-700") : "text-gray-400"}>{row.actualHrs > 0 ? `${row.actualHrs}h` : "-"}</span>
                            </td>
                            <td className="text-center">
                              {util !== null ? (
                                <div className="flex items-center gap-2 justify-center">
                                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${over ? "bg-red-400" : util >= 80 ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${Math.min(util, 100)}%` }} />
                                  </div>
                                  <span className={`text-xs font-medium w-9 ${over ? "text-red-600" : util >= 80 ? "text-green-700" : "text-amber-600"}`}>{util}%</span>
                                </div>
                              ) : "-"}
                            </td>
                            <td className="text-center">
                              {row.plannedHrs > 0 && row.actualHrs === 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">ยังไม่ submit</span>}
                              {over && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">เกิน</span>}
                              {util !== null && util >= 80 && !over && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">ดี</span>}
                            </td>
                            <td className="text-center">
                              {row.planId && <button onClick={() => removePlan(row.planId!)} className="text-gray-300 hover:text-red-500 text-lg leading-none" title="ลบ">×</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Add Member */}
              <div className="ges-card p-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-3">➕ เพิ่มพนักงานเข้าโครงการ</h3>
                {availableToAdd.length === 0 ? (
                  <p className="text-sm text-gray-400">พนักงานทุกคนถูก assign ในโครงการนี้แล้ว</p>
                ) : (
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-xs text-gray-500 mb-1">เลือกพนักงาน *</label>
                      <select value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)} className="ges-input">
                        <option value="">-- เลือกพนักงาน --</option>
                        {availableToAdd.map((e) => (
                          <option key={e.id} value={e.id}>{e.employeeId} – {e.name} ({e.department})</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-36">
                      <label className="block text-xs text-gray-500 mb-1">ชั่วโมงที่วางแผน</label>
                      <input type="number" min="0" max="80" step="4" value={addHrs} onChange={(e) => setAddHrs(Number(e.target.value))} className="ges-input" />
                    </div>
                    <button onClick={handleAddMember} disabled={!addEmpId || saving === "add"} className="ges-btn-primary">
                      {saving === "add" ? "กำลังเพิ่ม…" : "+ เพิ่ม"}
                    </button>
                  </div>
                )}
              </div>

              {/* Summary */}
              {rows.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "On Track", value: rows.filter(r => r.plannedHrs > 0 && r.actualHrs >= r.plannedHrs * 0.8 && r.actualHrs <= r.plannedHrs).length, color: "text-green-700", bg: "bg-green-50", desc: "≥ 80% ของแผน" },
                    { label: "ต่ำกว่าแผน", value: rows.filter(r => r.plannedHrs > 0 && r.actualHrs < r.plannedHrs * 0.8).length, color: "text-amber-700", bg: "bg-amber-50", desc: "< 80% ของแผน" },
                    { label: "เกินแผน", value: rows.filter(r => r.plannedHrs > 0 && r.actualHrs > r.plannedHrs).length, color: "text-red-700", bg: "bg-red-50", desc: "> 100% ของแผน" },
                  ].map(s => (
                    <div key={s.label} className={`ges-card p-4 ${s.bg}`}>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5">{s.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
