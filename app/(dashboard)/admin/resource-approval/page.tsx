"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MD_APPROVE_DEPTS = ["Management", "Project Management"];

interface MonthMeta   { month: number; name: string; standardHrs: number; }
interface ProjectPlan {
  projectId: string; projectNumber: string; projectName: string;
  planStatus: string; monthPlans: Record<number, number>;
}
interface EmpData {
  employee: { id: string; employeeId: string; name: string; department: string; position: string };
  monthActuals: Record<number, number>;
  projects: ProjectPlan[];
}
interface DeptData  { name: string; employees: EmpData[]; }
interface WorkloadData { year: number; months: MonthMeta[]; departments: DeptData[]; }

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role    = (session?.user as any)?.role;
  const canAccess = ["ges_management", "admin", "md"].includes(role);
  const isMD      = role === "md";

  const [year, setYear]   = useState(new Date().getFullYear());
  const [data, setData]   = useState<WorkloadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing]   = useState<string | null>(null);
  // MD view tabs
  const [mdView, setMdView] = useState<"workload" | "approve" | "projects">("workload");

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/admin/workload?year=${year}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [year]);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  // Approve a single project
  async function approveProject(projectId: string) {
    setActing(projectId);
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", projectId }),
    });
    setActing(null);
    load();
  }

  if (!canAccess) return null;

  const filterDepts = (depts: DeptData[]): DeptData[] => {
    if (isMD && mdView === "approve") return depts.filter((d) => MD_APPROVE_DEPTS.includes(d.name));
    return depts;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isMD && mdView !== "approve" ? "Plan/Actual" : "Approval Plan"}
          </h1>
          <p className="text-gray-500 text-sm">Workload บุคลากรแยกรายเดือน/รายโครงการ เทียบชั่วโมงมาตรฐาน</p>
        </div>
        {/* Year picker */}
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded-lg border hover:bg-gray-100">◀</button>
          <span className="text-base font-semibold w-16 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded-lg border hover:bg-gray-100">▶</button>
          <button onClick={load} className="ml-2 text-xs text-gray-500 hover:text-blue-600 border rounded px-2 py-1">🔄</button>
        </div>
      </div>

      {/* MD: tab selector */}
      {isMD && (
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-5">
          <button onClick={() => setMdView("workload")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mdView === "workload" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"}`}>
            📊 Plan/Actual รายแผนก
          </button>
          <button onClick={() => setMdView("approve")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mdView === "approve" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"}`}>
            ✅ Approve Plan
          </button>
          <button onClick={() => setMdView("projects")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mdView === "projects" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"}`}>
            📁 Overview รายโครงการ
          </button>
        </div>
      )}

      {/* MD Project Overview */}
      {isMD && mdView === "projects" ? (
        <ProjectOverview />
      ) : loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : !data || data.months.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">ไม่มีข้อมูล Plan ในปี {year}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filterDepts(data.departments).map((dept) => (
            <DeptTable
              key={dept.name}
              dept={dept}
              months={data.months}
              canApprove={!isMD || mdView === "approve"}
              acting={acting}
              approveProject={approveProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Department Table ──────────────────────────────────────────────────────────
function DeptTable({ dept, months, canApprove, acting, approveProject }: {
  dept: DeptData; months: MonthMeta[];
  canApprove: boolean; acting: string | null;
  approveProject: (id: string) => void;
}) {
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  // Sum planned per employee per month (across all projects)
  const getEmpMonthTotal = (emp: EmpData, month: number) =>
    emp.projects.reduce((s, p) => s + (p.monthPlans[month] ?? 0), 0);

  return (
    <div className="ges-card overflow-hidden">
      {/* Dept header */}
      <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
        <h3 className="font-bold text-blue-900">{dept.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{dept.employees.length} คน</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2 font-semibold text-gray-700 min-w-[180px]">พนักงาน</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-700 min-w-[160px]">โครงการ</th>
              {months.map((m) => (
                <th key={m.month} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[110px]">
                  <div>{m.name}</div>
                  <div className="text-xs font-normal text-gray-400">({m.standardHrs}hr)</div>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[60px]">รวม</th>
              {canApprove && <th className="px-3 py-2 min-w-[100px]"></th>}
            </tr>
          </thead>
          <tbody>
            {dept.employees.map((emp) => {
              const empKey  = emp.employee.id;
              const expanded = expandedEmp === empKey;

              // Row: employee summary (total across all projects)
              const empMonthTotals = months.map((m) => getEmpMonthTotal(emp, m.month));
              const empTotal = empMonthTotals.reduce((s, h) => s + h, 0);

              return (
                <>
                  {/* Employee summary row */}
                  <tr key={empKey}
                    className="border-b border-gray-100 bg-blue-50/40 hover:bg-blue-50 cursor-pointer"
                    onClick={() => setExpandedEmp(expanded ? null : empKey)}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-blue-600 text-xs">{expanded ? "▼" : "▶"}</span>
                        <div>
                          <div className="font-semibold text-gray-800">{emp.employee.name}</div>
                          <div className="text-xs text-gray-400">{emp.employee.employeeId} · {emp.employee.position}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 italic">
                      {emp.projects.length} โครงการ
                    </td>
                    {months.map((m, i) => {
                      const planned = empMonthTotals[i];
                      const actual  = emp.monthActuals[m.month] ?? 0;
                      const over    = planned > m.standardHrs;
                      return (
                        <td key={m.month} className="px-3 py-2 text-center">
                          <div className={`font-bold ${over ? "text-red-600" : planned > 0 ? "text-blue-700" : "text-gray-300"}`}>
                            {planned > 0 ? `${planned}h` : "–"}
                          </div>
                          {actual > 0 && (
                            <div className="text-xs text-green-600 mt-0.5">A: {actual}h</div>
                          )}
                          {over && <div className="text-xs text-red-500">+{planned - m.standardHrs}h</div>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center font-bold text-blue-900">
                      {empTotal > 0 ? `${empTotal}h` : "–"}
                    </td>
                    {canApprove && <td></td>}
                  </tr>

                  {/* Project detail rows (expanded) */}
                  {expanded && emp.projects.map((proj) => {
                    const projTotal = months.reduce((s, m) => s + (proj.monthPlans[m.month] ?? 0), 0);
                    const isSubmitted = proj.planStatus === "submitted";
                    const isApproved  = proj.planStatus === "approved";
                    return (
                      <tr key={proj.projectId} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                        <td className="px-4 py-2 pl-10 text-xs text-gray-400"></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-blue-600">{proj.projectNumber}</span>
                            <span className="text-xs text-gray-600 truncate max-w-[120px]">{proj.projectName}</span>
                          </div>
                          <PlanStatusBadge status={proj.planStatus} />
                        </td>
                        {months.map((m) => {
                          const planned = proj.monthPlans[m.month] ?? 0;
                          const over    = planned > m.standardHrs;
                          return (
                            <td key={m.month} className="px-3 py-2 text-center">
                              {planned > 0 ? (
                                <span className={`font-semibold ${over ? "text-red-600" : "text-blue-700"}`}>
                                  {planned}h
                                </span>
                              ) : <span className="text-gray-200">–</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-semibold text-blue-900">
                          {projTotal > 0 ? `${projTotal}h` : "–"}
                        </td>
                        {canApprove && (
                          <td className="px-3 py-2 text-center">
                            {isSubmitted && (
                              <button
                                onClick={() => approveProject(proj.projectId)}
                                disabled={acting === proj.projectId}
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
                                {acting === proj.projectId ? "…" : "✓ Approve"}
                              </button>
                            )}
                            {isApproved && (
                              <span className="text-xs text-green-600 font-medium">✓ Approved</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MD Project Overview ───────────────────────────────────────────────────────
function ProjectOverview() {
  const [groups,  setGroups]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const MONTH_NAMES_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/resource-plan-monthly?forApproval=1");
    const data = await res.json();
    const projects = data.projects || [];
    const results = [];
    for (const proj of projects) {
      if (proj.planStatus === "draft") continue;
      const empRes   = await fetch(`/api/resource-plan-employee-monthly?projectId=${proj.id}`);
      const empData  = await empRes.json();
      const empPlans = empData.plans || [];
      const totalPlanned = empPlans.reduce((s: number, p: any) => s + p.plannedHrs, 0);
      const monthSet = new Set<string>();
      for (const p of empPlans) monthSet.add(`${p.year}|${p.month}`);
      const months = Array.from(monthSet)
        .map((k) => { const [y, m] = k.split("|"); return { year: Number(y), month: Number(m) }; })
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
      results.push({ project: proj, totalPlanned, empCount: new Set(empPlans.map((p: any) => p.employeeId)).size, months, empPlans });
    }
    setGroups(results);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(projectId: string, action: string) {
    setActing(projectId);
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId }),
    });
    setActing(null);
    load();
  }

  if (loading) return <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>;
  if (groups.length === 0) return <div className="ges-card p-10 text-center text-gray-400">ไม่มีแผนที่รอการอนุมัติ</div>;

  return (
    <div className="space-y-4">
      {groups.map(({ project, totalPlanned, empCount, months, empPlans }) => {
        const isExpanded = expandedId === project.id;
        const { planStatus } = project;
        return (
          <div key={project.id} className="ges-card overflow-hidden">
            <div className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              planStatus === "approved" ? "bg-green-50 border-b border-green-100" :
              planStatus === "revision_requested" ? "bg-blue-50 border-b border-blue-100" :
              "bg-amber-50 border-b border-amber-100"
            }`}>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-blue-600">{project.projectNumber}</span>
                  <PlanStatusBadge status={planStatus} />
                </div>
                <h3 className="font-bold text-gray-900 mt-0.5">{project.projectName}</h3>
                <div className="text-xs text-gray-500 mt-1">
                  {project.pd && <span>PD: {project.pd.name} · </span>}
                  {months.length} เดือน · {empCount} คน · {totalPlanned}h
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setExpandedId(isExpanded ? null : project.id)}
                  className="text-xs border border-blue-200 text-blue-600 px-2 py-1 rounded hover:bg-blue-50">
                  {isExpanded ? "ซ่อน" : "ดูแผน"}
                </button>
                {planStatus === "submitted" && (
                  <>
                    <button onClick={() => handleAction(project.id, "approve")} disabled={acting === project.id}
                      className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                      {acting === project.id ? "…" : "✓ อนุมัติ"}
                    </button>
                    <button onClick={() => handleAction(project.id, "reject")} disabled={acting === project.id}
                      className="text-sm bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50">
                      ✗ ไม่อนุมัติ
                    </button>
                  </>
                )}
                {planStatus === "approved" && (
                  <button onClick={() => handleAction(project.id, "reject")} disabled={acting === project.id}
                    className="text-xs text-amber-600 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-50 disabled:opacity-50">
                    ↩ ยกเลิก
                  </button>
                )}
              </div>
            </div>
            {isExpanded && (
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-2">พนักงาน</th>
                      <th className="text-left px-3 py-2">แผนก</th>
                      {months.map((m: { year: number; month: number }) => (
                        <th key={`${m.year}-${m.month}`} className="px-2 py-2 text-center text-gray-500">
                          {MONTH_NAMES_EN[m.month-1]}<br/>{m.year}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-semibold">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set(empPlans.map((p: any) => p.employeeId))).map((empId: any) => {
                      const emp = empPlans.find((p: any) => p.employeeId === empId)?.employee;
                      const rowTotal = empPlans.filter((p: any) => p.employeeId === empId).reduce((s: number, p: any) => s + p.plannedHrs, 0);
                      return (
                        <tr key={empId} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <div className="font-medium">{emp?.name}</div>
                            <div className="text-gray-400">{emp?.employeeId}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-500">{emp?.department}</td>
                          {months.map((m: { year: number; month: number }) => {
                            const p = empPlans.find((ep: any) => ep.employeeId === empId && ep.year === m.year && ep.month === m.month);
                            return (
                              <td key={`${m.year}-${m.month}`} className="px-2 py-2 text-center">
                                {p?.plannedHrs ? <span className="font-semibold text-blue-900">{p.plannedHrs}h</span> : <span className="text-gray-300">–</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-900">{rowTotal > 0 ? `${rowTotal}h` : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:              { label: "Draft",         cls: "bg-gray-100 text-gray-600" },
    submitted:          { label: "📤 รอ Approve",  cls: "bg-amber-100 text-amber-800" },
    revision_requested: { label: "🔄 ขอแก้ไขแผน", cls: "bg-blue-100 text-blue-800" },
    approved:           { label: "✓ Approved",    cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
