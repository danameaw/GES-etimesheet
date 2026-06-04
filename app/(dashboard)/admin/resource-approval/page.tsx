"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

// Departments MD can approve
const MD_APPROVE_DEPTS = ["Management", "Project Management"];

interface EmpWorkload {
  employee:     { id: string; employeeId: string; name: string; department: string; position: string };
  totalPlanned: number;
  projects:     { projectId: string; projectNumber: string; projectName: string; planStatus: string; plannedHrs: number }[];
}
interface DeptWorkload { name: string; employees: EmpWorkload[]; }
interface WorkloadData {
  year: number; month: number;
  standardHrs: number; workingDays: number;
  holidays: { date: string; name: string }[];
  departments: DeptWorkload[];
}

const MONTH_NAMES = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const canAccess = ["ges_management", "admin", "md"].includes(role);
  const isMD      = role === "md";

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data,  setData]  = useState<WorkloadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  // MD view: "workload" or "projects"
  const [mdView, setMdView] = useState<"workload" | "projects">("workload");

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/admin/workload?year=${year}&month=${month}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  // Approve all submitted projects that have employees in this dept this month
  async function approveDept(deptName: string) {
    if (!data) return;
    const dept = data.departments.find((d) => d.name === deptName);
    if (!dept) return;

    const projectIds = Array.from(
      new Set(
        dept.employees
          .flatMap((e) => e.projects)
          .filter((p) => p.planStatus === "submitted")
          .map((p) => p.projectId)
      )
    );
    if (projectIds.length === 0) { alert("ไม่มี Plan ที่รอ Approve ใน Department นี้"); return; }

    setActing(deptName);
    await Promise.all(
      projectIds.map((id) =>
        fetch("/api/resource-plan-monthly", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", projectId: id }),
        })
      )
    );
    setActing(null);
    load();
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  if (!canAccess) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Plan</h1>
          <p className="text-gray-500 text-sm">ตรวจสอบ Workload บุคลากรเทียบกับชั่วโมงมาตรฐาน</p>
        </div>
        {/* Month picker */}
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg border hover:bg-gray-100">◀</button>
          <span className="text-base font-semibold w-28 text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg border hover:bg-gray-100">▶</button>
          <button onClick={load} className="ml-2 text-xs text-gray-500 hover:text-blue-600 border rounded px-2 py-1">🔄</button>
        </div>
      </div>

      {/* Standard hours info */}
      {data && (
        <div className="ges-card p-4 mb-5 flex flex-wrap gap-4 text-sm">
          <span>📅 วันทำงาน: <strong>{data.workingDays} วัน</strong></span>
          <span>⏱ ชั่วโมงมาตรฐาน: <strong className="text-blue-700">{data.standardHrs} ชม.</strong></span>
          {data.holidays.length > 0 && (
            <span className="text-gray-500">🎌 วันหยุด: {data.holidays.map(h => h.name).join(", ")}</span>
          )}
        </div>
      )}

      {/* MD: tab selector */}
      {isMD && (
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-5">
          <button onClick={() => setMdView("workload")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mdView === "workload" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"}`}>
            📊 Workload รายแผนก
          </button>
          <button onClick={() => setMdView("projects")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mdView === "projects" ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"}`}>
            📁 Overview รายโครงการ
          </button>
        </div>
      )}

      {loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : !data || data.departments.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">ไม่มีข้อมูล Plan ในเดือนนี้</p>
        </div>
      ) : mdView === "projects" && isMD ? (
        <ProjectOverview year={year} month={month} />
      ) : (
        /* Workload by department */
        <div className="space-y-5">
          {data.departments.map((dept) => {
            const canApprove =
              isMD ? MD_APPROVE_DEPTS.includes(dept.name)
              : true; // ges_management can approve own dept (only their dept is shown)

            const hasSubmitted = dept.employees.some((e) => e.projects.some((p) => p.planStatus === "submitted"));
            const overCount    = dept.employees.filter((e) => e.totalPlanned > data.standardHrs).length;

            return (
              <div key={dept.name} className="ges-card overflow-hidden">
                {/* Dept header */}
                <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-bold text-blue-900">{dept.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {dept.employees.length} คน
                      {overCount > 0 && <span className="ml-2 text-red-600 font-medium">⚠ {overCount} คน Overload</span>}
                    </p>
                  </div>
                  {canApprove && hasSubmitted && (
                    <button
                      onClick={() => approveDept(dept.name)}
                      disabled={acting === dept.name}
                      className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                    >
                      {acting === dept.name ? "…" : "✓ Approve Department"}
                    </button>
                  )}
                  {canApprove && !hasSubmitted && (
                    <span className="text-xs text-green-600 font-medium">✓ ไม่มี Plan รอ Approve</span>
                  )}
                </div>

                {/* Employee table */}
                <div className="overflow-x-auto">
                  <table className="ges-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left">พนักงาน</th>
                        <th className="text-left">ตำแหน่ง</th>
                        <th className="text-center">Plan รวม</th>
                        <th className="text-center">มาตรฐาน</th>
                        <th className="text-center">สถานะ</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dept.employees.map((emp) => {
                        const isOver   = emp.totalPlanned > data.standardHrs;
                        const empKey   = emp.employee.id;
                        const expanded = expandedEmp === empKey;
                        return (
                          <>
                            <tr key={empKey} className="hover:bg-gray-50">
                              <td>
                                <div className="font-medium text-gray-800">{emp.employee.name}</div>
                                <div className="text-xs text-gray-400">{emp.employee.employeeId}</div>
                              </td>
                              <td className="text-xs text-gray-500">{emp.employee.position}</td>
                              <td className="text-center font-bold" style={{ color: isOver ? "#dc2626" : "#1d4ed8" }}>
                                {emp.totalPlanned}h
                              </td>
                              <td className="text-center text-gray-500">{data.standardHrs}h</td>
                              <td className="text-center">
                                {isOver ? (
                                  <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                    ⚠ เกิน {emp.totalPlanned - data.standardHrs}h
                                  </span>
                                ) : (
                                  <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                    ✓ ปกติ
                                  </span>
                                )}
                              </td>
                              <td className="text-center">
                                <button
                                  onClick={() => setExpandedEmp(expanded ? null : empKey)}
                                  className="text-xs text-blue-500 hover:underline"
                                >
                                  {expanded ? "ซ่อน" : `ดู (${emp.projects.length})`}
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr key={`${empKey}-detail`} className="bg-blue-50">
                                <td colSpan={6} className="px-6 py-2">
                                  <div className="space-y-1">
                                    {emp.projects.map((p) => (
                                      <div key={p.projectId} className="flex items-center gap-3 text-xs">
                                        <span className="font-mono font-semibold text-blue-700 w-20">{p.projectNumber}</span>
                                        <span className="text-gray-600 flex-1 truncate">{p.projectName}</span>
                                        <span className="font-semibold">{p.plannedHrs}h</span>
                                        <PlanStatusBadge status={p.planStatus} />
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MD Project Overview (existing per-project view) ──────────────────────────
function ProjectOverview({ year: _year, month: _month }: { year: number; month: number }) {
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
      const empRes  = await fetch(`/api/resource-plan-employee-monthly?projectId=${proj.id}`);
      const empData = await empRes.json();
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
                      className="text-sm bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50 font-medium">
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
