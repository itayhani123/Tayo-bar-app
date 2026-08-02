import { z } from "zod";
export const taxAdvanceSchema = z.object({ rate: z.number().min(0, "השיעור חייב להיות אפס או יותר.").max(100, "השיעור אינו תקין.") });
