"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend
);

interface DashboardData {
  projectHours: { projectNumber: string; projectName: string; hours: number }[];
  categoryHours: { category: string; hours: number }[];
  deptHours: { department: string; hours: number }[];
  topEmployees: { name: string; hours: number }[];
  weeklyTrend: { week: string; utilization: number }[];
}

const COLORS = [
  "#1e3a5f", "#2563eb", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#65a30d", "#ea580c",
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;
  const isAdmin = role === "admin";
  const canView = ["admin", "pd"].includes(role);
  useEffect(() => {
    if (session && !canView) router.push("/timesheet");
  }, [session, canView, router]);

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (!canView) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg animate-pulse">Loading dashboard…</div>
      </div>
    );
  }

  if (!data) return <div className="text-red-500">Failed to load dashboard data.</div>;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
        <p className="text-gray-500 text-sm">Project hours, workload, and utilization overview</p>
      </div>

      {data.projectHours.length === 0 ? (
        <div className="ges-card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-lg font-medium">No data yet</p>
          <p className="text-sm mt-1">Submit timesheets to see analytics</p>
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
                        title: (items) => {
                          const idx = items[0].dataIndex;
                          return data.projectHours[idx].projectName;
                        },
                      },
                    },
                  },
                  scales: {
                    y: { beginAtZero: true, grid: { color: "#f1f5f9" } },
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
                    x: { beginAtZero: true, grid: { color: "#f1f5f9" } },
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
                      },
                    },
                  },
                  scales: {
                    x: { beginAtZero: true, grid: { color: "#f1f5f9" } },
                    y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                  },
                }}
              />
            </div>
          </div>

          {/* Line: Weekly Utilization Trend */}
          <div className="ges-card p-5 lg:col-span-2">
            <h2 className="font-semibold text-gray-800 mb-4">Weekly Utilization Trend (Last 6 Weeks)</h2>
            <div style={{ height: 200 }}>
              <Line
                data={{
                  labels: data.weeklyTrend.map((w) => w.week),
                  datasets: [{
                    label: "Utilization %",
                    data: data.weeklyTrend.map((w) => w.utilization),
                    borderColor: "#1e3a5f",
                    backgroundColor: "rgba(30,58,95,0.1)",
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: "#1e3a5f",
                    pointRadius: 5,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: {
                      beginAtZero: true,
                      max: 110,
                      grid: { color: "#f1f5f9" },
                      ticks: { callback: (v) => `${v}%` },
                    },
                    x: { grid: { display: false } },
                  },
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
