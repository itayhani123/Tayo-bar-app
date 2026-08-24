import * as XLSX from "xlsx";
import type { EmployeePayroll, PayrollAssignment } from "../types";

const SUMMARY_HEADER_ROW = 4;
const MONEY_FORMAT = '[$₪-he-IL]#,##0.00';
const HOURS_FORMAT = "0.00";
export const payrollExportColumns = ["שם עובד", "מספר אירועים", "סה\"כ שעות", "שכר שעתי", "שכר קבוע", "סה\"כ לתשלום"] as const;
export const shiftExportColumns = ["תאריך", "עובד", "אירוע", "אולם", "שעת התחלה", "שעת סיום", "סה\"כ שעות", "סוג שכר", "שכר שעתי", "שכר קבוע", "סה\"כ למשמרת"] as const;

export function employeeHourlyRate(employee: EmployeePayroll): number | "משתנה" | "" {
  const rates = [...new Set(employee.assignments.filter((assignment) => assignment.payType === "hourly" && assignment.hourlyRate !== null).map((assignment) => assignment.hourlyRate as number))];
  if (!rates.length) return "";
  return rates.length === 1 ? rates[0] : "משתנה";
}

export function createPayrollWorkbook(month: string, employees: EmployeePayroll[]): XLSX.WorkBook {
  const totals = employees.reduce((sum, employee) => ({ events: sum.events + employee.eventCount, hours: sum.hours + employee.workedMinutes / 60, fixed: sum.fixed + employee.fixedTotal, salary: sum.salary + employee.totalSalary }), { events: 0, hours: 0, fixed: 0, salary: 0 });
  const summaryRows: (string | number)[][] = [
    ["ריכוז משכורות"], [`חודש: ${month}`], [], [...payrollExportColumns],
    ...employees.map((employee) => [employee.fullName, employee.eventCount, employee.workedMinutes / 60, employeeHourlyRate(employee), employee.fixedTotal, employee.totalSalary]),
    ["סה\"כ משכורות", totals.events, totals.hours, "", totals.fixed, totals.salary],
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary["!views"] = [{ RTL: true }];
  summary["!freeze"] = { xSplit: 0, ySplit: SUMMARY_HEADER_ROW, topLeftCell: `A${SUMMARY_HEADER_ROW + 1}`, activePane: "bottomLeft", state: "frozen" };
  summary["!autofilter"] = { ref: `A${SUMMARY_HEADER_ROW}:F${SUMMARY_HEADER_ROW + employees.length}` };
  summary["!cols"] = [{ wch: 28 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
  makeBold(summary.A1); makeBold(summary.A2);
  for (let column = 0; column < payrollExportColumns.length; column += 1) makeBold(summary[XLSX.utils.encode_cell({ r: SUMMARY_HEADER_ROW - 1, c: column })]);
  for (let index = 0; index < employees.length; index += 1) {
    const row = SUMMARY_HEADER_ROW + 1 + index;
    setFormat(summary[`C${row}`], HOURS_FORMAT);
    if (typeof employeeHourlyRate(employees[index]) === "number") setFormat(summary[`D${row}`], MONEY_FORMAT);
    for (const column of ["E", "F"]) setFormat(summary[`${column}${row}`], MONEY_FORMAT);
  }
  const totalRow = SUMMARY_HEADER_ROW + employees.length + 1;
  for (const column of ["A", "B", "C", "D", "E", "F"]) makeBold(summary[`${column}${totalRow}`]);
  setFormat(summary[`C${totalRow}`], HOURS_FORMAT); setFormat(summary[`E${totalRow}`], MONEY_FORMAT); setFormat(summary[`F${totalRow}`], MONEY_FORMAT);

  const assignments = employees.flatMap((employee) => employee.assignments).sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.employeeName.localeCompare(right.employeeName, "he"));
  const details = XLSX.utils.aoa_to_sheet([
    [...shiftExportColumns],
    ...assignments.map(assignmentRow),
  ], { cellDates: true, dateNF: "dd/mm/yyyy" });
  details["!views"] = [{ RTL: true }];
  details["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  details["!autofilter"] = { ref: `A1:K${Math.max(1, assignments.length + 1)}` };
  details["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
  for (let column = 0; column < shiftExportColumns.length; column += 1) makeBold(details[XLSX.utils.encode_cell({ r: 0, c: column })]);
  for (let index = 0; index < assignments.length; index += 1) {
    const row = index + 2;
    setFormat(details[`G${row}`], HOURS_FORMAT);
    for (const column of ["I", "J", "K"]) setFormat(details[`${column}${row}`], MONEY_FORMAT);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, "ריכוז משכורות");
  XLSX.utils.book_append_sheet(workbook, details, "פירוט משמרות");
  return workbook;
}

export function exportPayrollWorkbook(month: string, employees: EmployeePayroll[]) {
  if (!employees.length) return false;
  XLSX.writeFile(createPayrollWorkbook(month, employees), `ריכוז_משכורות_${month}.xlsx`, { cellDates: true, cellStyles: true });
  return true;
}

function assignmentRow(assignment: PayrollAssignment): (string | number | Date)[] {
  return [excelDate(assignment.eventDate), assignment.employeeName, assignment.eventType, assignment.venueName, formatTime(assignment.workStart), formatTime(assignment.workEnd), assignment.workedMinutes === null ? "" : assignment.workedMinutes / 60, assignment.payType === "hourly" ? "שעתי" : "קבוע", assignment.payType === "hourly" ? assignment.hourlyRate ?? "" : "", assignment.payType === "fixed" ? assignment.fixedPay ?? "" : "", assignment.salary ?? ""];
}
function formatTime(value: string | null) { return value ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : ""; }
function excelDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function setFormat(cell: XLSX.CellObject | undefined, format: string) { if (cell) cell.z = format; }
function makeBold(cell: XLSX.CellObject | undefined) { if (cell) cell.s = { ...cell.s, font: { ...cell.s?.font, bold: true } }; }
