"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format, addWeeks, subWeeks, startOfWeek, addMonths, subMonths, startOfMonth } from "date-fns";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend, BarController, LineController,
} from "chart.js";
import { Bar, Doughnut, Chart } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend, BarController, LineController);

const DEPT_COLORS = ["#1e3a5f","#2563eb","#0891b2","#059669","#d97706","#dc2626","#7c3aed","#db2777","#65a30d","#ea580c"];
const CAT_COLORS  = ["#2563eb","#0891b2","#059669","#d97706","#7c3aed","#dc2626","#db2777","#65a30d"];

interface Project        { id: string; projectNumber: string; projectName: string; }
interface PlanVsActual   { projectId: string; projectNumber: string; projectName: string; planned: number; actual: number; }
interface TaskRow         { category: string; hours: number; }
interface TrendRow        { week: string; utilization: number; totalHrs: number; }
interface EmpRow          { name: string; hours: number; department: string; }
interface LeaveRow        { name: string; employeeId: string; department: string; hours: number; }
interface MatrixProject   { projectId: string; projectNumber: string; projectName: string; months: { year: number; month: number; label: string; planned: number; actual: number }[]; totalPlanned: number; totalActual: number; }
interface MatrixEmp       { empId: string; employeeId: string; name: string; position: string; months: { year: number; month: number; label: string; planned: number; actual: number }[]; totalPlanned: number; totalActual: number; }
interface MatrixMonth     { year: number; month: number; label: string; }

interface DashData {
  allProjects:      Project[];
  planVsActual:     PlanVsActual[];
  taskBreakdown:    TaskRow[];
  weeklyTrend:      TrendRow[];
  topEmployees:     EmpRow[];
  allDepts:         string[];
  planActualMatrix: MatrixProject[];
  empActualMatrix:  MatrixEmp[];
  matrixMonths:     MatrixMonth[];
  leaveBreakdown:   LeaveRow[];
  summary:          { totalHours: number; totalWorkHours: number; totalPlanned: number; submittedCount: number; totalEmployees: number; mode: string; totalLeaveHrs: number };
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const isPD      = role === "pd";
  const isGESMgmt = role === "ges_management";
  const canAccess = ["ges_management","admin","md","pd"].includes(role);
  useEffect(() => { if (session && !canAccess) router.push("/timesheet"); }, [session, canAccess, router]);

  const dashTitle = isPD ? "Dashboard Project"
    : isGESMgmt ? "Dashboard Department"
    : "Dashboard";

  const [data, setData]           = useState<DashData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState<"week"|"month">("week");
  const [selectedWeek, setSelectedWeek]   = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [deptFilter, setDeptFilter] = useState<string>("");

