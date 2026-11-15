import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";

const text = z.string().trim().min(1).max(160);
const money = z.number().finite().min(0).max(99999999.99);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const eventFields = {
  eventDate: z.iso.date().nullable(), startTime: time.nullable(), venueId: z.uuid().nullable(), clientName: text.nullable(),
  guestCount: z.number().int().min(1).max(100000).nullable(), eventType: text.nullable(), packageType: text.nullable(), notes: z.string().max(5000).nullable(),
  pricePerGuest: money.nullable(), vatRate: z.number().min(0).max(100).nullable(), priceIncludesVat: z.boolean().nullable(), payerType: z.enum(["client", "venue"]).nullable(), estimatedAlcoholCost: money.nullable(),
};
const assignmentFields = { eventRole: z.enum(["bartender", "manager"]).nullable(), workStart: z.union([time, z.literal("")]).nullable(), workEnd: z.union([time, z.literal("")]).nullable(), notes: z.string().max(2000).nullable(), payType: z.enum(["hourly", "fixed"]).nullable(), hourlyRate: money.nullable(), fixedPay: money.nullable() };
const paymentFields = { amount: money.positive(), paymentMethod: text, payerType: z.enum(["client", "venue"]), paidAt: z.iso.date(), notes: z.string().max(2000) };

// These tools can ONLY prepare a server-stored proposal. No execution tool is exposed to the model.
export const actionRegistry = {
  propose_create_event: { title: "יצירת אירוע", permission: "operational", schema: z.object({ ...eventFields, eventDate: z.iso.date(), startTime: time, venueId: z.uuid(), clientName: text, guestCount: z.number().int().min(1).max(100000), eventType: text, packageType: text }).strict() },
  propose_update_event: { title: "עדכון אירוע", permission: "operational", schema: z.object({ eventId: z.uuid(), ...eventFields }).strict() },
  propose_assign_employee: { title: "שיבוץ עובד לאירוע", permission: "operational", schema: z.object({ eventId: z.uuid(), employeeId: z.uuid(), ...assignmentFields }).strict() },
  propose_update_assignment: { title: "עדכון שיבוץ", permission: "operational", schema: z.object({ assignmentId: z.uuid(), ...assignmentFields }).strict() },
  propose_remove_assignment: { title: "הסרת שיבוץ", permission: "operational", schema: z.object({ assignmentId: z.uuid() }).strict() },
  propose_record_payment: { title: "רישום תשלום לאירוע", permission: "financial", schema: z.object({ eventId: z.uuid(), ...paymentFields }).strict() },
  propose_update_payment: { title: "עדכון תשלום", permission: "financial", schema: z.object({ paymentId: z.uuid(), ...paymentFields, notes: paymentFields.notes.nullable() }).strict() },
  propose_close_venue: { title: "סגירת התחשבנות אולם", permission: "financial", schema: z.object({ venueId: z.uuid(), cutoffDate: z.iso.date(), includesHallFee: z.boolean() }).strict() },
} as const;
export type ActionName = keyof typeof actionRegistry;
export function isActionName(name: string): name is ActionName { return Object.hasOwn(actionRegistry, name); }
export function actionAllowed(role: string, name: string) { return isActionName(name) && (role === "owner" || (role === "manager" && actionRegistry[name].permission === "operational")); }
export function actionTools(role: string): FunctionTool[] {
  return (Object.keys(actionRegistry) as ActionName[]).filter(name => actionAllowed(role, name)).map(name => {
    const { $schema: _schema, ...parameters } = z.toJSONSchema(actionRegistry[name].schema, { target: "draft-7" });
    void _schema;
    return { type: "function", name, strict: true, description: `${actionRegistry[name].title}. Prepare ONLY; requires user click on confirmation card, never executes. Resolve exact IDs with action_lookup. Null fields mean unchanged/default; never guess missing essential facts. Managers cannot specify monetary/pay fields. Cancellation of events and deletion of payments are unsupported.`, parameters };
  });
}

export const lookupSchema = z.object({ kind: z.enum(["events", "employees", "venues", "event_types", "bar_packages", "payment_methods", "assignments", "payments"]), query: z.string().trim().min(1).max(160).nullable(), eventId: z.uuid().nullable(), date: z.iso.date().nullable() }).strict();
export const lookupTool: FunctionTool = { type: "function", name: "action_lookup", description: "Read-only bounded entity search for exact action targets. Use names/dates to resolve events; ask user when ambiguous. Employees returns active names/IDs only. Assignments/payments require eventId; payments owner-only. Empty query/date is prohibited for event searches. Never use the first match when multiple match.", strict: true, parameters: (() => { const { $schema: _schema, ...p } = z.toJSONSchema(lookupSchema, { target: "draft-7" }); void _schema; return p; })() };
