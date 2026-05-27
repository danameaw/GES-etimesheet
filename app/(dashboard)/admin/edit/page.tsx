"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, addDays } from "date-fns";

interface Project { id: string; projectNumber: string; projectName: string; }
interface TaskCode { id: string; code: string; name: string; }
interface Employee { id: string; employeeId: string; name: string; department: string; position: string; }
interface TimesheetRow {
  id: string; projectId: string; taskCodeId: string;
  monHrs: number; tueHrs: number; wedHrs: number; thuHrs: number;
  friHrs: number; satHrs: number; sunHrs: number;
}

const DAYS: { key: keyof TimesheetRow; short: string }[] = [
  { key: "monHrs", short: "Mon" }, { key: "tueHrs", short: "Tue" },
  { key: "wedHrs", short: "Wed" }, { key: "thuHrs", short: "Thu" },
  { key: "friHrs", short: "Fri" }, { key: "satHrs", short: "Sat" },
  { key: "sunHrs", short: "Sun" },
];

let rowCounter = 0;
function newRow(): TimesheetRow {
  return { id: `row-${++rowCounter}`, projectId: "", taskCodeId: "",
    monHrs: 0, tueHrs: 0, wedHrs: 0, thuHrs: 0, friHrs: 0, satHrs: 0, sunHrs: 0 };
}

function AdminEditContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const empId = searchParams.get("empId");
  const weekParam = searchParams.get("week"); // yyyy-MM-dd

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskCodes, setTaskCodes] = useState<TaskCode[]>([]);
  const [rows, setRows] = useState<TimesheetRow[]>([newRow()]);
  const [timesheetStatus, setTimesheetStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (session && role !== "admin") router.push("/timesheet");
  }, [session, role, router]);

  const weekStart = weekParam ? new Date(weekParam + "T00:00:00.000Z") : new Date();
  const weekEnd = addDays(weekStart, 6);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(async () => {
    if (!empId || !weekParam) return;
    setLoading(true);
    const res = await fetch(`/api/admin/timesheet?empId=${empId}&week=${weekParam}`);
    const data = await res.json();
    if (!res.ok) { setLoading(false); return; }
    setEmployee(data.employee);
    setProjects(data.projects || []);
    setTaskCodes(data.taskCodes || []);
    if (data.timesheet?.entries?.length > 0) {
      setRows(data.timesheet.entries.map((e: any) => ({
        id: e.id, projectId: e.projectId, taskCodeId: e.taskCodeId,
        monHrs: e.monHrs, tueHrs: e.tueHrs, wedHrs: e.wedHrs,
        thuHrs: e.thuHrs, friHrs: e.friHrs, satHrs: e.satHrs, sunHrs: e.sunHrs,
      })));
      setTimesheetStatus(data.timesheet.status);
    } else {
      setRows([newRow()]);
      setTimesheetStatus("draft");
    }
    setLoading(false);
  }, [empId, weekParam]);

  useEffect(() => { load(); }, [load]);

  const totalByDay = DAYS.map((d) => rows.reduce((sum, r) => sum + (Number(r[d.key]) || 0), 0));
  const totalWeekHrs = totalByDay.reduce((a, b) => a + b, 0);

  function updateRow(id: string, field: keyof TimesheetRow, value: string | number) {
    setRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, [field]: field.endsWith("Hrs") ? Number(value) || 0 : value } : r
    ));
  }

  async function handleSave(action: "save" | "submit") {
    const validRows = rows.filter((r) => r.projectId && r.taskCodeId);
    if (validRows.length === 0) {
      setMessage({ type: "error", text: "กรุณาเพิ่มอย่างน้อย 1 รายการที่มีโครงการและ Task Code" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empId, weekStart: weekParam, entries: validRows, action }),
      });
      const data = await res.json();
      if (res.ok) {
        setTimesheetStatus(data.status);
        setMessage({ type: "success", text: action === "submit" ? "✓ Submit สำเร็จ!" : "✓ บันทึก Draft แล้ว" });
      } else {
        setMessage({ type: "error", text: data.error || "เกิดข้อผิดพลาด" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    }
    setSaving(false);
  }

  if (role !== "admin") return null;
  if (!empId || !weekParam) return <div className="text-red-500 p-6">Missing parameters.</div>;

  const isSubmitted = timesheetStatus === "submitted";

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="ges-btn-secondary px-3 py-1.5 text-sm">
            ← กลับ
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">แก้ไข Timesheet</h1>
            {employee ? (
              <p className="text-gray-500 text-sm mt-0.5">
                <span className="font-mono font-semibold text-blue-700">{employee.employeeId}</span>
                {" · "}{employee.name}{" · "}{employee.department}
              </p>
            ) : (
              <p className="text-gray-400 text-sm">กำลังโหลด…</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="font-semibold text-gray-800 text-sm">
              {format(weekStart, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}
            </p>
            <p className="text-xs text-gray-400">Week {format(weekStart, "w, yyyy")}</p>
          </div>
          <span className={`text-sm font-medium px-3 py-1 rounded-full ${
            isSubmitted ? "bg-green-100 text-green-800" :
            timesheetStatus === "approved" ? "bg-blue-100 text-blue-800" :
            "bg-yellow-100 text-yellow-800"
          }`}>
            {isSubmitted ? "✓ Submitted" : timesheetStatus === "approved" ? "✓ Approved" : "Draft"}
          </span>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          message.type === "success"
            ? "bg-green-50 text-green-800 border border-green-200"
            : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {message.text}
        </div>
      )}

      {totalWeekHrs > 0 && totalWeekHrs < 40 && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200 flex gap-2">
          <span>⚠️</span>
          <span>ชั่วโมงรวม ({totalWeekHrs}h) ต่ำกว่า 40h</span>
        </div>
      )}

      {/* Timesheet Grid */}
      <div className="ges-card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
        ) : (
          <table className="ges-table w-full min-w-[900px]">
            <thead>
              <tr>
                <th className="text-left w-[260px]">Project</th>
                <th className="text-left w-[180px]">Task Code</th>
                {DAYS.map((d, i) => (
                  <th key={d.key} className={weekDates[i].getDay() === 0 || weekDates[i].getDay() === 6 ? "bg-blue-800" : ""}>
                    <div>{d.short}</div>
                    <div className="text-blue-200 font-normal text-xs">{format(weekDates[i], "dd/MM")}</div>
                  </th>
                ))}
                <th>Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowTotal = DAYS.reduce((sum, d) => sum + (Number(row[d.key]) || 0), 0);
                return (
                  <tr key={row.id}>
                    <td>
                      <select value={row.projectId} onChange={(e) => updateRow(row.id, "projectId", e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                        <option value="">-- เลือก Project --</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.projectNumber} - {p.projectName.length > 30 ? p.projectName.slice(0, 28) + "…" : p.projectName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={row.taskCodeId} onChange={(e) => updateRow(row.id, "taskCodeId", e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                        <option value="">-- Task --</option>
                        {taskCodes.map((t) => (
                          <option key={t.id} value={t.id}>{t.code} - {t.name}</option>
                        ))}
                      </select>
                    </td>
                    {DAYS.map((d, i) => (
                      <td key={d.key} className={`text-center ${weekDates[i].getDay() === 0 || weekDates[i].getDay() === 6 ? "bg-gray-50" : ""}`}>
                        <input type="number" min="0" max="24" step="0.5"
                          value={row[d.key] || ""}
                          onChange={(e) => updateRow(row.id, d.key, e.target.value)}
                          className="hours-input" placeholder="0" />
                      </td>
                    ))}
                    <td className={`text-center font-semibold text-sm ${rowTotal > 0 ? "text-blue-800" : "text-gray-400"}`}>
                      {rowTotal > 0 ? rowTotal : "-"}
                    </td>
                    <td className="text-center">
                      {rows.length > 1 && (
                        <button onClick={() => setRows((p) => p.filter((r) => r.id !== row.id))}
                          className="text-red-400 hover:text-red-600 text-lg leading-none" title="ลบแถว">×</button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr className="bg-blue-50">
                <td colSpan={2} className="font-semibold text-sm text-gray-700 px-3 py-2">Daily Total</td>
                {totalByDay.map((total, i) => (
                  <td key={i} className={`text-center font-bold text-sm ${
                    total > 0 ? (total > 8 ? "text-red-600" : "text-blue-900") : "text-gray-400"
                  }`}>{total > 0 ? total : "-"}</td>
                ))}
                <td className={`text-center font-bold text-base ${
                  totalWeekHrs >= 40 ? "text-green-700" : totalWeekHrs > 0 ? "text-amber-600" : "text-gray-400"
                }`}>{totalWeekHrs > 0 ? totalWeekHrs : "-"}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setRows((p) => [...p, newRow()])}
            className="ges-btn-secondary text-sm flex items-center gap-1">
            <span className="text-lg leading-none">+</span> เพิ่มแถว
          </button>
          <span className="text-sm text-gray-500">
            Week total:{" "}
            <span className={`font-bold ${totalWeekHrs >= 40 ? "text-green-700" : "text-amber-600"}`}>
              {totalWeekHrs}h
            </span> / 40h
          </span>
        </div>
        <div className="flex gap-3">
          <button onClick={() => handleSave("save")} disabled={saving} className="ges-btn-secondary">
            {saving ? "Saving…" : "💾 Save Draft"}
          </button>
          <button onClick={() => handleSave("submit")} disabled={saving} className="ges-btn-primary">
            {saving ? "Submitting…" : "✓ Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminEditPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-gray-400 animate-pulse">กำลังโหลด…</div></div>}>
      <AdminEditContent />
    </Suspense>
  );
}
