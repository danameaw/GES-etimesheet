import ExcelJS from "exceljs";
import {
  addTitleBand, styleHeaderRow, styleDataRow, styleGroupRow,
  addDataBar, addColorScale, styleStatusCell, addKpiTile, COLORS,
} from "./theme";
import {
  ProjAgg, EmpAgg, ProjTaskAgg, sortByHoursDesc,
} from "./aggregate";

export const HRS_FMT = "#,##0.0";

/** Generic flat, filterable table sheet (title band + header + banded rows). Used for the raw Detail export. */
export function writeFlatTableSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string,
  columns: { header: string; width: number; numFmt?: string }[],
  rows: (string | number)[][],
  statusColIndex?: number
) {
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, columns.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = columns.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, columns.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];
  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: columns.length } };

  let r = headerRowNum + 1;
  let alt = false;
  for (const rowValues of rows) {
    ws.getRow(r).values = rowValues;
    columns.forEach((c, i) => { if (c.numFmt) ws.getRow(r).getCell(i + 1).numFmt = c.numFmt; });
    styleDataRow(ws, r, columns.length, alt);
    if (statusColIndex) styleStatusCell(ws.getRow(r).getCell(statusColIndex), String(rowValues[statusColIndex - 1] ?? ""));
    alt = !alt;
    r++;
  }
  return ws;
}

