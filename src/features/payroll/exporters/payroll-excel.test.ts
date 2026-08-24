import test from "node:test";
import assert from "node:assert/strict";
import type { EmployeePayroll, PayrollAssignment } from "../types.ts";
import { createPayrollWorkbook, employeeHourlyRate } from "./payroll-excel.ts";

function assignment(id: string, employeeId: string, employeeName: string, payType: "hourly" | "fixed", hourlyRate: number | null, fixedPay: number | null, salary: number, workedMinutes: number): PayrollAssignment {
  return { id, employeeId, employeeName, eventId: `event-${id}`, eventDate: "2026-08-10", venueName: "קסנאדו", eventType: "Wedding", eventRole: "bartender", payType, hourlyRate, fixedPay, workStart: "2026-08-10T15:30:00.000Z", workEnd: "2026-08-10T22:30:00.000Z", salary, workedMinutes };
}
const hourlyRows = [assignment("1", "1", "עובד אחיד", "hourly", 50, null, 375, 450), assignment("2", "1", "עובד אחיד", "hourly", 50, null, 350, 420)];
const mixedRows = [assignment("3", "2", "עובד משתנה", "hourly", 50, null, 350, 420), assignment("4", "2", "עובד משתנה", "hourly", 60, null, 420, 420), assignment("5", "2", "עובד משתנה", "fixed", null, 300, 300, 0)];
const fixedRows = [assignment("6", "3", "עובד קבוע", "fixed", null, 500, 500, 0)];
const employees: EmployeePayroll[] = [
  { employeeId: "1", fullName: "עובד אחיד", assignments: hourlyRows, eventCount: 2, workedMinutes: 870, hourlyTotal: 725, fixedTotal: 0, totalSalary: 725, missingHoursCount: 0, hasCalculatedSalary: true },
  { employeeId: "2", fullName: "עובד משתנה", assignments: mixedRows, eventCount: 3, workedMinutes: 840, hourlyTotal: 770, fixedTotal: 300, totalSalary: 1070, missingHoursCount: 0, hasCalculatedSalary: true },
  { employeeId: "3", fullName: "עובד קבוע", assignments: fixedRows, eventCount: 1, workedMinutes: 0, hourlyTotal: 0, fixedTotal: 500, totalSalary: 500, missingHoursCount: 0, hasCalculatedSalary: true },
];

test("uses assignment hourly rates without averaging or deriving", () => {
  assert.equal(employeeHourlyRate(employees[0]), 50);
  assert.equal(employeeHourlyRate(employees[1]), "משתנה");
  assert.equal(employeeHourlyRate(employees[2]), "");
});

test("exports summary and exact shift details without changing payroll totals", () => {
  const workbook = createPayrollWorkbook("2026-08", employees);
  assert.deepEqual(workbook.SheetNames, ["ריכוז משכורות", "פירוט משמרות"]);
  const summary = workbook.Sheets["ריכוז משכורות"];
  assert.equal(summary.D5.v, 50);
  assert.equal(summary.D6.v, "משתנה");
  assert.equal(summary.D7.v, "");
  assert.equal(summary.F8.v, 2295);
  assert.equal(summary.F8.t, "n");
  const details = workbook.Sheets["פירוט משמרות"];
  assert.equal(details.I2.v, 50);
  assert.equal(details.K2.v, 375);
  assert.equal(details.G2.v, 7.5);
});
