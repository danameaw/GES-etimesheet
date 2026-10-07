/**
 * Excel template ของ Resource Plan รายคน (ResourcePlanEmployeeMonthly)
 * - template หลายโครงการ: 1 sheet ต่อโครงการ, คนจัดกลุ่มตามส่วนที่ Head of Dept อนุมัติ (แผนก/หน่วย)
 *   มี Actual รายเดือนให้ดูประกอบ + ช่องแผนให้ PD กรอก
 * - parser ใช้ร่วมกันทั้ง import ทีละโครงการ และ import ทั้งไฟล์
 */
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { LEAVE_TASK_CODES } from "@/lib/task-constants";
import { COLORS, thinBorder, addTitleBand, styleHeaderRow, styleGroupRow, styleSubtotalRow, setWorkbookMeta } from "@/lib/export/theme";
import { loadUnitIndex, approvalKeyFor } from "@/lib/org-units";
import { approvalLabel } from "@/lib/plan-approvals";
import { PROJECT_GROUPS, projectGroupKey } from "@/lib/project-groups";

export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_MAP: Record<string, number> = Object.fromEntries(MONTH_NAMES.map((m, i) => [m, i + 1]));

export type YM = { year: number; month: number };
export type MonthCol = YM & { label: string };

export const ymKey = (y: number, m: number) => `${y}-${m}`;
export const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

/** "2026-06" → { year: 2026, month: 6 } */
export function parseYM(s: string | null | undefined): YM | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s ?? "");
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { year: +m[1], month: +m[2] };
}

/** เดือนตั้งแต่ from ถึง to (รวมทั้งสองเดือน) */
export function monthRange(from: YM, to: YM): MonthCol[] {
  const out: MonthCol[] = [];
  for (let y = from.year, m = from.month; y < to.year || (y === to.year && m <= to.month); m++) {
    if (m > 12) { y++; m = 1; }
    if (y > to.year || (y === to.year && m > to.month)) break;
    out.push({ year: y, month: m, label: monthLabel(y, m) });
  }
  return out;
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseMonthLabel(label: string): YM | null {
  const parts = label.trim().split(" ");
  if (parts.length !== 2) return null;           // "Actual Jun 2026" / "Total Plan" → ไม่ใช่คอลัมน์แผน
  const month = MONTH_MAP[parts[0]];
  const year  = parseInt(parts[1]);
  if (!month || isNaN(year)) return null;
  return { year, month };
}

/** header ที่ Excel แปลงเป็น serial number (เช่น 46174 = Jun 2026) ก็อ่านได้ */
function cellToMonth(val: any): YM | null {
  if (typeof val === "string") return parseMonthLabel(val);
  if (typeof val === "number" && val > 40000 && val < 90000) {
    const d = new Date((val - 25569) * 86400000);  // Excel serial 25569 = 1970-01-01
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  return null;
}

const STD_HOURS_PER_MONTH = 176;
/** 0 < v ≤ 1.5 → ถือเป็น MM แปลงเป็นชั่วโมง (1 MM = 176 ชม.) */
const resolveHrs = (v: number) => (v > 0 && v <= 1.5 ? Math.round(v * STD_HOURS_PER_MONTH) : v);

export type ParsedPlan = { userId: string; year: number; month: number; hrs: number };

/**
 * อ่านแถวของ sheet (array of arrays) → แผนรายคนรายเดือน
 * ต้องมีแถว header ที่คอลัมน์แรกเป็น "User ID"; คอลัมน์เดือนเริ่มที่คอลัมน์ที่ 4
 * แถวที่ไม่มี User ID (หัวกลุ่ม / subtotal / total) ถูกข้าม
 */
export function parsePlanRows(rows: any[][]): { plans: ParsedPlan[]; error?: string } {
  const headerIdx = rows.findIndex((r) => String(r[0] ?? "").trim().toLowerCase() === "user id");
  if (headerIdx === -1) return { plans: [], error: 'ไม่พบ header row "User ID" กรุณาใช้ Template ที่ดาวน์โหลดจากระบบ' };

  const header = rows[headerIdx];
  const monthCols: (YM & { col: number })[] = [];
  for (let c = 3; c < header.length; c++) {
    const ym = cellToMonth(header[c]);
    if (ym) monthCols.push({ col: c, ...ym });
  }
  if (monthCols.length === 0) return { plans: [], error: "ไม่พบคอลัมน์เดือนในไฟล์" };

  const plans: ParsedPlan[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const userId = String(row[0] ?? "").trim().toUpperCase();
    if (!userId || userId === "TOTAL") continue;
    for (const { col, year, month } of monthCols) {
      const v = parseFloat(String(row[col]));
      // cell ว่าง = 0 (Excel เป็น source of truth ต้อง overwrite ค่าเก่า)
      plans.push({ userId, year, month, hrs: isNaN(v) || v < 0 ? 0 : resolveHrs(v) });
    }
  }
  return { plans };
}

/** เลขโครงการของ sheet: cell ถัดจาก "Project No." ใน 6 แถวแรก */
export function sheetProjectNumber(rows: any[][]): string | null {
  for (const r of rows.slice(0, 6)) {
    const i = r.findIndex((v) => String(v ?? "").trim().toLowerCase() === "project no.");
    if (i >= 0 && String(r[i + 1] ?? "").trim()) return String(r[i + 1]).trim();
  }
  return null;
}

export function sheetRows(ws: XLSX.WorkSheet): any[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

/** บันทึกแผนของโครงการ (upsert ทีละเดือน) — คืนจำนวนที่บันทึก + User ID ที่ไม่พบ */
export async function savePlans(projectId: string, plans: ParsedPlan[], byEmpDbId: string) {
  const emps = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true, employeeId: true } });
  const lookup = new Map(emps.map((e) => [e.employeeId.toUpperCase(), e.id]));

  const notFound = new Set<string>();
  const ops = [];
  for (const p of plans) {
    const employeeId = lookup.get(p.userId);
    if (!employeeId) { notFound.add(p.userId); continue; }
    ops.push(prisma.resourcePlanEmployeeMonthly.upsert({
      where: { projectId_employeeId_year_month: { projectId, employeeId, year: p.year, month: p.month } },
      update: { plannedHrs: p.hrs, createdBy: byEmpDbId },
      create: { projectId, employeeId, year: p.year, month: p.month, plannedHrs: p.hrs, createdBy: byEmpDbId },
    }));
  }
  if (ops.length) await prisma.$transaction(ops);
  return { savedCount: ops.length, notFound: Array.from(notFound) };
}

