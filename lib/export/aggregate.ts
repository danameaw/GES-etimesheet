// Pure in-memory aggregation of TimesheetEntry rows into the trees the report
// sheets render. Kept independent of Prisma so it's easy to reason about/test.

export type EntryRow = {
  totalHrs: number;
  project: { projectNumber: string; projectName: string };
  taskCode: { code: string; name: string };
  timesheet: { employee: { employeeId: string; name: string; department: string } };
};

export type TaskAgg = { code: string; name: string; hours: number };
export type EmpInProj = { employeeId: string; name: string; department: string; hours: number; tasks: Map<string, TaskAgg> };
export type ProjAgg = { number: string; name: string; hours: number; employees: Map<string, EmpInProj> };

/** Project -> Employee -> Task */
export function buildProjectTree(entries: EntryRow[]): Map<string, ProjAgg> {
  const map = new Map<string, ProjAgg>();
  for (const e of entries) {
    if (e.totalHrs === 0) continue;
    const pKey = e.project.projectNumber;
    if (!map.has(pKey)) map.set(pKey, { number: pKey, name: e.project.projectName, hours: 0, employees: new Map() });
    const proj = map.get(pKey)!;
    proj.hours += e.totalHrs;

    const emp = e.timesheet.employee;
    if (!proj.employees.has(emp.employeeId)) {
      proj.employees.set(emp.employeeId, { employeeId: emp.employeeId, name: emp.name, department: emp.department, hours: 0, tasks: new Map() });
    }
    const empRow = proj.employees.get(emp.employeeId)!;
    empRow.hours += e.totalHrs;

    const tKey = e.taskCode.code;
    if (!empRow.tasks.has(tKey)) empRow.tasks.set(tKey, { code: tKey, name: e.taskCode.name, hours: 0 });
    empRow.tasks.get(tKey)!.hours += e.totalHrs;
  }
  return map;
}

export type ProjInEmp = { number: string; name: string; hours: number; tasks: Map<string, TaskAgg> };
export type EmpAgg = { employeeId: string; name: string; department: string; hours: number; projects: Map<string, ProjInEmp> };

/** Employee -> Project -> Task */
export function buildEmployeeTree(entries: EntryRow[]): Map<string, EmpAgg> {
  const map = new Map<string, EmpAgg>();
  for (const e of entries) {
    if (e.totalHrs === 0) continue;
    const emp = e.timesheet.employee;
    if (!map.has(emp.employeeId)) {
      map.set(emp.employeeId, { employeeId: emp.employeeId, name: emp.name, department: emp.department, hours: 0, projects: new Map() });
    }
    const empRow = map.get(emp.employeeId)!;
    empRow.hours += e.totalHrs;

    const pKey = e.project.projectNumber;
    if (!empRow.projects.has(pKey)) empRow.projects.set(pKey, { number: pKey, name: e.project.projectName, hours: 0, tasks: new Map() });
    const projRow = empRow.projects.get(pKey)!;
    projRow.hours += e.totalHrs;

    const tKey = e.taskCode.code;
    if (!projRow.tasks.has(tKey)) projRow.tasks.set(tKey, { code: tKey, name: e.taskCode.name, hours: 0 });
    projRow.tasks.get(tKey)!.hours += e.totalHrs;
  }
  return map;
}

export type ProjTaskRow = { code: string; name: string; hours: number; employees: Set<string> };
export type ProjTaskAgg = { name: string; hours: number; tasks: Map<string, ProjTaskRow> };

/** Project -> Task (with distinct engineer count per task), used by the "By Task" sheet. */
export function buildProjectTaskTree(entries: EntryRow[]): Map<string, ProjTaskAgg> {
  const map = new Map<string, ProjTaskAgg>();
  for (const e of entries) {
    if (e.totalHrs === 0) continue;
    const pKey = e.project.projectNumber;
    if (!map.has(pKey)) map.set(pKey, { name: e.project.projectName, hours: 0, tasks: new Map() });
    const proj = map.get(pKey)!;
    proj.hours += e.totalHrs;

    const tKey = e.taskCode.code;
    if (!proj.tasks.has(tKey)) proj.tasks.set(tKey, { code: tKey, name: e.taskCode.name, hours: 0, employees: new Set() });
    const task = proj.tasks.get(tKey)!;
    task.hours += e.totalHrs;
    task.employees.add(e.timesheet.employee.employeeId);
  }
  return map;
}

export function sortByHoursDesc<T extends { hours: number }>(map: Map<string, T>): [string, T][] {
  return Array.from(map.entries()).sort((a, b) => b[1].hours - a[1].hours);
}

export function departmentBreakdown(entries: EntryRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.totalHrs === 0) continue;
    const dept = e.timesheet.employee.department || "Other";
    map.set(dept, (map.get(dept) || 0) + e.totalHrs);
  }
  return map;
}
