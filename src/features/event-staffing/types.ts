export const EVENT_ROLES = ["bartender", "manager"] as const;
export const PAY_TYPES = ["hourly", "fixed"] as const;
export type EventRole = (typeof EVENT_ROLES)[number];
export type PayType = (typeof PAY_TYPES)[number];

export type EventAssignment = {
  id: string;
  eventId: string;
  employeeId: string;
  employeeName: string;
  employeePhone: string;
  eventRole: EventRole;
  payType: PayType;
  hourlyRate: number | null;
  fixedPay: number | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AssignmentFormValues = {
  employeeId: string;
  eventRole: EventRole;
  payType: PayType;
  hourlyRate: number | null;
  fixedPay: number | null;
  workStart: string;
  workEnd: string;
  notes: string;
};
