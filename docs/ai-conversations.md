# Tayo AI: conversational repair

## Diagnosis

The earlier code could technically call proposal tools but did not implement a reliable multi-turn workflow:

1. The browser replayed only 11 text messages. OpenAI function calls, lookup results and resolved entity IDs disappeared on the next HTTP request, and refresh removed the whole conversation.
2. Every action tool demanded a fully populated payload. There was no durable partial intent/draft for “תוסיף אירוע למחר”. Missing details and invalid serialization were treated as failed tool input rather than continued data gathering.
3. Catalogs store values such as `Wedding`, `Premium` and `Cash`, whereas users speak Hebrew and the model sometimes supplies catalog UUIDs. Payer enums use `client`/`venue`. These representation differences caused valid user intent to fail validation.
4. A generic union allowed the model to produce a string `"250"` for a numeric guest count. Real-model tests reproduced that failure. The updated argument schema gives numbers, IDs, dates, booleans and text separate strict types using Responses-compatible `anyOf` (not `oneOf`).
5. Literal name search could miss “האירוע של דני”, Hebrew typos or transliteration and then treat unrelated fallback candidates as exact ambiguity. Partial employee/event search hints were not supported at all.
6. There was no feedback from a confirmed action into subsequent model context, no robust contextual corrections and no restoration of confirmation status. Payment notes were incorrectly considered a mandatory conversational question even though a new payment may have no notes.
7. With `tool_choice: auto`, the model could ask a follow-up without saving the known facts. A required semantic first step now records the actual intent and supplied facts on every turn; there is no regex/keyword intent router.

## Current architecture

- The chat sends only a new user message, conversation UUID and idempotency request UUID. It cannot inject stored assistant/tool history or role/actor claims. The legacy text-history API remains available for read-only callers.
- The authenticated server loads private, actor-and-role-bound conversation state. `understand_request` is forced as the first Responses tool call and uses the real model to classify a read, partial action, clarification or draft cancellation and extract typed user facts.
- `collect_action` merges those facts into a structured draft, validates each field, resolves unique real database search hints, and returns exactly which required details remain. A partial request is a normal state, not an error.
- Catalog values are normalized against actual catalog IDs/names and the application's existing Hebrew labels. The system does not invent catalog entries, amounts or targets. Ambiguous names/dates produce actual selectable records. Fallback search candidates are explicitly marked; the model can resolve a unique semantic match or ask the user.
- Required details are collected incrementally. Existing financial rules and owner/manager restrictions remain enforced in the server. New payments default only optional notes to empty; payment updates preserve existing notes when no note change was requested.
- Complete drafts call the existing validated proposal pipeline. The model receives only “requires user confirmation”, never an execution capability. Correction of a pending request cancels its old card before preparing another one. Text “כן” never executes.
- Confirmation still uses the separate authenticated endpoint and original atomic RPCs. Stored proposal outcomes are reloaded into the conversation; confirmed event targets remain available for follow-up edits. Cards restore their real terminal status after refresh.
- Whole Responses items and every function-call result are replayed using the official SDK's `toResponseInputItems`. Context compaction drops complete old turns, not individual tool outputs, while preserving structured draft facts and resolved references.
- A per-conversation database lease prevents concurrent turns from overwriting state. A completed request ID returns its existing response without another model request. Other users and changed roles cannot load that conversation. Stale leases are recoverable.

