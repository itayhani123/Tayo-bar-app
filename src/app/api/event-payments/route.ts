import { assertOwner } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

const fields = "id, event_id, amount, payment_method, payer_type, paid_at, notes, created_at, updated_at";
const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 403 });
type PaymentPayload = {
  amount: unknown;
  payment_method: string;
  payer_type: unknown;
  paid_at: unknown;
  notes: unknown;
};

function parsePaymentPayload(value: unknown): PaymentPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.payment_method !== "string" || !input.payment_method.trim()) return null;
  return {
    amount: input.amount,
    payment_method: input.payment_method.trim(),
    payer_type: input.payer_type,
    paid_at: input.paid_at,
    notes: input.notes,
  };
}

export async function GET(request: Request) { try { await assertOwner(); } catch { return unauthorized(); } const eventId = new URL(request.url).searchParams.get("eventId"); if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 }); const { data, error } = await (await createClient()).from("event_payments").select(fields).eq("event_id", eventId).order("paid_at", { ascending: false }); return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json(data); }
export async function POST(request: Request) { try { await assertOwner(); } catch { return unauthorized(); } const body = await request.json() as { eventId?: string; values?: unknown }; const values = parsePaymentPayload(body.values); if (!body.eventId || !values) return Response.json({ error: "Invalid request" }, { status: 400 }); const { data, error } = await (await createClient()).from("event_payments").insert({ event_id: body.eventId, ...values }).select(fields).single(); return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json(data); }
export async function PATCH(request: Request) { try { await assertOwner(); } catch { return unauthorized(); } const body = await request.json() as { id?: string; values?: unknown }; const values = parsePaymentPayload(body.values); if (!body.id || !values) return Response.json({ error: "Invalid request" }, { status: 400 }); const { data, error } = await (await createClient()).from("event_payments").update(values).eq("id", body.id).select(fields).single(); return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json(data); }
export async function DELETE(request: Request) { try { await assertOwner(); } catch { return unauthorized(); } const id = new URL(request.url).searchParams.get("id"); if (!id) return Response.json({ error: "Missing id" }, { status: 400 }); const { error } = await (await createClient()).from("event_payments").delete().eq("id", id); return error ? Response.json({ error: error.message }, { status: 400 }) : new Response(null, { status: 204 }); }