/** Project -> Employee -> Task, with collapsible Excel row groups. */
export function writeProjectEmployeeTaskSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string, tree: Map<string, ProjAgg>
) {
  const ws = wb.addWorksheet(sheetName, { properties: { outlineLevelRow: 2 } });
  const cols = [
    { header: "Project No.", width: 13 },
    { header: "Project Name", width: 34 },
    { header: "Employee ID", width: 12 },
    { header: "Employee Name", width: 24 },
    { header: "Department", width: 18 },
    { header: "Task Code", width: 10 },
    { header: "Task Name", width: 28 },
    { header: "Hours", width: 12 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, cols.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, cols.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];

  let r = headerRowNum + 1;
  const sorted = sortByHoursDesc(tree);
  for (const [num, proj] of sorted) {
    ws.getRow(r).values = [num, proj.name, "", "", `${proj.employees.size} คน`, "", "", proj.hours];
    ws.getRow(r).getCell(8).numFmt = HRS_FMT;
    styleGroupRow(ws, r, cols.length);
    r++;

    const sortedEmps = Array.from(proj.employees.values()).sort((a, b) => b.hours - a.hours);
    for (const emp of sortedEmps) {
      ws.getRow(r).values = ["", "", emp.employeeId, emp.name, emp.department, "", "", emp.hours];
      ws.getRow(r).getCell(8).numFmt = HRS_FMT;
      ws.getRow(r).outlineLevel = 1;
      styleGroupRow(ws, r, cols.length);
      for (let c = 1; c <= 2; c++) ws.getRow(r).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
      r++;

      const sortedTasks = Array.from(emp.tasks.values()).sort((a, b) => b.hours - a.hours);
      let alt = false;
      for (const t of sortedTasks) {
        ws.getRow(r).values = ["", "", "", "", "", t.code, t.name, t.hours];
        ws.getRow(r).getCell(8).numFmt = HRS_FMT;
        ws.getRow(r).outlineLevel = 2;
        styleDataRow(ws, r, cols.length, alt);
        alt = !alt;
        r++;
      }
    }
    r++; // blank separator
  }
  return ws;
}

/** Employee -> Project -> Task, mirrored layout of the sheet above. */
export function writeEmployeeProjectTaskSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string, tree: Map<string, EmpAgg>
) {
  const ws = wb.addWorksheet(sheetName, { properties: { outlineLevelRow: 2 } });
  const cols = [
    { header: "Employee ID", width: 12 },
    { header: "Employee Name", width: 24 },
    { header: "Department", width: 18 },
    { header: "Project No.", width: 13 },
    { header: "Project Name", width: 34 },
    { header: "Task Code", width: 10 },
    { header: "Task Name", width: 28 },
    { header: "Hours", width: 12 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, cols.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, cols.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];

  let r = headerRowNum + 1;
  const sorted = sortByHoursDesc(tree);
  for (const [empId, emp] of sorted) {
    ws.getRow(r).values = [empId, emp.name, emp.department, "", "", "", "", emp.hours];
    ws.getRow(r).getCell(8).numFmt = HRS_FMT;
    styleGroupRow(ws, r, cols.length);
    r++;

    const sortedProjs = Array.from(emp.projects.values()).sort((a, b) => b.hours - a.hours);
    for (const proj of sortedProjs) {
      ws.getRow(r).values = ["", "", "", proj.number, proj.name, "", "", proj.hours];
      ws.getRow(r).getCell(8).numFmt = HRS_FMT;
      ws.getRow(r).outlineLevel = 1;
      styleGroupRow(ws, r, cols.length);
      for (let c = 1; c <= 3; c++) ws.getRow(r).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
      r++;

      const sortedTasks = Array.from(proj.tasks.values()).sort((a, b) => b.hours - a.hours);
      let alt = false;
      for (const t of sortedTasks) {
        ws.getRow(r).values = ["", "", "", "", "", t.code, t.name, t.hours];
        ws.getRow(r).getCell(8).numFmt = HRS_FMT;
        ws.getRow(r).outlineLevel = 2;
        styleDataRow(ws, r, cols.length, alt);
        alt = !alt;
        r++;
      }
    }
    r++; // blank separator
  }
  return ws;
}

/** Project -> Task (with distinct engineer counts), restyled version of the original "By Task" report. */
export function writeProjectTaskSheet(
  wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string, tree: Map<string, ProjTaskAgg>
) {
  const ws = wb.addWorksheet(sheetName, { properties: { outlineLevelRow: 1 } });
  const cols = [
    { header: "Project No.", width: 13 },
    { header: "Project Name", width: 34 },
    { header: "Task Code", width: 10 },
    { header: "Task Name", width: 30 },
    { header: "Hours", width: 12 },
    { header: "Engineers", width: 12 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, cols.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, cols.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];

  let r = headerRowNum + 1;
  const sorted = Array.from(tree.entries()).sort((a, b) => b[1].hours - a[1].hours);
  for (const [num, proj] of sorted) {
    const projEmps = new Set<string>();
    proj.tasks.forEach((t) => t.employees.forEach((id) => projEmps.add(id)));
    ws.getRow(r).values = [num, proj.name, "", "", proj.hours, projEmps.size];
    ws.getRow(r).getCell(5).numFmt = HRS_FMT;
    styleGroupRow(ws, r, cols.length);
    r++;

    const sortedTasks = Array.from(proj.tasks.values()).sort((a, b) => b.hours - a.hours);
    let alt = false;
    for (const t of sortedTasks) {
      ws.getRow(r).values = ["", "", t.code, t.name, t.hours, t.employees.size];
      ws.getRow(r).getCell(5).numFmt = HRS_FMT;
      ws.getRow(r).outlineLevel = 1;
      styleDataRow(ws, r, cols.length, alt);
      alt = !alt;
      r++;
    }
    r++;
  }
  return ws;
}

export type UtilizationRow = {
  employeeId: string; name: string; department: string; position: string;
  hours: number; utilization: number; status: string;
};

export function writeUtilizationSheet(
  wb: ExcelJS.Workbook, title: string, subtitle: string, rows: UtilizationRow[]
) {
  const ws = wb.addWorksheet("Utilization");
  const cols = [
    { header: "Employee ID", width: 12 },
    { header: "Employee Name", width: 24 },
    { header: "Department", width: 20 },
    { header: "Position", width: 28 },
    { header: "Total Hours", width: 12 },
    { header: "Utilization %", width: 14 },
    { header: "Status", width: 14 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, cols.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, cols.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];
  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: cols.length } };

  let r = headerRowNum + 1;
  let alt = false;
  for (const row of rows) {
    ws.getRow(r).values = [row.employeeId, row.name, row.department, row.position, row.hours, row.utilization / 100, row.status];
    ws.getRow(r).getCell(5).numFmt = HRS_FMT;
    ws.getRow(r).getCell(6).numFmt = "0%";
    styleDataRow(ws, r, cols.length, alt);
    styleStatusCell(ws.getRow(r).getCell(7), row.status);
    alt = !alt;
    r++;
  }
  if (rows.length > 0) addColorScale(ws, `F${headerRowNum + 1}:F${r - 1}`);
  return ws;
}

export function writeMissingSheet(
  wb: ExcelJS.Workbook, title: string, subtitle: string,
  rows: { employeeId: string; name: string; department: string; position: string; status: string }[]
) {
  const ws = wb.addWorksheet("Missing");
  const cols = [
    { header: "Employee ID", width: 12 },
    { header: "Employee Name", width: 24 },
    { header: "Department", width: 20 },
    { header: "Position", width: 28 },
    { header: "Status", width: 14 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  addTitleBand(ws, title, subtitle, cols.length);

  const headerRowNum = 3;
  ws.getRow(headerRowNum).values = cols.map((c) => c.header);
  styleHeaderRow(ws, headerRowNum, cols.length);
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];
  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: cols.length } };

  let r = headerRowNum + 1;
  let alt = false;
  for (const row of rows) {
    ws.getRow(r).values = [row.employeeId, row.name, row.department, row.position, row.status];
    styleDataRow(ws, r, cols.length, alt);
    styleStatusCell(ws.getRow(r).getCell(5), row.status);
    alt = !alt;
    r++;
  }
  return ws;
}

