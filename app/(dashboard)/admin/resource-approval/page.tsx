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
interface DeptApprovalEntry { department: string; status: string; }
interface WorkloadData {
  year: number; months: MonthMeta[]; departments: DeptData[];
  deptApprovalMap: Record<string, DeptApprovalEntry[]>;
}

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router   = useRouter();
  const role        = (session?.user as any)?.role;
  const managedDept = (session?.user as any)?.managedDept as string | undefined;
  const canAccess   = ["ges_management", "ges_pd", "admin", "md"].includes(role);
  const isMD        = role === "md";

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

  // Dept filter:
  // - MD approve tab → Management + Project Management only
  // - ges_management/ges_pd → only their managedDept
  // - admin → all
  const displayDepts = (depts: DeptData[]): DeptData[] => {
    if (isMD && mdView === "approve") return depts.filter((d) => MD_APPROVE_DEPTS.includes(d.name));
    if (["ges_management", "ges_pd"].includes(role) && managedDept)
      return depts.filter((d) => d.name === managedDept);
    return depts;
  };

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
      ) : displayDepts(data.departments).length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">ไม่มีข้อมูล Plan สำหรับ Department ที่คุณดูแล</p>
          <p className="text-xs mt-1">กรุณา logout แล้ว login ใหม่หากยังไม่เห็นข้อมูล</p>
        </div>
      ) : (
        <div className="space-y-6">
          {displayDepts(data.departments).map((dept) => (
            <DeptTable
              key={dept.name}
              dept={dept}
              months={data.months}
              canApprove={!isMD}
              acting={acting}
              approveProject={approveProject}
              planAction={planAction}
              deptApprovalMap={data.deptApprovalMap || {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Department Table (Workload view + Approve Plan view) ─────────────────────
function DeptTable({ dept, months, canApprove, acting, approveProject, planAction, deptApprovalMap }: {
  dept: DeptData; months: MonthMeta[];
  canApprove: boolean; acting: string | null;
  approveProject: (id: string) => void;
  planAction: (id: string, action: string) => void;
  deptApprovalMap: Record<string, DeptApprovalEntry[]>;
}) {
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  const getEmpMonthTotal = (emp: EmpData, month: number) =>
    emp.projects.reduce((s, p) => s + (p.monthPlans[month] ?? 0), 0);

  // Unique projects in this dept that need action
  const actionableProjects = canApprove ? (() => {
    const projMap = new Map<string, { projectId: string; projectNumber: string; projectName: string; planStatus: string }>();
    for (const emp of dept.employees)
      for (const proj of emp.projects)
        if (!projMap.has(proj.projectId)) projMap.set(proj.projectId, proj);
    return Array.from(projMap.values()).filter(
      (p) => p.planStatus === "submitted" || p.planStatus === "revision_requested"
    );
  })() : [];

  return (
    <div className="ges-card overflow-hidden">
      <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-blue-900">{dept.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{dept.employees.length} คน</p>
          </div>
          {actionableProjects.length > 0 && (
            <div className="flex flex-col gap-2">
              {actionableProjects.map((proj) => (
                <div key={proj.projectId} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
                  proj.planStatus === "revision_requested"
                    ? "bg-blue-50 border-blue-200"
                    : "bg-amber-50 border-amber-200"
                }`}>
                  <span className="text-xs font-mono text-blue-600 font-semibold">{proj.projectNumber}</span>
                  <span className="text-xs text-gray-700 max-w-[150px] truncate">{proj.projectName}</span>
                  <PlanStatusBadge status={proj.planStatus} />
                  {proj.planStatus === "submitted" && (() => {
                    const allDeptApprovals = deptApprovalMap[proj.projectId] || [];
                    const myDeptApproval = allDeptApprovals.find((da) => da.department === dept.name);
                    const otherApprovals = allDeptApprovals.filter((da) => da.department !== dept.name);
                    const alreadyApproved = myDeptApproval?.status === "approved";
                    return (
                      <div className="flex flex-col gap-1.5">
                        {otherApprovals.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {otherApprovals.map((da) => (
                              <span key={da.department} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                                da.status === "approved"
                                  ? "bg-green-50 border-green-200 text-green-700"
                                  : "bg-amber-50 border-amber-200 text-amber-700"
                              }`}>
                                {da.status === "approved" ? "✓" : "⏳"} {da.department}
                              </span>
                            ))}
                          </div>
                        )}
                        {alreadyApproved
                          ? <span className="text-xs text-green-600 font-semibold">✓ {dept.name} อนุมัติแล้ว</span>
                          : <button
                              onClick={() => planAction(proj.projectId, "dept_approve")}
                              disabled={acting === `${proj.projectId}:dept_approve`}
                              className="text-xs bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium whitespace-nowrap">
                              {acting === `${proj.projectId}:dept_approve` ? "…" : `✓ Approve (${dept.name})`}
                            </button>
                        }
                      </div>
                    );
                  })()}
                  {proj.planStatus === "revision_requested" && (
                    <>
                      <button
                        onClick={() => planAction(proj.projectId, "approve_revision")}
                        disabled={!!acting}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium whitespace-nowrap">
                        {acting === `${proj.projectId}:approve_revision` ? "…" : "✓ ยินยอมให้แก้ไข"}
                      </button>
                      <button
                        onClick={() => planAction(proj.projectId, "reject_revision")}
                        disabled={!!acting}
                        className="text-xs bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600 disabled:opacity-50 font-medium whitespace-nowrap">
                        {acting === `${proj.projectId}:reject_revision` ? "…" : "✗ ไม่อนุญาต"}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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

const MONTH_NAMES_TH_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

// ── MD Overview: ภาพรวมรายบุคคลตามโครงการ (view-only, Plan vs Actual) ────────
function ProjectOverview() {
  const currentYear = new Date().getFullYear();
  const [groups,        setGroups]        = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [availYears,    setAvailYears]    = useState<number[]>([]);
  const [selectedYear,  setSelectedYear]  = useState<number>(currentYear);
  const [availMonths,   setAvailMonths]   = useState<number[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null); // null = รวม (ทั้งปี)

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch("/api/resource-plan-monthly?forApproval=1");
    const data = await res.json();
    const projects: any[] = (data.projects || []).filter((p: any) => p.planStatus !== "draft");

    const results = await Promise.all(
      projects.map(async (proj) => {
        const empRes  = await fetch(`/api/resource-plan-employee-monthly?projectId=${proj.id}`);
        const empData = await empRes.json();
        const plans: any[]   = empData.plans   || [];
        const actuals: any[] = empData.actuals || [];

        // Store per-employee monthly breakdown keyed by "year-month"
        type EmpEntry = { employee: any; monthPlanned: Record<string, number>; monthActual: Record<string, number> };
        const empMap = new Map<string, EmpEntry>();
        for (const p of plans) {
          const empId = p.employeeId;
          if (!empMap.has(empId)) empMap.set(empId, { employee: p.employee, monthPlanned: {}, monthActual: {} });
          const key = `${p.year}-${p.month}`;
          empMap.get(empId)!.monthPlanned[key] = (empMap.get(empId)!.monthPlanned[key] ?? 0) + p.plannedHrs;
        }
        for (const a of actuals) {
          if (empMap.has(a.employeeId)) {
            const key = `${a.year}-${a.month}`;
            empMap.get(a.employeeId)!.monthActual[key] = (empMap.get(a.employeeId)!.monthActual[key] ?? 0) + a.actualHrs;
          }
        }

        const employees = Array.from(empMap.values())
          .filter((e) => Object.values(e.monthPlanned).some((h) => h > 0) || Object.values(e.monthActual).some((h) => h > 0))
          .sort((a, b) => a.employee.name.localeCompare(b.employee.name));

        return { project: proj, employees };
      })
    );

    const filled = results.filter((g) => g.employees.length > 0);
    setGroups(filled);

    // Collect distinct years from all data
    const yearSet = new Set<number>();
    for (const { employees } of filled)
      for (const emp of employees) {
        for (const key of Object.keys(emp.monthPlanned)) yearSet.add(Number(key.split("-")[0]));
        for (const key of Object.keys(emp.monthActual))  yearSet.add(Number(key.split("-")[0]));
      }
    const years = Array.from(yearSet).sort((a, b) => a - b);
    setAvailYears(years);
    // Default to current year if available, else first year
    setSelectedYear((y) => years.includes(y) ? y : (years.includes(currentYear) ? currentYear : years[0] ?? currentYear));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recompute available months when selected year changes
  useEffect(() => {
    const monthSet = new Set<number>();
    for (const { employees } of groups)
      for (const emp of employees) {
        for (const key of Object.keys(emp.monthPlanned)) {
          const [y, m] = key.split("-").map(Number);
          if (y === selectedYear) monthSet.add(m);
        }
        for (const key of Object.keys(emp.monthActual)) {
          const [y, m] = key.split("-").map(Number);
          if (y === selectedYear) monthSet.add(m);
        }
      }
    setAvailMonths(Array.from(monthSet).sort((a, b) => a - b));
    setSelectedMonth(null); // reset to "รวม" when year changes
  }, [selectedYear, groups]);

  // Sum hours filtered by selected year + optional month
  function calcTotals(emp: any, year: number, monthFilter: number | null) {
    let planned = 0, actual = 0;
    for (const [key, h] of Object.entries(emp.monthPlanned as Record<string, number>)) {
      const [y, m] = key.split("-").map(Number);
      if (y === year && (monthFilter === null || m === monthFilter)) planned += h as number;
    }
    for (const [key, h] of Object.entries(emp.monthActual as Record<string, number>)) {
      const [y, m] = key.split("-").map(Number);
      if (y === year && (monthFilter === null || m === monthFilter)) actual += h as number;
    }
    return { planned, actual };
  }

  if (loading) return <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>;
  if (groups.length === 0) return (
    <div className="ges-card p-12 text-center text-gray-400">
      <p className="text-4xl mb-3">📋</p>
      <p className="font-medium">ไม่มีข้อมูล Plan ในระบบ</p>
    </div>
  );

  const planLabel   = selectedMonth !== null
    ? `Plan ${MONTH_NAMES_TH_SHORT[selectedMonth - 1]} ${selectedYear}`
    : `Plan รวม ${selectedYear}`;
  const actualLabel = selectedMonth !== null
    ? `Actual ${MONTH_NAMES_TH_SHORT[selectedMonth - 1]} ${selectedYear}`
    : `Actual รวม ${selectedYear}`;

  return (
    <div className="space-y-4">
      {/* Year + Month filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Year selector */}
        <div className="flex items-center gap-1">
          <button onClick={() => setSelectedYear(y => { const i = availYears.indexOf(y); return i > 0 ? availYears[i-1] : y; })}
            className="px-2 py-1 rounded border text-xs hover:bg-gray-100">◀</button>
          <span className="text-sm font-semibold w-14 text-center">{selectedYear}</span>
          <button onClick={() => setSelectedYear(y => { const i = availYears.indexOf(y); return i < availYears.length-1 ? availYears[i+1] : y; })}
            className="px-2 py-1 rounded border text-xs hover:bg-gray-100">▶</button>
        </div>

        <span className="text-gray-300">|</span>

        {/* Month selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">เดือน:</span>
          <button
            onClick={() => setSelectedMonth(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              selectedMonth === null
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
            }`}>
            รวม
          </button>
          {availMonths.map((m) => (
            <button key={m}
              onClick={() => setSelectedMonth(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                selectedMonth === m
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}>
              {MONTH_NAMES_TH_SHORT[m - 1]}
            </button>
          ))}
        </div>
      </div>

      {groups.map(({ project, employees }) => {
        const isExpanded = expandedId === project.id;

        const empTotals   = employees.map((emp: any) => ({ ...emp, ...calcTotals(emp, selectedYear, selectedMonth) }));
        const visibleEmps = empTotals.filter((e: any) => e.planned > 0 || e.actual > 0);
        const totalPlan   = visibleEmps.reduce((s: number, e: any) => s + e.planned, 0);
        const totalActual = visibleEmps.reduce((s: number, e: any) => s + e.actual, 0);
        const overCount   = visibleEmps.filter((e: any) => e.actual > e.planned && e.planned > 0).length;

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
                  {visibleEmps.length} คน · {planLabel}: {totalPlan}h · {actualLabel}: {totalActual}h
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
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[90px]">{planLabel}</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[90px]">{actualLabel}</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-700 min-w-[120px]">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEmps.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">ไม่มีข้อมูลสำหรับเดือนนี้</td></tr>
                    ) : visibleEmps.map((emp: any) => {
                      const plan   = emp.planned;
                      const actual = emp.actual;
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
                    {visibleEmps.length > 0 && (
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
                    )}
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
