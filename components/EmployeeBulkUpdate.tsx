"use client";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";

// Columns recognised in the sheet (header names, case-insensitive). Empty cell = no change, "-" = clear.
const COLS = ["employeeId", "name", "department", "position", "level", "role", "managedDept", "managedUnit", "unit", "startDate", "endDate", "active"] as const;

type Result = {
  preview: boolean; errors: string[]; unitsToCreate: string[];
  changes: { employeeId: string; name: string; fields: string[] }[];
};

// Excel date cell → "yyyy-MM-dd"; other values as trimmed text
function cell(v: unknown): string {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return String(v ?? "").trim();
}

/** อัปเดตพนักงานเดิมจาก Excel (จับคู่ด้วย employeeId) — ตรวจก่อนแล้วค่อยยืนยัน */
export default function EmployeeBulkUpdate({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(data: Record<string, string>[], apply: boolean) {
    setBusy(true);
    const res = await fetch("/api/employees/bulk-update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: data, apply }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { alert(json.error || "อัปเดตไม่สำเร็จ"); return; }
    setResult(json);
    if (apply) onDone();
  }

  function parse(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: "array" });
      const sheetName = wb.SheetNames.find((n) => /update|อัปเดต/i.test(n)) ?? wb.SheetNames[0];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
      const data = raw.map((r) => {
        const out: Record<string, string> = {};
        for (const c of COLS) {
          const h = Object.keys(r).find((k) => k.trim().toLowerCase() === c.toLowerCase());
          if (h) out[c] = cell(r[h]);
        }
        return out;
      }).filter((r) => r.employeeId);
      if (data.length === 0) { alert("ไม่พบคอลัมน์ employeeId"); return; }
      setRows(data);
      send(data, false);
    };
    reader.readAsArrayBuffer(file);
  }

  function template() {
    const ws = XLSX.utils.aoa_to_sheet([
      [...COLS],
      ["1234", "", "Engineering", "Civil Engineer", "Senior Engineer I", "", "", "", "Engineering > Civil", "", "", ""],
      ["5678", "", "", "", "", "", "", "", "", "", "2026-03-31", "N"],
    ]);
    ws["!cols"] = COLS.map(() => ({ wch: 16 }));
    const inst = XLSX.utils.aoa_to_sheet([
      ["คอลัมน์", "ความหมาย"],
      ["employeeId", "รหัสพนักงาน (ต้องมีในระบบ)"],
      ["(ช่องว่าง)", "ไม่เปลี่ยนค่าเดิม"],
      ["-", "ล้างค่า (level, managedDept, managedUnit, unit, startDate, endDate)"],
      ["role", "employee | pd | ges_management | ges_pd | admin | md"],
      ["unit / managedUnit", "path เช่น Engineering > BIM/CAD (ถ้ายังไม่มีหน่วย ระบบสร้างให้)"],
      ["startDate / endDate", "yyyy-MM-dd · endDate = วันสุดท้ายที่ทำงาน"],
      ["active", "Y = เปิดบัญชี · N = ปิดบัญชี"],
    ]);
    inst["!cols"] = [{ wch: 20 }, { wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Update");
    XLSX.utils.book_append_sheet(wb, inst, "Instructions");
    XLSX.writeFile(wb, "employee_update_template.xlsx");
  }

  const close = () => { setOpen(false); setRows(null); setResult(null); };

  return (
    <>
      <button onClick={() => setOpen(true)} className="ges-btn-secondary flex items-center gap-2">
        <span>📝</span> อัปเดตจาก Excel
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={close}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">อัปเดตพนักงานเดิมจาก Excel</h2>
                <p className="text-xs text-gray-500">จับคู่ด้วย employeeId · ช่องว่าง = ไม่เปลี่ยน · &quot;-&quot; = ล้างค่า</p>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-sm">
              {!result && (
                <div className="flex items-center gap-3">
                  <button onClick={() => fileRef.current?.click()} disabled={busy} className="ges-btn-primary text-sm">
                    {busy ? "กำลังตรวจ…" : "เลือกไฟล์ Excel"}
                  </button>
                  <button onClick={template} className="text-blue-600 hover:underline text-xs">ดาวน์โหลด Template</button>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); e.target.value = ""; }} />
                </div>
              )}
              {result && (
                <>
                  <p className={result.preview ? "text-gray-700" : "text-green-700 font-medium"}>
                    {result.preview ? "ตรวจแล้ว — " : "✓ อัปเดตเสร็จ — "}
                    เปลี่ยน <b>{result.changes.length}</b> คน
                    {result.unitsToCreate.length > 0 && <> · สร้างหน่วยใหม่ <b>{result.unitsToCreate.length}</b></>}
                    {result.errors.length > 0 && <> · <span className="text-red-600">ข้าม {result.errors.length} แถว</span></>}
                  </p>
                  {result.errors.length > 0 && (
                    <ul className="text-xs text-red-600 list-disc ml-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                  )}
                  {result.unitsToCreate.length > 0 && (
                    <ul className="text-xs text-indigo-600 list-disc ml-5">{result.unitsToCreate.map((u) => <li key={u}>หน่วยใหม่: {u}</li>)}</ul>
                  )}
                  <table className="ges-table w-full text-xs">
                    <thead><tr><th className="w-24">รหัส</th><th className="w-40">ชื่อ</th><th>การเปลี่ยนแปลง</th></tr></thead>
                    <tbody>
                      {result.changes.map((c) => (
                        <tr key={c.employeeId}>
                          <td className="font-mono">{c.employeeId}</td>
                          <td>{c.name}</td>
                          <td>{c.fields.map((f) => <div key={f}>{f}</div>)}</td>
                        </tr>
                      ))}
                      {result.changes.length === 0 && <tr><td colSpan={3} className="text-center text-gray-400 py-4">ไม่มีอะไรเปลี่ยน</td></tr>}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={close} className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">ปิด</button>
              {result?.preview && rows && result.changes.length > 0 && (
                <button onClick={() => send(rows, true)} disabled={busy}
                  className="text-sm px-4 py-2 rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 font-medium">
                  {busy ? "กำลังอัปเดต…" : `✓ ยืนยันอัปเดต ${result.changes.length} คน`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
