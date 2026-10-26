# Venue settlement closing

The implementation closes the signed venue settlement (including hall fees by default) through an inclusive cutoff. Positive means the venue owes Tayo; negative means Tayo owes the venue. Customer debt, payments, revenue, payroll and source events are never updated by closing.

## Apply to Supabase

1. In the intended Supabase project, open SQL Editor and create a new query.
2. Paste the **entire** contents of `supabase/migrations/013_venue_settlements.sql` and run it once. It includes a transaction. Existing migrations through 012 and the existing `profiles`/`auth.users` tables must already be present.
3. Then run the entire new `supabase/migrations/014_venue_settlement_allocations.sql`. If 013 is already installed, run only 014. It preserves all existing rows and defaults legacy closings to including hall fees.
4. Confirm `public.venue_settlements`, `public.venue_settlement_snapshot(uuid)` and `public.close_venue_settlement(uuid,date,numeric,uuid,uuid,jsonb,boolean,jsonb)` exist. The migration creates no ledger entries and changes no financial source data.
5. Ensure the application server has `NEXT_PUBLIC_SUPABASE_URL`, its existing public Supabase key, and **server-only** `SUPABASE_SERVICE_ROLE_KEY`. The admin client already used by this repository supplies the latter. Never expose the service key through a `NEXT_PUBLIC_` variable.
6. Deploy/restart the application after applying the migration. The receivables views show an error if the ledger cannot be read, instead of silently showing unadjusted balances.

The migration has **not** been applied to a remote project by this implementation. If this project uses the Supabase CLI migration workflow, apply 013 and 014 through that established workflow instead of also running it manually in SQL Editor.

## Local commands

Use Node 24 (the test loader uses synchronous Node module hooks). In PowerShell:

```powershell
npm.cmd install
npm.cmd run typecheck
node scripts/test.mjs receivables
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run dev
```

Only PGlite was added, as a development dependency for isolated PostgreSQL tests. Tests do not connect to Supabase or read production credentials.

## Behavior and API

- `GET /api/venue-settlements`: owner-only ledger history, paginated internally.
- `POST /api/venue-settlements` with `{ "action": "preview", "venueId": "UUID", "cutoffDate": "YYYY-MM-DD", "includesHallFee": true }`: owner-only server preview, including event count, raw signed settlement, previous closings, difference and a source version.
- POST with `action: "confirm"`, the same venue/cutoff/fee choice, the preview's `version`, and a client-generated UUID `requestId`: recalculates using `calculateReceivableEvent` and writes through the trusted RPC. No client amount is accepted. Retry a failed/lost response with the **same** request ID; a changed preview requires a new explicit confirmation.
- An unchanged zero balance creates no record. A correction to historical event data can be closed again at the latest cutoff; earlier cutoff dates are rejected. Source changes after closing can reopen a balance and remain visible.
- Venue cards, dashboard venue balances and venue Excel exports are **cumulative across all actual events**, regardless of month/event-type filters. Event tables retain filters and display only remaining signed components after closing. Every new closing stores fixed per-event payment and fee allocations. Legacy allocations are reconstructed from immutable source snapshots in chronological order, without updating historical amounts. Later edits reopen only their signed difference.
- The total collectible KPI equals customer debt plus positive remaining venue balances. The signed venue KPI includes amounts owed to venues. The monthly KPI explicitly shows customer debt from that month's events, since a cumulative closing cannot be assigned to particular monthly event rows.
- The default venue Excel contains only open event balances and labels fee-only rows. A separate history export contains original current event calculations, signed closings, remaining balance and immutable event allocations at closing. Customer export code and customer balances are unchanged.

## Atomicity and security

The snapshot RPC returns events, payments and previous closings in one database statement without row-limit truncation. The application recalculates with the existing TypeScript rules, avoiding a second SQL implementation of VAT/payment/hall-fee formulas.

The write RPC takes brief write-conflicting locks on venues, events, payments and the ledger, compares the complete snapshot, and inserts only if it still matches. This also protects against inserted/deleted events, concurrent payments and venue renames. Requests with the same idempotency key return the original record; different requests calculated from the same stale state cannot both insert. A five-second lock wait limit fails safely under contention.

Both RPCs are `SECURITY INVOKER` with an empty search path and execution granted only to `service_role`. The API verifies the authenticated owner; the write RPC separately verifies the recorded creator is an owner. Authenticated owners can read under RLS but cannot directly insert/update/delete the ledger or execute either RPC. The ledger records actor, timestamp, request ID and source snapshot for audit.

## Validation and deployment checks

Local results: 53/53 receivables tests pass, TypeScript passes, production build passes, and ESLint passes for the changed areas. The full test run has three existing failures: manager navigation expects no `/leads` route, and two WhatsApp template expectations disagree with their implementation. Full-repository lint reports four existing errors and eleven warnings outside the changed areas. These unrelated behaviors were left unchanged.

Automated coverage includes both payer types, VAT/payment/hall-fee rules, positive and negative closings, inclusive cutoffs, later events, sequential closings, same-cutoff corrections, invalid/retroactive dates, unchanged customer/export values, dashboard aggregation, Excel, SQL permissions, stale snapshots and duplicate submissions. The actual migration is executed in PGlite PostgreSQL. PGlite serializes its connection: simultaneous submitted promises verify queued duplicate/stale requests, **not independent multi-session lock contention**.

After migration, smoke-test in staging with an owner account: preview and close a positive and negative venue balance, verify the cumulative cutoff balance is zero, and confirm later events remain open. Use two browser sessions to confirm the same preview simultaneously; one should succeed and the other should report stale data. Check Tab/Escape/focus return in the native RTL dialog and verify a manager cannot access the endpoint. Browser interaction and a live multi-session Supabase test were not run locally.

The locking strategy favors correctness and briefly serializes source writes across venues; test latency with production-sized histories before deployment. It does not prevent authorized users from subsequently editing historical source data; such changes appear as new differences rather than rewriting audit records.

## Files changed

- `supabase/migrations/013_venue_settlements.sql`: ledger, RLS and atomic RPCs.
- `src/app/api/venue-settlements/route.ts`: owner history/preview/confirmation endpoints.
- `src/app/api/receivables/route.ts`: complete paginated reads.
- `src/features/receivables/components/venue-settlement-dialog.tsx` and `hooks/use-venue-settlements.ts`: dialog, history, request handling and query refresh.
- `src/features/receivables/components/receivables-page.tsx`, `utils/receivables-policy.ts`, `utils/venue-settlements.ts`: cumulative balances and cutoff calculations.
- `src/features/dashboard/components/dashboard-page.tsx`: remaining signed venue balances using the shared aggregation.
- `src/features/receivables/exporters/venue-receivables-excel.ts`: ledger and remaining balance export.
- `src/features/receivables/utils/receivables-calculations.ts`: direct import of the existing payment calculator; financial formulas unchanged.
- Receivables tests: new settlement/SQL tests, updated historical hall-fee expectations and fixture type fixes.
- `scripts/test.mjs`, `scripts/test-register.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`: reproducible test/type-check commands and PostgreSQL test dependency.

The pre-existing dashboard edits were preserved. `src/features/dashboard/utils/dashboard-calculations.ts` and `venue-settlement-review.txt` were not edited by this implementation.