// ── Actual ────────────────────────────────────────────────────────────────────

const DAY_KEYS = ["monHrs", "tueHrs", "wedHrs", "thuHrs", "friHrs", "satHrs", "sunHrs"] as const;
const DAY_MS = 86400000;

/**
 * ชั่วโมงจริงรายเดือน (timesheet ที่ submit/approve แล้ว, ไม่รวมลา) แยกตามวันจริงของแต่ละวันในสัปดาห์
 * → Map projectId → employee db id → "y-m" → hrs
 */
export async function monthlyActuals(projectIds: string[], from: YM, to: YM) {
  const start = Date.UTC(from.year, from.month - 1, 1);
  const end   = Date.UTC(to.year, to.month, 1);
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      projectId: { in: projectIds },
      totalHrs: { gt: 0 },
      taskCode: { code: { notIn: LEAVE_TASK_CODES } },
      timesheet: { status: { in: ["submitted", "approved"] }, weekStart: { gte: new Date(start - 8 * DAY_MS), lt: new Date(end) } },
    },
    select: { projectId: true, monHrs: true, tueHrs: true, wedHrs: true, thuHrs: true, friHrs: true, satHrs: true, sunHrs: true,
      timesheet: { select: { employeeId: true, weekStart: true } } },
  });

  const out = new Map<string, Map<string, Map<string, number>>>();
  for (const e of entries) {
    // weekStart บางแถวเก็บแบบเวลาไทย (17:00Z วันก่อน) → ปัดเป็นเที่ยงคืน UTC ที่ใกล้สุด
    const monday = Math.round(e.timesheet.weekStart.getTime() / DAY_MS) * DAY_MS;
    DAY_KEYS.forEach((k, i) => {
      const hrs = e[k];
      const t = monday + i * DAY_MS;
      if (!hrs || t < start || t >= end) return;
      const d = new Date(t);
      const key = ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
      if (!out.has(e.projectId)) out.set(e.projectId, new Map());
      const byEmp = out.get(e.projectId)!;
      if (!byEmp.has(e.timesheet.employeeId)) byEmp.set(e.timesheet.employeeId, new Map());
      const m = byEmp.get(e.timesheet.employeeId)!;
      m.set(key, (m.get(key) ?? 0) + hrs);
    });
  }
  return out;
}

