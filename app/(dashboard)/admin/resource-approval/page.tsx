"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format, startOfWeek, addWeeks, subWeeks, addDays } from "date-fns";

interface Employee { id: string; employeeId: string; name: string; department: string; position: string; }
interface ResourcePlan { id: string; projectId: string; employeeId: string; weekStart: string; plannedHrs: number; planStatus: string; employee: Employee; }
interface Project { id: string; projectNumber: string; projectName: string; manager: { id: string; name: string; employeeId: string } | null; }

interface ProjectGroup {
  project: Project;
  plans: ResourcePlan[];
  planStatus: string; // "draft" | "submitted" | "approved"
  totalPlanned: number;
}

export default function ResourceApprovalPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const role = (session?.user as any)?.role;
  const canAccess = ["pd", "admin"].includes(role);

  useEffect(() => {
    if (session && !canAccess) router.push("/timesheet");
  }, [session, canAccess, router]);

  const weekEnd = addDays(currentWeek, 6);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/resource-plan?week=${format(currentWeek, "yyyy-MM-dd")}`);
    const data = await res.json();

    const projects: Project[] = data.projects || [];
    const plans: ResourcePlan[] = data.plans || [];

    // Group plans by project
    const projectMap = new Map<string, ProjectGroup>();
    for (const proj of projects) {
      projectMap.set(proj.id, { project: proj, plans: [], planStatus: "draft", totalPlanned: 0 });
    }
    for (const plan of plans) {
      const grp = projectMap.get(plan.projectId);
      if (grp) {
        grp.plans.push(plan);
        grp.totalPlanned += plan.plannedHrs;
        // Project status = highest status among rows: approved > submitted > draft
        if (plan.planStatus === "approved") grp.planStatus = "approved";
        else if (plan.planStatus === "submitted" && grp.planStatus !== "approved") grp.planStatus = "submitted";
      }
    }

    setGroups(Array.from(projectMap.values()).filter((g) => g.plans.length > 0));
    setLoading(false);
  }, [currentWeek]);

  useEffect(() => { if (canAccess) load(); }, [load, canAccess]);

  async function handleAction(projectId: string, action: "approve" | "reject") {
    setActing(projectId);
    await fetch("/api/resource-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId, weekStart: format(currentWeek, "yyyy-MM-dd") }),
    });
    setActing(null);
    load();
  }

  const submittedCount = groups.filter((g) => g.planStatus === "submitted").length;
  const approvedCount = groups.filter((g) => g.planStatus === "approved").length;
  const draftCount = groups.filter((g) => g.planStatus === "draft").length;

  if (!canAccess) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">อนุมัติแผนทรัพยากร</h1>
          <p className="text-gray-500 text-sm">ตรวจสอบและอนุมัติแผนการใช้ทรัพยากรจาก PM</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
          <div className="text-center min-w-[180px]">
            <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
            <p className="text-xs text-gray-400">สัปดาห์ที่ {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
          <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">วันนี้</button>
          <button onClick={load} className="text-xs text-gray-500 hover:text-blue-600 ml-1" title="Refresh">🔄</button>
        </div>
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
          <p className="text-sm text-gray-500 mt-0.5">Draft (PM ยังไม่ส่ง)</p>
        </div>
      </div>

      {/* Project Plan List */}
      {loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : groups.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-lg font-medium">ไม่มีแผนทรัพยากรสำหรับสัปดาห์นี้</p>
          <p className="text-sm mt-1">PM ยังไม่ได้ submit แผนใดๆ</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ project, plans, planStatus, totalPlanned }) => (
            <div key={project.id} className="ges-card overflow-hidden">
              {/* Project header */}
              <div className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                planStatus === "approved" ? "bg-green-50 border-b border-green-100" :
                planStatus === "submitted" ? "bg-amber-50 border-b border-amber-100" :
                "bg-gray-50 border-b border-gray-100"
              }`}>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-blue-600">{project.projectNumber}</span>
                    <PlanStatusBadge status={planStatus} />
                  </div>
                  <h3 className="font-bold text-gray-900 mt-0.5">{project.projectName}</h3>
                  {project.manager && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      PM: {project.manager.name} ({project.manager.employeeId})
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-900">{plans.length}</p>
                    <p className="text-xs text-gray-500">Engineers</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-900">{totalPlanned}h</p>
                    <p className="text-xs text-gray-500">Total Planned</p>
                  </div>
                  <div className="flex gap-2">
                    {planStatus !== "approved" && (
                      <button
                        onClick={() => handleAction(project.id, "approve")}
                        disabled={acting === project.id}
                        className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {acting === project.id ? "…" : "✓ Approve"}
                      </button>
                    )}
                    {planStatus === "approved" && (
                      <button
                        onClick={() => handleAction(project.id, "reject")}
                        disabled={acting === project.id}
                        className="text-sm text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50 text-xs"
                      >
                        ↩ ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Employee list */}
              <table className="ges-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">พนักงาน</th>
                    <th className="text-left">แผนก</th>
                    <th className="text-center">ชั่วโมงที่วางแผน</th>
                    <th className="text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <p className="font-medium text-sm">{plan.employee.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{plan.employee.employeeId}</p>
                      </td>
                      <td className="text-xs text-gray-500">{plan.employee.department}</td>
                      <td className="text-center font-semibold text-sm text-blue-900">{plan.plannedHrs}h</td>
                      <td className="text-center">
                        <PlanStatusBadge status={plan.planStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:     { label: "Draft",     cls: "bg-gray-100 text-gray-600" },
    submitted: { label: "รอ Approve", cls: "bg-amber-100 text-amber-800" },
    approved:  { label: "✓ Approved", cls: "bg-green-100 text-green-800" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
