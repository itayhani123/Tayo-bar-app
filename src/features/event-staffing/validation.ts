import { z } from "zod";
import { EVENT_ROLES, PAY_TYPES } from "./types";

const optionalTime = z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, "יש להזין שעה תקינה.");

export const assignmentSchema = z.object({
  employeeId: z.string().uuid("יש לבחור עובד."),
  eventRole: z.enum(EVENT_ROLES),
  payType: z.enum(PAY_TYPES),
  hourlyRate: z.number().min(0, "השכר השעתי חייב להיות אפס או יותר.").nullable(),
  fixedPay: z.number().min(0, "התשלום הגלובלי חייב להיות אפס או יותר.").nullable(),
  workStart: optionalTime,
  workEnd: optionalTime,
  notes: z.string().max(2000, "ההערות מוגבלות ל־2,000 תווים."),
}).superRefine((values, context) => {
  if (values.payType === "hourly" && values.hourlyRate === null) context.addIssue({ code: "custom", path: ["hourlyRate"], message: "יש להזין שכר שעתי." });
  if (values.payType === "fixed" && values.fixedPay === null) context.addIssue({ code: "custom", path: ["fixedPay"], message: "יש להזין תשלום גלובלי." });
});
