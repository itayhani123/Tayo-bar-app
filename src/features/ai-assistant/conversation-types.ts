import type { ResponseInput } from "openai/resources/responses/responses";
import type { ActionName } from "./action-registry";
import type { ActionResult, ProposalCard } from "./action-types";

export type Choice = { id: string; kind: string; label: string; field: string | null; value?: string };
export type ConversationMessage = { role: "user" | "assistant"; content: string; proposals?: (ProposalCard & { result?: ActionResult })[]; choices?: Choice[] };
export type Draft = { action: ActionName; values: Record<string, string | number | boolean>; proposalIds: string[]; fingerprint?: string };
export type ConversationState = { input: ResponseInput; draft: Draft | null; references: Choice[]; lastAction?: { action: string; status: string; eventId?: string } };
export type ConversationReply = { conversationId: string; answer: string; proposals: ProposalCard[]; choices: Choice[]; messages: ConversationMessage[]; busy?: boolean };
export const emptyConversationState = (): ConversationState => ({ input: [], draft: null, references: [] });
