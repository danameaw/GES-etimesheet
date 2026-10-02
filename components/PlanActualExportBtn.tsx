"use client";
import { useState } from "react";

type Proj = { id: string; projectNumber: string; projectName: string };

const pad2 = (n: number) => String(n).padStart(2, "0");
const ym = (y: number, m: number) => `${y}-${pad2(m)}`; // m: 1–12
const MONTH_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const fmtYm = (v: string) => { const [y, m] = v.split("-").map(Number); return `${MONTH_TH[m - 1]} ${y}`; };
const monthCount = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm) + 1;
};
const MAX_MONTHS = 36;

/**
 * Export Plan vs Actual (Excel) — เลือกช่วงเดือน (ข้ามปีได้) + เลือกโครงการ
 * Admin เห็นทุกแผนก · GES Management เห็นเฉพาะแผนกที่ดูแล (บังคับที่ API)
 */
export default function PlanActualExportBtn({ defaultYear, label = "📋 Plan vs Actual", scopeNote }: {
  defaultYear: number; label?: string; scopeNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(ym(defaultYear, 1));
  const [to, setTo] = useState(ym(defaultYear, 12));
  const [projects, setProjects] = useState<Proj[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingProj, setLoadingProj] = useState(false);

  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  const qStart = Math.floor((cm - 1) / 3) * 3 + 1;
  const last12 = new Date(cy, cm - 12, 1);
  const presets = [
    { label: `ปี ${defaultYear}`, from: ym(defaultYear, 1), to: ym(defaultYear, 12) },
    { label: `ปี ${defaultYear - 1}`, from: ym(defaultYear - 1, 1), to: ym(defaultYear - 1, 12) },
    { label: "ไตรมาสนี้", from: ym(cy, qStart), to: ym(cy, qStart + 2) },
    { label: "12 เดือนล่าสุด", from: ym(last12.getFullYear(), last12.getMonth() + 1), to: ym(cy, cm) },
  ];

  const count = from && to ? monthCount(from, to) : 0;
  const periodError = !from || !to ? "กรุณาเลือกเดือน"
    : count < 1 ? "เดือนเริ่มต้องไม่หลังเดือนสิ้นสุด"
    : count > MAX_MONTHS ? `เลือกได้ไม่เกิน ${MAX_MONTHS} เดือน`
    : "";

  const openModal = async () => {
    setOpen(true);
    if (projects.length > 0) return;
    setLoadingProj(true);
    const res = await fetch("/api/projects");
    const data = await res.json();
    const list = (data.projects || []) as Proj[];
    setProjects(list);
    setSelected(new Set(list.map((p) => p.id))); // default: all selected
    setLoadingProj(false);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };
  const toggleAll = () => setSelected(selected.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)));

  const doExport = () => {
    // all projects selected → omit the filter (keeps the URL short)
    const ids = selected.size === projects.length ? "" : Array.from(selected).join(",");
    window.location.href = `/api/export?type=plan-actual&fromMonth=${from}&toMonth=${to}${ids ? `&projectIds=${ids}` : ""}`;
    setOpen(false);
  };

  return (
    <>
      <button onClick={openModal} className="ges-btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-[480px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">Export Plan vs Actual</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  หน่วย Man-Month (176 ชม){scopeNote ? ` · ${scopeNote}` : ""}
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* Period */}
            <div className="px-5 py-3 border-b space-y-2">
              <div className="text-xs font-medium text-gray-600">ช่วงเวลา</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => {
                  const active = p.from === from && p.to === to;
                  return (
                    <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                        active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                      }`}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="ges-input w-auto py-1" />
                <span className="text-gray-400">ถึง</span>
                <input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="ges-input w-auto py-1" />
              </div>
              <p className={`text-xs ${periodError ? "text-red-600" : "text-gray-500"}`}>
                {periodError || `${fmtYm(from)} – ${fmtYm(to)} · ${count} เดือน`}
              </p>
            </div>

            {/* Project list */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingProj ? (
                <div className="text-center text-gray-400 py-8">กำลังโหลดโครงการ…</div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{selected.size}/{projects.length} โครงการ</span>
                    <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                      {selected.size === projects.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {projects.map((p) => (
                      <label key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                          className="rounded border-gray-300 text-blue-600 w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-mono text-blue-700 w-16 flex-shrink-0">{p.projectNumber}</span>
                        <span className="text-sm text-gray-700 truncate">{p.projectName}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex items-center justify-end gap-3">
              <button onClick={() => setOpen(false)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button onClick={doExport} disabled={selected.size === 0 || !!periodError}
                className="text-sm px-4 py-2 rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 font-medium">
                ⬇ Export {selected.size > 0 ? `(${selected.size} โครงการ)` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
