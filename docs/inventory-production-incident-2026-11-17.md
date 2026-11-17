# Inventory and WhatsApp incident — 2026-11-17

## Verified cause and scope

Read-only diagnostics against the Supabase endpoint configured in `.env.local`
(hostname fingerprint `4c7f6830c083bb83`) returned these facts. Deployment configuration
must still confirm that Production uses this same endpoint; no deployed commit SHA
or authenticated Production browser session was available.

- The installed `inventory_overview` succeeds but returns only `events`, `reports`,
  `senders`, `products`, `movements`. It omits `inbox`. The old client asserted a
  TypeScript `Data` type without validating JSON and called `data.inbox.map`.
  Empty stock is not the cause: the current SQL returns empty arrays with COALESCE.
- `inventory_reports.preview_costs` and `event_snapshot` are missing (`42703`).
  This is an earlier deployed schema variant, not simply an empty database.
- `inventory_cancel`, `inventory_catalog`, `receive_inventory_whatsapp`,
  `prepare_inventory_whatsapp`, `execute_inventory_decision` are absent from
  service-role OpenAPI metadata. These are supplied by migration 028.
- The previous webhook used a narrow inventory keyword regex and sent everything
  else to `receive_whatsapp_attendance`. The worker trusted the stored report type
  and sent unrecognized inventory messages through attendance extraction. Examples
  include `נצרכו באפטאון 4 בקבוקים` and `קליטת מלאי 12 גרייגוס`.
- The shared SQL failure outbox also hardcoded “לא נשמרו שעות” for all domains.
  Thus even correctly routed inventory failures could produce attendance wording.

## Route and component audit

`src/app/(dashboard)/inventory/page.tsx` is a valid App Router page. It awaits
`searchParams` and `requireCurrentUser`, then loads the client `InventoryPage`.
The dashboard layout authenticates and renders `AppShell` with the existing
QueryClient provider. `InventoryPage` uses `ProductForm`, `Stat`, domain money
helpers, the new API contract and the existing `/api/inventory` handler. Desktop
and mobile navigation both link to `/inventory`; event links use its `event`
query parameter. There is no `/inventory/count` route or separate count URL.

No `notFound`, conflicting rewrite, basePath or inventory-specific redirect was
found. The proxy refreshes authentication; the API verifies owner/manager roles.
Unauthenticated local production-build checks returned `/inventory` → 307 login,
`/api/inventory` → 401 JSON, `/favicon.ico` → 200 image/x-icon. The build manifest
includes all three. The reported Production page 404 was not reproduced; confirm
the exact requested URL and active deployment before attributing it to a route bug.
The favicon was absent from tracked source and is now an App Router metadata asset.
The service worker does not cache authenticated pages, APIs or RSC responses.

## Changes

- `src/features/inventory/contract.ts`, `contract.test.ts`: validate server and
  browser response shapes, financial field permissions and catalog arrays.
- `src/features/inventory/http.ts`, `http.test.ts`: validate RPC results before
  array access, identify schema/permission failures, log safe original SQL codes,
  operation and diagnostic ID; avoid caching private responses.
- `src/features/inventory/page.tsx`, `page.test.ts`: use the validated loader;
  cover loading, empty catalog, populated catalog, API error and retry UI.
- `src/features/inventory/domain.ts`: use the shared intent classifier.
- `src/features/inventory/whatsapp.ts`, `whatsapp.test.ts`: validate catalog and
  extraction shape, report processing stages, reject extracted actions that
  contradict explicit intent, and retain existing product/event resolution.
- `src/lib/whatsapp/report-routing.ts`, `report-routing.test.ts`: classify
  attendance, consumption, receipt or clarification. Mixed/unclear messages request
  clarification and never enter a business parser.
- `src/lib/whatsapp/webhook.ts`: classify before durable intake; preserve signature,
  business number, sender authorization and provider ID deduplication.
- `src/lib/whatsapp/attendance-worker.ts`, `attendance-worker.test.ts`: classify
  again after claiming and verifying the sender; repair stale domain labels only
  under the current processing lease. Test separation in both directions.
