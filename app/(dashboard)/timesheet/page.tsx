"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { format, addWeeks, subWeeks, startOfWeek } from "date-fns";
import { OH_CATEGORIES, isOverheadProject } from "@/lib/task-constants";

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
function newRowId() {
  return `row-${++rowCounter}`;
}
function newRow(): TimesheetRow {
  return {
    id: newRowId(),
    projectId: "",
    taskCodeId: "",
    monHrs: 0, tueHrs: 0, wedHrs: 0, thuHrs: 0, friHrs: 0, satHrs: 0, sunHrs: 0,
  };
}

// ── ร่างอัตโนมัติในเครื่อง (กันข้อมูลหายตอนยังไม่ได้กด Save) ──
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // เก็บร่างในเครื่อง 30 วัน

// แถวที่ "มีข้อมูล" เท่านั้น — แถวว่างเปล่าไม่นับว่ามีการแก้ไข
function meaningfulRows(rows: TimesheetRow[]) {
  return rows.filter(
    (r) => r.projectId || r.taskCodeId || DAYS.some((d) => Number(r[d.key]) > 0)
  );
}

// ลายเซ็นข้อมูลในตาราง (ไม่รวม id) ไว้เทียบว่ามีการแก้ไขที่ยังไม่ได้บันทึกหรือไม่
function rowsSignature(rows: TimesheetRow[]): string {
  return JSON.stringify(meaningfulRows(rows).map(({ id: _id, ...rest }) => rest));
}

function readDraft(key: string): TimesheetRow[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - (parsed.savedAt || 0) > DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    // ออก id ใหม่เสมอ กัน id ชนกับแถวที่สร้างหลังรีเฟรชหน้า
    return (parsed.rows as TimesheetRow[]).map((r) => ({ ...r, id: newRowId() }));
  } catch {
    return null;
  }
}

