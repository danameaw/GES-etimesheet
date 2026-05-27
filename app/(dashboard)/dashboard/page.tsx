"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format, addWeeks, subWeeks, startOfWeek, addMonths, subMonths, startOfMonth } from "date-fns";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend);

interface DashboardData {
  projectHours:     { projectNumber: string; projectName: string; projectId: string; hours: number }[];
  projectDeptHours: { projectNumber: string; projectName: string; projectId: string; byDept: Record<string, number> }[];
  allDepts:         string[];
  categoryHours:    { category: string; hours: number }[];
  deptHours:        { department: string; hours: number }[];
  topEmployees:     { name: string; hours: number }[];
  weeklyTrend:      { week: string; utilization: number; totalHrs: number }[];
  planVsActual:     { projectNumber: string; projectName: string; projectId: string; planned: number; actual: number }[];
  summary:          { totalHours: number; submittedCount: number; totalEmployees: number; mode: string };
}

interface DrillDownData {
  project:      { id: string; projectNumber: string; projectName: string };
  employees:    { name: string; employeeId: string; department: string; actualHrs: number }[];
  planByDept:   Record<string, number>;
  actualByDept: Record<string, number>;
}

const DEPT_COLORS = [
  "#1e3a5f","#2563eb","#0891b2","#059669","#d97706",
  "#dc2626","#7c3aed","#db2777","#65a30d","#ea580c",
];