  const weekLabel  = `สัปดาห์ ${format(selectedWeek, "dd MMM yyyy")}`;
  const monthLabel = format(selectedMonth, "MMM yyyy");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (mode === "week")  params.set("week",  format(selectedWeek,  "yyyy-MM-dd"));
    if (mode === "month") params.set("month", format(selectedMonth, "yyyy-MM"));
    if (selectedProject) params.set("projectId", selectedProject);
    if (deptFilter)      params.set("dept", deptFilter);
    const res = await fetch(`/api/admin/dashboard?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [mode, selectedWeek, selectedMonth, selectedProject, deptFilter]);

  useEffect(() => { if (canAccess) fetchData(); }, [fetchData, canAccess]);

  if (!canAccess) return null;

  const summary = data?.summary;
  const utilizationPct = summary && summary.totalPlanned > 0
    ? Math.round((summary.totalHours / summary.totalPlanned) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{dashTitle}</h1>
          <p className="text-gray-500 text-sm">
            {isPD ? "ภาพรวมโครงการที่ดูแล" : isGESMgmt ? "ภาพรวม Department ของคุณ" : "ภาพรวม Resource & Timesheet"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period mode */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 text-sm">
            {(["week","month"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${mode === m ? "bg-white shadow-sm text-blue-900" : "text-gray-500"}`}>
                {m === "week" ? "สัปดาห์" : "เดือน"}
              </button>
            ))}
          </div>

          {/* Period navigator */}
          {mode === "week" ? (
            <div className="flex items-center gap-1">
              <button onClick={() => setSelectedWeek(w => subWeeks(w,1))} className="p-1.5 rounded hover:bg-gray-100">‹</button>
              <span className="text-sm font-medium text-gray-700 min-w-[160px] text-center">{weekLabel}</span>
              <button onClick={() => setSelectedWeek(w => addWeeks(w,1))} className="p-1.5 rounded hover:bg-gray-100">›</button>
              <button onClick={() => setSelectedWeek(startOfWeek(new Date(),{weekStartsOn:1}))} className="text-xs text-blue-600 hover:underline ml-1">วันนี้</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => setSelectedMonth(m => subMonths(m,1))} className="p-1.5 rounded hover:bg-gray-100">‹</button>
              <span className="text-sm font-medium text-gray-700 min-w-[100px] text-center">{monthLabel}</span>
              <button onClick={() => setSelectedMonth(m => addMonths(m,1))} className="p-1.5 rounded hover:bg-gray-100">›</button>
              <button onClick={() => setSelectedMonth(startOfMonth(new Date()))} className="text-xs text-blue-600 hover:underline ml-1">เดือนนี้</button>
            </div>
          )}

          {/* Project selector — shown for MD and PD (PD sees their own projects only) */}
          {!isGESMgmt && (
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[220px]">
              <option value="">{isPD ? "📁 All My Projects" : "🌐 All Projects"}</option>
              {(data?.allProjects || []).map((p) => (
                <option key={p.id} value={p.id}>{p.projectNumber} – {p.projectName}</option>
              ))}
            </select>
          )}

          <button onClick={fetchData} className="text-xs text-gray-400 hover:text-blue-600 p-1.5 rounded hover:bg-gray-100">🔄</button>
        </div>
      </div>

      {loading ? (
        <div className="ges-card p-16 text-center text-gray-400 animate-pulse">
          <p className="text-4xl mb-3">📊</p><p>กำลังโหลดข้อมูล…</p>
        </div>
      ) : !data ? null : (
        <>
          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: "ชั่วโมงจริง",    value: `${data.summary.totalWorkHours}h`, sub: "ไม่รวม Leave",    color: "text-blue-900" },
              { label: "ชั่วโมงแผน",     value: `${data.summary.totalPlanned}h`,  sub: "Planned total",    color: "text-purple-700" },
              { label: "Utilization",    value: `${utilizationPct}%`,              sub: "Actual / Plan",    color: utilizationPct > 100 ? "text-red-600" : utilizationPct >= 80 ? "text-green-600" : "text-amber-600" },
              { label: "Timesheets",     value: data.summary.submittedCount,       sub: "ส่งแล้ว",          color: "text-gray-800" },
              { label: "🏖️ ลา/วันหยุด", value: `${data.summary.totalLeaveHrs ?? 0}h`, sub: "Leave/Holiday hrs", color: "text-orange-600" },
            ].map((k) => (
              <div key={k.label} className="ges-card p-4">
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Chart 1: Plan vs Actual ── */}
          <div className="ges-card p-5">
            <h2 className="font-semibold text-gray-800 mb-1">① Plan vs Actual Hours by Project</h2>
            <p className="text-xs text-gray-400 mb-4">แท่งทึบ = Actual · แท่งโปร่ง = Plan · แดง = เกิน Plan</p>
            {data.planVsActual.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล Plan หรือ Actual ในช่วงเวลานี้</div>
            ) : (
              <div style={{ height: 260 }}>
                <Bar
                  data={{
                    labels: data.planVsActual.map((p) => p.projectNumber),
                    datasets: [
                      {
                        label: "Plan",
                        data: data.planVsActual.map((p) => p.planned),
                        backgroundColor: "rgba(37,99,235,0.15)",
                        borderColor: "rgba(37,99,235,0.5)",
                        borderWidth: 2,
                        borderRadius: 4,
                      },
                      {
                        label: "Actual",
                        data: data.planVsActual.map((p) => p.actual),
                        backgroundColor: data.planVsActual.map((p) => p.actual > p.planned && p.planned > 0 ? "rgba(220,38,38,0.75)" : "rgba(37,99,235,0.75)"),
                        borderRadius: 4,
                      },
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: true, position: "top" as const },
                      tooltip: { callbacks: { afterBody: (items) => {
                        const idx = items[0].dataIndex;
                        const p = data.planVsActual[idx];
                        const pct = p.planned > 0 ? Math.round((p.actual/p.planned)*100) : 0;
                        return [`${p.projectName}`, `Utilization: ${pct}%`];
                      }}},
                    },
                    scales: { y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } }, x: { grid: { display: false } } },
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Charts 2+3: ซ่อนสำหรับ GES Management (ไม่เกี่ยวกับ dept view) ── */}
          {!isGESMgmt && <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Chart 2: Task Breakdown */}
            <div className="ges-card p-5 lg:col-span-2">
              <h2 className="font-semibold text-gray-800 mb-1">② Task Breakdown</h2>
              <p className="text-xs text-gray-400 mb-3">
                {selectedProject ? "ชั่วโมงแยก Discipline โปรเจกต์นี้" : "ชั่วโมงแยกตาม Task Category"}
              </p>
              {data.taskBreakdown.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
              ) : (
                <div style={{ height: 220 }}>
                  <Doughnut
                    data={{
                      labels: data.taskBreakdown.slice(0, 8).map((t) => t.category),
                      datasets: [{ data: data.taskBreakdown.slice(0, 8).map((t) => t.hours), backgroundColor: CAT_COLORS, borderWidth: 2 }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "right" as const, labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
                        tooltip: { callbacks: { label: (i) => ` ${i.label}: ${i.raw}h` } },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            {/* Chart 3: Utilization Trend */}
            <div className="ges-card p-5 lg:col-span-3">
              <h2 className="font-semibold text-gray-800 mb-1">③ Utilization Trend</h2>
              <p className="text-xs text-gray-400 mb-3">% ชั่วโมงงาน (ไม่รวม Leave) ÷ Capacity · เส้นแดง = เป้า 80%</p>
              {data.weeklyTrend.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
              ) : (
                <div style={{ height: 220 }}>
                  <Chart
                    type="bar"
                    data={{
                      labels: data.weeklyTrend.map((w) => w.week),
                      datasets: [
                        { type: "bar"  as const, label: "ชั่วโมง (h)", data: data.weeklyTrend.map((w) => w.totalHrs), backgroundColor: "rgba(37,99,235,0.2)", borderRadius: 4, yAxisID: "yHrs" },
                        { type: "line" as const, label: "Utilization %", data: data.weeklyTrend.map((w) => w.utilization), borderColor: "#1e3a5f", backgroundColor: "transparent", tension: 0.3, pointBackgroundColor: "#1e3a5f", pointRadius: 4, yAxisID: "yPct" },
                        { type: "line" as const, label: "Target 80%", data: data.weeklyTrend.map(() => 80), borderColor: "#dc2626", borderDash: [6, 3], backgroundColor: "transparent", pointRadius: 0, yAxisID: "yPct" },
                      ],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: true, position: "top" as const }, tooltip: { callbacks: { label: (i) => i.datasetIndex === 0 ? ` ${i.raw}h` : ` ${i.raw}%` } } },
                      scales: {
                        yHrs: { type: "linear" as const, position: "left"  as const, beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        yPct: { type: "linear" as const, position: "right" as const, beginAtZero: true, max: 130, grid: { display: false }, ticks: { callback: (v) => `${v}%` } },
                        x: { grid: { display: false } },
                      },
                    }}
                  />
                </div>
              )}
            </div>
          </div>}

          {/* ── Chart 4: Top Employees ── */}
          <div className="ges-card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="font-semibold text-gray-800">④ Top Employees by Hours</h2>
                <p className="text-xs text-gray-400">{selectedProject ? "เฉพาะคนในโปรเจกต์นี้" : "พนักงานที่มีชั่วโมงมากสุด"}</p>
              </div>
              {/* Dept filter: hidden for PD (not relevant) and GES Management (auto-filtered) */}
              {!isPD && !isGESMgmt && (
                <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                  <option value="">ทุกแผนก</option>
                  {data.allDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
            </div>
            {data.topEmployees.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
            ) : (
              <div style={{ height: Math.max(180, data.topEmployees.length * 36) }}>
                <Bar
                  data={{
                    labels: data.topEmployees.map((e) => e.name),
                    datasets: [{
                      label: "ชั่วโมง",
                      data: data.topEmployees.map((e) => e.hours),
                      backgroundColor: data.topEmployees.map((e) => {
                        const idx = data.allDepts.indexOf(e.department);
                        return DEPT_COLORS[idx % DEPT_COLORS.length] + "cc";
                      }),
                      borderRadius: 4,
                    }],
                  }}
                  options={{
                    indexAxis: "y" as const, responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (i) => `  แผนก: ${data.topEmployees[i.dataIndex].department}` } } },
                    scales: { x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } }, y: { grid: { display: false } } },
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Chart 5: Leave / Holiday ── */}
          <div className="ges-card p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <div>
                <h2 className="font-semibold text-gray-800">⑤ 🏖️ Leave / Holiday</h2>
                <p className="text-xs text-gray-400">ชั่วโมง Leave/Holiday ของพนักงานในช่วงเวลานี้ (task code 1001)</p>
              </div>
              {(data.summary.totalLeaveHrs ?? 0) > 0 && (
                <span className="text-sm font-bold text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                  รวม {data.summary.totalLeaveHrs}h · {data.leaveBreakdown?.length ?? 0} คน
                </span>
              )}
            </div>
            {!data.leaveBreakdown || data.leaveBreakdown.length === 0 ? (
              <div className="h-24 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล Leave/Holiday ในช่วงเวลานี้</div>
            ) : (
              <div style={{ height: Math.max(140, data.leaveBreakdown.length * 38) }}>
                <Bar
                  data={{
                    labels: data.leaveBreakdown.map((e) => `${e.name} (${e.employeeId})`),
                    datasets: [{
                      label: "ชั่วโมง Leave/Holiday",
                      data:  data.leaveBreakdown.map((e) => e.hours),
                      backgroundColor: "rgba(234,88,12,0.65)",
                      borderRadius: 4,
                    }],
                  }}
                  options={{
                    indexAxis: "y" as const,
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: {
                        afterLabel: (i) => `  แผนก: ${data.leaveBreakdown[i.dataIndex].department}`,
                      }},
                    },
                    scales: {
                      x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                      y: { grid: { display: false } },
                    },
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Chart 6: Plan vs Actual Matrix ── */}
          <div className="ges-card overflow-x-auto">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                ⑥ Plan vs Actual Matrix — {isGESMgmt ? "รายบุคคล" : "รายโครงการ"}
              </h2>
              <div className="flex gap-4 mt-1 text-xs">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-300" /> Actual &gt; Plan</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-300" /> On Plan (≥80%)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" /> Under Plan (&lt;80%)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" /> ไม่มีแผน</span>
              </div>
            </div>

            {/* GES Management: Employee matrix */}
            {isGESMgmt ? (
              (data.empActualMatrix ?? []).length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">ยังไม่มีข้อมูล Plan สำหรับ Department นี้</div>
              ) : (
                <MatrixTable
                  rows={(data.empActualMatrix ?? []).map((e) => ({
                    key: e.empId,
                    label1: e.name,
                    label2: e.employeeId,
                    months: e.months,
                    totalPlanned: e.totalPlanned,
                    totalActual: e.totalActual,
                  }))}
                  matrixMonths={data.matrixMonths}
                />
              )
            ) : (
              /* MD / PD: Project matrix */
              data.planActualMatrix.length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">ยังไม่มีข้อมูล Plan ในระบบ</div>
              ) : (
                <MatrixTable
                  rows={data.planActualMatrix.map((p) => ({
                    key: p.projectId,
                    label1: p.projectNumber,
                    label2: p.projectName,
                    months: p.months,
                    totalPlanned: p.totalPlanned,
                    totalActual: p.totalActual,
                    isProject: true,
                  }))}
                  matrixMonths={data.matrixMonths}
                />
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Reusable Matrix Table ────────────────────────────────────────────────────
function MatrixTable({ rows, matrixMonths }: {
  rows: { key: string; label1: string; label2: string; months: { year: number; month: number; label: string; planned: number; actual: number }[]; totalPlanned: number; totalActual: number; isProject?: boolean }[];
  matrixMonths: { year: number; month: number; label: string }[];
}) {
  if (!rows.length) return <div className="p-10 text-center text-gray-400 text-sm">ยังไม่มีข้อมูล Plan</div>;

  // แสดงเฉพาะเดือนที่มี plan > 0 อย่างน้อย 1 โปรเจกต์
  const visibleMonths = matrixMonths.filter((mm) =>
    rows.some((row) => {
      const m = row.months.find((x) => x.year === mm.year && x.month === mm.month);
      return (m?.planned ?? 0) > 0;
    })
  );

  return (
    <table className="text-xs w-full">
      <thead>
        <tr className="bg-gray-50">
          <th className="text-left px-4 py-2.5 font-semibold text-gray-700 min-w-[160px] sticky left-0 bg-gray-50 border-r border-gray-200 z-10">
            {rows[0]?.isProject ? "โปรเจกต์" : "พนักงาน"}
          </th>
          {visibleMonths.map((m) => (
            <th key={`${m.year}-${m.month}`} className="px-2 py-2.5 text-center min-w-[90px] font-medium text-gray-600">{m.label}</th>
          ))}
          <th className="px-3 py-2.5 text-center min-w-[80px] font-semibold text-gray-700 border-l border-gray-200">Total Plan</th>
          <th className="px-3 py-2.5 text-center min-w-[80px] font-semibold text-gray-700">Total Actual</th>
          <th className="px-3 py-2.5 text-center min-w-[70px] font-semibold text-gray-700">Variance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const variance = row.totalPlanned > 0
            ? Math.round(((row.totalActual - row.totalPlanned) / row.totalPlanned) * 100) : 0;
          return (
            <tr key={row.key} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2 sticky left-0 bg-white border-r border-gray-200 z-10">
                {row.isProject ? (
                  <><p className="font-mono font-semibold text-blue-700">{row.label1}</p>
                    <p className="text-gray-500 truncate max-w-[140px]">{row.label2}</p></>
                ) : (
                  <><p className="font-semibold text-gray-800">{row.label1}</p>
                    <p className="text-gray-400">{row.label2}</p></>
                )}
              </td>
              {visibleMonths.map((mm) => {
                const m = row.months.find((x) => x.year === mm.year && x.month === mm.month) ?? { planned: 0, actual: 0 };
                const hasData = m.planned > 0 || m.actual > 0;
                const over    = m.planned > 0 && m.actual > m.planned;
                const onPlan  = m.planned > 0 && m.actual >= m.planned * 0.8;
                const cellBg  = !hasData ? "" : over ? "bg-red-50" : onPlan ? "bg-green-50" : "bg-amber-50";
                const pct     = m.planned > 0 ? Math.round((m.actual / m.planned) * 100) : 0;
                return (
                  <td key={`${mm.year}-${mm.month}`} className={`px-2 py-2 text-center ${cellBg}`}
                    title={hasData ? `Plan: ${m.planned}h | Actual: ${m.actual}h | ${pct}%` : "ไม่มีแผน"}>
                    {hasData ? (
                      <div>
                        <div className={`font-semibold ${over ? "text-red-700" : onPlan ? "text-green-700" : "text-amber-700"}`}>{m.actual}h</div>
                        <div className="text-gray-400">/{m.planned}h</div>
                        {m.planned > 0 && <div className={`font-medium ${over ? "text-red-600" : onPlan ? "text-green-600" : "text-amber-600"}`}>{pct}%</div>}
                      </div>
                    ) : <span className="text-gray-200">–</span>}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center border-l border-gray-200 font-semibold text-purple-800">{row.totalPlanned > 0 ? `${row.totalPlanned}h` : "–"}</td>
              <td className="px-3 py-2 text-center font-semibold text-blue-900">{row.totalActual > 0 ? `${row.totalActual}h` : "–"}</td>
              <td className={`px-3 py-2 text-center font-bold ${variance > 0 ? "text-red-600" : variance < -20 ? "text-amber-600" : "text-green-600"}`}>
                {row.totalPlanned > 0 ? `${variance > 0 ? "+" : ""}${variance}%` : "–"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
