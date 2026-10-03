"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

interface Unit {
  id: string; name: string; department: string; parentId: string | null; sortOrder: number;
  path: string; depth: number; memberCount: number;
  head: { id: string; employeeId: string; name: string } | null;
}
interface Emp { id: string; employeeId: string; name: string; department: string; orgUnitId: string | null; }
interface ImportPayload { units: { path: string; headEmployeeId?: string }[]; members: { employeeId: string; path: string }[]; }
interface ImportResult { preview: boolean; unitsToCreate: string[]; heads: string[]; membersToAssign: number; errors: string[]; }

// Excel header lookup: first column whose header contains one of the keys (case-insensitive)
function pick(row: Record<string, unknown>, ...keys: string[]): string {
  const col = Object.keys(row).find((h) => keys.some((k) => h.toLowerCase().includes(k.toLowerCase())));
  return col ? String(row[col] ?? "").trim() : "";
}

export default function OrgUnitsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = (session?.user as any)?.role === "admin";
  useEffect(() => { if (session && !isAdmin) router.push("/timesheet"); }, [session, isAdmin, router]);

  const [units, setUnits] = useState<Unit[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [importData, setImportData] = useState<ImportPayload | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, e] = await Promise.all([fetch("/api/org-units"), fetch("/api/employees")]);
    if (u.ok) setUnits((await u.json()).units || []);
    if (e.ok) setEmps((await e.json()).employees || []);
    setLoading(false);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [load, isAdmin]);

  async function call(method: string, body?: object, qs = "") {
    setBusy(true);
    const res = await fetch(`/api/org-units${qs}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || "ทำรายการไม่สำเร็จ");
    setBusy(false);
    load();
  }

  const addUnit = (department: string, parentId: string | null) => {
    const name = prompt(parentId ? "ชื่อหน่วยย่อย" : `ชื่อหน่วยใหม่ในแผนก ${department}`);
    if (name?.trim()) call("POST", { name, department, parentId });
  };
  const renameUnit = (u: Unit) => {
    const name = prompt("ชื่อหน่วย", u.name);
    if (name?.trim() && name !== u.name) call("PUT", { id: u.id, name });
  };
  const deleteUnit = (u: Unit) => {
    if (confirm(`ลบหน่วย "${u.path}"?\nสมาชิก ${u.memberCount} คนจะกลับไปขึ้นตรงกับแผนก`)) call("DELETE", undefined, `?id=${u.id}`);
  };

  // ── Excel import: sheet "Units" (path, headEmployeeId / หัวหน้า) + sheet "Members" (employeeId, path) ──
  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: "array" });
      const sheet = (name: string) => {
        const key = wb.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
        return key ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[key], { defval: "" }) : [];
      };
      const memberRows = sheet("Members");
      const members = memberRows
        .map((r) => ({ employeeId: pick(r, "employeeId"), path: pick(r, "path", "หน่วย"), name: pick(r, "ชื่อ", "name") }))
        .filter((m) => m.path);
      const idByName = new Map(members.filter((m) => m.employeeId).map((m) => [m.name.toLowerCase(), m.employeeId]));
      const unitRows = sheet("Units")
        .map((r) => {
          const headName = pick(r, "หัวหน้าหน่วย", "head name");
          return { path: pick(r, "path", "หน่วย ("), headEmployeeId: pick(r, "headEmployeeId") || idByName.get(headName.toLowerCase()) || "" };
        })
        .filter((u) => u.path);
      if (unitRows.length === 0 && members.length === 0) { alert('ไม่พบ sheet "Units" หรือ "Members"'); return; }
      const payload = { units: unitRows, members: members.map(({ employeeId, path }) => ({ employeeId, path })) };
      setImportData(payload);
      await runImport(payload, false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function runImport(payload: ImportPayload, apply: boolean) {
    setBusy(true);
    const res = await fetch("/api/org-units/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, apply }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { alert(data.error || "Import ไม่สำเร็จ"); return; }
    setImportResult(data);
    if (apply) load();
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const u = XLSX.utils.aoa_to_sheet([
      ["path", "headEmployeeId"],
      ["Procurement > Procurement", "1001"],
      ["Procurement > Procurement > Logistic Team", "1002"],
    ]);
    u["!cols"] = [{ wch: 60 }, { wch: 16 }];
    const m = XLSX.utils.aoa_to_sheet([
      ["employeeId", "path"],
      ["1002", "Procurement > Procurement > Logistic Team"],
      ["1003", "Procurement"],
    ]);
    m["!cols"] = [{ wch: 14 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, u, "Units");
    XLSX.utils.book_append_sheet(wb, m, "Members");
    XLSX.writeFile(wb, "org_units_template.xlsx");
  }

  if (!isAdmin) return null;

  const departments = Array.from(new Set([...units.map((u) => u.department), ...emps.map((e) => e.department)])).sort();
  const shownDepts = deptFilter ? [deptFilter] : departments.filter((d) => units.some((u) => u.department === d));
  const directCount = (dept: string) => emps.filter((e) => e.department === dept && !e.orgUnitId).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">หน่วยงาน (Org Units)</h1>
          <p className="text-gray-500 text-sm">หน่วยย่อยในแต่ละแผนก · หัวหน้าหน่วยอนุมัติ Resource Plan ของคนในหน่วย และเห็นหน่วยย่อยข้างใต้ทั้งหมด</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="ges-input w-auto text-sm">
            <option value="">แผนกที่มีหน่วยย่อย</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={downloadTemplate} className="ges-btn-secondary text-sm">📄 Template</button>
          <button onClick={() => fileRef.current?.click()} className="ges-btn-primary text-sm">📥 Import Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ""; }} />
        </div>
      </div>

      {importResult && (
        <div className="ges-card p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">{importResult.preview ? "ตรวจก่อน Import" : "✓ Import เสร็จแล้ว"}</h2>
            <button onClick={() => { setImportResult(null); setImportData(null); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
          <p>สร้างหน่วยใหม่ <b>{importResult.unitsToCreate.length}</b> · ตั้งหัวหน้า <b>{importResult.heads.length}</b> · จัดคนเข้าหน่วย <b>{importResult.membersToAssign}</b> คน
            {importResult.errors.length > 0 && <> · <span className="text-red-600">ข้าม {importResult.errors.length} รายการ</span></>}
          </p>
          {importResult.unitsToCreate.length > 0 && (
            <details><summary className="cursor-pointer text-gray-600">หน่วยที่จะสร้าง</summary>
              <ul className="text-xs text-gray-600 mt-1 ml-4 list-disc">{importResult.unitsToCreate.map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          {importResult.heads.length > 0 && (
            <details><summary className="cursor-pointer text-gray-600">หัวหน้าหน่วย</summary>
              <ul className="text-xs text-gray-600 mt-1 ml-4 list-disc">{importResult.heads.map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          {importResult.errors.length > 0 && (
            <details open><summary className="cursor-pointer text-red-600">รายการที่ข้าม</summary>
              <ul className="text-xs text-red-600 mt-1 ml-4 list-disc">{importResult.errors.map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          <p className="text-xs text-gray-400">แถวใน Members ที่ยังไม่กรอก employeeId จะไม่ถูกนำเข้า · Import ซ้ำได้ ไม่ลบหน่วยเดิม</p>
          {importResult.preview && importData && (
            <button onClick={() => runImport(importData, true)} disabled={busy} className="ges-btn-primary text-sm">
              {busy ? "กำลัง Import…" : "✓ ยืนยัน Import"}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="ges-card p-10 text-center text-gray-400 animate-pulse">กำลังโหลด…</div>
      ) : shownDepts.length === 0 ? (
        <div className="ges-card p-10 text-center text-gray-400">
          <p className="font-medium">ยังไม่มีหน่วยย่อย</p>
          <p className="text-xs mt-1">เลือกแผนกด้านบนเพื่อเพิ่มหน่วย หรือ Import จาก Excel</p>
        </div>
      ) : shownDepts.map((dept) => {
        const deptUnits = units.filter((u) => u.department === dept);
        const deptEmps = emps.filter((e) => e.department === dept);
        return (
          <div key={dept} className="ges-card overflow-hidden">
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-blue-900">{dept}</h3>
                <p className="text-xs text-gray-500">{deptUnits.length} หน่วย · ขึ้นตรงกับแผนก {directCount(dept)} คน</p>
              </div>
              <button onClick={() => addUnit(dept, null)} disabled={busy} className="text-xs text-blue-600 hover:underline">+ เพิ่มหน่วย</button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                  <th className="text-left px-4 py-2">หน่วย</th>
                  <th className="text-left px-3 py-2">หัวหน้าหน่วย (อนุมัติแผน)</th>
                  <th className="text-center px-3 py-2">สมาชิก</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {deptUnits.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2" style={{ paddingLeft: `${16 + (u.depth - 1) * 22}px` }}>
                      <span className="text-gray-300 mr-1">{u.depth > 1 ? "└" : ""}</span>
                      <span className="font-medium text-gray-800">{u.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <select value={u.head?.id ?? ""} disabled={busy}
                        onChange={(e) => call("PUT", { id: u.id, headId: e.target.value })}
                        className="ges-input py-1 text-xs w-full max-w-[260px]">
                        <option value="">— ยังไม่ระบุ —</option>
                        {deptEmps.map((e) => <option key={e.id} value={e.id}>{e.employeeId} · {e.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">{u.memberCount}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-xs space-x-2">
                      <button onClick={() => addUnit(dept, u.id)} disabled={busy} className="text-blue-600 hover:underline">+ หน่วยย่อย</button>
                      <button onClick={() => renameUnit(u)} disabled={busy} className="text-gray-600 hover:underline">แก้ชื่อ</button>
                      <button onClick={() => deleteUnit(u)} disabled={busy} className="text-red-500 hover:underline">ลบ</button>
                    </td>
                  </tr>
                ))}
                {deptUnits.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-xs">ยังไม่มีหน่วยในแผนกนี้</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-gray-400">
        จัดคนเข้าหน่วยทีละคนได้ที่หน้า Employees (แก้ไข → หน่วย) · หัวหน้าหน่วยต้อง logout/login ใหม่ จึงจะเห็นเมนู Approve Plan
      </p>
    </div>
  );
}
