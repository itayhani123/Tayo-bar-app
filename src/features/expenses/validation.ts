import { z } from "zod";
export const expenseSchema = z.object({
  expenseDate: z.iso.date("יש להזין תאריך תקין"), category: z.string().trim().min(1,"קטגוריה היא שדה חובה"), supplierName: z.string(), description: z.string(),
  amount: z.number().positive("הסכום חייב להיות גדול מאפס"), includesVat: z.boolean(), vatRate: z.number().min(0,"שיעור המע״מ אינו תקין"), paymentMethod: z.string(), referenceNumber: z.string(), eventId: z.string(), notes: z.string(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;
