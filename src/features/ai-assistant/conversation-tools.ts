import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { actionAllowed, actionRegistry, type ActionName } from "./action-registry";
import type { ConversationState } from "./conversation-types";
import { ProposalError } from "./action-proposals";
import { payerLabels } from "@/lib/hebrew";

export const actionNames = Object.keys(actionRegistry) as [ActionName, ...ActionName[]];
const hintFields = { eventQuery: z.string().trim().min(1).max(160), employeeQuery: z.string().trim().min(1).max(160), venueQuery: z.string().trim().min(1).max(160), targetDate: z.iso.date(), eventId: z.uuid(), employeeId: z.uuid() };
const fields = [...new Set([...actionNames.flatMap(name => Object.keys(actionRegistry[name].schema.shape)), ...Object.keys(hintFields)])] as [string, ...string[]];
const numberFields = ["guestCount", "pricePerGuest", "vatRate", "estimatedAlcoholCost", "hourlyRate", "fixedPay", "amount"] as const;
const booleanFields = ["priceIncludesVat", "includesHallFee"] as const;
const dateFields = ["eventDate", "targetDate", "paidAt", "cutoffDate"] as const;
const idFields = ["eventId", "venueId", "employeeId", "assignmentId", "paymentId"] as const;
const typed = new Set<string>([...numberFields, ...booleanFields, ...dateFields, ...idFields]);
const stringFields = fields.filter(field => !typed.has(field)) as [string, ...string[]];
// Field-specific argument types prevent the model from serializing guestCount as "250"
// or dates as free-form text. Business ranges/enums are revalidated by the action schema.
const updateSchema = z.union([
  z.object({ field: z.enum(numberFields), value: z.number().finite().nullable() }).strict(),
  z.object({ field: z.enum(booleanFields), value: z.boolean().nullable() }).strict(),
  z.object({ field: z.enum(dateFields), value: z.iso.date().nullable() }).strict(),
  z.object({ field: z.enum(idFields), value: z.uuid().nullable() }).strict(),
  z.object({ field: z.enum(stringFields), value: z.string().max(5000).nullable() }).strict(),
]);
export const collectSchema = z.object({ action: z.enum(actionNames), reset: z.boolean(), updates: z.array(updateSchema).max(30) }).strict();
export const askSchema = z.object({ question: z.string().trim().min(1).max(600), field: z.enum(fields).nullable(), choices: z.array(z.object({ kind: z.string().max(30), id: z.uuid() }).strict()).max(12) }).strict();
export const understandSchema = z.object({ mode: z.enum(["action", "read", "clarify", "cancel_draft"]), action: z.enum(actionNames).nullable(), reset: z.boolean(), updates: collectSchema.shape.updates }).strict();
function tool(name: string, description: string, schema: z.ZodType): FunctionTool {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(schema, { target: "draft-7" }); void _schema;
  return { type: "function", name, description, strict: true, parameters };
}
export const conversationTools = [
  tool("understand_request", "REQUIRED first step for each user message: understand free-form Hebrew in conversation context and preserve ALL newly supplied facts. mode=action for creation/edits/staffing/payment/closing, even when incomplete; action identifies the intent and updates contain known user facts plus search hints (eventQuery, employeeQuery, venueQuery, targetDate). mode=read for questions only, clarify when intent is unclear, cancel_draft only for stopping an UNEXECUTED draft. Never use cancellation as deletion of an existing event/payment. For continuation/correction use reset=false; reset=true only for a new request. No execution or authorization is performed. Missing information is NOT a failure to understand: save known facts and let the server identify the missing fields.", understandSchema),
  tool("collect_action", "Start/update a partial action draft. Works with ANY subset of known fields, including search hints BEFORE IDs are known: eventQuery=customer/event name, employeeQuery=employee name, venueQuery=venue name, targetDate=date used to FIND an existing event. eventDate means the date of a NEW event or an explicit date CHANGE, not a search date. Server resolves unique hints and returns real choices for ambiguity. Updates contain only user facts or resolved IDs. Missing fields are returned; a complete draft prepares a real card, never executes. Null removes a field. reset=false preserves facts/corrects; reset=true only for a new request. Default assignment pay/role follows existing workflow; never invent financial terms.", collectSchema),
  tool("ask_user", "Ask one concise Hebrew follow-up question about missing/ambiguous details. Optional choices MUST reference real IDs and kinds from action_lookup in this conversation; labels are resolved on the server. field is the field being selected or null. Use choices for ambiguous events/employees and when picking a venue or package. This ends data gathering for this turn; wait for the user's next reply.", askSchema),
  tool("cancel_draft", "Discard the current draft and invalidate its pending confirmation cards. No business records change. Use when user cancels/stops an unexecuted request, never to cancel/delete an existing event.", z.object({}).strict()),
];
export const fieldLabels: Record<string, string> = { venueId: "אולם", guestCount: "מספר אורחים", eventType: "סוג אירוע", packageType: "חבילת בר", startTime: "שעת התחלה", clientName: "שם הלקוח", eventDate: "תאריך האירוע", pricePerGuest: "מחיר לאורח", vatRate: "שיעור מע״מ", priceIncludesVat: "האם המחיר כולל מע״מ", payerType: "מי משלם", estimatedAlcoholCost: "עלות אלכוהול משוערת", eventId: "האירוע", employeeId: "העובד", assignmentId: "השיבוץ", paymentId: "התשלום לעדכון", amount: "סכום התשלום", paymentMethod: "אמצעי תשלום", paidAt: "תאריך התשלום", cutoffDate: "תאריך החיתוך", includesHallFee: "האם לכלול עמלות אולם" };
const order = ["venueId", "guestCount", "eventType", "packageType", "startTime", "clientName", "eventDate", "eventId", "employeeId", "assignmentId", "paymentId", "amount", "paymentMethod", "paidAt", "pricePerGuest", "vatRate", "priceIncludesVat", "payerType", "cutoffDate", "includesHallFee"];
const moneyFields = new Set(["pricePerGuest", "vatRate", "priceIncludesVat", "payerType", "estimatedAlcoholCost", "payType", "hourlyRate", "fixedPay", "amount", "paymentMethod", "paidAt"]);

