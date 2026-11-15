# Tayo AI

`/ai-assistant` is available to owners and managers through the shared desktop/mobile navigation. `/assistant` redirects to it. No floating button is added, so the existing mobile menu, notification UI and logout stay unobstructed.

The conversational repair adds durable partial drafts, required semantic interpretation, restored Responses/tool context and actual record choices. See [diagnosis, new files and live conversation verification](ai-conversations.md).

## Deployment

1. Apply migrations `015_ai_assistant_usage.sql`, `016_ai_assistant_actions.sql`, `017_ai_conversations.sql` and `018_ai_conversation_recovery.sql`, after 013–014. They add usage controls, private proposals/audit, atomic confirmation, private conversation state and interrupted-request recovery. Check migration history before applying previously installed migrations. The read-only remote probe found 017 infrastructure but no `checkpoint_ai_turn` metadata: install 018 before deployment. Missing infrastructure fails closed.
2. Set **server-only** `OPENAI_API_KEY` in `.env.local` and the Vercel project's Environment Variables. Never prefix it with `NEXT_PUBLIC_`.
3. Optionally set `OPENAI_MODEL` (default `gpt-4.1-mini`) to a Responses API model supporting strict function calls. Use a dedicated OpenAI project and configure its budget and model access.
4. Keep existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Also configure the existing **server-only** `SUPABASE_SERVICE_ROLE_KEY` for proposals, confirmation RPCs and the existing settlement/notification workflows. Never prefix it with `NEXT_PUBLIC_`. Ordinary reading still uses the authenticated cookie-scoped client. No new confirmation secret is required.
5. Redeploy after setting environment variables. The route exports `runtime = "nodejs"` and `maxDuration = 60`; ensure the Vercel plan allows a 60-second function. No `vercel.json`, cron, Redis or extra hosting service is required. The total request deadline is 50 seconds; SDK calls have a 20-second timeout and no retries.

