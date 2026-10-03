import ExcelJS from "exceljs";
import { addTitleBand, styleHeaderRow, styleDataRow, styleGroupRow, styleSubtotalRow, COLORS } from "./theme";
import { HRS_FMT } from "./sheets";
import { STD_MM_HRS } from "@/lib/capacity";

/** One summary line: plan / actual hours and the people who logged actual hours */
export type Agg = { plan: number; actual: number; people: Set<string> };
export const newAgg = (): Agg => ({ plan: 0, actual: 0, people: new Set() });
const addInto = (a: Agg, b: Agg) => { a.plan += b.plan; a.actual += b.actual; b.people.forEach((p) => a.people.add(p)); };

export type Group = { label: string; rows: { key: string[]; agg: Agg }[] };

const MM_FMT = "0.00";
const COLS = [
  { header: "คน (Actual)", width: 11 },
  { header: "Plan (ชม.)", width: 12, fmt: HRS_FMT },
  { header: "Actual (ชม.)", width: 12, fmt: HRS_FMT },
  { header: "Plan (MM)", width: 11, fmt: MM_FMT },
  { header: "Actual (MM)", width: 11, fmt: MM_FMT },
  { header: "Actual − Plan (MM)", width: 15, fmt: MM_FMT },
  { header: "Variance %", width: 11 },
];

/**
 * Grouped Plan vs Actual sheet: a group header row, one row per item, a subtotal per group,
 * and a grand total. keyHeaders = the leading text columns of each row (e.g. Project No., Project Name).
 */
export function writeGroupedPlanActualSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string,
  keyHeaders: { header: string; width: number }[], groups: Group[], subtotalLabel: string,
) {
  const ws = wb.addWorksheet(sheetName);
  const colCount = keyHeaders.length + COLS.length;
  ws.columns = [...keyHeaders, ...COLS].map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, colCount);
  const headerRow = 3;
  ws.getRow(headerRow).values = [...keyHeaders, ...COLS].map((c) => c.header);
  styleHeaderRow(ws, headerRow, colCount);
  ws.views = [{ state: "frozen", xSplit: keyHeaders.length, ySplit: headerRow }];

  const nums = (a: Agg): (number | string)[] => {
    const pMM = a.plan / STD_MM_HRS, aMM = a.actual / STD_MM_HRS;
    return [a.people.size, a.plan, a.actual, pMM, aMM, aMM - pMM, a.plan > 0 ? `${Math.round(((a.actual - a.plan) / a.plan) * 100)}%` : "–"];
  };
  const fmtRow = (r: number) => {
    COLS.forEach((c, i) => { if (c.fmt) ws.getRow(r).getCell(keyHeaders.length + 1 + i).numFmt = c.fmt; });
  };
  const varianceColor = (r: number, a: Agg) => {
    if (a.plan <= 0) return;
    const cell = ws.getRow(r).getCell(colCount);
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: a.actual < a.plan ? COLORS.danger : COLORS.success } };
  };

  let r = headerRow + 1;
  const grand = newAgg();
  for (const g of groups) {
    ws.getRow(r).values = [g.label];
    styleGroupRow(ws, r, colCount);
    ws.mergeCells(r, 1, r, colCount);
    r++;
    const sub = newAgg();
    let alt = false;
    for (const row of g.rows) {
      ws.getRow(r).values = [...row.key, ...nums(row.agg)];
      styleDataRow(ws, r, colCount, alt); fmtRow(r); varianceColor(r, row.agg);
      addInto(sub, row.agg);
      alt = !alt; r++;
    }
    ws.getRow(r).values = [`${subtotalLabel} ${g.label}`, ...Array(keyHeaders.length - 1).fill(""), ...nums(sub)];
    styleSubtotalRow(ws, r, colCount); fmtRow(r);
    addInto(grand, sub);
    r += 2;
  }
  if (groups.length > 1) {
    ws.getRow(r).values = ["รวมทั้งหมด", ...Array(keyHeaders.length - 1).fill(""), ...nums(grand)];
    styleSubtotalRow(ws, r, colCount); fmtRow(r);
  }
  return ws;
}

/** จำนวนวันจันทร์–ศุกร์ในช่วง [start, end) — ใช้ pro-rate แผนรายเดือนให้ตรงช่วงที่เลือก */
export function weekdaysBetween(start: Date, end: Date): number {
  let n = 0;
  for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return n;
}