export type DashboardInput = {
  periodLabel: string;
  totalHours: number;
  totalProjects: number;
  totalEmployees: number;
  avgUtilization: number; // 0-100
  complianceRate: number; // 0-100
  missingCount: number;
  topProjects: [string, { name: string; hours: number }][];
  topEmployees: [string, { name: string; department: string; hours: number }][];
  deptHours: [string, number][];
};

export function writeDashboardSheet(wb: ExcelJS.Workbook, d: DashboardInput) {
  const ws = wb.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
  const colCount = 8;
  ws.columns = Array(colCount).fill({ width: 13 });
  addTitleBand(ws, "GES E-Timesheet — Executive Summary", `รอบข้อมูล: ${d.periodLabel}  |  สร้างเมื่อ: ${new Date().toLocaleString("th-TH")}`, colCount);

  // KPI tiles row (2 cols wide each, 4 tiles across 8 columns)
  addKpiTile(ws, 4, 1, 2, "TOTAL HOURS", d.totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 }), COLORS.primary);
  addKpiTile(ws, 4, 3, 2, "ACTIVE PROJECTS", d.totalProjects, COLORS.primary);
  addKpiTile(ws, 4, 5, 2, "ACTIVE EMPLOYEES", d.totalEmployees, COLORS.primary);
  addKpiTile(ws, 4, 7, 2, "AVG. UTILIZATION", `${Math.round(d.avgUtilization)}%`, d.avgUtilization >= 80 ? COLORS.success : d.avgUtilization >= 50 ? COLORS.warning : COLORS.danger);

  addKpiTile(ws, 6, 1, 2, "SUBMISSION COMPLIANCE", `${Math.round(d.complianceRate)}%`, d.complianceRate >= 90 ? COLORS.success : d.complianceRate >= 70 ? COLORS.warning : COLORS.danger);
  addKpiTile(ws, 6, 3, 2, "MISSING TIMESHEETS", d.missingCount, d.missingCount === 0 ? COLORS.success : COLORS.danger);

  // Each mini-table fully owns its rows (label merged over cols 1-3, value in col 4) —
  // stacked vertically so no two blocks ever write to the same row.
  function miniTable(startRow: number, title: string, valueHeader: string, rows: [string, number][], barColor: string): number {
    ws.getCell(startRow, 1).value = title;
    ws.getCell(startRow, 1).font = { bold: true, size: 12, color: { argb: COLORS.textDark } };
    ws.mergeCells(startRow, 1, startRow, colCount);

    const headerRow = startRow + 1;
    ws.mergeCells(headerRow, 1, headerRow, 3);
    ws.getCell(headerRow, 1).value = "Name";
    ws.getCell(headerRow, 4).value = valueHeader;
    styleHeaderRow(ws, headerRow, 4);

    let row = headerRow + 1;
    let alt = false;
    for (const [label, hours] of rows) {
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 4).value = hours;
      ws.getCell(row, 4).numFmt = HRS_FMT;
      styleDataRow(ws, row, 4, alt);
      alt = !alt;
      row++;
    }
    if (rows.length > 0) addDataBar(ws, `D${headerRow + 1}:D${row - 1}`, barColor);
    return row + 1; // next free row, with a blank separator
  }

  let r = 9;
  r = miniTable(r, "Top 10 Projects by Hours", "Hours",
    d.topProjects.map(([num, p]) => [`${num} — ${p.name}`, p.hours]), "FF1E3A8A");
  r = miniTable(r, "Top 10 Employees by Hours", "Hours",
    d.topEmployees.map(([, e]) => [`${e.name} (${e.department})`, e.hours]), "FF16A34A");
  miniTable(r, "Hours by Department", "Hours",
    [...d.deptHours].sort((a, b) => b[1] - a[1]), "FF7C3AED");

  return ws;
}
