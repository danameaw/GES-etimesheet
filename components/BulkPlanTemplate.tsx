"use client";
import { useRef, useState, useTransition } from "react";
import { PROJECT_GROUPS } from "@/lib/project-groups";

type SheetResult = { sheet: string; projectNumber: string | null; status: "saved" | "skipped" | "error"; message: string };

const GROUPS = PROJECT_GROUPS.filter((g) => g.key !== "overhead");
const STATUS_STYLE: Record<SheetResult["status"], string> = {
  saved: "text-green-700", skipped: "text-amber-700", error: "text-red-700",
};
const STATUS_ICON: Record<SheetResult["status"], string> = { saved: "✅", skipped: "⏭", error: "❌" };

/** Admin: ดาวน์โหลด template แผนหลายโครงการ (แยกตามกลุ่มโครงการ) และ import กลับทั้งไฟล์ */
export default function BulkPlanTemplate({ onImported }: { onImported?: () => void }) {
  const [group, setGroup] = useState("all");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string; results?: SheetResult[] } | null>(null);
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    startImport(async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resource-plan-employee-monthly/bulk-import", { method: "POST", body: form });
      const data = await res.json();
      setMsg(res.ok
        ? { type: "success", text: data.message, results: data.results }
        : { type: "error", text: data.error || "นำเข้าไม่สำเร็จ" });
      if (res.ok) onImported?.();
    });
  }

  return (
    <div className="ges-card p-4 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800 text-sm">📦 Template แผนหลายโครงการ (Admin)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            1 sheet ต่อโครงการ · Actual มิ.ย.–ก.ย. 2026 · แผน ต.ค. 2026 ถึงวันจบโครงการ · นำเข้าเป็น draft ให้ PD ตรวจและ Submit
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="ges-input text-xs py-1.5">
            <option value="all">ทุกกลุ่มโครงการ</option>
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.icon} {g.label}</option>)}
          </select>
          <a href={`/api/resource-plan-employee-monthly/bulk-template?group=${group}`}
            className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
            📥 ดาวน์โหลด Template
          </a>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap border-green-300 text-green-700 hover:bg-green-50">
            {importing ? "กำลัง Import…" : "📤 Import ทั้งไฟล์"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mt-3 px-3 py-2 rounded-lg text-xs ${msg.type === "success" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200 text-red-800"}`}>
          <div className="flex justify-between gap-2">
            <span className="font-medium">{msg.text}</span>
            <button onClick={() => setMsg(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          {msg.results && (
            <ul className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
              {msg.results.map((r) => (
                <li key={r.sheet} className={STATUS_STYLE[r.status]}>
                  {STATUS_ICON[r.status]} <span className="font-mono">{r.projectNumber ?? r.sheet}</span> — {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
