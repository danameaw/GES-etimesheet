"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Project {
  id: string; projectNumber: string; projectName: string;
  startDate: string | null; endDate: string | null;
  planStatus: string;
  manager: { id: string; name: string; employeeId: string } | null;
  pd:      { id: string; name: string; employeeId: string } | null;
}
interface EmpPlan { employeeId: string; year: number; month: number; plannedHrs: number;
  employee: { employeeId: string; name: string; department: string; }; }

interface ProjectGroup {
  project: Project;
  totalPlanned: number;
  empCount: number;
  months: { year: number; month: number }[];
  empPlans: EmpPlan[];
}

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const canAccess = ["pd", "admin"].includes(role);

  const [groups, setGroups]   = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"pending" | "approved" | "all">("pending");

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    // forApproval=1 → bypass pdId filter so revision_requested projects always show
    const res = await fetch("/api/resource-plan-monthly?forApproval=1");
    const data = await res.json();
    const projects: Project[] = data.projects || [];

    const groupResults: ProjectGroup[] = [];
    for (const proj of projects) {
      if (proj.planStatus === "draft") continue; // skip pure drafts

      // Fetch employee plan for this project
      const empRes = await fetch(`/api/resource-plan-employee-monthly?projectId=${proj.id}`);
      const empData = await empRes.json();
      const empPlans: EmpPlan[] = empData.plans || [];

      // Still include the project even if no employee-level plans yet
      // (project may only have dept-level plans)

      const totalPlanned = empPlans.reduce((s, p) => s + p.plannedHrs, 0);
      const empSet = new Set(empPlans.map((p) => p.employeeId));
      const monthSet = new Set<string>();
      for (const p of empPlans) monthSet.add(`${p.year}|${p.month}`);
      const months = Array.from(monthSet)
        .map((k) => { const [y, m] = k.split("|"); return { year: Number(y), month: Number(m) }; })
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

      groupResults.push({
        project: proj,
        totalPlanned,
        empCount: empSet.size,
        months,
        empPlans,
      });
    }

    setGroups(groupResults);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  async function handleAction(projectId: string, action: "approve" | "reject" | "approve_revision" | "reject_revision") {
    setActing(projectId);
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId }),
    });
    setActing(null);
    load();
  }

  const pendingGroups  = groups.filter((g) => g.project.planStatus === "submitted" || g.project.planStatus === "revision_requested");
  const approvedGroups = groups.filter((g) => g.project.planStatus === "approved");
  const revisionGroups = groups.filter((g) => g.project.planStatus === "revision_requested");

  const displayedGroups =
    filterStatus === "pending"  ? pendingGroups  :
    filterStatus === "approved" ? approvedGroups :
    groups;

  if (!canAccess) return null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">อนุมัติแผนทรัพยากร</h1>
          <p className="text-gray-500 text-sm">ตรวจสอบและอนุมัติ Resource Plan จาก PM</p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-blue-600">🔄 Refresh</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="ges-card p-4 cursor-pointer hover:shadow-md" onClick={() => setFilterStatus("pending")}>
          <p className="text-2xl font-bold text-amber-600">{pendingGroups.filter(g => g.project.planStatus === "submitted").length}</p>
          <p className="text-sm text-gray-500 mt-0.5">รอ Approve</p>
        </div>
        <div className="ges-card p-4 cursor-pointer hover:shadow-md border-2 border-blue-200" onClick={() => setFilterStatus("pending")}>
          <p className="text-2xl font-bold text-blue-600">{revisionGroups.length}</p>
          <p className="text-sm text-gray-500 mt-0.5">ขอแก้ไขแผน</p>
        </div>
        <div className="ges-card p-4 cursor-pointer hover:shadow-md" onClick={() => setFilterStatus("approved")}>
          <p className="text-2xl font-bold text-green-600">{approvedGroups.length}</p>
          <p className="text-sm text-gray-500 mt-0.5">Approved แล้ว</p>
        </div>
        <div className="ges-card p-4 cursor-pointer hover:shadow-md" onClick={() => setFilterStatus("all")}>
          <p className="text-2xl font-bold text-gray-500">{groups.length}</p>
          <p className="text-sm text-gray-500 mt-0.5">ทั้งหมด</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-5">
        {(["pending","approved","all"] as const).map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filterStatus === s ? "bg-white text-blue-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {s === "pending" ? "⏳ รอดำเนินการ" : s === "approved" ? "✓ Approved" : "ทั้งหมด"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : displayedGroups.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-lg font-medium">ไม่มีรายการ</p>
          <p className="text-sm mt-1">{filterStatus === "pending" ? "ไม่มีแผนที่รอการอนุมัติ" : "ไม่มีข้อมูล"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedGroups.map(({ project, totalPlanned, empCount, months, empPlans }) => {
            const isExpanded = expandedId === project.id;
            const { planStatus } = project;

            // Build dept summary from employee plans
            const deptMap = new Map<string, number>();
            for (const p of empPlans) {
              const dept = p.employee.department;
              deptMap.set(dept, (deptMap.get(dept) || 0) + p.plannedHrs);
            }
            const depts = Array.from(deptMap.keys()).sort();

            return (
              <div key={project.id} className="ges-card overflow-hidden">
                {/* Project header */}
                <div className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  planStatus === "approved"           ? "bg-green-50 border-b border-green-100" :
                  planStatus === "revision_requested" ? "bg-blue-50 border-b border-blue-100" :
                  planStatus === "submitted"          ? "bg-amber-50 border-b border-amber-100" :
                  "bg-gray-50 border-b border-gray-100"
                }`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-blue-600">{project.projectNumber}</span>
                      <PlanStatusBadge status={planStatus} />
                    </div>
                    <h3 className="font-bold text-gray-900 mt-0.5">{project.projectName}</h3>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                      {project.manager && <span>PM: {project.manager.name}</span>}
                      {project.pd      && <span>PD: {project.pd.name}</span>}
                      {project.startDate && project.endDate && (
                        <span>{new Date(project.startDate).toLocaleDateString("th-TH")} → {new Date(project.endDate).toLocaleDateString("th-TH")}</span>
                      )}
                      <span>{months.length} เดือน · {empCount} คน · {totalPlanned}h รวม</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    <button onClick={() => setExpandedId(isExpanded ? null : project.id)}
                      className="text-xs text-blue-600 hover:underline px-2 py-1 rounded border border-blue-200 hover:bg-blue-50">
                      {isExpanded ? "ซ่อน" : "ดูแผน"}
                    </button>

                    {/* Actions for "submitted" plan */}
                    {planStatus === "submitted" && (
                      <>
                        <button onClick={() => handleAction(project.id, "approve")} disabled={acting === project.id}
                          className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                          {acting === project.id ? "…" : "✓ อนุมัติ"}
                        </button>
                        <button onClick={() => handleAction(project.id, "reject")} disabled={acting === project.id}
                          className="text-sm bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50 font-medium">
                          {acting === project.id ? "…" : "✗ ไม่อนุมัติ"}
                        </button>
                      </>
                    )}

                    {/* Actions for "revision_requested" */}
                    {planStatus === "revision_requested" && (
                      <>
                        <span className="text-xs text-blue-700 font-medium mr-1">PM ขอแก้ไขแผน:</span>
                        <button onClick={() => handleAction(project.id, "approve_revision")} disabled={acting === project.id}
                          className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                          {acting === project.id ? "…" : "✓ อนุมัติการแก้ไข"}
                        </button>
                        <button onClick={() => handleAction(project.id, "reject_revision")} disabled={acting === project.id}
                          className="text-sm bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50 font-medium">
                          {acting === project.id ? "…" : "✗ ปฏิเสธ"}
                        </button>
                      </>
                    )}

                    {/* Actions for "approved" plan */}
                    {planStatus === "approved" && (
                      <button onClick={() => handleAction(project.id, "reject")} disabled={acting === project.id}
                        className="text-xs text-amber-600 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-50 disabled:opacity-50">
                        ↩ ยกเลิก Approve
                      </button>
                    )}
                  </div>
                </div>

                {/* Dept summary pills */}
                <div className="px-5 py-3 flex flex-wrap gap-2">
                  {depts.map((dept) => (
                    <span key={dept} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                      {dept}: {deptMap.get(dept)}h
                    </span>
                  ))}
                </div>

                {/* Expanded: employee plan details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-4 py-2 font-semibold text-gray-600 min-w-[100px]">User ID</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-600 min-w-[150px]">ชื่อ</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-600">แผนก</th>
                          {months.map((m) => (
                            <th key={`${m.year}-${m.month}`} className="px-2 py-2 text-center min-w-[60px] text-gray-500">
                              {MONTH_NAMES[m.month-1]}<br />{m.year}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-center font-semibold text-gray-600">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(new Set(empPlans.map((p) => p.employeeId))).map((empId) => {
                          const emp = empPlans.find((p) => p.employeeId === empId)?.employee;
                          const rowTotal = empPlans.filter((p) => p.employeeId === empId).reduce((s, p) => s + p.plannedHrs, 0);
                          return (
                            <tr key={empId} className="border-t border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-2 font-mono text-xs font-semibold text-blue-600">{emp?.employeeId}</td>
                              <td className="px-3 py-2 font-medium text-gray-700">{emp?.name}</td>
                              <td className="px-3 py-2 text-gray-500">{emp?.department}</td>
                              {months.map((m) => {
                                const p = empPlans.find((ep) => ep.employeeId === empId && ep.year === m.year && ep.month === m.month);
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
                        {/* Totals row */}
                        <tr className="border-t-2 border-gray-300 bg-blue-50">
                          <td colSpan={3} className="px-4 py-2 font-bold text-gray-700">รวม</td>
                          {months.map((m) => {
                            const mTotal = empPlans.filter((p) => p.year === m.year && p.month === m.month).reduce((s, p) => s + p.plannedHrs, 0);
                            return (
                              <td key={`${m.year}-${m.month}`} className="px-2 py-2 text-center font-bold text-blue-900">
                                {mTotal > 0 ? `${mTotal}h` : "–"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-900">{totalPlanned}h</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:              { label: "Draft",                  cls: "bg-gray-100 text-gray-600" },
    submitted:          { label: "📤 รอ Approve",           cls: "bg-amber-100 text-amber-800" },
    revision_requested: { label: "🔄 ขอแก้ไขแผน",          cls: "bg-blue-100 text-blue-800" },
    approved:           { label: "✓ Approved",             cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