export function collectDraft(state: ConversationState, role: string, raw: unknown) {
  const args = collectSchema.parse(raw);
  if (!actionAllowed(role, args.action)) throw new ProposalError("אין לך הרשאה לפעולה כספית זו");
  const shape: Record<string, z.ZodType> = actionRegistry[args.action].schema.shape;
  const values = !args.reset && state.draft?.action === args.action ? { ...state.draft.values } : {};
  for (const rawUpdate of args.updates) {
    const update = { ...rawUpdate, field: rawUpdate.field === "eventDate" && !Object.hasOwn(shape, "eventDate") ? "targetDate" : rawUpdate.field };
    const validator = shape[update.field] ?? (hintFields as Record<string, z.ZodType>)[update.field];
    if (!validator) throw new ProposalError(`השדה ${update.field} אינו מתאים לפעולה המבוקשת`);
    if (values[update.field] !== update.value) {
      const resolvedField: Record<string, string> = { eventQuery: "eventId", targetDate: "eventId", employeeQuery: "employeeId", venueQuery: "venueId" };
      if (resolvedField[update.field]) delete values[resolvedField[update.field]];
    }
    if (role !== "owner" && moneyFields.has(update.field) && update.value !== null) throw new ProposalError("מנהלים אינם רשאים למסור או לשנות פרטים כספיים");
    if (update.value === null) delete values[update.field];
    else {
      let value = update.value;
      const aliases: Record<string, Record<string, string>> = { payerType: payerLabels, eventRole: { bartender: "ברמן", manager: "מנהל אירוע" }, payType: { hourly: "שעתי", fixed: "גלובלי" } };
      if (typeof value === "string" && aliases[update.field]) value = Object.entries(aliases[update.field]).find(([, label]) => label === value)?.[0] ?? value;
      if (["priceIncludesVat", "includesHallFee"].includes(update.field) && typeof value === "string" && ["כן", "לא"].includes(value)) value = value === "כן";
      const parsed = validator.safeParse(value);
      if (!parsed.success) throw new z.ZodError(parsed.error.issues.map(issue => ({ ...issue, path: [update.field, ...issue.path] })));
      values[update.field] = parsed.data as string | number | boolean;
    }
  }
  const complete = Object.fromEntries(Object.keys(shape).map(key => [key, values[key] ?? null]));
  if (args.action === "propose_record_payment" && complete.notes === null) complete.notes = "";
  const missing = Object.keys(shape).filter(key => !shape[key].safeParse(complete[key]).success);
  if (args.action === "propose_create_event" && role === "owner") for (const key of ["pricePerGuest", "vatRate", "priceIncludesVat", "payerType"]) if (complete[key] === null) missing.push(key);
  if (args.action === "propose_update_event" && !Object.keys(values).some(key => key !== "eventId" && Object.hasOwn(shape, key))) missing.push("changes");
  if (args.action === "propose_update_assignment" && !Object.keys(values).some(key => key !== "assignmentId" && Object.hasOwn(shape, key))) missing.push("changes");
  const unique = [...new Set(missing)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { action: args.action, reset: args.reset, values, complete, missing: unique.map(field => ({ field, label: fieldLabels[field] ?? "הפרטים שיש לשנות" })) };
}

export function israelCalendar(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Array.from({ length: 15 }, (_, offset) => {
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
    return { offset, date: date.toISOString().slice(0, 10), day: new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long" }).format(date) };
  });
}
