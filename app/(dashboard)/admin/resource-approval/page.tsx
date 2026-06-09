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
interface DeptData     { name: string; employees: EmpData[]; }
interface WorkloadData { year: number; months: MonthMeta[]; departments: DeptData[]; }

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router   = useRouter();
  const role     = (session?.user as any)?.role;
  const canAccess = ["ges_management", "admin", "md"].includes(role);
  const isMD      = role === "md";

  const [year, setYear]   = useState(new Date().getFullYear());
  const [data, setData]   = useState<WorkloadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing]   = useState<string | null>(null);  // "<projectId>:<action>"
  const [mdView, setMdView]   = useState<"workload" | "approve" | "projects">("workload");

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/admin/workload?year=${year}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [year]);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  async function planAction(projectId: string, action: string) {
    setActing(`${projectId}:${action}`);
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId }),
    });
    setActing(null);
    load();
  }

  const approveProject = (id: string) => planAction(id, "approve");

  if (!canAccess) return null;

  // Dept filter: Approve tab → only Mgmt/PM, others → all
  const displayDepts = (depts: DeptData[]): DeptData[] =>
    isMD && mdView === "approve"
      ? depts.filter((d) => MD_APPROVE_DEPTS.includes(d.name))
      : depts;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isMD ? (mdView === "approve" ? "Approve Plan" : mdView === "projects" ? "Overview รายโครงการ" : "Plan/Actual") : "Approval Plan"}
          </h1>
          <p className="text-gray-500 text-sm">
            {isMD && mdView === "workload" && "ภาพรวม Workload ทุก Department เทียบมาตรฐาน (ดูอย่างเดียว)"}
            {isMD && mdView === "approve" && "อนุมัติ Resource Plan ของ Management และ Project Management"}
            {isMD && mdView === "projects" && "ภาพรวมรายบุคคลตามโครงการ แสดง Plan vs Actual"}
            {!isMD && "ตรวจสอบ Workload บุคลากรเทียบมาตรฐาน อนุมัติ Resource Plan รายโครงการ"}
          </p>
        </div>
        {/* Year picker — hide for projects tab */}
        {mdView !== "projects" && (
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded-lg border hover:bg-gray-100">◀</button>
            <span className="text-base font-semibold w-16 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded-lg border hover:bg-gray-100">▶</button>
            <button onClick={load} className="ml-2 text-xs text-gray-500 hover:text-blue-600 border rounded px-2 py-1">🔄</button>
          </div>
        )}
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

      {/* ── Tab: Overview รายโครงการ (view-only) ── */}
      {isMD && mdView === "projects" ? (
        <ProjectOverview />

      /* ── Tab: Approve Plan (project-centric, Mgmt+PM only) ── */
      ) : isMD && mdView === "approve" ? (
        <ApprovePlanByProject
          data={data}
          loading={loading}
          acting={acting}
          planAction={planAction}
        />

      /* ── Tab: Plan/Actual รายแผนก (workload, view-only for MD) ── */
      ) : loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : !data || data.months.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">ไม่มีข้อมูล Plan ในปี {year}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GES Management: show all their dept plans with approve */}
          {displayDepts(data.departments).map((dept) => (
            <DeptTable
              key={dept.name}
              dept={dept}
              months={data.months}
              canApprove={!isMD}   // GES Management can approve, MD in workload tab = view only
              acting={acting}
              approveProject={approveProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Department Table (Workload view + Approve Plan view) ─────────────────────
function DeptTable({ dept, months, canApprove, acting, approveProject }: {
  dept: DeptData; months: MonthMeta[];
  canApprove: boolean; acting: string | null;
  approveProject: (id: string) => void;
}) {
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  const getEmpMonthTotal = (emp: EmpData, month: number) =>
    emp.projects.reduce((s, p) => s + (p.monthPlans[month] ?? 0), 0);

  return (
    <div className="ges-card overflow-hidden">
      <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
        <h3 className="font-bold text-blue-900">{dept.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{dept.employees.length} คน</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2 font-semibold text-gray-700 min-w-[180px]">พนักงาน</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-700 min-w-[140px]">โครงการ</th>
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
                    <td className="px-3 py-2 text-xs text-gray-400 italic">{emp.projects.length} โครงการ</td>
                    {months.map((m, i) => {
                      const planned = empMonthTotals[i];
                      const actual  = emp.monthActuals[m.month] ?? 0;
                      const over    = planned > m.standardHrs;
                      return (
                        <td key={m.month} className="px-3 py-2 text-center">
                          <div className={`font-bold ${over ? "text-red-600" : planned > 0 ? "text-blue-700" : "text-gray-300"}`}>
                            {planned > 0 ? `${planned}h` : "–"}
                          </div>
                          {actual > 0 && <div className="text-xs text-green-600 mt-0.5">A: {actual}h</div>}
                          {over && <div className="text-xs text-red-500">+{planned - m.standardHrs}h</div>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center font-bold text-blue-900">{empTotal > 0 ? `${empTotal}h` : "–"}</td>
                    {canApprove && <td></td>}
                  </tr>

                  {/* Project detail rows (expanded) */}
                  {expanded && emp.projects.map((proj) => {
                    const projTotal   = months.reduce((s, m) => s + (proj.monthPlans[m.month] ?? 0), 0);
                    const isSubmitted = proj.planStatus === "submitted";
                    const isApproved  = proj.planStatus === "approved";
                    return (
                      <tr key={proj.projectId} className="border-b border-gray-100 bg-white hover:bg-gray-50">
                        <td className="px-4 py-2 pl-10 text-xs text-gray-400"></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-blue-600">{proj.projectNumber}</span>
                            <span className="text-xs text-gray-600 truncate max-w-[100px]">{proj.projectName}</span>
                          </div>
                          <PlanStatusBadge status={proj.planStatus} />
                        </td>
                        {months.map((m) => {
                          const planned = proj.monthPlans[m.month] ?? 0;
                          const over    = planned > m.standardHrs;
                          return (
                            <td key={m.month} className="px-3 py-2 text-center">
                              {planned > 0
                                ? <span className={`font-semibold ${over ? "text-red-600" : "text-blue-700"}`}>{planned}h</span>
                                : <span className="text-gray-200">–</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-semibold text-blue-900">{projTotal > 0 ? `${projTotal}h` : "–"}</td>
                        {canApprove && (
                          <td className="px-3 py-2 text-center">
                            {isSubmitted && (
                              <button onClick={() => approveProject(proj.projectId)} disabled={acting === proj.projectId}
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
                                {acting === proj.projectId ? "…" : "✓ Approve"}
                              </button>
                            )}
                            {isApproved && <span className="text-xs text-green-600 font-medium">✓ Approved</span>}
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

// ── Approve Plan by Project (MD — Management + Project Management only) ──────
function ApprovePlanByProject({ data, loading, acting, planAction }: {
  data: WorkloadData | null; loading: boolean;
  acting: string | null; planAction: (id: string, action: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>;
  if (!data || data.months.length === 0) return (
    <div className="ges-card p-12 text-center text-gray-400">
      <p className="text-4xl mb-3">📋</p>
      <p className="font-medium">ไม่มีข้อมูล Plan ในปี {data?.year}</p>
    </div>
  );

  // Extract unique projects from Management + Project Management depts
  const targetDepts = data.departments.filter((d) => MD_APPROVE_DEPTS.includes(d.name));

  // Build project map: projectId → { projectNumber, projectName, planStatus, employees: [{emp, monthPlans}] }
  const projMap = new Map<string, {
    projectId: string; projectNumber: string; projectName: string; planStatus: string;
    employees: { employee: any; monthPlans: Record<number, number> }[];
  }>();

  for (const dept of targetDepts) {
    for (const empData of dept.employees) {
      for (const proj of empData.projects) {
        if (!projMap.has(proj.projectId)) {
          projMap.set(proj.projectId, {
            projectId: proj.projectId,
            projectNumber: proj.projectNumber,
            projectName: proj.projectName,
            planStatus: proj.planStatus,
            employees: [],
          });
        }
        projMap.get(proj.projectId)!.employees.push({
          employee: empData.employee,
          monthPlans: proj.monthPlans,
        });
      }
    }
  }

  const projects = Array.from(projMap.values()).sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));

  if (projects.length === 0) return (
    <div className="ges-card p-10 text-center text-gray-400">
      ไม่มีข้อมูล Plan สำหรับ Department Management / Project Management
    </div>
  );

  return (
    <div className="space-y-4">
      {projects.map((proj) => {
        const isExpanded          = expandedId === proj.projectId;
        const isSubmitted         = proj.planStatus === "submitted";
        const isApproved          = proj.planStatus === "approved";
        const isRevisionRequested = proj.planStatus === "revision_requested";
        const totalPlan           = proj.employees.reduce((s, e) =>
          s + data.months.reduce((ms, m) => ms + (e.monthPlans[m.month] ?? 0), 0), 0);

        return (
          <div key={proj.projectId} className="ges-card overflow-hidden">
            {/* Project header */}
            <div className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b ${
              isApproved          ? "bg-green-50 border-green-100"
              : isSubmitted       ? "bg-amber-50 border-amber-100"
              : isRevisionRequested ? "bg-blue-50 border-blue-100"
              : "bg-gray-50 border-gray-100"
            }`}>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-blue-600">{proj.projectNumber}</span>
                  <PlanStatusBadge status={proj.planStatus} />
                </div>
                <h3 className="font-bold text-gray-900 mt-0.5">{proj.projectName}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {proj.employees.length} คน · Plan รวม: {totalPlan}h
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setExpandedId(isExpanded ? null : proj.projectId)}
                  className="text-xs border border-blue-200 text-blue-600 px-3 py-1.5 rounded hover:bg-blue-50">
                  {isExpanded ? "ซ่อน" : "ดูรายละเอียด"}
                </button>
                {isSubmitted && (
                  <button onClick={() => planAction(proj.projectId, "approve")}
                    disabled={acting === `${proj.projectId}:approve`}
                    className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                    {acting === `${proj.projectId}:approve` ? "…" : "✓ Approve"}
                  </button>
                )}
                {isApproved && (
                  <span className="text-sm text-green-600 font-semibold">✓ Approved แล้ว</span>
                )}
                {isRevisionRequested && (
                  <>
                    <button onClick={() => planAction(proj.projectId, "approve_revision")}
                      disabled={!!acting}
                      className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                      {acting === `${proj.projectId}:approve_revision` ? "…" : "✓ ยินยอมให้แก้ไข"}
                    </button>
                    <button onClick={() => planAction(proj.projectId, "reject_revision")}
                      disabled={!!acting}
                      className="text-sm bg-red-500 text-white px-4 py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-50 font-medium">
                      {acting === `${proj.projectId}:reject_revision` ? "…" : "✗ ไม่อนุญาต"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Employee detail table */}
            {isExpanded && (
              <div className="overflow-x-auto">
                <table className="text-sm w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 font-semibold text-gray-700 min-w-[180px]">พนักงาน</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">แผนก</th>
                      {data.months.map((m) => (
                        <th key={m.month} className="px-3 py-2 text-center font-semibold text-gray-700 min-w-[100px]">
                          <div>{m.name}</div>
                          <div className="text-xs font-normal text-gray-400">({m.standardHrs}hr)</div>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proj.employees.map((e, i) => {
                      const empTotal = data.months.reduce((s, m) => s + (e.monthPlans[m.month] ?? 0), 0);
                      return (
                        <tr key={e.employee.id} className={`border-t border-gray-100 ${i%2===0?"bg-white":"bg-gray-50/50"} hover:bg-blue-50/30`}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-gray-800">{e.employee.name}</div>
                            <div className="text-xs text-gray-400">{e.employee.employeeId}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{e.employee.department}</td>
                          {data.months.map((m) => {
                            const planned = e.monthPlans[m.month] ?? 0;
                            const over    = planned > m.standardHrs;
                            return (
                              <td key={m.month} className="px-3 py-2 text-center">
                                {planned > 0
                                  ? <span className={`font-semibold ${over ? "text-red-600" : "text-blue-700"}`}>{planned}h</span>
                                  : <span className="text-gray-300">–</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-900">
                            {empTotal > 0 ? `${empTotal}h` : "–"}
                          </td>
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

// ── MD Overview: ภาพรวมรายบุคคลตามโครงการ (view-only, Plan vs Actual) ────────
function ProjectOverview() {
  const [groups,  setGroups]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Fetch all non-draft projects
    const res  = await fetch("/api/resource-plan-monthly?forApproval=1");
    const data = await res.json();
    const projects: any[] = (data.projects || []).filter((p: any) => p.planStatus !== "draft");

    const results = await Promise.all(
      projects.map(async (proj) => {
        const empRes  = await fetch(`/api/resource-plan-employee-monthly?projectId=${proj.id}`);
        const empData = await empRes.json();
        const plans: any[]   = empData.plans   || [];
        const actuals: any[] = empData.actuals || [];

        // Build plan map: DB-id → { employee, totalPlanned }
        const empMap = new Map<string, { employee: any; totalPlanned: number; totalActual: number }>();
        for (const p of plans) {
          const empId = p.employeeId; // DB id
          if (!empMap.has(empId)) empMap.set(empId, { employee: p.employee, totalPlanned: 0, totalActual: 0 });
          empMap.get(empId)!.totalPlanned += p.plannedHrs;
        }
        // Match actuals by DB id (actuals.employeeId = DB id from timesheet.employeeId)
        for (const a of actuals) {
          if (empMap.has(a.employeeId)) {
            empMap.get(a.employeeId)!.totalActual += a.actualHrs;
          }
        }

        const employees = Array.from(empMap.values())
          .filter((e) => e.totalPlanned > 0 || e.totalActual > 0)
          .sort((a, b) => a.employee.name.localeCompare(b.employee.name));

        return { project: proj, employees };
      })
    );

    setGroups(results.filter((g) => g.employees.length > 0));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>;
  if (groups.length === 0) return (
    <div className="ges-card p-12 text-center text-gray-400">
      <p className="text-4xl mb-3">📋</p>
      <p className="font-medium">ไม่มีข้อมูล Plan ในระบบ</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {groups.map(({ project, employees }) => {
        const isExpanded = expandedId === project.id;
        const totalPlan   = employees.reduce((s: number, e: any) => s + e.totalPlanned, 0);
        const totalActual = employees.reduce((s: number, e: any) => s + e.totalActual, 0);
        const overCount   = employees.filter((e: any) => e.totalActual > e.totalPlanned && e.totalPlanned > 0).length;

        return (
          <div key={project.id} className="ges-card overflow-hidden">
            {/* Project header */}
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-blue-600">{project.projectNumber}</span>
                  <PlanStatusBadge status={project.planStatus} />
                  {overCount > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      ⚠ {overCount} คน Actual เกิน Plan
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-gray-900 mt-0.5">{project.projectName}</h3>
                <div className="text-xs text-gray-500 mt-1">
                  {employees.length} คน · Plan รวม: {totalPlan}h · Actual รวม: {totalActual}h
                  {project.pd && <span> · PD: {project.pd.name}</span>}
                </div>
              </div>
              <button onClick={() => setExpandedId(isExpanded ? null : project.id)}
                className="text-xs border border-blue-200 text-blue-600 px-3 py-1.5 rounded hover:bg-blue-50">
                {isExpanded ? "ซ่อน" : "ดูรายละเอียด"}
              </button>
            </div>

            {/* Employee plan vs actual table */}
            {isExpanded && (
              <div className="overflow-x-auto">
                <table className="text-sm w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 font-semibold text-gray-700">พนักงาน</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">แผนก</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[90px]">Plan รวม</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[90px]">Actual รวม</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[120px]">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp: any) => {
                      const plan   = emp.totalPlanned;
                      const actual = emp.totalActual;
                      const over   = plan > 0 && actual > plan;
                      const under  = plan > 0 && actual < plan;
                      const diff   = Math.abs(actual - plan);

                      return (
                        <tr key={emp.employee.id ?? emp.employee.employeeId} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <div className="font-medium text-gray-800">{emp.employee.name}</div>
                            <div className="text-xs text-gray-400">{emp.employee.employeeId}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{emp.employee.department}</td>
                          <td className="px-3 py-2 text-center font-semibold text-purple-700">
                            {plan > 0 ? `${plan}h` : <span className="text-gray-300">–</span>}
                          </td>
                          <td className="px-3 py-2 text-center font-bold"
                            style={{ color: over ? "#dc2626" : under ? "#d97706" : "#16a34a" }}>
                            {actual > 0 ? `${actual}h` : <span className="text-gray-300">–</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {plan === 0 ? (
                              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">ไม่มีแผน</span>
                            ) : over ? (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                                🔴 เกิน {diff}h
                              </span>
                            ) : under ? (
                              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                                🟡 ต่ำกว่า {diff}h
                              </span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                ✅ ตาม Plan
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Summary row */}
                    <tr className="border-t-2 border-gray-300 bg-blue-50">
                      <td colSpan={2} className="px-4 py-2 font-bold text-gray-700 text-sm">รวม</td>
                      <td className="px-3 py-2 text-center font-bold text-purple-800">{totalPlan > 0 ? `${totalPlan}h` : "–"}</td>
                      <td className="px-3 py-2 text-center font-bold"
                        style={{ color: totalActual > totalPlan ? "#dc2626" : totalActual < totalPlan ? "#d97706" : "#16a34a" }}>
                        {totalActual > 0 ? `${totalActual}h` : "–"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {totalPlan > 0 && (
                          <span className="text-xs font-semibold text-gray-600">
                            {Math.round((totalActual / totalPlan) * 100)}%
                          </span>
                        )}
                      </td>
                    </tr>
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