// ── Writer ────────────────────────────────────────────────────────────────────

export type SheetEmp = { userId: string; name: string; department: string; unit: string; actual: number[]; plan: number[] };
export type SheetGroup = { label: string; emps: SheetEmp[] };

export type ProjectSheet = {
  projectNumber: string;
  projectName: string;
  pdName: string;
  pmName: string;
  planStatus: string;
  endDate: Date | null;
  warning: string;          // ข้อความเตือนบน sheet ("" = ไม่มี)
  actualMonths: MonthCol[];
  planMonths: MonthCol[];
  groups: SheetGroup[];
};

const BLANK_ROWS = 5;
const INPUT_FILL = "FFFFFBEB";  // amber-50 — ช่องที่ให้กรอก
const ACTUAL_FILL = "FFF1F5F9"; // slate-100 — ข้อมูลจริง ดูอย่างเดียว

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\[\]:*?/\\]/g, "-").slice(0, 31) || "Project";
  for (let n = 2; used.has(base.toLowerCase()); n++) base = `${name.slice(0, 27)} (${n})`;
  used.add(base.toLowerCase());
  return base;
}

export function writeProjectSheet(wb: ExcelJS.Workbook, p: ProjectSheet, usedNames: Set<string>) {
  const ws = wb.addWorksheet(safeSheetName(p.projectNumber, usedNames));
  const nA = p.actualMonths.length, nP = p.planMonths.length;
  const firstActual = 5, totalActualCol = firstActual + nA, firstPlan = totalActualCol + 1, totalPlanCol = firstPlan + nP;
  const colCount = totalPlanCol;
  const col = (c: number) => ws.getColumn(c).letter;

  addTitleBand(ws, `${p.projectNumber} : ${p.projectName}`,
    `PD: ${p.pdName || "-"}   •   PM: ${p.pmName || "-"}   •   วันจบโครงการ: ${fmtDate(p.endDate)}   •   สถานะแผน: ${p.planStatus}`, colCount);
  ws.getCell(3, 1).value = "Project No.";
  ws.getCell(3, 2).value = p.projectNumber;
  ws.getCell(3, 1).font = ws.getCell(3, 2).font = { bold: true, size: 10, color: { argb: COLORS.textMuted } };
  ws.getCell(4, 1).value = p.warning
    ? `⚠ ${p.warning}`
    : "กรอกชั่วโมงแผนในช่องสีเหลือง (ใส่ 0–1.5 = จำนวน MM, ระบบแปลง 1 MM = 176 ชม.) · เพิ่มคนได้ที่แถวว่างด้านล่าง โดยใส่ User ID";
  ws.getCell(4, 1).font = { size: 10, italic: !p.warning, bold: !!p.warning, color: { argb: p.warning ? COLORS.danger : COLORS.textMuted } };

  const HEADER = 6;
  ws.getRow(HEADER).values = [
    "User ID", "ชื่อ-นามสกุล", "แผนก", "หน่วย",
    ...p.actualMonths.map((m) => `Actual ${m.label}`), "Total Actual",
    ...p.planMonths.map((m) => m.label), "Total Plan",
  ];
  styleHeaderRow(ws, HEADER, colCount);
  for (let c = firstActual; c <= totalActualCol; c++) ws.getCell(HEADER, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.textMuted } };

  const sumCell = (r: number, from: number, to: number, result: number) =>
    to >= from ? { formula: `SUM(${col(from)}${r}:${col(to)}${r})`, result } : result;

  const writeEmpRow = (r: number, e: SheetEmp | null) => {
    const row = ws.getRow(r);
    row.values = e
      ? [e.userId, e.name, e.department, e.unit, ...e.actual, null, ...e.plan, null]
      : ["", "", "", "", ...p.actualMonths.map(() => null), null, ...p.planMonths.map(() => null), null];
    const tA = e ? e.actual.reduce((s, v) => s + v, 0) : 0, tP = e ? e.plan.reduce((s, v) => s + v, 0) : 0;
    row.getCell(totalActualCol).value = sumCell(r, firstActual, totalActualCol - 1, tA);
    row.getCell(totalPlanCol).value = sumCell(r, firstPlan, totalPlanCol - 1, tP);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder();
      cell.font = { size: 10, color: { argb: COLORS.textDark } };
      if (c >= firstActual && c <= totalActualCol) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACTUAL_FILL } };
      if (c >= firstPlan && c < totalPlanCol) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
        cell.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true,
          showErrorMessage: true, errorTitle: "ชั่วโมงไม่ถูกต้อง", error: "กรอกตัวเลขตั้งแต่ 0 ขึ้นไป" };
      }
      if (c >= firstActual) cell.numFmt = "#,##0.##";
    }
    if (!e) row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
  };

  const subtotalRows: number[] = [];
  const writeSubtotal = (r: number, label: string, from: number, to: number) => {
    const row = ws.getRow(r);
    row.getCell(2).value = label;
    for (let c = firstActual; c <= colCount; c++) {
      let result = 0;
      for (let i = from; i <= to; i++) result += Number((ws.getCell(i, c).value as any)?.result ?? ws.getCell(i, c).value ?? 0);
      row.getCell(c).value = { formula: `SUM(${col(c)}${from}:${col(c)}${to})`, result };
      row.getCell(c).numFmt = "#,##0.##";
    }
    styleSubtotalRow(ws, r, colCount);
    subtotalRows.push(r);
  };

  let r = HEADER + 1;
  const groups = [...p.groups, { label: "เพิ่มพนักงาน (ถ้ามี) — ใส่ User ID", emps: [] as SheetEmp[] }];
  groups.forEach((g, gi) => {
    const isBlank = gi === groups.length - 1;
    ws.getCell(r, 2).value = isBlank ? g.label : `▸ ${g.label}`;
    styleGroupRow(ws, r, colCount);
    r++;
    const from = r;
    if (isBlank) for (let i = 0; i < BLANK_ROWS; i++) writeEmpRow(r++, null);
    else for (const e of g.emps) writeEmpRow(r++, e);
    writeSubtotal(r, isBlank ? "รวม (คนที่เพิ่ม)" : `รวม ${g.label}`, from, r - 1);
    r++;
  });

  // grand total = ผลรวมของ subtotal ทุกกลุ่ม
  r++;
  const totalRow = ws.getRow(r);
  totalRow.getCell(2).value = "TOTAL";
  for (let c = firstActual; c <= colCount; c++) {
    const result = subtotalRows.reduce((s, sr) => s + Number((ws.getCell(sr, c).value as any)?.result ?? 0), 0);
    totalRow.getCell(c).value = { formula: subtotalRows.map((sr) => `${col(c)}${sr}`).join("+"), result };
    totalRow.getCell(c).numFmt = "#,##0.##";
  }
  styleSubtotalRow(ws, r, colCount);
  for (let c = 1; c <= colCount; c++) totalRow.getCell(c).font = { bold: true, size: 11, color: { argb: COLORS.primary } };

  ws.getColumn(1).width = 11; ws.getColumn(2).width = 30; ws.getColumn(3).width = 18; ws.getColumn(4).width = 22;
  for (let c = firstActual; c <= colCount; c++) ws.getColumn(c).width = c === totalActualCol || c === totalPlanCol ? 12 : 10.5;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: HEADER }];
}

