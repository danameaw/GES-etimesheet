"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, startOfWeek, addWeeks, subWeeks, addDays } from "date-fns";

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
  const [filter, setFilter] = useState<"all" | "submitted" | "approved" | "draft" | "missing">("all");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const role = (session?.user as any)?.role;
  const isAdmin = role === "admin";
  const canApprove = ["admin", "pd"].includes(role);

  useEffect(() => {
    if (session && !canApprove) router.push("/timesheet");
  }, [session, canApprove, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin?week=${format(currentWeek, "yyyy-MM-dd")}`);
    const data = await res.json();
    setSummary(data.summary);
    setEmployees(data.employees || []);
    setLoading(false);
  }, [currentWeek]);

  useEffect(() => { load(); }, [load]);

  async function handleUnlock(timesheetId: string) {
    setActing(timesheetId);
    await fetch(`/api/timesheets/${timesheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock" }),
    });
    setActing(null);
    load();
  }

  async function handleApprove(timesheetId: string) {
    setActing(timesheetId);
    await fetch(`/api/timesheets/${timesheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    setActing(null);
    load();
  }

  const weekEnd = addDays(currentWeek, 6);

  const filtered = employees.filter((e) => {
    const matchesFilter = filter === "all" || e.status === filter;
    const matchesSearch = !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // Approved count (for PD summary)
  const approvedCount = employees.filter((e) => e.status === "approved").length;

  if (!canApprove) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {role === "pd" ? "Timesheet Approval" : "Admin View"}
          </h1>
          <p className="text-gray-500 text-sm">
            {role === "pd" ? "อนุมัติ Timesheet ประจำสัปดาห์" : "Timesheet submission overview"}
          </p>
        </div>

        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← ก่อนหน้า</button>
          <div className="text-center min-w-[200px]">
            <p className="font-semibold text-sm">{format(currentWeek, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</p>
            <p className="text-xs text-gray-400">สัปดาห์ที่ {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">ถัดไป →</button>
          <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">วันนี้</button>
          <button onClick={load} title="Refresh" className="text-xs text-gray-500 hover:text-blue-600 ml-1">🔄</button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <SummaryCard label="พนักงานทั้งหมด" value={summary.total}     color="bg-blue-900"   icon="👥" onClick={() => setFilter("all")}       active={filter === "all"} />
          <SummaryCard label="รออนุมัติ"       value={summary.submitted} color="bg-amber-500"  icon="📋" onClick={() => setFilter("submitted")} active={filter === "submitted"} />
          <SummaryCard label="อนุมัติแล้ว"     value={approvedCount}     color="bg-green-600"  icon="✓"  onClick={() => setFilter("approved")}  active={filter === "approved"} />
          <SummaryCard label="Draft"           value={summary.draft}     color="bg-gray-500"   icon="✏️" onClick={() => setFilter("draft")}     active={filter === "draft"} />
          <SummaryCard label="ยังไม่ส่ง"       value={summary.missing}   color="bg-red-600"    icon="⚠"  onClick={() => setFilter("missing")}   active={filter === "missing"} />
        </div>
      )}

      {/* Progress bar */}
      {summary && summary.total > 0 && (
        <div className="ges-card p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">
              {role === "pd" ? "อนุมัติแล้ว" : "Submission Progress"}
            </span>
            <span className="text-gray-500">
              {role === "pd"
                ? `อนุมัติ ${approvedCount}/${summary.total} (${Math.round((approvedCount / summary.total) * 100)}%)`
                : `${summary.submitted}/${summary.total} (${Math.round((summary.submitted / summary.total) * 100)}%)`}
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${role === "pd" ? (approvedCount / summary.total) * 100 : (summary.submitted / summary.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Search + Filter + Export */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, รหัส, แผนก..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ges-input max-w-sm"
        />
        <div className="flex gap-2 flex-wrap">
          {(["all", "submitted", "approved", "draft", "missing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
                filter === f ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "submitted" ? "รออนุมัติ" : f === "approved" ? "อนุมัติแล้ว" : f === "draft" ? "Draft" : f === "missing" ? "ยังไม่ส่ง" : "ทั้งหมด"}
            </button>
          ))}
        </div>

        {/* Export buttons — PD + Admin */}
        <div className="flex gap-2 ml-auto flex-wrap">
          <ExportBtn type="weekly"      week={currentWeek} label="📥 Weekly Excel" />
          <ExportBtn type="utilization" week={currentWeek} label="📊 Utilization" />
          <ExportBtn type="missing"     week={currentWeek} label="⚠ Missing" />
          <ExportBtn type="project"     week={currentWeek} label="🗂 By Project" />
        </div>
      </div>

      {/* Table */}
      <div className="ges-card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400">กำลังโหลด…</div>
        ) : (
          <table className="ges-table w-full">
            <thead>
              <tr>
                <th className="text-left">รหัสพนักงาน</th>
                <th className="text-left">ชื่อ-นามสกุล</th>
                <th className="text-left">แผนก</th>
                <th>ชั่วโมงรวม</th>
                <th>Utilization</th>
                <th>สถานะ</th>
                <th>ส่งเมื่อ</th>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td>
                </tr>
              ) : (
                filtered.map((emp) => {
                  const utilization = Math.round((emp.totalHrs / 40) * 100);
                  return (
                    <tr key={emp.id}>
                      <td className="font-mono text-xs font-semibold text-blue-900">{emp.employeeId}</td>
                      <td className="font-medium">{emp.name}</td>
                      <td className="text-gray-600 text-xs">{emp.department}</td>
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
                        <StatusBadge status={emp.status} />
                      </td>
                      <td className="text-xs text-gray-500 text-center">
                        {emp.submittedAt ? format(new Date(emp.submittedAt), "dd/MM HH:mm") : "-"}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {/* PD ONLY: Approve button */}
                          {role === "pd" && emp.status === "submitted" && emp.timesheetId && (
                            <button
                              onClick={() => handleApprove(emp.timesheetId!)}
                              disabled={acting === emp.timesheetId}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              ✓ อนุมัติ
                            </button>
                          )}
                          {/* PD + Admin: Unlock */}
                          {["submitted", "approved"].includes(emp.status) && emp.timesheetId && (
                            <button
                              onClick={() => handleUnlock(emp.timesheetId!)}
                              disabled={acting === emp.timesheetId}
                              className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50"
                            >
                              🔓 ปลดล็อค
                            </button>
                          )}
                          {/* Admin ONLY: Edit timesheet */}
                          {isAdmin && (
                            <Link
                              href={`/admin/edit?empId=${emp.id}&week=${format(currentWeek, "yyyy-MM-dd")}`}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              ✏️ แก้ไข
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3 text-right">แสดง {filtered.length} จาก {employees.length} คน</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    submitted: { label: "รออนุมัติ", cls: "bg-amber-100 text-amber-800" },
    approved:  { label: "✓ อนุมัติแล้ว", cls: "bg-green-100 text-green-800" },
    draft:     { label: "Draft", cls: "bg-gray-100 text-gray-600" },
    missing:   { label: "ยังไม่ส่ง", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status] ?? map.missing;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function SummaryCard({ label, value, color, icon, onClick, active }: {
  label: string; value: number; color: string; icon: string;
  onClick: () => void; active: boolean;
}) {
  return (
    <button onClick={onClick} className={`ges-card p-4 text-left transition-all hover:shadow-md ${active ? "ring-2 ring-blue-500" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        </div>
        <div className={`${color} text-white w-10 h-10 rounded-xl flex items-center justify-center text-lg`}>{icon}</div>
      </div>
    </button>
  );
}

function ExportBtn({ type, week, label }: { type: string; week: Date; label: string }) {
  const weekStr = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;
  return (
    <a href={`/api/export?type=${type}&week=${weekStr}`}
      className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
      {label}
    </a>
  );
}
