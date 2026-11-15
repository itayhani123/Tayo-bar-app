// Opt-in paid, real-model multi-turn checks against synthetic LOCAL PostgreSQL only.
// node --env-file=.env.local --import ./scripts/test-register.mjs scripts/check-ai-conversations.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { conversationFixture } from "./ai-conversation-fixture.ts";
import { runConversation, loadConversation } from "../src/features/ai-assistant/conversations.ts";

const fixture = await conversationFixture();
const { db, pg, ids } = fixture;
const now = new Date("2026-11-10T12:00:00Z");
const reports = [];
const transcripts = [];
const session = (role = "owner") => ({ id: randomUUID(), role, actor: role === "owner" ? ids.owner : ids.manager });
const state = async s => (await pg.query("select state from public.ai_conversations where id=$1", [s.id])).rows[0].state;
async function say(s, message, selection, requestId = randomUUID()) {
  const response = await runConversation(db, db, s.role, s.actor, { conversationId: s.id, requestId, message, ...(selection ? { selection: { kind: selection.kind, id: selection.id } } : {}) }, AbortSignal.timeout(50000), { now });
  transcripts.push({ conversation: s.id, role: s.role, message, answer: response.answer, choices: response.choices, proposals: response.proposals.map(p => ({ id: p.id, title: p.title })) });
  return response;
}
async function click(s, card) {
  const result = (await db.rpc("decide_ai_action", { p_actor: s.actor, p_proposal: card.id, p_decision: "confirm" }).abortSignal(AbortSignal.timeout(20000))).data;
  assert.equal(result.status, "succeeded");
  return result;
}
const count = async table => (await pg.query(`select count(*)::int n from public.${table}`)).rows[0].n;
const pass = name => { reports.push({ name, passed: true }); console.log(`PASS ${name}`); };
try {
  const a = session();
  await say(a, "תוסיף אירוע למחר");
  assert.equal((await state(a)).draft?.values.eventDate, "2026-11-11", "A: date not collected from partial Hebrew request");
  await say(a, "קסנאדו");
  assert.equal((await state(a)).draft?.values.venueId, ids.venue, "A: venue not retained");
  await say(a, "250 אורחים");
  assert.equal((await state(a)).draft?.values.guestCount, 250, "A: guest count not retained");
  const refreshed = await loadConversation(db, ids.owner, "owner", a.id);
  assert.equal(refreshed.messages.length, 6, "A: conversation lost after reload");
  let reply = await say(a, "זו חתונה בחבילת פרימיום בשעה 19:00, שם הלקוח טל בדיקה. המחיר 30 שקלים לאורח כולל מע״מ 18 אחוז והלקוח משלם");
  for (let attempt = 0; !reply.proposals.length && attempt < 2; attempt++) reply = await say(a, "הפרטים שביקשתי: מחר, קסנאדו, 250 אורחים, Wedding, Premium, 19:00, טל בדיקה, 30 לאורח, 18% מעמ, המחיר כולל מעמ, payerType client");
  assert.equal(reply.proposals.length, 1, "A: no real confirmation card after required details");
  const card = reply.proposals[0];
  await say(a, "כן");
  assert.equal(await count("events"), 1, "A: text yes must not create an event");
  const created = await click(a, card);
  assert.equal(await count("events"), 2);
  assert.equal((await pg.query("select guest_count n from public.events where id=$1", [created.eventId])).rows[0].n, 250);
  await click(a, card); assert.equal(await count("events"), 2, "A: duplicate click created another event");
  pass("A: partial Hebrew creation, context, reload, explicit click and replay");

  const b = session();
  const update = await say(b, "תשנה את האירוע של דני ל-300 איש");
  assert.equal(update.proposals.length, 1, "B: no update card");
  await click(b, update.proposals[0]);
  assert.equal((await pg.query("select guest_count n from public.events where id=$1", [ids.event])).rows[0].n, 300);
  const corrected = await say(b, "תשנה ל-320");
  assert.equal(corrected.proposals.length, 1, "B: follow-up lost the confirmed target");
  await say(b, "עזוב, בטל את הבקשה הזו");
  assert.equal((await state(b)).draft, null, "B: draft not cancelled");
  const cancelled = (await db.rpc("decide_ai_action", { p_actor: ids.owner, p_proposal: corrected.proposals[0].id, p_decision: "confirm" }).abortSignal(AbortSignal.timeout(10000))).data;
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await pg.query("select guest_count n from public.events where id=$1", [ids.event])).rows[0].n, 300);
  pass("B: named event update, contextual correction and cancellation");

  const c = session();
  let staffing = await say(c, "שבץ את יוסי לאירוע של מחר");
  if (!staffing.proposals.length) {
    assert.ok(staffing.choices.length >= 2, "C: ambiguous tomorrow events need real choices");
    const choice = staffing.choices.find(c => c.id === ids.event);
    assert.ok(choice, "C: real event absent from choices");
    staffing = await say(c, choice.label, choice);
  }
  assert.equal(staffing.proposals.length, 1, "C: no staffing card");
  await click(c, staffing.proposals[0]);
  assert.equal((await pg.query("select count(*)::int n from public.event_assignments where event_id=$1 and employee_id=$2", [ids.event, ids.employee])).rows[0].n, 1);
  pass("C: real employee/event lookup, ambiguity choices and assignment");

  const d = session();
  await say(d, "רשום תשלום של 2000 שקל");
  assert.equal((await state(d)).draft?.values.amount, 2000, "D: amount not retained");
  assert.equal(await count("event_payments"), 0);
  let payment = await say(d, "האירוע של דני");
  if (payment.choices.some(c => c.id === ids.event)) {
    const choice = payment.choices.find(c => c.id === ids.event);
    payment = await say(d, choice.label, choice);
  }
  if (!payment.proposals.length) payment = await say(d, "התשלום התקבל היום במזומן מהלקוח");
  if (!payment.proposals.length) payment = await say(d, "Cash, הלקוח שילם היום 10.11.2026, סכום 2000");
  assert.equal(payment.proposals.length, 1, "D: no payment card");
  await click(d, payment.proposals[0]); await click(d, payment.proposals[0]);
  assert.equal(await count("event_payments"), 1);
  assert.equal(Number((await pg.query("select amount from public.event_payments")).rows[0].amount), 2000);
  pass("D: partial payment, missing event/details, confirmed recording and duplicate prevention");

  const e = session();
  const operations = await say(e, "מי עובד מחר?");
  assert.match(operations.answer, /יוסי/);
  assert.equal(operations.proposals.length, 0);
  pass("E: operational question answered from actual synthetic database rows");

  const f = session("manager");
  const unauthorized = await say(f, "תרשום תשלום של 2000 שקל לאירוע של דני");
  assert.equal(unauthorized.proposals.length, 0);
  assert.equal((await state(f)).draft, null);
  assert.equal(await count("event_payments"), 1);
  pass("F: manager financial action blocked");

  const g = session();
  await say(g, "תכניס ארוע למחרתים");
  assert.equal((await state(g)).draft?.values.eventDate, "2026-11-12", "G: misspelled relative request not understood");
  await say(g, "לא משנה, בטל");
  assert.equal((await state(g)).draft, null);
  pass("G: Hebrew typos/synonym, day-after-tomorrow and cancellation");

  const h = session();
  const removal = await say(h, "תוריד את יוסי מהאירוע של דני");
  assert.equal(removal.proposals.length, 1, "H: no real removal card");
  await click(h, removal.proposals[0]);
  assert.equal(await count("event_assignments"), 0);
  assert.equal(await count("employees"), 1);
  pass("H: contextual assignment removal retains employee records");
} catch (error) {
  reports.push({ passed: false, error: error.status ? `Provider status ${error.status}` : error.message });
  console.error(error.status ? `FAIL provider status ${error.status}${error.status === 400 ? `: ${String(error.message).slice(0, 700)}` : ""}` : `FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  mkdirSync("test-results/ai", { recursive: true });
  const states = (await pg.query("select id,state from public.ai_conversations")).rows;
  writeFileSync("test-results/ai/conversation-live.json", JSON.stringify({ syntheticOnly: true, model: process.env.OPENAI_MODEL || "gpt-4.1-mini", reports, transcripts, states }, null, 2));
  writeFileSync(`test-results/ai/conversation-live-${(process.env.OPENAI_MODEL || "gpt-4.1-mini").replace(/[^a-z0-9-]/gi, "_")}.json`, JSON.stringify({ syntheticOnly: true, model: process.env.OPENAI_MODEL || "gpt-4.1-mini", reports, transcripts, states }, null, 2));
  await fixture.close();
}
