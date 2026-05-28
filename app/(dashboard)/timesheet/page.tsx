"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";

interface Project {
  id: string;
  projectNumber: string;
  projectName: string;
  projectType: string;
}

interface TaskCode {
  id: string;
  code: string;
  name: string;
  category: string;
}

interface TimesheetRow {
  id: string;
  projectId: string;
  taskCodeId: string;
  monHrs: number;
  tueHrs: number;
  wedHrs: number;
  thuHrs: number;
  friHrs: number;
  satHrs: number;
  sunHrs: number;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
}

const DAYS: { key: keyof TimesheetRow; label: string; short: string }[] = [
  { key: "monHrs", label: "Monday",    short: "Mon" },
  { key: "tueHrs", label: "Tuesday",   short: "Tue" },
  { key: "wedHrs", label: "Wednesday", short: "Wed" },
  { key: "thuHrs", label: "Thursday",  short: "Thu" },
  { key: "friHrs", label: "Friday",    short: "Fri" },
  { key: "satHrs", label: "Saturday",  short: "Sat" },
  { key: "sunHrs", label: "Sunday",    short: "Sun" },
];

let rowCounter = 0;
function newRow(): TimesheetRow {
  return {
    id: `row-${++rowCounter}`,
    projectId: "",
    taskCodeId: "",
    monHrs: 0, tueHrs: 0, wedHrs: 0, thuHrs: 0, friHrs: 0, satHrs: 0, sunHrs: 0,
  };
}