export type ReadmeRow = { projectNumber: string; projectName: string; pdName: string; pmName: string;
  endDate: Date | null; people: number; actualHrs: number; planStatus: string; warning: string };

export function writeReadmeSheet(wb: ExcelJS.Workbook, title: string, rows: ReadmeRow[], actual: MonthCol[], planFrom: MonthCol) {
  const ws = wb.addWorksheet("README");
  const colCount = 9;
  addTitleBand(ws, title, `Actual ${actual[0]?.label ?? "-"} – ${actual[actual.length - 1]?.label ?? "-"}   •   แผนตั้งแต่ ${planFrom.label} ถึงวันจบโครงการ`, colCount);
  const steps = [
    "วิธีใช้",
    "1) แต่ละ sheet = 1 โครงการ · พนักงานจัดกลุ่มตามแผนก/หน่วย ที่ Head of Dept จะเป็นผู้อนุมัติ",
    "2) คอลัมน์สีเทา = ชั่วโมงจริง (Actual) จาก Timesheet ที่ส่งแล้ว ไว้ดูประกอบ ไม่ต้องแก้",
    "3) คอลัมน์สีเหลือง = แผน (ชั่วโมง/เดือน) ให้ PD กรอก · ใส่ 0–1.5 จะถือเป็น MM (1 MM = 176 ชม.)",
    "4) เพิ่มคนที่ยังไม่มีในรายชื่อได้ที่แถวว่างท้าย sheet (ใส่ User ID ก็พอ) · ห้ามแก้ชื่อ sheet แถว Project No. และแถว header",
    "5) ส่งไฟล์กลับ → Admin นำเข้าที่หน้า Resource Plan → PD ตรวจและกด Submit ในระบบ → Head of Dept อนุมัติในหน้า Approve Plan",
  ];
  steps.forEach((s, i) => {
    const c = ws.getCell(4 + i, 1);
    c.value = s;
    c.font = { size: 10, bold: i === 0, color: { argb: COLORS.textDark } };
  });

  const HEADER = 4 + steps.length + 1;
  ws.getRow(HEADER).values = ["Project No.", "ชื่อโครงการ", "PD", "PM", "วันจบโครงการ", "จำนวนคน", "Actual รวม (ชม.)", "สถานะแผน", "หมายเหตุ"];
  styleHeaderRow(ws, HEADER, colCount);
  rows.forEach((x, i) => {
    const r = HEADER + 1 + i;
    ws.getRow(r).values = [x.projectNumber, x.projectName, x.pdName, x.pmName, fmtDate(x.endDate), x.people, Math.round(x.actualHrs), x.planStatus, x.warning];
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getCell(r, c);
      cell.border = thinBorder();
      cell.font = { size: 10, color: { argb: c === 9 ? COLORS.danger : COLORS.textDark } };
    }
  });
  [14, 42, 24, 24, 13, 10, 15, 14, 48].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: HEADER }];
}

