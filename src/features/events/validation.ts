import { z } from "zod";
import { PAYER_TYPES, PAYMENT_STATUSES } from "./types";

export const eventSchema = z.object({
  eventDate: z.string().min(1, "יש להזין תאריך."),
  startTime: z.string().min(1, "יש להזין שעה."),
  venueId: z.string().uuid("יש לבחור אולם."),
  clientName: z.string().trim().min(1, "יש להזין שם איש קשר.").max(160, "שם איש הקשר ארוך מדי."),
  clientPhone: z.string().trim().max(40),
  guestCount: z.number().int().positive("מספר האורחים חייב להיות לפחות 1."),
  eventType: z.string().min(1, "יש לבחור סוג אירוע."),
  packageType: z.string().min(1, "יש לבחור חבילת בר."),
  pricePerGuest: z.number().min(0, "המחיר לאורח לא יכול להיות שלילי."),
  payerType: z.enum(PAYER_TYPES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  estimatedAlcoholCost: z.number().min(0, "עלות האלכוהול לא יכולה להיות שלילית."),
  securityCheckReceived: z.boolean(),
  invoiceIssued: z.boolean(),
  managerEmployeeId: z.string().uuid("מזהה המנהל חייב להיות UUID תקין.").or(z.literal("")),
  notes: z.string().max(5000, "ההערות מוגבלות ל־5,000 תווים."),
});