This follows the official [Responses conversation-state guidance](https://developers.openai.com/api/docs/guides/conversation-state). OpenAI requests retain `store: false`; application conversation persistence is in Supabase, not the provider Conversations API.

## Persistence, privacy and limits

Apply `supabase/migrations/017_ai_conversations.sql` after 015 and 016. It creates `ai_conversations`, `ai_conversation_turns` and server-only begin/finish/release RPCs. Existing business records and authorization policies are not modified.

The browser stores only a user/role-scoped conversation UUID. Messages, typed draft and bounded tool context are private server records. GET restoration returns visible messages and confirmation statuses, never the raw model context. Business phone numbers and existing customer/employee notes are not added to model tool outputs. No chat/provider payloads or credentials are logged by the production endpoints.

Conversation access expires 24 hours after its last completed turn. Expired conversations/turns are removed lazily on that actor's next conversation request; this is not a promise of physical deletion at the exact expiration time. Apply an organization-appropriate scheduled retention policy if exact physical deletion deadlines are required. Proposals and the business-action audit retain their independent existing policy.

Current bounds: 20 retained active conversations/actor, 200 turns/conversation, 40 visible messages (with a further text-size bound), bounded whole-turn model context and references, six model rounds/tool-call budget, the existing 50-second request deadline, and a 70-second recoverable conversation lease. Existing usage quotas remain **6 requests/user/minute, 40/user/UTC day, 300 globally/UTC day**; rapid follow-up messages can reach the existing minute limit. No quota expansion was applied. Model selection is still controlled by `OPENAI_MODEL`, with default `gpt-4.1-mini` unchanged.

## Verification

`npm run test -- ai-assistant` covers deterministic model orchestration with real local PostgreSQL/PGlite, strict field types, Hebrew enum mapping, partial state, saved lookup IDs, reload, corrections invalidating old cards, canonical payment defaults, event/employee ambiguity choices, actual read results, manager rejection, leases and private-table grants. Existing event/payment/settlement/auth tests remain part of that suite.

Final checks: **38 assistant tests passed**. Repository-wide tests: **158 passed, 2 existing WhatsApp template failures**. TypeScript and production build passed. ESLint for the changed source/scripts passed; full repository lint retains **4 existing errors and 9 warnings** in unrelated files. Browser RTL/layout checks passed for owner and manager at 320, 390 and 1280px with no horizontal overflow and 44px touch controls. Those layout checks are server-rendered fixtures, not a deployed authenticated browser session.

The opt-in paid command below uses a real OpenAI model and synthetic local PostgreSQL, without accessing/mutating the live Supabase application:

```powershell
node --env-file=.env.local --import ./scripts/test-register.mjs scripts/check-ai-conversations.mjs
```

Eight live scenarios passed with default **gpt-4.1-mini** and also with **gpt-5.4-mini**:

1. “תוסיף אירוע למחר” → “קסנאדו” → “250 אורחים” → remaining details → real card → explicit confirmation → database creation. Reload, text “כן” and repeated confirmation are checked.
2. “תשנה את האירוע של דני ל-300 איש” → actual target → card → database update; contextual correction and cancellation do not revert the already committed change.
3. “שבץ את יוסי לאירוע של מחר” → actual ambiguous events → selection → confirmed assignment.
4. “רשום תשלום של 2000 שקל” → event/details → confirmed 2000 ILS payment; duplicate click records only one payment.
5. “מי עובד מחר?” → answer includes the employee actually assigned in the synthetic database.
6. Manager financial action → no proposal and no payment mutation.
7. “תכניס ארוע למחרתים” → correct Israel-local date despite spelling/synonym → draft cancellation.
8. “תוריד את יוסי מהאירוע של דני” → confirmed assignment removal; employee record retained.

Synthetic transcripts/tool states and assertions are written under `test-results/ai/conversation-live-<model>.json` (ignored by Git and retained across builds). They are test artifacts, not production chat logs. The harness asserts database outcomes; it does not merely compare canned assistant text. Live model checks are opt-in because they use network access and paid tokens. They are not authenticated end-to-end tests of a deployed Supabase/Vercel environment.

Event cancellation/deletion, payment deletion, bulk operations and automatic reversal of already committed changes remain unsupported. The application has no safe event cancellation status and its existing deletion cascades payment/staffing records. Pending draft cancellation remains supported and never changes business records. Uncertain dates/names still require clarification; passing these regressions does not guarantee understanding every possible Hebrew utterance.

## Changed files for this repair

- `src/features/ai-assistant/conversation-types.ts`, `conversation-tools.ts`, `conversations.ts`, `conversations.test.ts`: state, semantic/progressive tools, persistence/orchestration and regressions.
- `src/features/ai-assistant/service.ts`: required semantic first step, retained Responses history, typed collection, catalog/entity resolution and clarification.
- `src/features/ai-assistant/http.ts`, `src/app/api/ai-assistant/route.ts`: new single-turn protocol, authenticated restoration, legacy read-only compatibility and useful errors.
- `src/features/ai-assistant/chat.tsx`, `confirmation-card.tsx`, `action-types.ts`, `src/app/(dashboard)/ai-assistant/page.tsx`: restored chat, real choices, role-scoped metadata and persisted confirmation status.
- `src/features/ai-assistant/action-registry.ts`, `action-proposals.ts`, `assistant.test.ts`: optional update notes, safe lookup fallback and adjusted privacy assertion.
- `supabase/migrations/017_ai_conversations.sql`: private conversation tables and RPCs.
- `scripts/ai-conversation-fixture.ts`, `check-ai-conversations.mjs`: synthetic real-database fixture and repeatable real-model conversation checks.
- `scripts/check-ai-configuration.mjs`: presence-only environment checks, zero-row infrastructure-column checks and read-only REST function metadata checks.
- `docs/ai-assistant.md`, `docs/ai-conversations.md`: current setup and diagnosis/verification report.
- `.gitignore`: excludes generated test results.

After applying 017 and 018, redeploy/restart with the existing server OpenAI/Supabase environment variables and reload the installed PWA so it uses the new message protocol. No new key or external storage service is required. Verify authenticated owner/manager restoration and confirmation in the deployed environment before release; remote migration/deployment and live business mutations were not performed here.

A read-only probe of the connected Supabase project found the required AI infrastructure tables/columns and metadata entries for `begin_ai_turn`, `finish_ai_turn` and `release_ai_turn` already available. All required local environment keys were present. The probe fetched zero table rows and did not execute a mutation RPC. Availability is not proof that every remote function body matches this repository migration: check migration history before applying 017 and do not blindly rerun an already-applied migration. Repeat the probe with `node --env-file=.env.local scripts/check-ai-configuration.mjs --database`.

## Final recovery verification

Migration 018_ai_conversation_recovery.sql is required in addition to 017. It saves incoming intent before the model request and checkpoints coherent tool results, so interrupted requests remain recoverable. The server rejects older conversation RPC protocol versions before calling OpenAI.

The read-only remote probe found conversation tables and begin/finish/release RPC metadata, but checkpoint_ai_turn was unavailable. Apply 018 to the connected Supabase project before deployment. Do not blindly rerun an already applied 017. The probe did not read business rows or mutate remote data.

Final deterministic results: 38 assistant tests passed; repository total 160, with 158 passing and the same two unrelated WhatsApp failures. Manager event-creation cards also omit financial defaults. Changed-file additions include supabase/migrations/018_ai_conversation_recovery.sql and the action database regression tests.
