import ExcelJS from "exceljs";

// GES brand palette (matches Tailwind classes used across the app: blue-900 primary, status colors)
export const COLORS = {
  primary: "FF1E3A8A",     // blue-900 — title band / table headers
  primarySoft: "FFDCE7F7", // light blue — group/section header rows
  bandAlt: "FFF8FAFC",     // near-white gray — alternating data rows
  subtotal: "FFEFF2F6",    // subtotal / total rows
  border: "FFD9E2EC",
  headerText: "FFFFFFFF",
  textDark: "FF1E293B",
  textMuted: "FF64748B",
  success: "FF16A34A",
  successBg: "FFDCFCE7",
  warning: "FFB45309",
  warningBg: "FFFEF3C7",
  danger: "FFB91C1C",
  dangerBg: "FFFEE2E2",
};

export function thinBorder(): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
}

/** Two-row banner: bold title on a colored band + a muted subtitle line below it. */
export function addTitleBand(ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) {
  ws.mergeCells(1, 1, 1, Math.max(colCount, 1));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { size: 15, bold: true, color: { argb: COLORS.headerText } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 28;
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primary } };
  }

  ws.mergeCells(2, 1, 2, Math.max(colCount, 1));
  const subCell = ws.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { size: 10, italic: true, color: { argb: COLORS.textMuted } };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(2).height = 18;
}

/** Styles an existing row (already populated with values) as a table header row. */
export function styleHeaderRow(ws: ExcelJS.Worksheet, rowNum: number, colCount: number) {
  const row = ws.getRow(rowNum);
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primary } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  }
}

/** Light banding + borders for a plain data row. */
export function styleDataRow(ws: ExcelJS.Worksheet, rowNum: number, colCount: number, altShade: boolean) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = thinBorder();
    cell.font = { size: 10, color: { argb: COLORS.textDark } };
    if (altShade) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
  }
}

/** Bold section/group header row (e.g. a project or employee name row) with a soft blue fill. */
export function styleGroupRow(ws: ExcelJS.Worksheet, rowNum: number, colCount: number) {
  const row = ws.getRow(rowNum);
  row.height = 19;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10.5, color: { argb: COLORS.textDark } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primarySoft } };
    cell.border = thinBorder();
  }
}

/** Bold subtotal/total row with a light gray fill and a heavier top border. */
export function styleSubtotalRow(ws: ExcelJS.Worksheet, rowNum: number, colCount: number) {
  const row = ws.getRow(rowNum);
  const topSide = { style: "medium" as const, color: { argb: COLORS.primary } };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: COLORS.textDark } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.subtotal } };
    cell.border = { ...thinBorder(), top: topSide };
  }
}

/** Native Excel data-bar conditional formatting on a numeric column range, e.g. "F5:F20". */
export function addDataBar(ws: ExcelJS.Worksheet, ref: string, color = "FF3B82F6") {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "dataBar",
        priority: 1,
        gradient: true,
        border: false,
        showValue: true,
        minLength: 0,
        maxLength: 100,
        cfvo: [{ type: "min" }, { type: "max" }],
        color: { argb: color },
      } as any,
    ],
  });
}

/** Native Excel 3-color scale (red → yellow → green), for percentages like utilization. */
export function addColorScale(ws: ExcelJS.Worksheet, ref: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "colorScale",
        priority: 1,
        cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
        color: [{ argb: "FFF87171" }, { argb: "FFFDE68A" }, { argb: "FF86EFAC" }],
      } as any,
    ],
  });
}

/** Fills a single cell as a colored status pill (approved/submitted=green, draft=yellow, missing=red). */
export function styleStatusCell(cell: ExcelJS.Cell, status: string) {
  const s = status.toLowerCase();
  const isGood = s === "approved" || s === "submitted";
  const isBad = s === "missing";
  const bg = isGood ? COLORS.successBg : isBad ? COLORS.dangerBg : COLORS.warningBg;
  const fg = isGood ? COLORS.success : isBad ? COLORS.danger : COLORS.warning;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.font = { bold: true, size: 10, color: { argb: fg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

/** A single KPI tile: a merged label cell above a merged big-number value cell. */
export function addKpiTile(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  width: number,
  label: string,
  value: string | number,
  accent = COLORS.primary
) {
  ws.mergeCells(row, col, row, col + width - 1);
  const labelCell = ws.getCell(row, col);
  labelCell.value = label;
  labelCell.font = { size: 9, bold: true, color: { argb: COLORS.textMuted } };
  labelCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
  ws.getRow(row).height = 16;

  ws.mergeCells(row + 1, col, row + 1, col + width - 1);
  const valueCell = ws.getCell(row + 1, col);
  valueCell.value = value;
  valueCell.font = { size: 18, bold: true, color: { argb: accent } };
  valueCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.bandAlt } };
  ws.getRow(row + 1).height = 30;

  for (let r = row; r <= row + 1; r++) {
    for (let c = col; c < col + width; c++) {
      ws.getCell(r, c).border = { left: { style: "thin", color: { argb: COLORS.border } } };
    }
  }
  // Left accent bar
  ws.getCell(row, col).border = { ...ws.getCell(row, col).border, left: { style: "thick", color: { argb: accent } } };
  ws.getCell(row + 1, col).border = { ...ws.getCell(row + 1, col).border, left: { style: "thick", color: { argb: accent } } };
}

export function setWorkbookMeta(wb: ExcelJS.Workbook) {
  wb.creator = "GES E-Timesheet";
  wb.lastModifiedBy = "GES E-Timesheet";
  wb.created = new Date();
}
