import ExcelJS from "exceljs";
import { addTitleBand, styleHeaderRow, styleDataRow, styleGroupRow, styleSubtotalRow, COLORS } from "./theme";
import { HRS_FMT } from "./sheets";
import { STD_MM_HRS } from "@/lib/capacity";

/** One summary line: plan / actual hours, leave hours (shown apart, not in actual) and the people who logged actual hours */
export type Agg = { plan: number; actual: number; leave: number; people: Set<string> };
export const newAgg = (): Agg => ({ plan: 0, actual: 0, leave: 0, people: new Set() });
const addInto = (a: Agg, b: Agg) => { a.plan += b.plan; a.actual += b.actual; a.leave += b.leave; b.people.forEach((p) => a.people.add(p)); };

export type Group = { label: string; rows: { key: string[]; agg: Agg }[] };

const MM_FMT = "0.00";
const COLS = [
  { header: "คน (Actual)", width: 11 },
  { header: "Plan (ชม.)", width: 12, fmt: HRS_FMT },
  { header: "Actual (ชม.)", width: 12, fmt: HRS_FMT },
  { header: "ลา (ชม.)", width: 10, fmt: HRS_FMT },
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
    return [a.people.size, a.plan, a.actual, a.leave, pMM, aMM, aMM - pMM, a.plan > 0 ? `${Math.round(((a.actual - a.plan) / a.plan) * 100)}%` : "–"];
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
  const subtotalRows = new Map<string, number>(); // group label → its subtotal row (for cross-sheet checks)
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
    subtotalRows.set(g.label, r);
    addInto(grand, sub);
    r += 2;
  }
  if (groups.length > 1) {
    ws.getRow(r).values = ["รวมทั้งหมด", ...Array(keyHeaders.length - 1).fill(""), ...nums(grand)];
    styleSubtotalRow(ws, r, colCount); fmtRow(r);
  }
  // Actual (ชม.) column = after the key columns, "คน" and "Plan"
  return { ws, subtotalRows, actualCol: keyHeaders.length + 3 };
}

/** Employee → Project → Task hours of one department, split into hours excl. holidays / holidays */
export type DeptEmpDetail = {
  employeeId: string; name: string; department: string; unit: string; hours: number;
  projects: { number: string; name: string; hours: number; tasks: { code: string; name: string; hours: number }[] }[];
};

/**
 * Employee detail sheet of one department (Employee → Project → Task) with live formulas:
 * "Hours excl. Holidays" drops the holiday task codes, and a check row compares the total
 * with the department's Actual in the Dept x Project sheet (checkRef, e.g. 'Dept x Project'!E46).
 */
export function writeDeptEmployeeDetailSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string,
  emps: DeptEmpDetail[], holidayCodes: string[], checkRef: { ref: string; value: number } | null,
) {
  const ws = wb.addWorksheet(sheetName, { properties: { outlineLevelRow: 2 } });
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true }; // cached results of 0 are not written
  const cols = [
    { header: "Employee ID", width: 12 }, { header: "Employee Name", width: 24 }, { header: "Department", width: 16 },
    { header: "Unit", width: 30 }, { header: "Project No.", width: 13 }, { header: "Project Name", width: 34 },
    { header: "Task Code", width: 10 }, { header: "Task Name", width: 40 },
    { header: "Hours", width: 12 }, { header: "Hours excl. Holidays", width: 20 }, { header: `Holidays (${holidayCodes.join(", ")})`, width: 18 },
  ];
  const n = cols.length;
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, n);
  const headerRow = 3;
  ws.getRow(headerRow).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRow, n);
  ws.views = [{ state: "frozen", ySplit: headerRow }];

  const isHoliday = (code: string) => holidayCodes.includes(code.trim());
  const holidayTest = (cell: string) => {
    const tests = holidayCodes.map((c) => `TRIM(${cell}&"")="${c}"`);
    return tests.length === 1 ? tests[0] : `OR(${tests.join(",")})`;
  };
  const fmt = (r: number) => { for (let c = 9; c <= n; c++) ws.getRow(r).getCell(c).numFmt = HRS_FMT; };
  const band = (r: number, upTo: number) => {
    for (let c = 1; c <= upTo; c++) ws.getRow(r).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
  };

  const first = headerRow + 1;
  let r = first;
  let allHrs = 0, holidayHrs = 0;
  for (const emp of emps) {
    const empRow = r++;
    const projRows: number[] = [];
    let empExcl = 0;
    for (const p of emp.projects) {
      const pRow = r++;
      projRows.push(pRow);
      const tFirst = r;
      let pExcl = 0;
      let alt = false;
      for (const t of p.tasks) {
        const excl = isHoliday(t.code) ? 0 : t.hours;
        pExcl += excl;
        if (!excl) holidayHrs += t.hours;
        ws.getRow(r).values = ["", "", "", "", "", "", t.code, t.name, t.hours,
          { formula: `IF(${holidayTest(`$G${r}`)},0,$I${r})`, result: excl } as any];
        ws.getRow(r).outlineLevel = 2;
        styleDataRow(ws, r, n, alt); fmt(r);
        alt = !alt; r++;
      }
      ws.getRow(pRow).values = ["", "", "", "", p.number, p.name, "", "", p.hours,
        { formula: `SUM(J${tFirst}:J${r - 1})`, result: pExcl } as any];
      ws.getRow(pRow).outlineLevel = 1;
      styleGroupRow(ws, pRow, n); band(pRow, 4); fmt(pRow);
      empExcl += pExcl;
    }
    const exclF = projRows.length ? projRows.map((x) => `J${x}`).join("+") : `I${empRow}`;
    ws.getRow(empRow).values = [emp.employeeId, emp.name, emp.department, emp.unit, "", "", "", "", emp.hours,
      { formula: exclF, result: empExcl } as any, { formula: `I${empRow}-J${empRow}`, result: emp.hours - empExcl } as any];
    styleGroupRow(ws, empRow, n); fmt(empRow);
    allHrs += emp.hours;
    r++; // blank separator
  }

  // Totals — employee rows only (column A is filled on employee rows), so nothing is counted twice
  const last = Math.max(r - 1, first);
  const total = r + 1;
  const empOnly = (col: string) => `SUMPRODUCT(($A$${first}:$A$${last}<>"")*${col}${first}:${col}${last})`;
  const totalRow = (row: number, label: string, cells: Record<number, ExcelJS.CellValue>) => {
    ws.getRow(row).getCell(1).value = label;
    for (const [c, v] of Object.entries(cells)) ws.getRow(row).getCell(Number(c)).value = v;
    styleSubtotalRow(ws, row, n); fmt(row);
  };
  totalRow(total, "Total – all hours", {
    9: { formula: empOnly("I"), result: allHrs } as any,
    10: { formula: empOnly("J"), result: allHrs - holidayHrs } as any,
    11: { formula: empOnly("K"), result: holidayHrs } as any,
  });
  totalRow(total + 1, `Holidays (${holidayCodes.join(", ")})`, {
    // OR() does not work element-wise inside SUMPRODUCT, so add up the per-code tests instead
    9: { formula: `SUMPRODUCT(((${holidayCodes.map((c) => `(TRIM($G$${first}:$G$${last}&"")="${c}")`).join("+")})>0)*$I$${first}:$I$${last})`, result: holidayHrs } as any,
    11: { formula: `K${total}`, result: holidayHrs } as any,
  });
  totalRow(total + 2, "Total excl. Holidays (matches Dept x Project)", {
    9: { formula: `I${total}-I${total + 1}`, result: allHrs - holidayHrs } as any,
    10: { formula: `J${total}`, result: allHrs - holidayHrs } as any,
  });
  if (checkRef) {
    const ok = Math.round((allHrs - holidayHrs - checkRef.value) * 100) === 0;
    ws.getRow(total + 3).getCell(1).value = {
      formula: `IF(ROUND(J${total}-${checkRef.ref},2)=0,"✓ Matches Dept x Project total","✗ Does not match Dept x Project")`,
      result: ok ? "✓ Matches Dept x Project total" : "✗ Does not match Dept x Project",
    } as any;
    ws.getRow(total + 3).getCell(1).font = { bold: true, color: { argb: ok ? COLORS.success : COLORS.danger } };
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
