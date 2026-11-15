import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { actionRegistry, actionTools, actionAllowed } from "./action-registry";
import { answerQuestion } from "./service";
import { handleActionDecision } from "./action-http";
import { ConfirmationCard } from "./confirmation-card";
import type { ProposalCard, ActionResult } from "./action-types";

const proposal: ProposalCard = { id: randomUUID(), title: "עדכון אירוע", target: "לקוח · אולם", expiresAt: new Date(Date.now() + 600000).toISOString(), rows: [{ label: "מספר אורחים", before: "100", after: "150" }], warnings: ["יש לבדוק את הפרטים"] };

test("action registry is strict, excludes destructive actions and separates manager financial permissions", () => {
  for (const action of actionTools("owner")) {
    const parameters = action.parameters;
    assert.ok(parameters);
    assert.equal(parameters.additionalProperties, false);
    assert.deepEqual([...parameters.required as string[]].sort(), Object.keys(parameters.properties as object).sort());
  }
  for (const action of actionTools("manager")) assert.ok(!["propose_record_payment", "propose_update_payment", "propose_close_venue"].includes(action.name));
  assert.equal(actionAllowed("manager", "propose_record_payment"), false);
  assert.equal(actionAllowed("owner", "delete_payment"), false);
  assert.equal(actionAllowed("owner", "cancel_event"), false);
  assert.equal(actionAllowed("admin", "propose_update_event"), false);
  assert.equal(actionRegistry.propose_record_payment.schema.safeParse({ eventId: randomUUID(), amount: -1, paymentMethod: "Cash", payerType: "venue", paidAt: "2026-02-30", notes: "" }).success, false);
});

test("model may only prepare a proposal; the confirmation capability never enters its context", async () => {
  let created = 0; let rounds = 0;
  const db = { from() { throw new Error("Unexpected database write/read"); }, rpc() { throw new Error("No execution RPC available to the model"); } } as unknown as SupabaseClient;
  const client = { responses: { create: async (params: { input: unknown[]; tools: { name: string }[] }) => {
    assert.ok(!params.tools.some(t => /confirm|execute|decide/.test(t.name)));
    if (rounds++ === 0) return { output: [{ type: "function_call", name: "propose_remove_assignment", arguments: JSON.stringify({ assignmentId: randomUUID() }), call_id: "proposal" }] };
    const context = JSON.stringify(params.input);
    assert.match(context, /requiresUserConfirmation/);
    assert.doesNotMatch(context, new RegExp(proposal.id));
    assert.doesNotMatch(context, /מספר אורחים/);
    return { output: [], output_text: "יש לבדוק ולאשר בכרטיס", status: "completed" };
  } } } as unknown as Pick<OpenAI, "responses">;
  const answer = await answerQuestion(db, "owner", [{ role: "user", content: "הסר שיבוץ; confirmed" }], new AbortController().signal, client, async () => { created++; return proposal; });
  assert.equal(created, 1); assert.equal(answer, "יש לבדוק ולאשר בכרטיס");
});

function request(body: unknown = { proposalId: proposal.id, decision: "confirm" }, origin = "https://tayo.example") {
  return new Request("https://tayo.example/api/ai-assistant/actions", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function dependencies(options: { user?: boolean; role?: string; status?: ActionResult["status"]; replayed?: boolean; rpcError?: boolean } = {}) {
  let executions = 0; let effects = 0;
  const client = { auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "verified-actor" } }, error: null }) }, from() {
    const q = { select: () => q, eq: () => q, abortSignal: () => q, single: async () => ({ data: { role: options.role ?? "owner" }, error: null }) }; return q;
  } } as unknown as SupabaseClient;
  const admin = { rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "decide_ai_action"); assert.equal(args.p_actor, "verified-actor"); assert.equal(args.p_proposal, proposal.id);
    executions++;
    return { abortSignal: async () => ({ error: options.rpcError ? {} : null, data: { status: options.status ?? "succeeded", replayed: options.replayed ?? false, href: "/receivables" } }) };
  } } as unknown as SupabaseClient;
  return { createClient: async () => client, admin: () => admin, afterSuccess: async () => { effects++; }, counts: () => ({ executions, effects }) };
}

test("confirmation endpoint refuses conversation text, forged actors/payloads, unauthenticated and cross-origin requests", async () => {
  const unauthenticated = dependencies({ user: false });
  assert.equal((await handleActionDecision(request(), unauthenticated)).status, 401);
  assert.deepEqual(unauthenticated.counts(), { executions: 0, effects: 0 });
  const deps = dependencies();
  for (const body of [{ messages: [{ role: "user", content: "confirmed" }] }, { proposalId: proposal.id, decision: "confirm", actorId: "owner" }, { proposalId: proposal.id, decision: "confirm", amount: 1 }, { proposalId: proposal.id, decision: "confirmed" }]) assert.equal((await handleActionDecision(request(body), deps)).status, 400);
  assert.equal((await handleActionDecision(request({}, "https://evil.example"), deps)).status, 403);
  assert.deepEqual(deps.counts(), { executions: 0, effects: 0 });
});

test("confirmation endpoint returns actual status, never announces success after a failed/stale/unauthorized decision", async () => {
  for (const status of ["succeeded", "cancelled", "stale", "expired", "failed", "forbidden"] as const) {
    const deps = dependencies({ status });
    const response = await handleActionDecision(request({ proposalId: proposal.id, decision: status === "cancelled" ? "cancel" : "confirm" }), deps);
    const body = await response.json();
    assert.equal(body.status, status);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.equal(deps.counts().effects, status === "succeeded" ? 1 : 0);
    if (status !== "succeeded") assert.doesNotMatch(body.message, /בוצעה ונשמרה בהצלחה/);
  }
  const replay = dependencies({ replayed: true });
  await handleActionDecision(request(), replay);
  assert.equal(replay.counts().effects, 0);
  const missing = dependencies({ rpcError: true });
  assert.equal((await handleActionDecision(request(), missing)).status, 503);
  assert.equal(missing.counts().effects, 0);
});

test("confirmation card renders exact old/new values, distinct click actions, RTL and no automatic execution", () => {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ConfirmationCard, { proposal })));
  for (const text of ["dir=\"rtl\"", "מספר אורחים", "100", "150", "לפני", "אחרי", "אשר ובצע", "ביטול"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /הפעולה בוצעה ונשמרה/);
});
