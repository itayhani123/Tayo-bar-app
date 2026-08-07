import { createHash } from "node:crypto";
export const notificationDedupeKey = (source: string) => createHash("sha256").update(source).digest("hex");
