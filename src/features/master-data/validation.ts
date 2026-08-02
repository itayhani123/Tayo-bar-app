import { z } from "zod";

export const masterDataSchema = z.object({ name: z.string().trim().min(1, "Name is required.").max(120, "Name must be 120 characters or fewer.") });