- `src/lib/whatsapp/attendance-failures.ts`: identify incompatible inventory
  catalogs without inventing a database error code or endlessly retrying.
- `src/lib/auth/middleware.ts`: return 401 JSON for an expired inventory API
  session, preserving session cookies, instead of redirecting fetch to HTML.
- `src/app/favicon.ico`: supply the missing icon through Next's file convention.
- `supabase/migrations/029_inventory_failure_feedback.sql`: domain-specific
  inventory failure feedback using the existing outbox and deduplication.
- `supabase/migrations/030_inventory_schema_alignment.sql`: add the missing
  snapshot columns and refresh inventory functions/triggers/grants from the current
  027 definitions without recreating tables or changing stock/history.
- `src/features/inventory/inventory-db.test.ts`: exercise both migrations, simulate
  the missing deployed columns, apply alignment twice, verify actual PostgreSQL
  transactions, roles, costs, confirmation, deduplication and failure feedback.
- `scripts/check-inventory-schema.mjs`: read-only zero-row column checks, RPC
  metadata, and overview field names. No data values, phones, URLs or credentials
  are printed. The overview read RPC uses POST because authorization takes a shared
  row lock; GET rejects that lock with PostgreSQL `25006`.

Explicit interactive WhatsApp confirmation remains mandatory; text approvals do
not write. Existing atomic ledger transactions, sender remapping/revocation checks,
receiving grants, owner-only prices, whole bottles, central stock and event cost
snapshots are preserved. No products or events are created by WhatsApp. PGlite
tests verify no movements before approval, no duplicate confirmation, receiving
revocation, cancellation, rollback and attendance regression.

## Validation

- Production build: passed; includes inventory API, inventory page and favicon.
- TypeScript: passed (run after build; building concurrently recreates `.next/types`).
- ESLint on every changed/new TypeScript and diagnostic script: passed.
- Full lint: 4 existing `set-state-in-effect` errors in `pwa-provider.tsx`,
  `events-page.tsx`, `notification-center.tsx`, `use-payroll-payment-status.ts`;
  9 warnings outside this fix.
- Full suite: 232 tests, 230 passed, 2 failed in untouched `templates.test.ts`.
  One expects `hello_world` although the configured assignment template is custom;
  the other expects an owner salary parameter that the implementation omits.
  Notification template behavior was not changed as part of this incident.
- Live Meta delivery and authenticated browser checks still require staging.

## Production steps — explicit approval required

1. Confirm the Supabase project, migration history and deployed application revision.
   Rehearse against a staging copy and review the two unrelated test failures and
   existing lint failures before release. Back up the database.
2. For the inspected schema, **do not rerun 027**: its tables already exist and its
   current CREATE statements are not idempotent. Confirm 028 is pending in migration
   history, then apply **028 → 029 → 030**. Fresh installations apply 027 first.
   If 028 is recorded as applied despite missing functions, reconcile that drift
   against a schema dump before executing anything; do not blindly `db push`.
3. Coordinate worker invocation with the release so requests are not processed by
   an old deployment during schema/code transition. The existing Supabase Edge
   Function forwards cron to `APP_URL/api/cron/whatsapp-notifications`; verify that
   APP_URL and Meta's existing webhook both target the updated application. No
   parallel worker, new cron, transport, webhook URL or environment variable is needed.
4. Deploy the reviewed application, rerun the schema diagnostic using Production's
   environment, and verify that overview includes `inbox` and all RPCs are present.
5. Check empty/populated inventory as owner and manager; verify favicon, session
   expiry, existing event links, API failure UI, and absence of prices for managers.
6. Send separate attendance, consumption, receipt and ambiguous messages. Check
   correction feedback, real confirmation/cancel buttons, a duplicate click, event
   costs and unchanged stock before confirmation. Monitor routing and safe failure
   logs and existing queue delivery/retry states. Legacy pending previews without
   product/event snapshots must be prepared and explicitly approved again; no
   historical snapshots are fabricated. Do not mass-reset failed/approved messages.

No commit, push, deploy, Production migration or business data write was performed.
