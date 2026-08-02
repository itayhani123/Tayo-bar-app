import type { EventRole, PayType } from "@/features/event-staffing/types";

export type PayrollAssignment = {
  id: string;
  employeeId: string;
  employeeName: string;
  eventId: string;
  eventDate: string;
  venueName: string;
  eventType: string;
  eventRole: EventRole;
  payType: PayType;
  hourlyRate: number | null;
  fixedPay: number | null;
  workStart: string | null;
  workEnd: string | null;
  salary: number | null;
  workedMinutes: number | null;
};

export type EmployeePayroll = {
  employeeId: string;
  fullName: string;
  assignments: PayrollAssignment[];
  eventCount: number;
  workedMinutes: number;
  hourlyTotal: number;
  fixedTotal: number;
  totalSalary: number;
  missingHoursCount: number;
  hasCalculatedSalary: boolean;
};

export type MonthlyPayroll = {
  month: string;
  employees: EmployeePayroll[];
  totalAmount: number;
  calculatedEmployeeCount: number;
  missingHoursCount: number;
};
