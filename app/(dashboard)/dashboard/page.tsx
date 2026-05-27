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

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend
);

interface DashboardData {
  projectHours: { projectNumber: string; projectName: string; hours: number }[];
  categoryHours: { category: string; hours: number }[];
  deptHours: { department: string; hours: number }[];
  topEmployees: { name: string; hours: number }[];
  weeklyTrend: { week: string; utilization: number; totalHrs: number }[];
  planVsActual: { projectNumber: string; projectName: string; planned: number; actual: number }[];
  summary: { totalHours: number; submittedCount: number; totalEmployees: number; mode: string };
}

const COLORS = [
  "#1e3a5f", "#2563eb", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#65a30d", "#ea580c",
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

  // Mode: "week" | "month"
  const [mode, setMode] = useState<"week" | "month">("week");

  // Week mode: selected Monday
  const [currentWeek, setCurrentWeek] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  // Month mode: first day of selected month
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    startOfMonth(new Date())
  );

  const role = (session?.user as any)?.role;
  const canView = role === "pd";

  useEffect(() => {
    if (session && !canView) router.push("/timesheet");
  }, [session, canView, router]);

  const fetchData = useCallback(() => {
    setLoading(true);
    let url = "/api/admin/dashboard?";
    if (mode === "week") {
      url += `week=${format(currentWeek, "yyyy-MM-dd")}`;
    } else {
      url += `month=${format(currentMonth, "yyyy-MM")}`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mode, currentWeek, currentMonth]);

  useEffect(() => {
    if (canView) fetchData();
  }, [canView, fetchData]);

  if (!canView) return null;

  // Labels
  const weekEnd = new Date(currentWeek.getTime() + 6 * 86400000);
  const weekLabel = `${format(currentWeek, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;
  const monthLabel = `${MONTH_NAMES_TH[currentMonth.getMonth()]} ${currentMonth.getFullYear() + 543}`;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };

  return (
    <div>
      {/* Header + Period Navigator */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="text-gray-500 text-sm">Project hours, workload, and utilization overview</p>
        </div>

        {/* Mode tabs + Navigator */}
        <div className="flex flex-col items-end gap-2">
          {/* Tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setMode("week")}
              className={`px-4 py-1.5 font-medium transition-colors ${
                mode === "week" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              รายสัปดาห์
            </button>
            <button
              onClick={() => setMode("month")}
              className={`px-4 py-1.5 font-medium transition-colors border-l border-gray-200 ${
                mode === "month" ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              รายเดือน
            </button>
          </div>

          {/* Week navigator */}
          {mode === "week" && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-gray-700 min-w-[170px] text-center">
                {weekLabel}
              </span>
              <button
                onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                ›
              </button>
              <button
                onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 ml-1"
              >
                สัปดาห์นี้
              </button>
            </div>
          )}

          {/* Month navigator */}
          {mode === "month" && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-gray-700 min-w-[150px] text-center">
                {monthLabel}
              </span>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                ›
              </button>
              <button
                onClick={() => setCurrentMonth(startOfMonth(new Date()))}
                className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 ml-1"
              >
                เดือนนี้
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-lg animate-pulse">Loading dashboard…</div>
        </div>
      ) : !data ? (
        <div className="text-red-500">Failed to load dashboard data.</div>
      ) : (
        <>
          {/* Summary KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="ges-card p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">ชั่วโมงรวม</p>
              <p className="text-2xl font-bold text-blue-900">
                {data.summary?.totalHours ?? 0}
                <span className="text-sm font-normal text-gray-400 ml-1">h</span>
              </p>
            </div>
            <div className="ges-card p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Timesheets ที่ส่ง</p>
              <p className="text-2xl font-bold text-blue-900">{data.summary?.submittedCount ?? 0}</p>
            </div>
            <div className="ges-card p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">พนักงานทั้งหมด</p>
              <p className="text-2xl font-bold text-blue-900">{data.summary?.totalEmployees ?? 0}</p>
            </div>
            <div className="ges-card p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">อัตราการส่ง</p>
              <p className="text-2xl font-bold text-blue-900">
                {data.summary?.totalEmployees
                  ? Math.round((data.summary.submittedCount / data.summary.totalEmployees) * 100)
                  : 0}
                <span className="text-sm font-normal text-gray-400 ml-0.5">%</span>
              </p>
            </div>
          </div>

          {data.projectHours.length === 0 ? (
            <div className="ges-card p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-lg font-medium">ไม่มีข้อมูลในช่วงเวลานี้</p>
              <p className="text-sm mt-1">ลองเลือกสัปดาห์หรือเดือนอื่น</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Bar: Hours by Project */}
              <div className="ges-card p-5 lg:col-span-2">
                <h2 className="font-semibold text-gray-800 mb-4">Hours by Project (Top 10)</h2>
                <div style={{ height: 280 }}>
                  <Bar
                    data={{
                      labels: data.projectHours.map((p) => p.projectNumber),
                      datasets: [{
                        label: "Hours",
                        data: data.projectHours.map((p) => p.hours),
                        backgroundColor: COLORS,
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      ...chartOptions,
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
                        y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* Doughnut: Hours by Task Category */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Hours by Task Category</h2>
                <div className="flex items-center gap-6">
                  <div style={{ height: 220, width: 220 }} className="flex-shrink-0">
                    <Doughnut
                      data={{
                        labels: data.categoryHours.map((c) => c.category),
                        datasets: [{
                          data: data.categoryHours.map((c) => c.hours),
                          backgroundColor: COLORS,
                          borderWidth: 2,
                          borderColor: "#fff",
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                      }}
                    />
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto max-h-48">
                    {data.categoryHours.map((c, i) => (
                      <div key={c.category} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-600 flex-1 text-xs">{c.category}</span>
                        <span className="font-semibold text-gray-900 text-xs">{c.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Horizontal Bar: Workload by Department */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Workload by Department</h2>
                <div style={{ height: 240 }}>
                  <Bar
                    data={{
                      labels: data.deptHours.map((d) => d.department),
                      datasets: [{
                        label: "Hours",
                        data: data.deptHours.map((d) => d.hours),
                        backgroundColor: "#2563eb",
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      ...chartOptions,
                      indexAxis: "y" as const,
                      scales: {
                        x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* Horizontal Bar: Top 8 Employees */}
              <div className="ges-card p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Top 8 Employees by Hours</h2>
                <div style={{ height: 260 }}>
                  <Bar
                    data={{
                      labels: data.topEmployees.map((e) => e.name.split(" ")[0]),
                      datasets: [{
                        label: "Hours",
                        data: data.topEmployees.map((e) => e.hours),
                        backgroundColor: "#059669",
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      ...chartOptions,
                      indexAxis: "y" as const,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            title: (items) => data.topEmployees[items[0].dataIndex].name,
                            label: (item) => ` ${item.raw}h`,
                          },
                        },
                      },
                      scales: {
                        x: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => `${v}h` } },
                        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* Combined Bar+Line: Weekly Utilization Trend */}
              <div className="ges-card p-5 lg:col-span-2">
                <h2 className="font-semibold text-gray-800 mb-1">
                  {mode === "month"
                    ? `Weekly Utilization — ${monthLabel}`
                    : "Weekly Utilization Trend (Last 6 Weeks)"}
                </h2>
                <p className="text-xs text-gray-400 mb-4">ชั่วโมงที่ส่งจริง (แท่ง) และอัตราการใช้งาน % เทียบ 40h/คน (เส้น)</p>
                <div style={{ height: 230 }}>
                  <Bar
                    data={{
                      labels: data.weeklyTrend.map((w) => w.week),
                      datasets: [
                        {
                          type: "bar" as const,
                          label: "ชั่วโมง (h)",
                          data: data.weeklyTrend.map((w) => w.totalHrs ?? 0),
                          backgroundColor: "rgba(37,99,235,0.25)",
                          borderRadius: 4,
                          yAxisID: "yHrs",
                        },
                        {
                          type: "line" as const,
                          label: "Utilization %",
                          data: data.weeklyTrend.map((w) => w.utilization),
                          borderColor: "#1e3a5f",
                          backgroundColor: "rgba(30,58,95,0.0)",
                          tension: 0.3,
                          pointBackgroundColor: "#1e3a5f",
                          pointRadius: 5,
                          yAxisID: "yPct",
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: true, position: "top" as const },
                        tooltip: {
                          callbacks: {
                            label: (item) =>
                              item.datasetIndex === 1
                                ? ` Utilization: ${item.raw}%`
                                : ` ชั่วโมง: ${item.raw}h`,
                          },
                        },
                      },
                      scales: {
                        yHrs: {
                          type: "linear" as const,
                          position: "left" as const,
                          beginAtZero: true,
                          grid: { color: "#f1f5f9" },
                          ticks: { callback: (v) => `${v}h` },
                        },
                        yPct: {
                          type: "linear" as const,
                          position: "right" as const,
                          beginAtZero: true,
                          max: 130,
                          grid: { display: false },
                          ticks: { callback: (v) => `${v}%` },
                        },
                        x: { grid: { display: false } },
                      },
                    }}
                  />
                </div>
              </div>

              {/* Bar: Plan vs Actual hours by Project */}
              {data.planVsActual && data.planVsActual.length > 0 && (
                <div className="ges-card p-5 lg:col-span-2">
                  <h2 className="font-semibold text-gray-800 mb-1">Plan vs Actual Hours by Project</h2>
                  <p className="text-xs text-gray-400 mb-4">เปรียบเทียบชั่วโมงที่วางแผน (Resource Plan) กับชั่วโมงที่ลงจริงในช่วงเวลาที่เลือก</p>
                  <div style={{ height: 300 }}>
                    <Bar
                      data={{
                        labels: data.planVsActual.map((p) => p.projectNumber),
                        datasets: [
                          {
                            label: "แผน (Planned)",
                            data: data.planVsActual.map((p) => p.planned),
                            backgroundColor: "rgba(37,99,235,0.7)",
                            borderRadius: 4,
                          },
                          {
                            label: "จริง (Actual)",
                            data: data.planVsActual.map((p) => p.actual),
                            backgroundColor: "rgba(5,150,105,0.7)",
                            borderRadius: 4,
                          },
                        ],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
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
                      }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}
        </>
      )}
    </div>
  );
}
