// Senior staff who are not required to log timesheets - excluded from all
// utilization/compliance counting (Admin View summary, Utilization, Missing,
// and Executive reports). They still appear normally on the Employees admin
// page; this only affects reporting.
export const TIMESHEET_EXEMPT_IDS = new Set([
  "2962", "1215", "0584", "2623", "3486", "0260",
  "3033", "0248", "GES001", "0327", "GES003", "0353",
]);
