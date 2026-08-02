import { z } from "zod";

export const masterDataSchema = z.object({ name: z.string().trim().min(1, "יש להזין שם.").max(120, "השם מוגבל ל־120 תווים.") });
