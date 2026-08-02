import { getAssignmentSalary, getWorkedMinutes } from "@/features/event-staffing/calculations";
import type { EventAssignment } from "@/features/event-staffing/types";
import type { EmployeePayroll, MonthlyPayroll, PayrollAssignment } from "../types";

export function buildMonthlyPayroll(month: string, assignments: Omit<PayrollAssignment, "salary" | "workedMinutes">[]): MonthlyPayroll {
  const calculated = assignments.map((assignment) => {
    const salarySource: EventAssignment = { ...assignment, eventId: assignment.eventId, employeePhone: "", notes: "", createdAt: "", updatedAt: "" };
    return { ...assignment, workedMinutes: getWorkedMinutes(assignment.workStart, assignment.workEnd), salary: getAssignmentSalary(salarySource) };
  });
  const groups = new Map<string, PayrollAssignment[]>();
  calculated.forEach((assignment) => groups.set(assignment.employeeId, [...(groups.get(assignment.employeeId) ?? []), assignment]));
  const employees: EmployeePayroll[] = [...groups.entries()].map(([employeeId, rows]) => {
    const hourlyRows = rows.filter((row) => row.payType === "hourly");
    const fixedRows = rows.filter((row) => row.payType === "fixed");
    return { employeeId, fullName: rows[0].employeeName, assignments: rows, eventCount: new Set(rows.map((row) => row.eventId)).size, workedMinutes: rows.reduce((sum, row) => sum + (row.workedMinutes ?? 0), 0), hourlyTotal: hourlyRows.reduce((sum, row) => sum + (row.salary ?? 0), 0), fixedTotal: fixedRows.reduce((sum, row) => sum + (row.salary ?? 0), 0), totalSalary: rows.reduce((sum, row) => sum + (row.salary ?? 0), 0), missingHoursCount: hourlyRows.filter((row) => !row.workStart || !row.workEnd).length, hasCalculatedSalary: rows.some((row) => row.salary !== null) };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));
  return { month, employees, totalAmount: employees.reduce((sum, employee) => sum + employee.totalSalary, 0), calculatedEmployeeCount: employees.filter((employee) => employee.hasCalculatedSalary).length, missingHoursCount: employees.reduce((sum, employee) => sum + employee.missingHoursCount, 0) };
}

export function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const next = new Date(year, monthNumber, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}
