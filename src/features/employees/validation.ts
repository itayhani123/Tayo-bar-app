import { z } from "zod";

export const employeeSchema = z.object({
  fullName: z.string().trim().min(1, "יש להזין שם מלא.").max(160, "השם מוגבל ל־160 תווים."),
  phone: z.string().trim().max(40, "מספר הטלפון ארוך מדי."),
  defaultHourlyRate: z.number().min(0, "השכר השעתי חייב להיות אפס או יותר."),
  active: z.boolean(),
  notes: z.string().max(5000, "ההערות מוגבלות ל־5,000 תווים."),
});
