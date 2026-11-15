import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { conversationFixture } from "../../../scripts/ai-conversation-fixture";
import { collectDraft, conversationTools, israelCalendar, understandSchema } from "./conversation-tools";
import { emptyConversationState } from "./conversation-types";
import { compactContext, loadConversation, runConversation } from "./conversations";

function scripted(steps: ({ name: string; args: object } | string)[], inspect?: (input: string) => void) {
  return { responses: { create: async (params: { input: unknown }) => {
    inspect?.(JSON.stringify(params.input));
    const next = steps.shift(); assert.ok(next, "Unexpected extra model call");
    return typeof next === "string" ? { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: next, annotations: [] }], status: "completed", id: randomUUID() }], output_text: next, status: "completed" } : { output: [{ type: "function_call", name: next.name, arguments: JSON.stringify(next.args), call_id: randomUUID() }] };
  } } } as unknown as Pick<OpenAI, "responses">;
}

test("progressive drafts preserve facts, require only missing fields, and block manager financial patches", () => {
  const state = emptyConversationState();
  const first = collectDraft(state, "owner", { action: "propose_create_event", reset: false, updates: [{ field: "eventDate", value: "2026-11-11" }] });
  assert.equal(first.missing[0].field, "venueId");
  state.draft = { action: first.action, values: first.values, proposalIds: [] };
  const second = collectDraft(state, "owner", { action: first.action, reset: false, updates: [{ field: "guestCount", value: 250 }] });
  assert.equal(second.values.eventDate, "2026-11-11"); assert.equal(second.values.guestCount, 250);
  assert.throws(() => collectDraft(state, "manager", { action: "propose_record_payment", reset: true, updates: [] }), /הרשאה/);
  assert.throws(() => collectDraft(state, "manager", { action: "propose_create_event", reset: false, updates: [{ field: "pricePerGuest", value: 20 }] }), /כספיים/);
  assert.throws(() => collectDraft(state, "owner", { action: first.action, reset: false, updates: [{ field: "eventDate", value: "2026-02-30" }] }));
  assert.equal(understandSchema.safeParse({ mode: "action", action: first.action, reset: false, updates: [{ field: "guestCount", value: "250" }] }).success, false);
  assert.doesNotMatch(JSON.stringify(conversationTools), /"oneOf"/);
  const payment = collectDraft(emptyConversationState(), "owner", { action: "propose_record_payment", reset: false, updates: [{ field: "eventId", value: randomUUID() }, { field: "amount", value: 2000 }, { field: "paymentMethod", value: "Cash" }, { field: "payerType", value: "לקוח" }, { field: "paidAt", value: "2026-11-10" }] });
  assert.deepEqual(payment.missing, []);
  assert.equal(payment.complete.notes, ""); assert.equal(payment.complete.payerType, "client");
});

test("Israel calendar crosses UTC midnight and leap/month boundaries without guessing relative language", () => {
  const days = israelCalendar(new Date("2028-02-28T23:30:00Z"));
  assert.equal(days[0].date, "2028-02-29"); assert.equal(days[1].date, "2028-03-01"); assert.equal(days[2].date, "2028-03-02");
});

test("whole-turn context compaction retains draft and resolved IDs, without orphan tool results", () => {
  const state = emptyConversationState();
  state.draft = { action: "propose_update_event", values: { eventId: randomUUID(), guestCount: 300 }, proposalIds: [] };
  for (let i = 0; i < 20; i++) state.input.push({ role: "user", content: `request ${i}` }, { type: "function_call", name: "operations", arguments: "{}", call_id: `call${i}` }, { type: "function_call_output", call_id: `call${i}`, output: "x".repeat(4000) });
  const id = state.draft.values.eventId;
  compactContext(state);
  assert.equal(state.draft.values.eventId, id);
  assert.ok(JSON.stringify(state.input).length <= 48000);
  assert.equal("role" in state.input[0] && state.input[0].role, "user");
});

