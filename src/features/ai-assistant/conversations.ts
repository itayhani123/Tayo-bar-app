import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { answerQuestion, type TurnContext } from "./service";
import { proposeAction } from "./action-proposals";
import { collectDraft } from "./conversation-tools";
import type { ConversationMessage, ConversationReply, ConversationState } from "./conversation-types";
import type { ActionResult } from "./action-types";

export const turnSchema = z.object({ conversationId: z.uuid(), requestId: z.uuid(), message: z.string().trim().min(1).max(2000), selection: z.object({ kind: z.string().min(1).max(30), id: z.uuid() }).strict().optional() }).strict();
export type UserTurn = z.infer<typeof turnSchema>;
export class ConversationError extends Error { constructor(message: string, public status = 503) { super(message); } }
const unavailable = () => new ConversationError("לא ניתן לשמור את השיחה כרגע. יש לוודא שמיגרציות 017–018 הותקנו ולנסות שוב");

// Compact whole user turns, never orphaning a function call from its output. Draft/known IDs survive compaction.
export function compactContext(state: ConversationState) {
  while (JSON.stringify(state.input).length > 48000 || state.input.length > 90) {
    const next = state.input.findIndex((item, index) => index > 0 && "role" in item && item.role === "user");
    if (next < 0) break;
    state.input.splice(0, next);
  }
  state.references = state.references.slice(-60);
}

export async function refreshProposalResults(admin: SupabaseClient, actorId: string, messages: ConversationMessage[], state?: ConversationState) {
  const ids = [...new Set([...messages.flatMap(m => m.proposals?.map(p => p.id) ?? []), ...(state?.draft?.proposalIds ?? [])])].slice(-60);
  if (!ids.length) return;
  const { data, error } = await admin.from("ai_action_proposals").select("id,action,status,result,expires_at").eq("actor_id", actorId).in("id", ids);
  if (error) throw unavailable();
  for (const row of data ?? []) {
    const status = row.status === "pending" && Date.parse(row.expires_at) <= Date.now() ? "expired" : row.status;
    if (status === "pending") continue;
    const result = { ...(row.result ?? {}), status } as ActionResult;
    for (const message of messages) for (const card of message.proposals ?? []) if (card.id === row.id) card.result = result;
    if (state?.draft?.proposalIds.includes(row.id)) {
      state.lastAction = { action: row.action, status, eventId: result.eventId };
      if (status === "succeeded") state.draft = result.eventId && ["propose_create_event", "propose_update_event"].includes(row.action) ? { action: "propose_update_event", values: { eventId: result.eventId }, proposalIds: [] } : null;
      else { state.draft.proposalIds = []; state.draft.fingerprint = undefined; }
    }
  }
}

