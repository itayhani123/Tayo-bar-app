import { z } from "zod";

export const eventPaymentSchema = z.object({
  amount: z.number({ error: "יש להזין סכום תקין" }).finite("יש להזין סכום תקין").positive("הסכום חייב להיות גדול מאפס"),
  paymentMethod: z.string().trim().min(1, "יש לבחור אמצעי תשלום"),
  payerType: z.enum(["client", "venue"], { error: "יש לבחור מי שילם" }),
  paidAt: z.string().min(1, "תאריך תשלום הוא שדה חובה").refine((value) => !Number.isNaN(Date.parse(value)), "תאריך התשלום אינו תקין"),
  notes: z.string().max(2000, "ההערות ארוכות מדי"),
});

export function eventPaymentSchemaFor(paymentMethods: string[], historicalValue?: string) { const allowed = new Set([...paymentMethods, ...(historicalValue ? [historicalValue] : [])]); return eventPaymentSchema.refine((values) => allowed.has(values.paymentMethod), { path: ["paymentMethod"], message: "יש לבחור אמצעי תשלום מהרשימה" }); }