// ── Template หลายโครงการ ─────────────────────────────────────────────────────

const FALLBACK_PLAN_TO: YM = { year: 2027, month: 12 }; // โครงการที่ไม่มีวันจบ / วันจบผ่านไปแล้ว

/**
 * Workbook แผนรายคนของหลายโครงการ: README + 1 sheet ต่อโครงการ (active, ไม่รวม Overhead)
 * group = กลุ่มโครงการ (lib/project-groups) หรือ "all" · คืน null ถ้าไม่มีโครงการ
 */
export async function buildBulkPlanWorkbook(group: string, actualFrom: YM, actualTo: YM, planFrom: YM) {
  const projects = (await prisma.project.findMany({
    where: { isActive: true },
    include: { pd: { select: { name: true } }, manager: { select: { name: true } } },
    orderBy: { projectNumber: "asc" },
  })).filter((p) => {
    const g = projectGroupKey(p);
    return g !== "overhead" && (group === "all" || g === group);
  });
  if (projects.length === 0) return null;

  const projectIds = projects.map((p) => p.id);
  const actualMonths = monthRange(actualFrom, actualTo);
  const [actuals, existingPlans, idx] = await Promise.all([
    monthlyActuals(projectIds, actualFrom, actualTo),
    prisma.resourcePlanEmployeeMonthly.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, employeeId: true, year: true, month: true, plannedHrs: true },
    }),
    loadUnitIndex(),
  ]);

  // พนักงาน = มี Actual ในช่วงนี้ หรือมีแผนอยู่แล้ว
  const empIds = new Set<string>(existingPlans.map((p) => p.employeeId));
  actuals.forEach((byEmp) => byEmp.forEach((_, id) => empIds.add(id)));
  const emps = await prisma.employee.findMany({
    where: { id: { in: Array.from(empIds) } },
    select: { id: true, employeeId: true, name: true, department: true, orgUnitId: true, isActive: true },
  });
  const empById = new Map(emps.map((e) => [e.id, e]));

  const planOf = new Map<string, number>(); // projectId|empId|y-m → hrs
  for (const p of existingPlans) planOf.set(`${p.projectId}|${p.employeeId}|${ymKey(p.year, p.month)}`, p.plannedHrs);

  const wb = new ExcelJS.Workbook();
  setWorkbookMeta(wb);
  const readme: ReadmeRow[] = [];
  const sheets: Parameters<typeof writeProjectSheet>[1][] = [];

  for (const p of projects) {
    const warnings: string[] = [];
    let planTo = FALLBACK_PLAN_TO;
    if (!p.startDate || !p.endDate) warnings.push("ยังไม่ได้ตั้งวันเริ่ม/จบโครงการ — PD จะไม่เห็นแผนในระบบจนกว่า Admin ตั้งวันที่ที่หน้า Manage");
    if (p.endDate) {
      const end = { year: p.endDate.getUTCFullYear(), month: p.endDate.getUTCMonth() + 1 };
      if (end.year * 12 + end.month >= planFrom.year * 12 + planFrom.month) planTo = end;
      else warnings.push(`วันจบโครงการ (${p.endDate.toISOString().slice(0, 10)}) ผ่านไปแล้ว — ให้ช่องแผนถึง Dec 2027 ถ้ายังดำเนินอยู่ควรแก้วันจบ`);
    }
    if (!p.pdId && !p.managerId) warnings.push("ยังไม่ได้กำหนด PD/PM — ไม่มีใครเห็นโครงการนี้ในหน้า Resource Plan (ตั้งได้ที่หน้า Manage)");
    if (p.planStatus !== "draft") warnings.push(`แผนสถานะ "${p.planStatus}" — import ทับไม่ได้จนกว่าแผนจะกลับเป็น draft`);
    const planMonths = monthRange(planFrom, planTo);

    const projActual = actuals.get(p.id) ?? new Map<string, Map<string, number>>();
    const ids = new Set<string>(projActual.keys());
    for (const ep of existingPlans) if (ep.projectId === p.id) ids.add(ep.employeeId);

    const groupMap = new Map<string, SheetGroup>();
    let actualHrs = 0;
    for (const id of Array.from(ids)) {
      const e = empById.get(id);
      if (!e || !e.isActive) continue; // ลาออกแล้ว — ไม่ต้องวางแผน
      const label = approvalLabel(idx, approvalKeyFor(idx, e));
      const unitPath = e.orgUnitId ? idx.names(e.orgUnitId).join(" > ") : "";
      const a = projActual.get(id);
      const actual = actualMonths.map((m) => Math.round((a?.get(ymKey(m.year, m.month)) ?? 0) * 100) / 100);
      actualHrs += actual.reduce((s, v) => s + v, 0);
      if (!groupMap.has(label)) groupMap.set(label, { label, emps: [] });
      groupMap.get(label)!.emps.push({
        userId: e.employeeId, name: e.name, department: e.department, unit: unitPath, actual,
        plan: planMonths.map((m) => planOf.get(`${p.id}|${id}|${ymKey(m.year, m.month)}`) ?? 0),
      });
    }
    const groups = Array.from(groupMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    groups.forEach((g) => g.emps.sort((a, b) => a.name.localeCompare(b.name)));

    const common = { projectNumber: p.projectNumber, projectName: p.projectName, pdName: p.pd?.name ?? "", pmName: p.manager?.name ?? "",
      planStatus: p.planStatus, endDate: p.endDate };
    sheets.push({ ...common, warning: warnings.join(" · "), actualMonths, planMonths, groups });
    readme.push({ ...common, people: groups.reduce((s, g) => s + g.emps.length, 0), actualHrs, warning: warnings.join(" · ") });
  }

  const groupLabel = group === "all" ? "ทุกกลุ่ม" : PROJECT_GROUPS.find((g) => g.key === group)?.label ?? group;
  writeReadmeSheet(wb, `Resource Plan Template — ${groupLabel} (${projects.length} โครงการ)`, readme, actualMonths, monthRange(planFrom, planFrom)[0]);
  const used = new Set<string>(["readme"]);
  for (const s of sheets) writeProjectSheet(wb, s, used);

  return wb;
}