type Begin = { status: "ready"; protocolVersion: number; lease: string; state: ConversationState; messages: ConversationMessage[] } | { status: "completed"; response: ConversationReply } | { status: "busy" };
export async function runConversation(db: SupabaseClient, admin: SupabaseClient, role: string, actorId: string, raw: UserTurn, signal: AbortSignal, options: { client?: Pick<OpenAI, "responses">; lookup?: TurnContext["lookup"]; read?: TurnContext["read"]; now?: Date } = {}): Promise<ConversationReply> {
  const turn = turnSchema.parse(raw);
  const begin = await admin.rpc("begin_ai_turn", { p_actor: actorId, p_role: role, p_conversation: turn.conversationId, p_request: turn.requestId, p_message: turn.message, p_selection: turn.selection ?? null }).abortSignal(signal);
  if (begin.error?.code === "42501") throw new ConversationError("אין הרשאה לשיחה הזו בתפקיד הנוכחי. יש לפתוח שיחה חדשה", 403);
  if (begin.error?.message.includes("Request ID reused")) throw new ConversationError("מזהה הבקשה כבר שימש להודעה אחרת. שלחו את ההודעה מחדש", 409);
  if (begin.error?.message.includes("Conversation full")) throw new ConversationError("השיחה הגיעה למגבלת האורך. יש לפתוח שיחה חדשה", 409);
  if (begin.error?.message.includes("Conversation limit")) throw new ConversationError("הגעת למכסת השיחות החדשות. ניתן להמשיך בשיחה קיימת או להמתין לפקיעת תוקף השיחות", 429);
  if (begin.error || !begin.data) throw unavailable();
  const opened = begin.data as Begin;
  if (opened.status === "busy") throw new ConversationError("מתבצעת כבר בקשה בשיחה זו. המתינו לתשובה לפני שליחת הודעה נוספת", 409);
  if (opened.status === "completed") {
    await refreshProposalResults(admin, actorId, opened.response.messages);
    return opened.response;
  }
  if (opened.protocolVersion !== 2) {
    await admin.rpc("release_ai_turn", { p_actor: actorId, p_conversation: turn.conversationId, p_lease: opened.lease }).abortSignal(AbortSignal.timeout(3000));
    throw new ConversationError("מנגנון השיחה בשרת אינו מעודכן. יש להחיל את מיגרציה 018 לפני השימוש", 503);
  }
  const state = opened.state;
  const messages = opened.messages;
  const context: TurnContext = { state, proposals: [], choices: [], ...options, checkpoint: async () => {
    compactContext(state);
    const saved = await admin.rpc("checkpoint_ai_turn", { p_actor: actorId, p_conversation: turn.conversationId, p_lease: opened.lease, p_state: state }).abortSignal(AbortSignal.timeout(3000));
    if (saved.error || saved.data !== true) throw unavailable();
  }, recover: async id => {
    const { data, error } = await admin.from("ai_action_proposals").select("id,summary,expires_at").eq("id", id).eq("actor_id", actorId).eq("actor_role", role).eq("status", "pending").single();
    if (error || !data) throw new ConversationError("ההצעה אינה זמינה. יש להכין הצעה חדשה", 409);
    return { ...data.summary, id: data.id, expiresAt: data.expires_at };
  }, invalidate: async ids => {
    for (const id of ids) {
      const cancelled = await admin.rpc("decide_ai_action", { p_actor: actorId, p_proposal: id, p_decision: "cancel" }).abortSignal(signal);
      if (cancelled.error || !cancelled.data || !["cancelled", "expired", "stale", "failed"].includes(cancelled.data.status)) throw new ConversationError("לא ניתן להחליף את ההצעה הישנה. יש לבדוק את תוצאת הפעולה לפני יצירת הצעה חדשה", 409);
    }
  } };
  try {
    await refreshProposalResults(admin, actorId, messages, state);
    let content = turn.message;
    if (turn.selection) {
      const chosen = messages.findLast(m => m.role === "assistant")?.choices?.find(c => c.id === turn.selection!.id && c.kind === turn.selection!.kind);
      if (!chosen) throw new ConversationError("האפשרות אינה שייכת לשאלה האחרונה. בחרו מתוך האפשרויות המוצגות", 400);
      content = `${chosen.label} (בחירה מהרשימה: ${chosen.kind}, ${chosen.id})`;
      if (chosen.field && state.draft) {
        const draft = collectDraft(state, role, { action: state.draft.action, reset: false, updates: [{ field: chosen.field, value: ["eventType", "packageType", "paymentMethod"].includes(chosen.field) ? chosen.value ?? chosen.label : chosen.id }] });
        if (state.draft.proposalIds.length) await context.invalidate(state.draft.proposalIds);
        state.draft = { action: draft.action, values: draft.values, proposalIds: [] };
      }
    }
    const incoming = state.input.findLastIndex(item => "role" in item && item.role === "user");
    if (incoming >= 0) state.input[incoming] = { role: "user", content };
    compactContext(state);
    const propose = async (name: string, args: unknown) => {
      if (context.proposals.length >= 3) throw new ConversationError("ניתן להכין עד שלוש הצעות בהודעה אחת", 400);
      return proposeAction(admin, actorId, role, turn.requestId, name, args, signal);
    };
    let answer: string;
    try { answer = await answerQuestion(db, role, [], signal, options.client, propose, context); }
    catch (error) {
      if (error instanceof ConversationError) throw error;
      if (!context.proposals.length && !context.question) throw error;
      answer = context.question ?? "ההצעה מוכנה לבדיקה בכרטיס. לא בוצע שינוי בנתונים";
      // Drop an interrupted current tool turn; structured draft remains available next time.
      const index = state.input.findLastIndex(item => "role" in item && item.role === "user");
      state.input.splice(index + 1);
      state.input.push({ role: "assistant", content: answer });
    }
    messages.push({ role: "assistant", content: answer, proposals: context.proposals, choices: context.choices });
    await refreshProposalResults(admin, actorId, messages);
    const visible = messages.slice(-40);
    while (JSON.stringify(visible).length > 60000 && visible.length > 2) visible.splice(0, 2);
    compactContext(state);
    const reply: ConversationReply = { conversationId: turn.conversationId, answer, proposals: context.proposals, choices: context.choices, messages: visible };
    const finish = await admin.rpc("finish_ai_turn", { p_actor: actorId, p_role: role, p_conversation: turn.conversationId, p_lease: opened.lease, p_state: state, p_messages: visible, p_response: reply }).abortSignal(signal);
    if (finish.error?.code === "42501") throw new ConversationError("התפקיד או ההרשאות השתנו במהלך הבקשה. יש לפתוח שיחה חדשה", 403);
    if (finish.error || finish.data !== true) throw unavailable();
    return reply;
  } finally {
    // Separate deadline: release safely even after an upstream model timeout. Never release another request's lease.
    try { await admin.rpc("release_ai_turn", { p_actor: actorId, p_conversation: turn.conversationId, p_lease: opened.lease }).abortSignal(AbortSignal.timeout(3000)); }
    catch { /* A failed cleanup must not replace a committed response; the lease also expires. */ }
  }
}

export async function loadConversation(admin: SupabaseClient, actorId: string, role: string, conversationId: string) {
  z.uuid().parse(conversationId);
  const { data, error } = await admin.from("ai_conversations").select("messages,lease_until").eq("id", conversationId).eq("actor_id", actorId).eq("actor_role", role).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new ConversationError("השיחה אינה זמינה או שפג תוקפה. ניתן לפתוח שיחה חדשה", 404);
  const messages = data.messages as ConversationMessage[];
  await refreshProposalResults(admin, actorId, messages);
  const busy = !!data.lease_until && Date.parse(data.lease_until) > Date.now();
  return { conversationId, messages, busy, interrupted: !busy && messages.at(-1)?.role === "user" };
}