test("multi-message request survives reload, retains tool IDs, creates only after click, and invalidates corrected cards", async () => {
  const f = await conversationFixture();
  try {
    const id = randomUUID();
    const turn = (message: string, client: Pick<OpenAI, "responses">, requestId = randomUUID()) => runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId: id, requestId, message }, new AbortController().signal, { client, now: new Date("2026-11-10T12:00:00Z") });
    await turn("תוסיף אירוע למחר", scripted([{ name: "collect_action", args: { action: "propose_create_event", reset: false, updates: [{ field: "eventDate", value: "2026-11-11" }] } }, "באיזה אולם?"]));
    const restored = await loadConversation(f.db, f.ids.owner, "owner", id);
    assert.equal(restored.messages.length, 2);
    await turn("קסנאדו", scripted([{ name: "action_lookup", args: { kind: "venues", query: "קסנאדו", date: null, eventId: null } }, { name: "collect_action", args: { action: "propose_create_event", reset: false, updates: [{ field: "venueId", value: f.ids.venue }] } }, "כמה אורחים?"]));
    let retained = false;
    await turn("250 אורחים", scripted([{ name: "collect_action", args: { action: "propose_create_event", reset: false, updates: [{ field: "guestCount", value: 250 }] } }, "איזה סוג אירוע?"], input => { if (input.includes(f.ids.venue) && input.includes("function_call_output")) retained = true; }));
    assert.equal(retained, true);
    const complete = await turn("חתונה, פרימיום ב-19:00 עבור טל, 30 לאורח כולל מעמ 18 אחוז, הלקוח משלם", scripted([{ name: "collect_action", args: { action: "propose_create_event", reset: false, updates: [{ field: "eventType", value: "Wedding" }, { field: "packageType", value: "Premium" }, { field: "startTime", value: "19:00" }, { field: "clientName", value: "טל" }, { field: "pricePerGuest", value: 30 }, { field: "vatRate", value: 18 }, { field: "priceIncludesVat", value: true }, { field: "payerType", value: "client" }] } }, "יש לאשר בכרטיס"]));
    assert.equal(complete.proposals.length, 1);
    assert.equal((await f.pg.query<{ count: number }>("select count(*)::int count from public.events")).rows[0].count, 1);
    const changed = await turn("תשנה ל-300", scripted([{ name: "collect_action", args: { action: "propose_create_event", reset: false, updates: [{ field: "guestCount", value: 300 }] } }, "הכרטיס עודכן"]));
    assert.equal(changed.proposals.length, 1);
    const old = await f.pg.query<{ result: { status: string } }>("select public.decide_ai_action($1,$2,'confirm') result", [f.ids.owner, complete.proposals[0].id]);
    assert.equal(old.rows[0].result.status, "cancelled");
    const confirmed = (await f.pg.query<{ result: { status: string; eventId: string } }>("select public.decide_ai_action($1,$2,'confirm') result", [f.ids.owner, changed.proposals[0].id])).rows[0].result;
    assert.equal(confirmed.status, "succeeded");
    assert.equal((await f.pg.query<{ n: number }>("select guest_count n from public.events where id=$1", [confirmed.eventId])).rows[0].n, 300);
    const after = await loadConversation(f.db, f.ids.owner, "owner", id);
    assert.equal(after.messages.at(-1)?.proposals?.[0].result?.status, "succeeded");
    const requestId = randomUUID();
    const client = scripted(["האירוע נשמר"]);
    await turn("מה הסטטוס?", client, requestId);
    await turn("מה הסטטוס?", scripted([]), requestId); // No second model/API call.
    await assert.rejects(loadConversation(f.db, f.ids.manager, "manager", id), /אינה זמינה/);
    await assert.rejects(runConversation(f.db, f.db, "manager", f.ids.owner, { conversationId: id, requestId: randomUUID(), message: "הצג היסטוריה" }, new AbortController().signal), /Unauthorized/);
  } finally { await f.close(); }
});

test("conversation leases prevent competing turns, and browser roles cannot read stored tool context", async () => {
  const f = await conversationFixture();
  try {
    const conversation = randomUUID(), request = randomUUID();
    const args = { p_actor: f.ids.owner, p_role: "owner", p_conversation: conversation, p_request: request, p_message: "שלום", p_selection: null };
    const first = await f.db.rpc("begin_ai_turn", args).abortSignal(new AbortController().signal);
    assert.equal(first.data.status, "ready");
    assert.equal(first.data.protocolVersion, 2);
    const second = await f.db.rpc("begin_ai_turn", { ...args, p_request: randomUUID() }).abortSignal(new AbortController().signal);
    assert.equal(second.data.status, "busy");
    const outdated = { ...f.db, rpc: (name: string, params: Record<string, unknown>) => name === "begin_ai_turn" ? { abortSignal: async (signal: AbortSignal) => {
      const result = await f.db.rpc(name, params).abortSignal(signal);
      return { ...result, data: { ...result.data, protocolVersion: 1 } };
    } } : f.db.rpc(name, params) } as unknown as typeof f.db;
    await assert.rejects(runConversation(f.db, outdated, "owner", f.ids.owner, { conversationId: randomUUID(), requestId: randomUUID(), message: "תוסיף אירוע למחר" }, new AbortController().signal, { client: scripted([]) }), /018/);
    await f.pg.exec("reset role; set role authenticated");
    await assert.rejects(f.pg.query("select * from public.ai_conversations"), /permission denied/);
    await assert.rejects(f.pg.query("select public.begin_ai_turn($1,'owner',$2,$3,'שלום',null)", [f.ids.owner, conversation, randomUUID()]), /permission denied/);
  } finally { await f.close(); }
});