export default function TimesheetPage() {
  const { data: session } = useSession();
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [projects, setProjects]       = useState<Project[]>([]);
  const [taskCodes, setTaskCodes]     = useState<TaskCode[]>([]);
  const [holidays, setHolidays]       = useState<Holiday[]>([]);
  const [rows, setRows]               = useState<TimesheetRow[]>([newRow()]);
  const [timesheetStatus, setTimesheetStatus] = useState<string>("draft");
  const [saving, setSaving]           = useState(false);
  const [message, setMessage]         = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);

  const weekEnd = new Date(currentWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekLabel = `${format(currentWeek, "dd MMM")} – ${format(weekEnd, "dd MMM yyyy")}`;

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Build date-string set for fast holiday lookup: "yyyy-MM-dd"
  const holidayDateSet = new Set(holidays.map((h) => h.date.slice(0, 10)));
  const weekDateStrings = weekDates.map((d) => format(d, "yyyy-MM-dd"));
  const isHoliday = (dayIndex: number) => holidayDateSet.has(weekDateStrings[dayIndex]);
  const holidayName = (dayIndex: number) =>
    holidays.find((h) => h.date.slice(0, 10) === weekDateStrings[dayIndex])?.name;

  // Count working-day holidays (Mon–Fri) in this week
  const weekHolidayCount = weekDates.filter((d, i) => {
    const dow = d.getDay(); // 0=Sun, 6=Sat
    return dow >= 1 && dow <= 5 && isHoliday(i);
  }).length;
  const weekCapacity = 40 - weekHolidayCount * 8;

  // Fetch projects and task codes
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(({ projects, taskCodes }) => {
        setProjects(projects || []);
        setTaskCodes(taskCodes || []);
      });
  }, []);

  // Fetch timesheet + holidays for current week
  const loadTimesheet = useCallback(async () => {
    const weekStr = format(currentWeek, "yyyy-MM-dd");
    setMessage(null); // Clear any stale messages when loading a new week
    const res = await fetch(`/api/timesheets?week=${weekStr}`);
    const data = await res.json();

    setHolidays(data.holidays || []);

    if (data.timesheet) {
      setTimesheetStatus(data.timesheet.status);
      if (data.timesheet.entries.length > 0) {
        setRows(data.timesheet.entries.map((e: any) => ({
          id: e.id,
          projectId: e.projectId,
          taskCodeId: e.taskCodeId,
          monHrs: e.monHrs, tueHrs: e.tueHrs, wedHrs: e.wedHrs,
          thuHrs: e.thuHrs, friHrs: e.friHrs, satHrs: e.satHrs, sunHrs: e.sunHrs,
        })));
      } else {
        setRows([newRow()]);
      }
    } else {
      setTimesheetStatus("draft");
      setRows([newRow()]);
    }
  }, [currentWeek]);

  useEffect(() => { loadTimesheet(); }, [loadTimesheet]);

  // Sum all logged hours per day (holidays are now informational only — hours still count)
  const totalByDay = DAYS.map((d) =>
    rows.reduce((sum, r) => sum + (Number(r[d.key]) || 0), 0)
  );
  const totalWeekHrs = totalByDay.reduce((a, b) => a + b, 0);

  function updateRow(id: string, field: keyof TimesheetRow, value: string | number) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: field.endsWith("Hrs") ? Number(value) || 0 : value } : r))
    );
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id: string) {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSave(action: "save" | "submit") {
    const validRows = rows.filter((r) => r.projectId && r.taskCodeId);
    if (validRows.length === 0) {
      setMessage({ type: "error", text: "Please add at least one entry with project and task code." });
      return;
    }
    if (action === "submit" && totalWeekHrs < 40) {
      const ok = window.confirm(`Total hours (${totalWeekHrs}h) is less than 40h. Submit anyway?`);
      if (!ok) return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: format(currentWeek, "yyyy-MM-dd"),
          weekEnd:   format(weekEnd, "yyyy-MM-dd"),
          entries:   validRows,
          action:    action === "submit" ? "submit" : "save",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTimesheetStatus(data.status);
        setMessage({
          type: "success",
          text: action === "submit" ? "Timesheet submitted successfully!" : "Draft saved.",
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
    setSaving(false);
  }

  const isSubmitted = timesheetStatus === "submitted";
  const isApproved  = timesheetStatus === "approved";
  const canEdit     = !isSubmitted && !isApproved;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Timesheet</h1>
          <p className="text-gray-500 text-sm mt-0.5">{(session?.user as any)?.employeeId} · {session?.user?.name}</p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentWeek((w) => subWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← Prev</button>
          <div className="text-center min-w-[200px]">
            <p className="font-semibold text-gray-800 text-sm">{weekLabel}</p>
            <p className="text-xs text-gray-400">Week {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => setCurrentWeek((w) => addWeeks(w, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">Next →</button>
          <button onClick={() => setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">Today</button>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium px-3 py-1 rounded-full ${
            isApproved ? "bg-blue-100 text-blue-800" :
            isSubmitted ? "bg-green-100 text-green-800" :
            "bg-yellow-100 text-yellow-800"
          }`}>
            {isApproved ? "✓ Approved" : isSubmitted ? "✓ Submitted" : "Draft"}
          </span>
        </div>
      </div>

      {/* Holiday notice for this week */}
      {holidays.length > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800 flex items-start gap-2">
          <span className="text-base">🏖️</span>
          <div>
            <span className="font-semibold">วันหยุดสัปดาห์นี้: </span>
            {holidays.map((h, i) => (
              <span key={h.id}>{i > 0 ? " · " : ""}<strong>{h.name}</strong> ({format(new Date(h.date.slice(0,10) + "T00:00:00"), "dd MMM")})</span>
            ))}
            {weekHolidayCount > 0 && (
              <span className="ml-2 text-red-600">— เพดานสัปดาห์นี้: <strong>{weekCapacity}h</strong></span>
            )}
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" :
          message.type === "error"   ? "bg-red-50 text-red-800 border border-red-200" :
          "bg-yellow-50 text-yellow-800 border border-yellow-200"
        }`}>
          {message.text}
        </div>
      )}

      {/* Read-only notice */}
      {(isSubmitted || isApproved) && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          isApproved
            ? "bg-blue-50 text-blue-800 border border-blue-200"
            : "bg-green-50 text-green-800 border border-green-200"
        }`}>
          <span>🔒</span>
          <span>
            {isApproved
              ? "Timesheet ได้รับการ Approve แล้ว — ไม่สามารถแก้ไขได้"
              : "Timesheet ถูกส่งแล้ว — ไม่สามารถแก้ไขได้ กรุณาติดต่อ PD หรือ Admin เพื่อ Unlock"}
          </span>
        </div>
      )}

      {/* Hours warning */}
      {totalWeekHrs > 0 && totalWeekHrs < 40 && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
          <span>⚠️</span>
          <span>Total hours ({totalWeekHrs}h) is below 40h. Please complete your timesheet or log Leave/Holiday hours for remaining time.</span>
        </div>
      )}

      {/* Timesheet Grid */}
      <div className="ges-card overflow-x-auto">
        <table className="ges-table w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="text-left w-[260px]">Project</th>
              <th className="text-left w-[180px]">Task Code</th>
              {DAYS.map((d, i) => {
                const holName = holidayName(i);
                const isSat   = weekDates[i].getDay() === 6;
                const isSun   = weekDates[i].getDay() === 0;
                const isHol   = isHoliday(i);
                return (
                  <th key={d.key} className={isHol ? "bg-red-800" : (isSat || isSun) ? "bg-blue-800" : ""}>
                    <div>{d.short}</div>
                    <div className="text-blue-200 font-normal text-xs">{format(weekDates[i], "dd/MM")}</div>
                    {isHol && <div className="text-red-200 font-normal text-xs leading-tight truncate max-w-[60px]" title={holName}>{holName}</div>}
                  </th>
                );
              })}
              <th>Total</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowTotal = DAYS.reduce((sum, d) => sum + (Number(row[d.key]) || 0), 0);
              return (
                <tr key={row.id}>
                  {/* Project selector */}
                  <td>
                    <select
                      value={row.projectId}
                      onChange={(e) => updateRow(row.id, "projectId", e.target.value)}
                      disabled={!canEdit}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50"
                    >
                      <option value="">-- Select Project --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.projectNumber} - {p.projectName.length > 30 ? p.projectName.slice(0, 28) + "…" : p.projectName}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Task code selector */}
                  <td>
                    <select
                      value={row.taskCodeId}
                      onChange={(e) => updateRow(row.id, "taskCodeId", e.target.value)}
                      disabled={!canEdit}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50"
                    >
                      <option value="">-- Task --</option>
                      {taskCodes.map((t) => (
                        <option key={t.id} value={t.id}>{t.code} - {t.name}</option>
                      ))}
                    </select>
                  </td>

                  {/* Hours inputs */}
                  {DAYS.map((d, i) => {
                    const isHol   = isHoliday(i);
                    const isSat   = weekDates[i].getDay() === 6;
                    const isSun   = weekDates[i].getDay() === 0;
                    return (
                      <td key={d.key} className={`text-center ${isHol ? "bg-red-50" : (isSat || isSun) ? "bg-gray-50" : ""}`}>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={row[d.key] || ""}
                          onChange={(e) => updateRow(row.id, d.key, e.target.value)}
                          disabled={!canEdit}
                          className={`hours-input disabled:bg-gray-100 ${isHol ? "border-red-200 bg-red-50" : ""}`}
                          placeholder="0"
                        />
                      </td>
                    );
                  })}

                  {/* Row total */}
                  <td className={`text-center font-semibold text-sm ${rowTotal > 0 ? "text-blue-800" : "text-gray-400"}`}>
                    {rowTotal > 0 ? rowTotal : "-"}
                  </td>

                  {/* Remove row */}
                  <td className="text-center">
                    {canEdit && rows.length > 1 && (
                      <button onClick={() => removeRow(row.id)} className="text-red-400 hover:text-red-600 text-lg leading-none" title="Remove row">×</button>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Totals row */}
            <tr className="bg-blue-50">
              <td colSpan={2} className="font-semibold text-sm text-gray-700 px-3 py-2">Daily Total</td>
              {totalByDay.map((total, i) => {
                const isHol = isHoliday(i);
                return (
                  <td key={i} className={`text-center font-bold text-sm ${
                    isHol ? "bg-red-50 text-red-300" :
                    total > 0 ? (total > 8 ? "text-red-600" : "text-blue-900") : "text-gray-400"
                  }`}>
                    {isHol ? "–" : total > 0 ? total : "-"}
                  </td>
                );
              })}
              <td className={`text-center font-bold text-base ${
                totalWeekHrs >= weekCapacity ? "text-green-700" : totalWeekHrs > 0 ? "text-amber-600" : "text-gray-400"
              }`}>
                {totalWeekHrs > 0 ? totalWeekHrs : "-"}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {canEdit && (
            <button onClick={addRow} className="ges-btn-secondary text-sm flex items-center gap-1">
              <span className="text-lg leading-none">+</span> Add Row
            </button>
          )}
          <span className="text-sm text-gray-500">
            Week total: <span className={`font-bold ${totalWeekHrs >= weekCapacity ? "text-green-700" : "text-amber-600"}`}>
              {totalWeekHrs}h
            </span> / {weekCapacity}h
            {weekHolidayCount > 0 && <span className="text-xs text-red-500 ml-1">(−{weekHolidayCount} วันหยุด)</span>}
          </span>
        </div>

        {canEdit && (
          <div className="flex gap-3">
            <button onClick={() => handleSave("save")} disabled={saving} className="ges-btn-secondary">
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button
              onClick={() => handleSave("submit")}
              disabled={saving || isSubmitted}
              className="ges-btn-primary"
            >
              {isSubmitted ? "✓ Submitted" : saving ? "Submitting…" : "Submit Timesheet"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