const MONTH_NAMES_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"week"|"month">("week");
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [drillDown, setDrillDown] = useState<DrillDownData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const role = (session?.user as any)?.role;
  const canView = role === "pd";

  useEffect(() => {
    if (session && !canView) router.push("/timesheet");
  }, [session, canView, router]);

  const fetchData = useCallback(() => {
    setLoading(true);
    const url = mode === "week"
      ? `/api/admin/dashboard?week=${format(currentWeek, "yyyy-MM-dd")}`
      : `/api/admin/dashboard?month=${format(currentMonth, "yyyy-MM")}`;
    fetch(url).then((r) => r.json()).then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [mode, currentWeek, currentMonth]);

  useEffect(() => { if (canView) fetchData(); }, [canView, fetchData]);

  const openDrillDown = async (projectId: string) => {
    setDrillLoading(true);
    const param = mode === "week"
      ? `week=${format(currentWeek, "yyyy-MM-dd")}`
      : `month=${format(currentMonth, "yyyy-MM")}`;
    const res = await fetch(`/api/admin/dashboard/project-detail?projectId=${projectId}&${param}`);
    const d = await res.json();
    setDrillDown(d);
    setDrillLoading(false);
  };

  if (!canView) return null;

  const weekEnd    = new Date(currentWeek.getTime() + 6 * 86400000);
  const weekLabel  = `${format(currentWeek, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;
  const monthLabel = `${MONTH_NAMES_TH[currentMonth.getMonth()]} ${currentMonth.getFullYear() + 543}`;

  return (
    <div>
      {/* Header + Navigator */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="text-gray-500 text-sm">Project hours, workload, and utilization overview</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setMode("week")} className={`px-4 py-1.5 font-medium transition-colors ${mode === "week" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>รายสัปดาห์</button>
            <button onClick={() => setMode("month")} className={`px-4 py-1.5 font-medium transition-colors border-l border-gray-200 ${mode === "month" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>รายเดือน</button>
          </div>
          {mode === "week" && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">‹</button>
              <span className="text-sm font-medium text-gray-700 min-w-[170px] text-center">{weekLabel}</span>
              <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">›</button>
              <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 ml-1">สัปดาห์นี้</button>
            </div>
          )}
          {mode === "month" && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">‹</button>
              <span className="text-sm font-medium text-gray-700 min-w-[150px] text-center">{monthLabel}</span>
              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">›</button>
              <button onClick={() => setCurrentMonth(startOfMonth(new Date()))} className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 ml-1">เดือนนี้</button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="text-gray-400 text-lg animate-pulse">Loading dashboard…</div></div>
      ) : !data ? (
        <div className="text-red-500">Failed to load dashboard data.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "ชั่วโมงรวม", value: `${data.summary?.totalHours ?? 0}h`, sub: "Total Hours" },
              { label: "Timesheets ที่ส่ง", value: data.summary?.submittedCount ?? 0, sub: "Submitted" },
              { label: "พนักงานทั้งหมด", value: data.summary?.totalEmployees ?? 0, sub: "Employees" },
              { label: "อัตราการส่ง", value: `${data.summary?.totalEmployees ? Math.round((data.summary.submittedCount / data.summary.totalEmployees) * 100) : 0}%`, sub: "Submit Rate" },
            ].map((k) => (
              <div key={k.label} className="ges-card p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">{k.label}</p>
                <p className="text-2xl font-bold text-blue-900">{k.value}</p>
                <p className="text-xs text-gray-400">{k.sub}</p>
              </div>
            ))}
          </div>

          {(!data.projectDeptHours || data.projectDeptHours.length === 0) ? (
            <div className="ges-card p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-lg font-medium">ไม่มีข้อมูลในช่วงเวลานี้</p>
              <p className="text-sm mt-1">ลองเลือกสัปดาห์หรือเดือนอื่น</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ① Stacked Bar: Hours by Project broken down by Department */}
              <div className="ges-card p-5 lg:col-span-2">
                <h2 className="font-semibold text-gray-800 mb-1">Hours by Project (by Department)</h2>
                <p className="text-xs text-gray-400 mb-4">ชั่วโมงแต่ละโครงการแยกตามแผนก — คลิกแท่งเพื่อดูรายละเอียด</p>
                <div style={{ height: 300 }}>
                  <Bar
                    data={{
                      labels: data.projectDeptHours.map((p) => p.projectNumber),
                      datasets: (data.allDepts || []).map((dept, i) => ({
                        label: dept,
                        data: data.projectDeptHours.map((p) => p.byDept[dept] || 0),
                        backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length],
                        borderRadius: 2,
                        stack: "stack",
                      })),
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: true, position: "right" as const, labels: { boxWidth: 12, font: { size: 11 } } },
                        tooltip: {
                          callbacks: {
                            title: (items) => {
                              const idx = items[0].dataIndex;
                              return data.projectDeptHours[idx].projectName;
                            },
                            label: (item) => ` ${item.dataset.label}: ${item.raw}h`,
                          },
                        },
                      },
                      scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
                        y: { stacked: true, beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                      },
                      onClick: (_, elements) => {
                        if (elements.length > 0) {
                          const idx = elements[0].index;
                          const pid = data.projectDeptHours[idx]?.projectId;
                          if (pid) openDrillDown(pid);
                        }
                      },
                    }}
                  />
                </div>
              </div>

              {/* ② Doughnut: Task Category */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Hours by Task Category</h2>
                <div className="flex items-center gap-6">
                  <div style={{ height: 220, width: 220 }} className="flex-shrink-0">
                    <Doughnut
                      data={{
                        labels: data.categoryHours.map((c) => c.category),
                        datasets: [{ data: data.categoryHours.map((c) => c.hours), backgroundColor: DEPT_COLORS, borderWidth: 2, borderColor: "#fff" }],
                      }}
                      options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                    />
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto max-h-48">
                    {data.categoryHours.map((c, i) => (
                      <div key={c.category} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                        <span className="text-gray-600 flex-1 text-xs">{c.category}</span>
                        <span className="font-semibold text-gray-900 text-xs">{c.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ③ Horizontal Bar: Workload by Project */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Workload by Project</h2>
                <div style={{ height: 260 }}>
                  <Bar
                    data={{
                      labels: data.projectHours.map((p) => p.projectNumber),
                      datasets: [{
                        label: "Hours",
                        data: data.projectHours.map((p) => p.hours),
                        backgroundColor: "#2563eb",
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      indexAxis: "y" as const,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            title: (items) => data.projectHours[items[0].dataIndex].projectName,
                            label: (item) => ` ${item.raw}h`,
                          },
                        },
                      },
                      scales: {
                        x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                      },
                      onClick: (_, elements) => {
                        if (elements.length > 0) {
                          const pid = data.projectHours[elements[0].index]?.projectId;
                          if (pid) openDrillDown(pid);
                        }
                      },
                    }}
                  />
                </div>
              </div>

              {/* ④ Horizontal Bar: Top 8 Employees */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Top 8 Employees by Hours</h2>
                <div style={{ height: 260 }}>
                  <Bar
                    data={{
                      labels: data.topEmployees.map((e) => e.name.split(" ")[0]),
                      datasets: [{ label: "Hours", data: data.topEmployees.map((e) => e.hours), backgroundColor: "#059669", borderRadius: 4 }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      indexAxis: "y" as const,
                      plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { title: (items) => data.topEmployees[items[0].dataIndex].name, label: (item) => ` ${item.raw}h` } },
                      },
                      scales: {
                        x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* ⑤ Utilization Trend (combined bar+line) */}
              <div className="ges-card p-5 lg:col-span-2">
                <h2 className="font-semibold text-gray-800 mb-1">
                  {mode === "month" ? `Weekly Utilization — ${monthLabel}` : "Weekly Utilization Trend (Last 6 Weeks)"}
                </h2>
                <p className="text-xs text-gray-400 mb-4">ชั่วโมงที่ส่งจริง (แท่ง) และ % utilization เทียบ 40h/คน (เส้น)</p>
                <div style={{ height: 230 }}>
                  <Bar
                    data={{
                      labels: data.weeklyTrend.map((w) => w.week),
                      datasets: [
                        { type: "bar" as const, label: "ชั่วโมง (h)", data: data.weeklyTrend.map((w) => w.totalHrs ?? 0), backgroundColor: "rgba(37,99,235,0.25)", borderRadius: 4, yAxisID: "yHrs" },
                        { type: "line" as const, label: "Utilization %", data: data.weeklyTrend.map((w) => w.utilization), borderColor: "#1e3a5f", backgroundColor: "transparent", tension: 0.3, pointBackgroundColor: "#1e3a5f", pointRadius: 5, yAxisID: "yPct" },
                      ],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { display: true, position: "top" as const },
                        tooltip: { callbacks: { label: (item) => item.datasetIndex === 1 ? ` Utilization: ${item.raw}%` : ` ชั่วโมง: ${item.raw}h` } },
                      },
                      scales: {
                        yHrs: { type: "linear" as const, position: "left" as const, beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        yPct: { type: "linear" as const, position: "right" as const, beginAtZero: true, max: 130, grid: { display: false }, ticks: { callback: (v) => `${v}%` } },
                        x: { grid: { display: false } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* ⑥ Plan vs Actual — click to drill down */}
              {data.planVsActual?.length > 0 && (
                <div className="ges-card p-5 lg:col-span-2">
                  <h2 className="font-semibold text-gray-800 mb-1">Plan vs Actual Hours by Project</h2>
                  <p className="text-xs text-gray-400 mb-4">คลิกแท่งเพื่อดูรายละเอียดรายบุคคล</p>
                  <div style={{ height: 300 }}>
                    <Bar
                      data={{
                        labels: data.planVsActual.map((p) => p.projectNumber),
                        datasets: [
                          { label: "แผน (Planned)", data: data.planVsActual.map((p) => p.planned), backgroundColor: "rgba(37,99,235,0.7)", borderRadius: 4 },
                          { label: "จริง (Actual)",  data: data.planVsActual.map((p) => p.actual),  backgroundColor: "rgba(5,150,105,0.7)",  borderRadius: 4 },
                        ],
                      }}
                      options={{
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                          legend: { display: true, position: "top" as const },
                          tooltip: {
                            callbacks: {
                              title: (items) => data.planVsActual[items[0].dataIndex].projectName,
                              label: (item) => ` ${item.dataset.label}: ${item.raw}h`,
                            },
                          },
                        },
                        scales: {
                          y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                        },
                        onClick: (_, elements) => {
                          if (elements.length > 0) {
                            const pid = data.planVsActual[elements[0].index]?.projectId;
                            if (pid) openDrillDown(pid);
                          }
                        },
                      }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}
        </>
      )}

      {/* ── Drill-Down Modal ──────────────────────────────────── */}
      {(drillDown || drillLoading) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDrillDown(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {drillLoading ? (
              <div className="p-16 text-center text-gray-400 animate-pulse">Loading…</div>
            ) : drillDown && (
              <>
                <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <p className="text-xs font-mono text-blue-600 font-semibold">{drillDown.project.projectNumber}</p>
                    <h3 className="text-lg font-bold text-gray-900 mt-0.5">{drillDown.project.projectName}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{mode === "month" ? monthLabel : weekLabel}</p>
                  </div>
                  <button onClick={() => setDrillDown(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4">×</button>
                </div>

                {/* Dept summary */}
                {Object.keys(drillDown.planByDept).length > 0 && (
                  <div className="px-6 py-4 border-b border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">สรุปรายแผนก</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Object.entries(drillDown.planByDept).map(([dept, planned]) => {
                        const actual = drillDown.actualByDept[dept] || 0;
                        const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;
                        return (
                          <div key={dept} className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-gray-700 truncate">{dept}</p>
                            <div className="flex gap-2 mt-1.5 text-xs">
                              <span className="text-blue-700">Plan: {planned}h</span>
                              <span className="text-green-700">Act: {actual}h</span>
                            </div>
                            {pct !== null && (
                              <div className="mt-1.5">
                                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-green-500" : "bg-amber-400"}`}
                                    style={{ width: `${Math.min(pct, 100)}%` }} />
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{pct}%</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Per-person table */}
                <div className="px-6 py-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">รายบุคคล — ชั่วโมงที่ลงจริง</h4>
                  {drillDown.employees.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-6">ไม่มีข้อมูลในช่วงเวลานี้</p>
                  ) : (
                    <table className="ges-table w-full">
                      <thead>
                        <tr>
                          <th className="text-left">พนักงาน</th>
                          <th className="text-left">แผนก</th>
                          <th className="text-right">ชั่วโมงจริง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillDown.employees.map((emp) => (
                          <tr key={emp.employeeId}>
                            <td>
                              <p className="font-medium text-sm">{emp.name}</p>
                              <p className="text-xs font-mono text-blue-600">{emp.employeeId}</p>
                            </td>
                            <td className="text-xs text-gray-500">{emp.department}</td>
                            <td className="text-right font-semibold text-sm text-green-700">{emp.actualHrs}h</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50">
                          <td colSpan={2} className="font-semibold text-gray-700 text-sm">รวม</td>
                          <td className="text-right font-bold text-blue-900">
                            {drillDown.employees.reduce((s, e) => s + e.actualHrs, 0)}h
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
