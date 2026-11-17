# Central bottle inventory

## Scope and entry points

`/inventory` manages one central stock of whole bottles. Bottle volume identifies a product; it is not a fractional-stock unit. There are no event dispatch/return balances, open bottles, automatic product creation or automatic event creation.

- `src/features/inventory/domain.ts`: strict extraction schema, deterministic product/alias and event matching, whole quantities and exact integer-agorot helpers.
- `src/features/inventory/http.ts`, `src/app/api/inventory/route.ts`: authenticated API with verified actor, Origin checks and explicit confirmation.
- `src/features/inventory/page.tsx`, `src/app/(dashboard)/inventory/page.tsx`: RTL catalog, receipt/consumption/adjustment previews, stock filters, history and reversals.
- `src/features/inventory/whatsapp.ts`: existing OpenAI configuration and Structured Outputs; model extracts data only. The server resolves existing records and prepares a report.
- `supabase/migrations/027_inventory.sql`: catalog, reports, immutable movement ledger, audit, sender permissions and transaction functions.
- `supabase/migrations/028_inventory_whatsapp.sql`: integration into existing inbound, decision and delivery queues.

## Permissions and accounting

Only owners can create/edit/disable products, change costs, adjust stock, reverse movements and grant WhatsApp receiving permission. Managers can read operational stock and submit consumption for existing events. Prices, preview costs, movement costs and valuations are removed from manager API responses. Direct authenticated table reads are owner-only under RLS; mutation functions are service-only behind verified API actors. Owner financial reads use a dedicated authenticated RPC that verifies `auth.uid()`.

Products start with zero stock. Initial stock requires a confirmed receipt, preserving a ledger entry. Manual adjustments and reversals require reasons. Product/price edits have before/after audit records. Movements cannot be updated or deleted. Historical event references cannot be silently deleted with their movements.

Money is stored as integer agorot (`bigint`); prices cross JSON boundaries as decimal integer strings. Decimal price entry is parsed without floating-point multiplication. Confirmation locks products in stable order, rechecks stock and current prices, then inserts all movements atomically. A failure rolls back all lines. Current stock is maintained by ledger triggers; direct balance changes are rejected. Each movement records its unit cost at confirmation. Later price edits do not change historical costs. Reversal uses the original movement's cost and can occur only once per movement.

Event costs are consumption minus reversals of consumption. Receipts do not count as event consumption. Dashboard, reports, event views and the authorized AI financial summary use actual tracked costs in place of the previous estimate; they do not add both. An actual net zero still replaces the estimate. Events without inventory history retain their estimate. Existing estimates are not automatically backfilled into stock movements. Inventory does not create a second expense entry for these same costs.

## WhatsApp lifecycle

The existing raw-body Meta signature validation, configured business number check, authorized-sender table, webhook, worker, cron, decision queue, outbox, retry logic and service window are reused. No new provider, transport or cron is introduced.

1. Explicit Hebrew consumption/stock-receipt intent routes a fresh provider message ID into the same inbox with `report_type=inventory`. Attendance remains on its existing path. Repeated webhook delivery of the same ID stays deduplicated.
2. Extraction never receives prices or authority to write. The server validates existing active products, sizes, aliases, event/date and positive whole counts. Unknown/ambiguous data, fractional bottles, insufficient stock, price instructions or mixed attendance/inventory produce correction feedback without movements.
3. A pending inventory report and summary are prepared. Visible WhatsApp text contains no prices, UUIDs or confirmation commands. Real Meta reply buttons carry the report/token internally. The existing receipt acknowledgement starts the ten-minute server-time confirmation window only after actual delivery acknowledgement.
4. The shared webhook receives `interactive.button_reply`. The decision worker validates sender, current mapped user/role, report, nonce, originating provider message, delivery policy and expiry. Cancellation records no movement. Confirmation rechecks all data and stock transactionally; success feedback is queued only after the database commit. Repeated confirmation cannot insert a second movement.
5. Receiving stock through WhatsApp additionally requires an owner-issued permission bound to the sender's current user. It is rechecked at confirmation, so revocation or remapping invalidates a pending receipt. App receipts remain owner-only.