test("refresh/disconnect during a model request retains incoming intent and allows contextual continuation", { timeout: 20000 }, async () => {
  const f = await conversationFixture();
  const controller = new AbortController();
  const conversationId = randomUUID();
  let entered: () => void = () => undefined;
  const modelStarted = new Promise<void>(resolve => { entered = resolve; });
  const slowClient = { responses: { create: async (_: unknown, options: { signal: AbortSignal }) => {
    entered();
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("Synthetic disconnect")), { once: true }));
  } } } as unknown as Pick<OpenAI, "responses">;
  try {
    const running = runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId, requestId: randomUUID(), message: "תוסיף אירוע למחר" }, controller.signal, { client: slowClient });
    const failed = assert.rejects(running, /Synthetic disconnect/);
    await modelStarted;
    const during = await loadConversation(f.db, f.ids.owner, "owner", conversationId);
    assert.equal(during.busy, true);
    assert.equal(during.messages.at(-1)?.content, "תוסיף אירוע למחר");
    controller.abort();
    await failed;
    const after = await loadConversation(f.db, f.ids.owner, "owner", conversationId);
    assert.equal(after.interrupted, true);
    assert.equal(after.messages.length, 1);
    let originalIntentSeen = false;
    await runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId, requestId: randomUUID(), message: "קסנאדו" }, new AbortController().signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_create_event", reset: false, updates: [{ field: "eventDate", value: "2026-11-11" }, { field: "venueQuery", value: "קסנאדו" }] } }, "כמה אורחים?"], input => { if (input.includes("תוסיף אירוע למחר")) originalIntentSeen = true; }) });
    assert.equal(originalIntentSeen, true);
    const stored = await f.pg.query<{ state: { draft: { values: Record<string, string> } } }>("select state from public.ai_conversations where id=$1", [conversationId]);
    assert.equal(stored.rows[0].state.draft.values.venueId, f.ids.venue);
  } finally { controller.abort(); await f.close(); }
});

test("semantic multi-turn staffing, ambiguity selection, payments, reads and manager refusal use real local rows", async () => {
  const f = await conversationFixture();
  const signal = new AbortController().signal;
  try {
    await f.pg.query("insert into public.events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type) values($1,'2026-11-11','20:00','Wedding',$2,'לקוח אחר',100,30,'Premium','client')", [randomUUID(), f.ids.venue]);
    const staff = randomUUID();
    const first = await runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId: staff, requestId: randomUUID(), message: "שבץ את יוסי לאירוע של מחר" }, signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_assign_employee", reset: false, updates: [{ field: "targetDate", value: "2026-11-11" }, { field: "employeeQuery", value: "יוסי" }] } }, "לאיזה אירוע מחר? המערכת מציגה אפשרויות"]), now: new Date("2026-11-10T12:00:00Z") });
    assert.equal(first.choices.length, 2);
    const choice = first.choices.find(c => c.id === f.ids.event)!;
    const chosen = await runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId: staff, requestId: randomUUID(), message: choice.label, selection: { kind: choice.kind, id: choice.id } }, signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_assign_employee", reset: false, updates: [] } }, "השיבוץ מוכן לאישור"]) });
    assert.equal(chosen.proposals.length, 1);
    await f.db.rpc("decide_ai_action", { p_actor: f.ids.owner, p_proposal: chosen.proposals[0].id, p_decision: "confirm" }).abortSignal(signal);
    const paymentId = randomUUID();
    await runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId: paymentId, requestId: randomUUID(), message: "רשום תשלום של 2000 שקל" }, signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_record_payment", reset: false, updates: [{ field: "amount", value: 2000 }] } }, "לאיזה אירוע?"]) });
    const paid = await runConversation(f.db, f.db, "owner", f.ids.owner, { conversationId: paymentId, requestId: randomUUID(), message: "האירוע של דני, היום במזומן מהלקוח" }, signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_record_payment", reset: false, updates: [{ field: "eventQuery", value: "דני" }, { field: "paymentMethod", value: "מזומן" }, { field: "payerType", value: "לקוח" }, { field: "paidAt", value: "2026-11-10" }] } }, "התשלום מוכן לאישור"]) });
    assert.equal(paid.proposals.length, 1);
    for (let i = 0; i < 2; i++) await f.db.rpc("decide_ai_action", { p_actor: f.ids.owner, p_proposal: paid.proposals[0].id, p_decision: "confirm" }).abortSignal(signal);
    assert.equal((await f.pg.query<{ n: number }>("select count(*)::int n from public.event_payments where amount=2000")).rows[0].n, 1);
    let realOperationalDataSeen = false;
    await runConversation(f.db, f.db, "manager", f.ids.manager, { conversationId: randomUUID(), requestId: randomUUID(), message: "מי עובד מחר?" }, signal, { client: scripted([{ name: "understand_request", args: { mode: "read", action: null, reset: false, updates: [] } }, { name: "operations", args: { start: "2026-11-11", end: "2026-11-11", venueId: null } }, "יוסי משובץ למחר"], input => { if (input.includes("יוסי") && input.includes("assignments")) realOperationalDataSeen = true; }) });
    assert.ok(realOperationalDataSeen);
    const denied = await runConversation(f.db, f.db, "manager", f.ids.manager, { conversationId: randomUUID(), requestId: randomUUID(), message: "רשום תשלום 2000" }, signal, { client: scripted([{ name: "understand_request", args: { mode: "action", action: "propose_record_payment", reset: false, updates: [{ field: "amount", value: 2000 }] } }, "אין לך הרשאה לפעולה כספית"]) });
    assert.equal(denied.proposals.length, 0);
    assert.equal((await f.pg.query<{ n: number }>("select count(*)::int n from public.event_payments")).rows[0].n, 1);
  } finally { await f.close(); }
});