export default function TimesheetPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [projects, setProjects]       = useState<Project[]>([]);
  const [taskCodes, setTaskCodes]     = useState<TaskCode[]>([]);
  const [holidays, setHolidays]       = useState<Holiday[]>([]);
  const [rows, setRows]               = useState<TimesheetRow[]>([newRow()]);
  const [timesheetStatus, setTimesheetStatus] = useState<string>("missing");
  const [saving, setSaving]           = useState(false);
  const [message, setMessage]         = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);

  // ── สถานะร่างอัตโนมัติ ──
  const [savedSig, setSavedSig]   = useState("");        // ลายเซ็นข้อมูลชุดล่าสุดที่อยู่บนระบบแล้ว
  const [loadedKey, setLoadedKey] = useState<string | null>(null); // ร่างที่ rows ปัจจุบันสังกัดอยู่
  const [restored, setRestored]   = useState(false);     // เพิ่งกู้ร่างที่ยังไม่ได้บันทึกกลับมา
  const loadSeq                   = useRef(0);

  // Favorites state
  interface Favorite {
    id: string;
    project: { id: string; projectNumber: string; projectName: string };
    taskCode: { id: string; code: string; name: string; category: string };
  }
  const [favorites, setFavorites]       = useState<Favorite[]>([]);
  const [favLoading, setFavLoading]     = useState(false);
  const [favAddProjectId, setFavAddProjectId] = useState("");
  const [favAddTaskId, setFavAddTaskId]       = useState("");
  const [favAdding, setFavAdding]             = useState(false);

  const weekEnd = new Date(currentWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekKey     = format(currentWeek, "yyyy-MM-dd");
  const employeeKey = (session?.user as any)?.id || null;
  // key ของร่างในเครื่อง — แยกตามคน + สัปดาห์ (null = ยังไม่รู้ว่าใคร → ยังไม่เก็บร่าง)
  const draftKey    = employeeKey ? `ges-ts-draft:${employeeKey}:${weekKey}` : null;

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

  // Weekday holidays (Mon–Fri) — for notice display
  const weekdayHolidays = weekDates
    .map((d, i) => ({ date: d, index: i, name: holidayName(i) }))
    .filter(({ date, index }) => {
      const dow = date.getDay();
      return dow >= 1 && dow <= 5 && isHoliday(index);
    });

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
    // รอ session ให้พร้อมก่อน ไม่งั้นจะโหลดสองรอบแล้วทับข้อมูลที่กำลังพิมพ์
    if (sessionStatus !== "authenticated") return;
    const seq = ++loadSeq.current;
    setLoadedKey(null);  // กันไม่ให้เขียนร่างข้ามสัปดาห์ระหว่างรอโหลด
    setRestored(false);
    setMessage(null);    // Clear any stale messages when loading a new week

    let data: any;
    try {
      const res = await fetch(`/api/timesheets?week=${weekKey}`);
      data = await res.json();
    } catch {
      if (seq === loadSeq.current) {
        setMessage({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ — กรุณารีเฟรชหน้าก่อนกรอกข้อมูล" });
      }
      return;
    }
    if (seq !== loadSeq.current) return; // เปลี่ยนสัปดาห์ระหว่างรอ → ทิ้งผลลัพธ์เก่า

    setHolidays(data.holidays || []);

    // ── ข้อมูลชุดที่อยู่บนระบบ ──
    let serverRows: TimesheetRow[] = [];
    let status = "missing";
    if (data.timesheet) {
      const entries: any[] = data.timesheet.entries || [];
      const hasHours = entries.some((e) =>
        (e.monHrs + e.tueHrs + e.wedHrs + e.thuHrs + e.friHrs + e.satHrs + e.sunHrs) > 0
      );
      status = hasHours ? data.timesheet.status : "missing";
      // เก็บทุกแถวที่บันทึกไว้ แม้ชั่วโมงยังเป็น 0 (เดิมโดนทิ้ง → Project/Task ที่เลือกไว้หาย)
      serverRows = entries.map((e) => ({
        id: e.id,
        projectId: e.projectId,
        taskCodeId: e.taskCodeId,
        monHrs: e.monHrs, tueHrs: e.tueHrs, wedHrs: e.wedHrs,
        thuHrs: e.thuHrs, friHrs: e.friHrs, satHrs: e.satHrs, sunHrs: e.sunHrs,
      }));
    }
    const baseRows = serverRows.length > 0 ? serverRows : [newRow()];
    const baseSig  = rowsSignature(baseRows);

    // ── กู้ร่างที่พิมพ์ค้างไว้แต่ยังไม่ได้กด Save ──
    let finalRows  = baseRows;
    let didRestore = false;
    if (draftKey && status !== "submitted" && status !== "approved") {
      const draft = readDraft(draftKey);
      if (draft && rowsSignature(draft) !== baseSig) {
        finalRows  = draft;
        didRestore = true;
      }
    }

    setTimesheetStatus(status);
    setRows(finalRows);
    setSavedSig(baseSig);
    setRestored(didRestore);
    setLoadedKey(draftKey);
  }, [weekKey, draftKey, sessionStatus]);

  useEffect(() => { loadTimesheet(); }, [loadTimesheet]);

  const currentSig = rowsSignature(rows);
  const isDirty    = loadedKey !== null && currentSig !== savedSig;

  // เก็บร่างลงเครื่องทุกครั้งที่พิมพ์ — เฉพาะเมื่อ rows สังกัดสัปดาห์ที่โหลดเสร็จแล้วเท่านั้น
  useEffect(() => {
    if (!draftKey || draftKey !== loadedKey) return;
    try {
      if (currentSig === savedSig) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), rows }));
    } catch {
      // localStorage เต็ม/ถูกปิด — ข้ามไป ไม่ให้กระทบการกรอกข้อมูล
    }
  }, [rows, currentSig, savedSig, draftKey, loadedKey]);

  // เตือนก่อนปิด/รีเฟรชหน้าเมื่อยังไม่ได้บันทึก
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function goToWeek(next: Date) {
    if (isDirty && !window.confirm(
      "สัปดาห์นี้มีข้อมูลที่ยังไม่ได้กด Save Draft\n" +
      "ระบบจะเก็บร่างไว้ในเครื่องให้ และจะแสดงกลับมาเมื่อเปิดสัปดาห์นี้อีกครั้ง\n\n" +
      "ต้องการเปลี่ยนสัปดาห์เลยหรือไม่?"
    )) return;
    setCurrentWeek(next);
  }

  function discardDraft() {
    if (!window.confirm("ทิ้งข้อมูลที่กู้คืนมา แล้วใช้ข้อมูลล่าสุดที่บันทึกไว้ในระบบแทน?")) return;
    if (draftKey) { try { localStorage.removeItem(draftKey); } catch {} }
    loadTimesheet();
  }

  // Load favorites once on mount
  useEffect(() => {
    setFavLoading(true);
    fetch("/api/timesheet-favorites")
      .then((r) => r.json())
      .then((d) => setFavorites(d.favorites || []))
      .finally(() => setFavLoading(false));
  }, []);

  function addFavoriteRow(fav: Favorite) {
    const task = taskCodes.find((t) => t.id === fav.taskCode.id);
    const projectId = (task && OH_CATEGORIES.has(task.category) && ohProject)
      ? ohProject.id
      : fav.project.id;
    setRows((prev) => [...prev, { ...newRow(), projectId, taskCodeId: fav.taskCode.id }]);
  }

  async function saveFavorite() {
    if (!favAddProjectId || !favAddTaskId) return;
    setFavAdding(true);
    const res = await fetch("/api/timesheet-favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: favAddProjectId, taskCodeId: favAddTaskId }),
    });
    if (res.ok) {
      const d = await res.json();
      setFavorites((prev) => [...prev, d.favorite]);
      setFavAddProjectId("");
      setFavAddTaskId("");
    }
    setFavAdding(false);
  }

  async function deleteFavorite(id: string) {
    await fetch(`/api/timesheet-favorites?id=${id}`, { method: "DELETE" });
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }

  // Sum all logged hours per day (holidays are now informational only — hours still count)
  const totalByDay = DAYS.map((d) =>
    rows.reduce((sum, r) => sum + (Number(r[d.key]) || 0), 0)
  );
  const totalWeekHrs = totalByDay.reduce((a, b) => a + b, 0);

  // Project Overhead / Non-Project (projectType = "overhead"/"support" หรือขึ้นต้นด้วย "GES-OH")
  const ohProject = projects.find(isOverheadProject);

  function updateRow(id: string, field: keyof TimesheetRow, value: string | number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: field.endsWith("Hrs") ? Number(value) || 0 : value };
        // ถ้าเปลี่ยน taskCode → เช็คว่าเป็น OH task ไหม
        if (field === "taskCodeId") {
          const task = taskCodes.find((t) => t.id === value);
          if (task && OH_CATEGORIES.has(task.category) && ohProject) {
            updated.projectId = ohProject.id;
          }
        }
        // ถ้าเปลี่ยนไป Project ที่ไม่ใช่ OH แต่ task เดิมเป็น OH → ล้าง task ทิ้ง (กันข้อมูลเก่า/ค้าง)
        if (field === "projectId") {
          const task = taskCodes.find((t) => t.id === updated.taskCodeId);
          const newProject = projects.find((p) => p.id === value);
          if (task && OH_CATEGORIES.has(task.category) && !isOverheadProject(newProject)) {
            updated.taskCodeId = "";
          }
        }
        return updated;
      })
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
    // OH task ต้องอยู่ใต้ Project Overhead เท่านั้น
    const ohMismatch = validRows.filter((r) => {
      const task = taskCodes.find((t) => t.id === r.taskCodeId);
      return task && OH_CATEGORIES.has(task.category)
        && !isOverheadProject(projects.find((p) => p.id === r.projectId));
    });
    if (ohMismatch.length > 0) {
      const codes = ohMismatch
        .map((r) => taskCodes.find((t) => t.id === r.taskCodeId)?.code)
        .filter(Boolean)
        .join(", ");
      setMessage({
        type: "error",
        text: `Task OH (${codes}) ต้องลงใต้ Project ${ohProject ? `${ohProject.projectNumber} ${ohProject.projectName}` : "Overhead / Non-Project"} เท่านั้น กรุณาแก้ไขก่อนบันทึก`,
      });
      return;
    }
    if (action === "submit" && totalWeekHrs === 0) {
      setMessage({ type: "error", text: "ไม่สามารถ Submit ได้ กรุณากรอกชั่วโมงก่อน" });
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
        // ข้อมูลขึ้นระบบแล้ว → ล้างร่างในเครื่อง
        setSavedSig(rowsSignature(rows));
        setRestored(false);
        if (draftKey) { try { localStorage.removeItem(draftKey); } catch {} }

        const skipped = meaningfulRows(rows).length - validRows.length;
        setMessage(
          skipped > 0
            ? {
                type: "warn",
                text: `${action === "submit" ? "Submit" : "บันทึกร่าง"}สำเร็จ — แต่มี ${skipped} แถวที่ยังไม่ได้ถูกบันทึก เพราะยังไม่ได้เลือก Project หรือ Task Code ครบ`,
              }
            : {
                type: "success",
                text: action === "submit" ? "Timesheet submitted successfully!" : "Draft saved.",
              }
        );
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
    <>
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Timesheet</h1>
          <p className="text-gray-500 text-sm mt-0.5">{(session?.user as any)?.employeeId} · {session?.user?.name}</p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => goToWeek(subWeeks(currentWeek, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">← Prev</button>
          <div className="text-center min-w-[200px]">
            <p className="font-semibold text-gray-800 text-sm">{weekLabel}</p>
            <p className="text-xs text-gray-400">Week {format(currentWeek, "w, yyyy")}</p>
          </div>
          <button onClick={() => goToWeek(addWeeks(currentWeek, 1))} className="ges-btn-secondary px-3 py-1.5 text-sm">Next →</button>
          <button onClick={() => goToWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="text-xs text-blue-600 hover:underline ml-1">Today</button>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium px-3 py-1 rounded-full ${
            isApproved ? "bg-blue-100 text-blue-800" :
            isSubmitted ? "bg-green-100 text-green-800" :
            timesheetStatus === "draft" ? "bg-yellow-100 text-yellow-800" :
            "bg-gray-100 text-gray-500"
          }`}>
            {isApproved ? "✓ Approved" : isSubmitted ? "✓ Submitted" : timesheetStatus === "draft" ? "Draft" : "ยังไม่กรอก"}
          </span>
        </div>
      </div>

      {/* ── Holiday Notice ── */}
      {holidays.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-100 border-b border-red-200">
            <span className="text-lg">🏖️</span>
            <span className="font-semibold text-red-800 text-sm">
              วันหยุดในสัปดาห์นี้ ({holidays.length} วัน)
            </span>
          </div>
          <div className="flex flex-wrap gap-3 p-4">
            {holidays.map((h) => {
              const d         = new Date(h.date.slice(0, 10) + "T00:00:00");
              const dow       = d.getDay();
              const DAY_TH    = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
              const isWeekend = dow === 0 || dow === 6;
              return (
                <div key={h.id}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm font-medium shadow-sm ${
                    isWeekend ? "bg-white border-gray-200 text-gray-600" : "bg-red-600 border-red-700 text-white"
                  }`}>
                  <div className="text-center leading-tight">
                    <div className={`text-xs font-normal ${isWeekend ? "text-gray-400" : "text-red-200"}`}>{DAY_TH[dow]}</div>
                    <div className="text-xl font-bold leading-none">{format(d, "d")}</div>
                    <div className={`text-xs ${isWeekend ? "text-gray-400" : "text-red-200"}`}>{format(d, "MMM")}</div>
                  </div>
                  <div>
                    <div>{h.name}</div>
                    {isWeekend && <div className="text-xs font-normal text-gray-400 mt-0.5">วันหยุดสุดสัปดาห์</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Leave / Holiday Code Reference — แสดงทุกสัปดาห์ ── */}
      <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-xs font-semibold text-blue-800 mb-2">
          📋 กรณีลา / วันหยุด ให้ลง Code ต่อไปนี้ (Project:{" "}
          {ohProject ? `${ohProject.projectNumber} ${ohProject.projectName}` : "Overhead / Non-Project"})
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {[
            { code: "1001", name: "Holidays" },
            { code: "1002", name: "Annual Leave" },
            { code: "1003", name: "Personal Leave" },
            { code: "1004", name: "Sick Leave" },
            { code: "1005", name: "Others" },
          ].map(({ code, name }) => (
            <span key={code} className="text-xs text-blue-700">
              <span className="font-mono font-semibold">{code}</span>
              <span className="text-blue-500 mx-1">–</span>
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* ── กู้ร่างที่ยังไม่ได้บันทึก ── */}
      {restored && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-900 border border-amber-300 flex items-start gap-2">
          <span>💾</span>
          <div className="flex-1">
            <p className="font-semibold">กู้คืนข้อมูลที่ยังไม่ได้บันทึกของสัปดาห์นี้ให้แล้ว</p>
            <p className="text-xs text-amber-700 mt-0.5">
              ข้อมูลนี้ยังอยู่แค่ในเครื่องของคุณ — กรุณากด <span className="font-semibold">Save Draft</span> หรือ{" "}
              <span className="font-semibold">Submit Timesheet</span> เพื่อบันทึกขึ้นระบบ
            </p>
          </div>
          <button onClick={discardDraft} className="text-xs text-amber-700 underline whitespace-nowrap hover:text-amber-900">
            ใช้ข้อมูลในระบบแทน
          </button>
        </div>
      )}

      {/* ── ยังไม่ได้บันทึกขึ้นระบบ ── */}
      {!restored && isDirty && canEdit && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-sm bg-orange-50 text-orange-800 border border-orange-200 flex items-center gap-2">
          <span className="text-orange-500">●</span>
          <span>มีการแก้ไขที่ยังไม่ได้บันทึกขึ้นระบบ — อย่าลืมกด Save Draft</span>
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
          <span>ชั่วโมงรวม ({totalWeekHrs}h) ยังไม่ครบ 40h กรุณากรอกข้อมูลให้ครบ</span>
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
                  <th key={d.key} className={isHol ? "bg-red-800" : (isSat || isSun) ? "bg-blue-700" : ""}>
                    <div className="flex items-center justify-center gap-1">
                      {d.short}
                      {(isSat || isSun) && !isHol && <span className="text-blue-300 text-xs font-normal">(OT)</span>}
                    </div>
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
              const selectedTask = taskCodes.find((t) => t.id === row.taskCodeId);
              const rowIsOH = selectedTask ? OH_CATEGORIES.has(selectedTask.category) : false;
              // OH task codes จะโชว์เฉพาะเมื่อเลือก Project เป็น Overhead (GES-OH) เท่านั้น
              // (rowIsOH ไว้กันกรณีข้อมูลเก่าที่ task OH ผูกกับ project อื่น — จะได้ไม่หายไปจาก dropdown)
              const rowProjectIsOH = !!ohProject && row.projectId === ohProject.id;
              const showOHTasks    = rowProjectIsOH || rowIsOH;
              // Task codes split into project vs OH groups
              const projectTaskCodes = taskCodes.filter((t) => !OH_CATEGORIES.has(t.category));
              const ohTaskCodes      = taskCodes.filter((t) =>  OH_CATEGORIES.has(t.category));
              const projectCategories = Array.from(new Set(projectTaskCodes.map((t) => t.category))).sort();
              const ohCategories      = Array.from(new Set(ohTaskCodes.map((t) => t.category))).sort();
              return (
                <tr key={row.id}>
                  {/* Project selector — lock to GES-OH if OH task */}
                  <td>
                    <select
                      value={row.projectId}
                      onChange={(e) => updateRow(row.id, "projectId", e.target.value)}
                      disabled={!canEdit || (rowIsOH && rowProjectIsOH)}
                      className={`w-full text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50 ${rowIsOH ? "border-orange-200 text-orange-700" : "border-gray-200"}`}
                    >
                      <option value="">-- Select Project --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.projectNumber} - {p.projectName.length > 30 ? p.projectName.slice(0, 28) + "…" : p.projectName}
                        </option>
                      ))}
                    </select>
                    {rowIsOH && (rowProjectIsOH
                      ? <p className="text-xs text-orange-500 mt-0.5">🏢 OH Task</p>
                      : <p className="text-xs text-red-600 mt-0.5">
                          ⚠️ OH Task ต้องลง Project {ohProject ? ohProject.projectNumber : "Overhead"}
                        </p>
                    )}
                  </td>

                  {/* Task code selector — grouped: Project Tasks / OH Tasks */}
                  <td>
                    <select
                      value={row.taskCodeId}
                      onChange={(e) => updateRow(row.id, "taskCodeId", e.target.value)}
                      disabled={!canEdit}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50"
                    >
                      <option value="">-- Task --</option>
                      {projectCategories.length > 0 && (
                        projectCategories.map((cat) => (
                          <optgroup key={cat} label={`📋 ${cat}`}>
                            {projectTaskCodes.filter((t) => t.category === cat).map((t) => (
                              <option key={t.id} value={t.id}>{t.code} - {t.name}</option>
                            ))}
                          </optgroup>
                        ))
                      )}
                      {showOHTasks && ohCategories.length > 0 && (
                        ohCategories.map((cat) => (
                          <optgroup key={cat} label={`🏢 ${cat}`}>
                            {ohTaskCodes.filter((t) => t.category === cat).map((t) => (
                              <option key={t.id} value={t.id}>{t.code} - {t.name}</option>
                            ))}
                          </optgroup>
                        ))
                      )}
                    </select>
                    {!showOHTasks && ohProject && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        OH Task: เลือก Project {ohProject.projectNumber} ก่อน
                      </p>
                    )}
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
                totalWeekHrs >= 40 ? "text-green-700" : totalWeekHrs > 0 ? "text-amber-600" : "text-gray-400"
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
            Week total: <span className={`font-bold ${totalWeekHrs >= 40 ? "text-green-700" : "text-amber-600"}`}>
              {totalWeekHrs}h
            </span> / 40h
            {weekdayHolidays.length > 0 && (
              <span className="text-xs text-red-500 ml-1">
                ({weekdayHolidays.length} วันหยุด)
              </span>
            )}
          </span>
        </div>

        {canEdit && (
          <div className="flex gap-3 items-center">
            {isDirty && (
              <span className="text-xs text-orange-600 font-medium whitespace-nowrap">● ยังไม่ได้บันทึก</span>
            )}
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

    {/* ── Favorites Section ── */}
    <div className="ges-card mt-4">
      <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
        <p className="text-xs font-semibold text-amber-800">★ Favorites — Quick Add รายการที่ใช้บ่อย</p>
        <p className="text-xs text-amber-600 mt-0.5">กด <span className="font-semibold">+ Add</span> เพื่อเพิ่มแถวในตาราง Timesheet ของสัปดาห์นี้</p>
      </div>

      {/* Saved favorites list */}
      {favLoading ? (
        <p className="text-sm text-gray-400">กำลังโหลด…</p>
      ) : favorites.length === 0 ? (
        <p className="text-sm text-gray-400 mb-3">ยังไม่มี Favorites — เพิ่มด้านล่างได้เลย</p>
      ) : (
        <div className="flex flex-col gap-1.5 mb-4">
          {favorites.map((fav) => (
            <div key={fav.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded px-3 py-2">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-blue-700">{fav.project.projectNumber}</span>
                <span className="text-xs text-gray-500 mx-1">—</span>
                <span className="text-xs text-gray-700 truncate">{fav.project.projectName.length > 35 ? fav.project.projectName.slice(0, 33) + "…" : fav.project.projectName}</span>
                <span className="text-xs text-gray-400 ml-2">/ {fav.taskCode.code} {fav.taskCode.name}</span>
              </div>
              {canEdit && (
                <button
                  onClick={() => addFavoriteRow(fav)}
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
                >
                  + Add
                </button>
              )}
              <button
                onClick={() => deleteFavorite(fav.id)}
                className="text-red-400 hover:text-red-600 text-base leading-none ml-1"
                title="ลบออกจาก Favorites"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new favorite form */}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-600 mb-2">เพิ่ม Favorite ใหม่</p>
        <div className="flex flex-wrap gap-2 items-end">
          <select
            value={favAddProjectId}
            onChange={(e) => {
              const pid = e.target.value;
              setFavAddProjectId(pid);
              // ถ้าเปลี่ยนไป Project ที่ไม่ใช่ OH แต่ task ที่เลือกไว้เป็น OH → ล้าง task
              const task = taskCodes.find((t) => t.id === favAddTaskId);
              const isOHProject = !!ohProject && pid === ohProject.id;
              if (task && OH_CATEGORIES.has(task.category) && !isOHProject) setFavAddTaskId("");
            }}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white flex-1 min-w-[180px]"
          >
            <option value="">-- เลือก Project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectNumber} - {p.projectName.length > 35 ? p.projectName.slice(0, 33) + "…" : p.projectName}
              </option>
            ))}
          </select>
          <select
            value={favAddTaskId}
            onChange={(e) => setFavAddTaskId(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white flex-1 min-w-[160px]"
          >
            <option value="">-- เลือก Task --</option>
            {(() => {
              // OH task codes โชว์เฉพาะเมื่อเลือก Project เป็น Overhead (GES-OH)
              const favProjectIsOH = !!ohProject && favAddProjectId === ohProject.id;
              const selectable = favProjectIsOH
                ? taskCodes
                : taskCodes.filter((t) => !OH_CATEGORIES.has(t.category));
              return Array.from(new Set(selectable.map((t) => t.category))).sort().map((cat) => (
                <optgroup key={cat} label={cat}>
                  {selectable.filter((t) => t.category === cat).map((t) => (
                    <option key={t.id} value={t.id}>{t.code} – {t.name}</option>
                  ))}
                </optgroup>
              ));
            })()}
          </select>
          <button
            onClick={saveFavorite}
            disabled={!favAddProjectId || !favAddTaskId || favAdding}
            className="ges-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
          >
            {favAdding ? "กำลังบันทึก…" : "บันทึก Favorite"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
