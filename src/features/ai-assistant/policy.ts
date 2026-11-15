import { z } from "zod";

const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ role: z.literal("assistant"), content: z.string().trim().min(1).max(8000) }).strict(),
]);
export const chatSchema = z.object({ requestId: z.uuid().optional(), messages: z.array(messageSchema).min(1).max(12) }).strict().refine(({ messages }) => messages.at(-1)?.role === "user" && messages.reduce((n, m) => n + m.content.length, 0) <= 12000);
export const toolSchema = z.object({ start: z.iso.date(), end: z.iso.date(), venueId: z.uuid().nullable() }).strict().refine(({ start, end }) => start <= end && Date.parse(end) - Date.parse(start) <= 366 * 86400000);
export const toolNames = ["operations", "financial_summary", "receivables", "venue_closings"] as const;
export type ToolName = typeof toolNames[number];
export function allowedTool(role: string, name: string): name is ToolName {
  return (role === "owner" && (toolNames as readonly string[]).includes(name)) || (role === "manager" && name === "operations");
}
export const suggestions = ["אילו אירועים יש השבוע?", "מי משובץ לאירוע הבא?"];
export const ownerSuggestions = ["כמה כסף נשאר לגבות מכל אולם?", "כמה הרווחנו החודש?", "כמה שילמנו משכורות החודש?", "איזה אולם הכי רווחי?", "מה יתרת אפטאון אחרי סגירות ההתחשבנות?"];
