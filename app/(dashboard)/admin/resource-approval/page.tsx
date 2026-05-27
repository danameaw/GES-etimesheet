"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Project {
  id: string; projectNumber: string; projectName: string;
  startDate: string | null; endDate: string | null;
  manager: { id: string; name: string; employeeId: string } | null;
}
interface PlanRow { id: string; projectId: string; department: string; year: number; month: number; plannedHrs: number; planStatus: string; }

interface ProjectGroup {
  project: Project;
  plans: PlanRow[];
  planStatus: string;
  totalPlanned: number;
  deptMap: Record<string, number>; // dept → total planned hrs
  months: { year: number; month: number }[];
}

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const canAccess = ["pd", "admin"].includes(role);

  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/resource-plan-monthly");
    const data = await res.json();

    const projects: Project[] = data.projects || [];
    const allPlans: PlanRow[] = data.plans || [];

    // Wait — the API without projectId returns plans=[] (only returns plans when projectId is specified).
    // We need to fetch plans for all projects. Let me handle this differently.
    // Actually, let me just fetch plans per project in a single call (which the API already does if we pass no projectId).
    // But looking at the API code, plans are only returned when projectId is specified.
    // For the approval page, let me call with each projectId, or add a ?all=true param.
    // For now, let me do one fetch per project.

    const groupResults: ProjectGroup[] = [];
    for (const proj of projects) {
      const pRes = await fetch(`/api/resource-plan-monthly?projectId=${proj.id}`);
      const pData = await pRes.json();
      const plans: PlanRow[] = pData.plans || [];
      if (plans.length === 0) continue;

      const planStatus = plans.reduce((status: string, p) => {
        if (p.planStatus === "approved") return "approved";
        if (p.planStatus === "submitted" && status !== "approved") return "submitted";
        return status;
      }, "draft");

      const totalPlanned = plans.reduce((s, p) => s + p.plannedHrs, 0);
      const deptMap: Record<string, number> = {};
      const monthSet = new Set<string>();
      for (const p of plans) {
        deptMap[p.department] = (deptMap[p.department] || 0) + p.plannedHrs;
        monthSet.add(`${p.year}|${p.month}`);
      }
      const months = Array.from(monthSet).map((k) => { const [y, m] = k.split("|"); return { year: Number(y), month: Number(m) }; })
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

      groupResults.push({ project: proj, plans, planStatus, totalPlanned, deptMap, months });
    }

    setGroups(groupResults);
    setLoading(false);
  }, []);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  async function handleAction(projectId: string, action: "approve" | "reject") {
    setActing(projectId);
    await fetch("/api/resource-plan-monthly", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId }),
    });
    setActing(null);
    load();
  }

  const submittedCount = groups.filter((g) => g.planStatus === "submitted").length;
  const approvedCount  = groups.filter((g) => g.planStatus === "approved").length;
  const draftCount     = groups.filter((g) => g.planStatus === "draft").length;

  if (!canAccess) return null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">อนุมัติแผนทรัพยากร</h1>
          <p className="text-gray-500 text-sm">ตรวจสอบและอนุมัติ Resource Plan ระยะยาวจาก PM</p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-blue-600">🔄 Refresh</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="ges-card p-4">
          <p className="text-2xl font-bold text-amber-600">{submittedCount}</p>
          <p className="text-sm text-gray-500 mt-0.5">รอ Approve</p>
        </div>
        <div className="ges-card p-4">
          <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
          <p className="text-sm text-gray-500 mt-0.5">Approved แล้ว</p>
        </div>
        <div className="ges-card p-4">
          <p className="text-2xl font-bold text-gray-500">{draftCount}</p>
          <p className="text-sm text-gray-500 mt-0.5">Draft (ยังไม่ส่ง)</p>
        </div>
      </div>

      {loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : groups.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-lg font-medium">ไม่มีแผนทรัพยากร</p>
          <p className="text-sm mt-1">PM ยังไม่ได้ submit แผนใดๆ</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ project, plans, planStatus, totalPlanned, deptMap, months }) => {
            const isExpanded = expandedId === project.id;
            const depts = Object.keys(deptMap).sort();
            return (
              <div key={project.id} className="ges-card overflow-hidden">
                {/* Project header */}
                <div className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  planStatus === "approved" ? "bg-green-50 border-b border-green-100" :
                  planStatus === "submitted" ? "bg-amber-50 border-b border-amber-100" :
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
                      {project.startDate && project.endDate && (
                        <span>{new Date(project.startDate).toLocaleDateString("th-TH")} → {new Date(project.endDate).toLocaleDateString("th-TH")}</span>
                      )}
                      <span>{months.length} เดือน · {depts.length} แผนก · {totalPlanned}h รวม</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setExpandedId(isExpanded ? null : project.id)}
                      className="text-xs text-blue-600 hover:underline px-2 py-1 rounded border border-blue-200 hover:bg-blue-50">
                      {isExpanded ? "ซ่อน" : "ดูแผน"}
                    </button>
                    {planStatus !== "approved" && (
                      <button onClick={() => handleAction(project.id, "approve")} disabled={acting === project.id}
                        className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">
                        {acting === project.id ? "…" : "✓ Approve"}
                      </button>
                    )}
                    {planStatus === "approved" && (
                      <button onClick={() => handleAction(project.id, "reject")} disabled={acting === project.id}
                        className="text-xs text-amber-600 hover:underline disabled:opacity-50">
                        ↩ ยกเลิก
                      </button>
                    )}
                  </div>
                </div>

                {/* Dept summary pills */}
                <div className="px-5 py-3 flex flex-wrap gap-2">
                  {depts.map((dept) => (
                    <span key={dept} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                      {dept}: {deptMap[dept]}h
                    </span>
                  ))}
                </div>

                {/* Expanded: full matrix */}
                {isExpanded && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-4 py-2 font-semibold text-gray-600 min-w-[140px]">แผนก</th>
                          {months.map((m) => (
                            <th key={`${m.year}-${m.month}`} className="px-2 py-2 text-center min-w-[60px] text-gray-500">
                              {MONTH_NAMES[m.month-1]}<br />{m.year}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-center font-semibold text-gray-600">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {depts.map((dept) => {
                          const deptTotal = deptMap[dept];
                          return (
                            <tr key={dept} className="border-t border-gray-100">
                              <td className="px-4 py-2 font-medium text-gray-700">{dept}</td>
                              {months.map((m) => {
                                const p = plans.find((r) => r.department === dept && r.year === m.year && r.month === m.month);
                                return (
                                  <td key={`${m.year}-${m.month}`} className="px-2 py-2 text-center">
                                    {p?.plannedHrs ? <span className="font-semibold text-blue-900">{p.plannedHrs}h</span> : <span className="text-gray-300">–</span>}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-center font-bold text-blue-900">{deptTotal}h</td>
                            </tr>
                          );
                        })}
                        {/* Totals */}
                        <tr className="border-t-2 border-gray-300 bg-blue-50">
                          <td className="px-4 py-2 font-bold text-gray-700">รวม</td>
                          {months.map((m) => {
                            const mTotal = depts.reduce((s, dept) => {
                              const p = plans.find((r) => r.department === dept && r.year === m.year && r.month === m.month);
                              return s + (p?.plannedHrs || 0);
                            }, 0);
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
    draft:     { label: "Draft",          cls: "bg-gray-100 text-gray-600" },
    submitted: { label: "📤 รอ Approve",   cls: "bg-amber-100 text-amber-800" },
    approved:  { label: "✓ Approved",     cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