Button delivery failure follows the existing visible error/retry path; there is no text-command fallback. Pending, approved, rejected and failed inventory inbox entries and delivery states appear on `/inventory`. Attendance entries remain in the existing Tayo AI inbox. Low-stock movements create deduplicated owner notifications in the existing application notification table.

## Deployment preparation — approval required

No Production migration, deployment, commit or push was performed for this change.

After review and explicit approval, fresh installations apply **027 → 028 → 029 → 030**, following migrations through 026. The inspected deployed database already has an older variant of 027: do not rerun its CREATE TABLE statements. Review migration history and apply pending **028 → 029 → 030**; 030 adds missing snapshot columns and refreshes the inventory contract. See [the incident report](inventory-production-incident-2026-11-17.md) for verified drift, validation and release steps. Migration 028 preserves the existing attendance decision/acknowledgement behavior while adding domain dispatch. No products or prices are seeded.

No new environment variables, Meta templates, webhook URLs or scheduled jobs are required. Existing Supabase server credentials, OpenAI configuration and working Meta Cloud API/outbox configuration are reused. Prices must be entered by an owner in the app; no real catalog or financial values are invented or seeded.

After deployment, the owner creates the actual catalog, including bottle sizes and any unambiguous aliases, confirms initial stock receipts and optionally enables receiving for specific existing authorized WhatsApp senders. The page currently returns the latest 500 movements, 200 reports and 500 selectable events; it is not an unlimited historical export. Bot catalogs enforce explicit limits and request narrower data rather than silently resolving beyond them.

## End-to-end verification in a test environment

1. Create an existing test event and three products with explicit bottle sizes and owner-entered test costs. Confirm receipt of 20 bottles each; before confirmation stock must remain zero. Check the receipt ledger and owner valuation.
2. Send a consumption message naming that event/date and quantities 4, 3 and 2. For illustrative test costs of 90, 75 and 45 shekels, the confirmed event cost must be 675 shekels. These are test inputs only. Before clicking the real reply button stock must remain unchanged. Confirm and verify stock 16/17/18, nine bottles consumed, recorded actor/time and event costs.
3. Repeat the webhook/click; stock and ledger must not change twice. Send a new message ID with the same content; it gets a new preview and requires a new explicit confirmation. This is distinct from replaying an already confirmed report.
4. Test unknown product/event, ambiguous name across two bottle sizes, insufficient stock, fractional quantity, cancellation and two competing pending reports. No rejected multi-line report may save partial movements. Dot-separated full dates must work; decimal quantities must fail.
5. Verify a manager cannot see prices in the UI or API and cannot alter them by forged requests/direct RPC. Receiving through WhatsApp must fail without an owner grant, succeed with it, and fail if the grant is revoked before confirmation.
6. Change a cost after a confirmed event and verify its historical movement remains unchanged. Reverse a consumption with an owner reason; verify restored stock, original-price reversal and recalculated net event cost. Reversing twice must fail safely.
7. Verify attendance summaries/approval/cancellation and existing notification delivery still work. Test button-send failure, retry and expiry with the existing outbox. Verify responsive layout on a real phone and desktop.

## Automated validation and remaining manual checks

PGlite tests apply migrations 027/028 with the existing attendance migrations and exercise actual PostgreSQL transactions, RLS, ledger triggers, rollback, receiving grants, shared decisions and attendance regression. Structured extraction, API authorization, webhook routing, matching and money arithmetic have automated coverage. Tests use a fake OpenAI/Meta transport; no live provider or Production database is mutated.

The full suite currently has two pre-existing failures in `src/lib/whatsapp/templates.test.ts` concerning notification template parameters. These unrelated notification behaviors were left unchanged. Inventory tests pass. Real Meta delivery, real migrated Supabase permissions, initial stock/catalog setup and mobile visual verification still require the test-environment checks above.