The official SDK implements the [Responses function-calling flow](https://developers.openai.com/api/docs/guides/function-calling). The [default model](https://developers.openai.com/api/docs/models/gpt-4.1-mini) supports Responses and function calling. Access depends on the configured OpenAI project.

## Authorization and privacy

Every request verifies the Supabase user with `auth.getUser()` and reads their role from `profiles`. The role is never taken from the request body. Each tool independently checks its allowlist before making database requests. Managers receive operational data only. Financial tools and financial card values are owner-only even if the model tries an unadvertised call. No SQL, table name or column list is accepted from the model. The new entity lookup exposes only bounded name/ID/date results, with assignments and payments scoped to an event; payment lookup requires an owner. Multiple matches require clarification.

Model tools can read data, collect a draft or prepare a proposal; **no execution tool is exposed to the model**. Only the distinct authenticated confirmation endpoint can mutate business data. Phone numbers, employee contact details, existing event/customer notes and raw closure snapshots are not sent to OpenAI. Legacy closure snapshots are read internally to reconstruct allocation history. Database text is untrusted; instructions prohibit following it. The UI renders plain text. Private, actor/role-bound conversation state now persists messages, a draft and bounded model/tool context for refresh recovery, with 24-hour access expiry and lazy actor-scoped cleanup. The browser stores only the conversation UUID. Production endpoints do not log chat/provider payloads or credentials. Private proposals retain validated changes, old-state snapshots and summaries; the audit stores actor/action/target/time/outcome. Proposal/audit retention remains independent. OpenAI uses `store: false`; this does not override provider account retention. The PWA service worker excludes API responses/business pages from caching.

## Confirmed actions

| Action | Owner | Manager |
| --- | --- | --- |
| Create event | Yes; price/VAT/payer details must be explicit | Operational creation, existing defaults: zero price, client payer |
| Update event, guests, date, venue, package, client name, notes | Yes, including pricing/VAT/alcohol costs | Operational fields only; financial fields rejected |
| Assign employee | Yes; existing employee default rate or explicit pay terms | Active employee with their current default hourly rate; no rate disclosure |
| Update assignment role/hours/notes | Yes, including pay terms | Operational fields only; existing pay terms preserved |
| Remove one assignment | Yes | Yes, matching existing operational workflow |
| Record/update one event payment | Yes | No |
| Preview and confirm venue closing, with/without hall fees | Yes | No |

Event cancellation is intentionally unsupported: the application has no cancellation status/workflow, and its existing event deletion cascades payments and assignments. The assistant never substitutes deletion for cancellation. Payment deletion, bulk actions, bank transfers and actual collection/payroll disbursement are also unsupported.

`action-registry.ts` defines strict tool schemas, titles and required permissions. `prepareAction` resolves and validates the current event/catalog/employee/payment state, reuses the existing event/assignment/payment payload builders and validators, and constructs exact Hebrew old/new rows. Owners see canonical VAT, event-payment, salary and hall-fee impact; managers receive no financial values. `prepareVenueClosing` is shared with the existing settlement API and uses the same hydrated allocation calculators.

The model receives only a generic “requires user confirmation” result. The proposal ID, summary and full snapshots are returned separately to the browser, never to the model. Each server-stored proposal has an unpredictable UUID, verified actor and role, 10-minute expiry, validated payload, immutable expected snapshot, and terminal result. A client message request ID plus the normalized tool input produces a unique `(actor_id, request_key)`, so duplicate chat delivery returns the same proposal. This is the server-stored-proposal alternative to bearer confirmation tokens.

The only execution request is `POST /api/ai-assistant/actions` with `{ proposalId, decision: "confirm" | "cancel" }`. It accepts no amounts, entity overrides or actor/role claims. It verifies the session and same-origin JSON request. Browser roles cannot read proposal snapshots, register proposals or call the execution RPC directly. The server-only RPC checks the actor's live role, locks the proposal, checks expiry and expected state, revalidates allowed fields and database constraints, then applies one registered action. Locks use the same ordering as the existing venue-closing transaction. The business change, terminal proposal result and audit outcome commit together. Failed actions roll back the business subtransaction. Concurrent/repeated confirmation retrieves the stored result rather than creating another payment/closing. Cancellation changes only proposal/audit metadata.

Venue closing calls the existing `close_venue_settlement` RPC with the exact preview snapshot, proposal ID as the existing unique request ID, signed amount, hall-fee choice and canonical allocations. No financial calculations were duplicated in SQL. Dependent payments/staffing/catalog rows are part of other proposals' snapshots; any change invalidates the confirmation. Date changes preserve existing assignment timestamps, matching the current form behavior; the card warns that hours may need separate updating. Shared assignment timestamp construction now explicitly uses Asia/Jerusalem, including overnight shifts, on both the existing form path and AI path.

Confirmation cards show pending/success/failure/expiry/cancellation states, prevent repeated clicks, and link to the affected record. Lost responses can be retried using the same proposal ID, including after expiry if execution already succeeded. Query caches for events, assignments, payments, calendar, dashboard, payroll, income, receivables, settlements and notifications are invalidated only after a confirmed database success.

Existing WhatsApp enqueue helpers run after the business transaction commits and only on the first successful confirmation. They use their existing deduplication and settings. A notification failure does not replay or roll back a successful payment/event/closing and is shown as a separate warning. This dispatch is best effort, not a durable outbox; a process crash immediately after commit can prevent notification delivery. No extra notification provider call is made by the model.

## Financial semantics

- Revenue uses the shared VAT calculator and event dates, through today in Israel; future events are excluded from financial summaries.
- Payroll uses the shared assignment salary calculator. Paid/unpaid markers currently live in browser localStorage, so the assistant cannot confirm actual salary payments.
- Estimated operational profit uses the shared net-revenue/staffing/alcohol calculation. Hall fees are returned separately, together with estimated profit after those fees. General expenses and tax are excluded. Incomplete staffing/hours/alcohol inputs yield unknown profit.
- Receivables use the existing event-payment and hall-fee rules. Open venue balances apply hydrated closure allocations, including corrections, negative fees and deleted/moved source events. Customer debt is not reduced by venue closures. Positive venue balance means owed to Tayo; negative means owed to the venue.
- Current balances always include all recorded past events and closures, irrespective of the requested history period. Historical closure lists use the requested cutoff-date period.
- Read-only question tools are limited to 500 rows per source, with exact-count checks. A truncated response is rejected rather than summarized. Ask for one venue or a narrower operational/financial period when the limit is reached. Large single-venue read-only histories need a future aggregation endpoint. Separate question-tool reads reflect live data and are not a transactionally consistent accounting snapshot. Action proposals instead use a coherent PostgreSQL snapshot and revalidate it transactionally at confirmation.

## Cost controls

Atomic PostgreSQL counters enforce 6 requests/user/minute, 40/user/UTC day and 300 total/UTC day across instances. All attempts admitted to OpenAI count, including failed calls. Counters expire automatically on subsequent calls. Denied quota returns 429; quota failures return 503. A request allows at most 12 messages, 2,000 characters/user message, 8,000 characters/assistant message, 12,000 total characters and 48 KB body bytes. Each request has at most six model rounds with actions enabled (four in read-only mode), six function calls, 1,400 output tokens/round and 24,000 characters/tool output. A response includes at most three proposals; registration also caps active pending proposals per actor at 20. Confirmation accepts at most 4 KB and does not call OpenAI. The database executor has a 15-second statement timeout and 5-second lock timeout. Chat context is bounded and automatic client retries are disabled. Changing models changes costs; the quotas are request budgets, not a currency-denominated spending guarantee.

## Validation

Run `npm run test -- ai-assistant`, `npm run typecheck`, `npm run lint`, and `npm run build`. Tests cover the existing reads and quotas, strict action schemas, model/execution separation, HTTP auth/origin/actor checks, Hebrew cards, and real PostgreSQL/PGlite proposal/confirmation workflows: event creation/updates, assignments, payments, closures, cancellation, expiry, stale updates, role revocation, duplicate requests, queued competing confirmations, rollback and audit. PGlite serializes queued requests; run deployment smoke tests against the real Supabase project before release.

After a build, `node --import ./scripts/test-register.mjs scripts/check-ai-layout.mjs` checks the actual server-rendered chat and synthetic confirmation cards with production CSS in installed Edge/Chrome at 320, 390 and 1280px for both roles. It verifies RTL, overflow, composer width and touch targets; screenshots are written under `.next/ai-layout`. Set `AI_TEST_BROWSER` to another Chromium executable if needed. This is a layout check, not a hydrated or authenticated browser test.

An optional **paid**, synthetic-only API smoke check is `node --env-file=.env.local --import ./scripts/test-register.mjs scripts/check-ai-openai.mjs`. Append `--actions` to validate all owner action-tool schemas and one synthetic proposal function call. The script does not access application data, register proposals or execute actions. It prints only status, never the key or raw provider errors. A provider 429 requires checking the account's usage limits/billing or trying later.

Before production release, sign in as an owner and manager and test the suggested questions against known events and settlement records. On a phone and installed PWA, check keyboard access, conversation scrolling, menu/logout, offline errors, long Hebrew text, loading, retry and clearing a conversation. Live answers require the migration, valid OpenAI configuration, and authenticated Supabase data; test fixtures do not establish account configuration or real-data correctness.

## Delivery verification (2026-11-10)

- `npm run typecheck`: passed. `npm run build`: passed, including `/ai-assistant`, `/api/ai-assistant` and `/api/ai-assistant/actions`.
- Assistant tests after the conversational repair: 38 passed, including PostgreSQL quota/action/conversation checks. Full suite: 158 passed, 2 failed in unchanged WhatsApp template tests (`hello_world has no body parameters` and `owner custom work-time parameters may include salary`).
- ESLint for all changed TypeScript/JavaScript files: passed. Repository-wide lint reports 4 existing errors and 9 warnings in unrelated files; these files were not changed.
- Chromium layout checks: all six combinations of owner/manager and 320/390/1280px passed. Screenshots are under `.next/ai-layout`.
- The new synthetic live OpenAI action-schema check passed (`completed`, valid function arguments). An earlier read-only smoke attempt had returned 429; that is not the result of the current check. No business data was sent and no action executed. Authenticated real-data action execution still requires deployment smoke tests.
- Migrations were tested locally in PostgreSQL/PGlite, not applied to the remote Supabase project. No Vercel deployment was performed.

## Changed files

- `package.json`, `package-lock.json`: official OpenAI SDK dependency.
- `src/app/(dashboard)/ai-assistant/page.tsx`: authenticated page.
- `src/app/(dashboard)/assistant/page.tsx`: legacy redirect.
- `src/components/layout/navigation.ts`, `navigation.test.ts`: shared desktop/mobile entry and role coverage. The existing manager Leads entry is retained in the navigation assertion.
- `src/lib/auth/middleware.ts`: JSON 401 for unauthenticated assistant API requests.
- `src/app/api/ai-assistant/route.ts`: server-only route and Vercel runtime/duration settings.
- `src/app/api/ai-assistant/actions/route.ts`: distinct authenticated confirmation/cancellation endpoint.
- `src/features/ai-assistant/policy.ts`, `chat.tsx`, `http.ts`, `service.ts`, `data-tools.ts`: validation, role policy, chat, request boundary, Responses integration and read-only data tools.
- `src/features/ai-assistant/assistant.test.ts`, `usage-db.test.ts`: authorization, calculations, UI and quota coverage.
- `src/features/ai-assistant/action-registry.ts`, `action-proposals.ts`, `action-types.ts`, `action-http.ts`, `action-effects.ts`, `confirmation-card.tsx`: strict proposal tools, entity resolution, Hebrew summaries, transactional decision dispatch, existing notification integration and inline confirmation UI.
- `src/features/ai-assistant/actions.test.ts`, `actions-db.test.ts`: action security, HTTP/UI and PostgreSQL integration tests.
- `src/features/events/mutation-payload.ts`, `services/events-service.ts`: shared event payload builder used by existing forms and proposals.
- `src/features/event-staffing/mutation-payload.ts`, `services/event-staffing-service.ts`: shared Israel-time assignment payload/time handling.
- `src/features/receivables/utils/prepare-closing.ts`, `src/app/api/venue-settlements/route.ts`: shared canonical venue preview logic.
- `supabase/migrations/015_ai_assistant_usage.sql`: distributed usage controls.
- `supabase/migrations/016_ai_assistant_actions.sql`: private proposals, action audit, coherent snapshots and atomic execution/idempotency.
- `scripts/check-ai-layout.mjs`, `scripts/check-ai-openai.mjs`: repeatable browser and optional paid provider checks.
- `docs/ai-assistant.md`: deployment, semantics, limits and delivery notes.

## Production configuration diagnosis

The old exact response `Tayo AI עדיין לא הוגדר בשרת. יש לפנות לבעלים` came from `handleAssistantRequest` when the route supplied `configured: Boolean(process.env.OPENAI_API_KEY)` as false. That check runs before quota consumption and before calling OpenAI. An invalid key, billing limit, model failure, database failure or WhatsApp setting did not produce that exact response. Missing/empty `OPENAI_API_KEY` in the running deployment is therefore the specific condition indicated by that response; whether the project setting is absent, assigned only to Preview/Development, or was added after the current deployment requires access to Vercel settings.

In Vercel, open the **tayo-bar-app** project → **Settings → Environment Variables**. Define server-only `OPENAI_API_KEY`, select **Production**, save, then create a new production deployment. Updating `.env.local` or an existing project's settings alone does not update the environment of an already running deployment. Do not use `NEXT_PUBLIC_OPENAI_API_KEY`, `OPENAI_KEY`, or a different spelling. No alias or public-key fallback is implemented.

Required exact names:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI Responses API, chat and attendance extraction; server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing Supabase browser/session authentication key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only conversation persistence, proposals and confirmations |
| `OPENAI_MODEL` | Optional model override; trimmed, defaults to `gpt-4.1-mini` |

WhatsApp credentials are not prerequisites for ordinary AI questions. Its webhook/cron reuse attendance extraction but do not set or override OpenAI configuration. Restoring a stored conversation or confirming already prepared attendance does not require another OpenAI call; those operations still require the Supabase server configuration.

Configuration now treats whitespace-only values as missing. The chat and attendance extractors use the same trimmed server key and model settings. Authenticated error responses contain a safe machine code: `AI_CONFIGURATION_MISSING` with exact missing variable names, `AI_PROVIDER_AUTH_FAILED`, `AI_PROVIDER_ACCESS_DENIED`, `AI_MODEL_UNAVAILABLE`, `AI_BILLING_LIMIT`, `AI_PROVIDER_RATE_LIMIT`, `AI_TIMEOUT`, `AI_CONNECTION_FAILED`, `AI_REQUEST_REJECTED` or `AI_PROVIDER_UNAVAILABLE`. A generic unknown failure remains `AI_REQUEST_FAILED`; it is never labeled as a missing key. Billing-limit errors do not suggest that retrying alone will fix them. The UI already displays the API's `error` text; it has no universal “not configured” fallback. Provider error bodies/messages and credentials are never returned or logged by this classification. Server logs contain only safe codes/status and allowlisted missing names.

Safe local diagnostics:

```
node --env-file=.env.local scripts/check-ai-configuration.mjs --database
node --env-file=.env.local --import ./scripts/test-register.mjs scripts/check-ai-openai.mjs
```

The first prints only variable presence, known alternative-name presence and schema availability (zero-row reads). The second sends synthetic text to OpenAI and never executes the returned tool call. Neither checks Vercel's runtime environment. In the diagnostic run, all four required local variables were present, no known alternative OpenAI variable names were present, and the live OpenAI function-call test completed. The connected Supabase exposed the AI tables and `begin_ai_turn`, `finish_ai_turn`, `release_ai_turn`, but did not expose `checkpoint_ai_turn` in API metadata: verify migration **018_ai_conversation_recovery.sql**, its service-role grants and PostgREST schema cache before testing conversation recovery. This is an additional database prerequisite, separate from the missing-key response.

Direct Vercel environment names/scopes remain unverified. After the user explicitly authorized read-only access to local Vercel credentials, the safe metadata diagnostic found the linked project but no Vercel CLI login token or VERCEL_TOKEN. No Vercel environment value was read or modified, and no deployment was triggered. Authenticate locally with npx vercel login, then run node --env-file=.env.local scripts/check-ai-vercel-configuration.mjs to compare names and Production targets without decrypting or printing values. The script reads only the linked project metadata and an existing authorized login; its only remote request is GET with decrypt=false. Current project settings do not by themselves prove which settings an older running deployment received.

References: [Vercel environment variable management](https://vercel.com/docs/environment-variables/managing-environment-variables), [OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes).

## Browser submission and version diagnostics

`AssistantChat` submits its form to `send()`, then React Query calls `POST /api/ai-assistant` with only the current user turn, conversation ID and request ID. Attendance lists take the existing `/api/ai-assistant/attendance` path. There is no browser-side OpenAI-key check. The historical “לא הוגדר בשרת” string originated in an API response, not a hard-coded client fallback. An old restore error could previously remain visible even while subsequent sending was blocked.

Reproducible client faults fixed:

- A missing `crypto.randomUUID` could throw **after** setting the submission lock and before invoking the mutation. The lock would remain set and no HTTP request would be created. UUIDs now use secure `getRandomValues` as a compatibility fallback; preparation occurs before locking, and failures are displayed without consuming the draft or disabling later retries.
- The fetch callback used `AbortSignal.any` and `AbortSignal.timeout` before `fetch`. Browsers lacking these methods failed before HTTP. Chat and attendance requests now use `AbortController`, an ordinary timer and explicit cancellation instead.
- Conversation restoration had no deadline. A hanging GET could keep the composer disabled indefinitely. Restore now times out after 12 seconds; busy polling is bounded at 90 seconds. Opening a new conversation cancels a pending restore and fences stale callbacks.
- Messages of 2,001–12,000 characters were accepted by the textarea but silently rejected by normal-chat `send()`. They now receive a clear length error; attendance retains its separate 12,000-character limit. Buttons also reflect the existing busy-action guard.
- Client error rendering checked `error.name === "Error"`, masking subclass errors. It now displays the safe error message. HTML/non-JSON responses, authentication redirects, HTTP failures, browser/network failures and timeouts have distinct safe codes. A new send clears stale restore errors.

Expand **אבחון שליחה** in the chat to see the client protocol `chat-transport-v2`, safe Vercel Git revision (or `local`), request stage, HTTP status, safe error code and request ID. No prompt, personal data, credentials or raw provider errors appear in diagnostics. A missing server marker is reported as `unknown-or-older`; this is a compatibility observation, not proof of a particular production commit.

The POST client sends `X-Tayo-AI-Request-Id`. At the authenticated API handler boundary, the server logs `Tayo AI HTTP received` with a validated/generated ID and protocol marker, before the existing authentication/configuration checks, and returns `X-Tayo-AI-Version` and the request ID on every handler-generated response. Authorization rules and WhatsApp connections are unchanged. Middleware can still reject unauthenticated traffic before that handler; a browser HTTP 401 should be investigated as a session failure rather than a missing OpenAI key.

`public/sw.js` already excludes API responses and non-GET requests from caching; no service-worker change was needed. The current Git HEAD (`c888f7a` when inspected) still contains the old configuration error text, while the prior configuration fixes and this repair are local working-tree changes. The actual deployed Vercel revision remains unverified because the linked local project has no available Vercel login/access token. Do not infer that Production has a missing key solely because a stale UI shows the historical message.

Validation:

```
npm test -- client-transport
node scripts/check-ai-chat-transport.mjs
npm test
npm run typecheck
npm run build
```

The browser check bundles the real React chat using the installed Next.js webpack and launches an isolated headless Chromium profile against a synthetic localhost HTTP server. It exercises real hydrated form submission, compatibility without modern AbortSignal methods/UUID API, pre-HTTP failures and retry, attendance routing, length errors, escaping a hanging restore, clearing a stale restore error, and displaying an actual HTTP 503 from an older API. It asserts exactly one POST after successful submission and no uncaught browser exceptions. Only the test fixture's link component and HTTP backend are mocked; no production authentication bypass, real OpenAI call, WhatsApp message or business-data write is involved.

All seven hydrated-browser scenarios passed. TypeScript, production build and scoped ESLint passed. The full Node test suite reported 189/191 passing, with only the same two pre-existing WhatsApp template failures. These checks establish the local request path and regression fixes; they do not establish which pre-HTTP fault, if any, occurs on the user's production browser. Deploy the repaired source and compare the visible transport/build marker and correlated request ID before attributing a production failure to a missing key.
