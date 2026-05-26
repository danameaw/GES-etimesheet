"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";

interface EmployeeRow {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  timesheetId: string | null;
  status: string;
  submittedAt: string | null;
  totalHrs: number;
}

interface Summary {
  total: number;
  submitted: number;
  draft: number;
  missing: number;
  weekStart: string;
  weekEnd: string;
}

export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "submitted" | "draft" | "missing">("all");
  const [search, setSearch] = useState("");
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const isAdmin = (session?.user as any)?.role === "admin";

  useEffect(() => {
    if (session && !isAdmin) router.push("/timesheet");
  }, [session, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin?week=${currentWeek.toISOString()}`);
    const data = await res.json();
    setSummary(data.summary);
    setEmployees(data.employees || []);
    setLoading(false);
  }, [currentWeek]);

  useEffect(() => { load(); }, [load]);

  async function handleUnlock(timesheetId: string) {
    setUnlocking(timesheetId);
    await fetch(`/api/timesheets/${timesheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock" }),
    });
    setUnlocking(null);
    load();
  }

  const weekEnd = new Date(currentWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const filtered = employees.filter((e) => {
    const matchesFilter = filter === "all" || e.status === filter;
    const matchesSearch = !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (!isAdmin) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin View</h1>
          <p className="text-gray-500 text-sm">Timesheet submission overview</p>
        </div>

        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← Prev</button>
          <div className="text-center min-w-[200px]">
            <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
            <p className="text-xs text-gray-400">Week {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">Next →</button>
          <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">Today</button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="Total Employees"
            value={summary.total}
            color="bg-blue-900"
            icon="👥"
            onClick={() => setFilter("all")}
            active={filter === "all"}
          />
          <SummaryCard
            label="Submitted"
            value={summary.submitted}
            color="bg-green-600"
            icon="✓"
            onClick={() => setFilter("submitted")}
            active={filter === "submitted"}
          />
          <SummaryCard
            label="Draft"
            value={summary.draft}
            color="bg-amber-500"
            icon="✏️"
            onClick={() => setFilter("draft")}
            active={filter === "draft"}
          />
          <SummaryCard
            label="Missing"
            value={summary.missing}
            color="bg-red-600"
            icon="⚠"
            onClick={() => setFilter("missing")}
            active={filter === "missing"}
          />
        </div>
      )}

      {/* Progress bar */}
      {summary && summary.total > 0 && (
        <div className="ges-card p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Submission Progress</span>
            <span className="text-gray-500">{summary.submitted}/{summary.total} ({Math.round((summary.submitted / summary.total) * 100)}%)</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${(summary.submitted / summary.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, ID, or department..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ges-input max-w-sm"
        />
        <div className="flex gap-2">
          {(["all", "submitted", "draft", "missing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
                filter === f ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 ml-auto">
          <ExportBtn type="weekly" week={currentWeek} label="📥 Weekly" />
          <ExportBtn type="missing" week={currentWeek} label="Missing" />
          <ExportBtn type="utilization" week={currentWeek} label="Utilization" />
        </div>
      </div>

      {/* Table */}
      <div className="ges-card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-left">Employee ID</th>
                <th className="text-left">Name</th>
                <th className="text-left">Department</th>
                <th className="text-left">Position</th>
                <th>Total Hrs</th>
                <th>Utilization</th>
                <th>Status</th>
                <th>Submitted At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">No records found</td>
                </tr>
              ) : (
                filtered.map((emp) => {
                  const utilization = Math.round((emp.totalHrs / 40) * 100);
                  return (
                    <tr key={emp.id}>
                      <td className="font-mono text-xs">{emp.employeeId}</td>
                      <td className="font-medium">{emp.name}</td>
                      <td className="text-gray-600 text-xs">{emp.department}</td>
                      <td className="text-gray-500 text-xs">{emp.position}</td>
                      <td className="text-center font-semibold">
                        <span className={emp.totalHrs >= 40 ? "text-green-700" : emp.totalHrs > 0 ? "text-amber-600" : "text-gray-400"}>
                          {emp.totalHrs > 0 ? `${emp.totalHrs}h` : "-"}
                        </span>
                      </td>
                      <td className="text-center">
                        {emp.totalHrs > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${utilization >= 100 ? "bg-green-500" : utilization >= 75 ? "bg-amber-400" : "bg-red-400"}`}
                                style={{ width: `${Math.min(utilization, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-10">{utilization}%</span>
                          </div>
                        )}
                      </td>
                      <td className="text-center">
                        <span className={`status-${emp.status === "missing" ? "missing" : emp.status === "submitted" ? "submitted" : "draft"}`}>
                          {emp.status === "submitted" ? "✓ Submitted" : emp.status === "draft" ? "Draft" : "Missing"}
                        </span>
                      </td>
                      <td className="text-xs text-gray-500 text-center">
                        {emp.submittedAt ? format(new Date(emp.submittedAt), "dd/MM HH:mm") : "-"}
                      </td>
                      <td className="text-center">
                        {emp.status === "submitted" && emp.timesheetId && (
                          <button
                            onClick={() => handleUnlock(emp.timesheetId!)}
                            disabled={unlocking === emp.timesheetId}
                            className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50"
                          >
                            🔓 Unlock
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3 text-right">Showing {filtered.length} of {employees.length} employees</p>
    </div>
  );
}

function SummaryCard({ label, value, color, icon, onClick, active }: {
  label: string; value: number; color: string; icon: string;
  onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`ges-card p-5 text-left transition-all hover:shadow-md ${active ? "ring-2 ring-blue-500" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        </div>
        <div className={`${color} text-white w-10 h-10 rounded-xl flex items-center justify-center text-lg`}>
          {icon}
        </div>
      </div>
    </button>
  );
}

function ExportBtn({ type, week, label }: { type: string; week: Date; label: string }) {
  return (
    <a
      href={`/api/export?type=${type}&week=${week.toISOString()}`}
      className="ges-btn-secondary text-xs px-3 py-1.5"
    >
      {label}
    </a>
  );
}
