# WhatsApp v1 recovery hotfix

Base: 1ec02ee9ecf7a2997d3bfc5929b991d579fcd81c. This branch contains only a
code hotfix; no migrations or full-upgrade source have been copied into it.

Attendance extraction separates explicit venue, event type and client. Exact known
hall names are preferred before trying Hebrew location prefixes. Explicit Brit and
Bar Mitzvah remain distinct; conflicting hints never produce an automatic match.
When an old catalog omits event_type, the server SELECTs id,event_type from the
existing events table for catalog candidate IDs only. The column exists in 002,
and service_role SELECT is granted by existing 027. Failure of that read fails
closed rather than ignoring the explicit type. No new RPC or grant is required.
Ambiguity requests corrected details or an explicit event choice in the app.
Existing work hours are never used to choose among events. Preparation, sender
permissions, proposal binding, buttons, tokens and the SQL confirmation path remain
unchanged; no hours are committed merely by parsing the message.

Inventory keeps inventory_bottles_v1, existing product IDs, bottle-size distinctions,
cost rules and existing confirmation RPCs. Unit words are stripped only if the
original message contains the same quantity/unit/product phrase. Exact real product
names/aliases are tried first, preserving brands that start with a unit word.
Unknown/ambiguous products remain rejected; no new products or invented price/volume.
Consumption also separates explicit hall/type/client and refuses ambiguity.

This cannot populate an empty catalog. An owner must create the actual product in
the existing app before WhatsApp receipts can resolve it. New-product WhatsApp
creation and optional prices/volumes still require the separate full upgrade.
This also does not repair an invalid OpenAI key, a stopped scheduler or an unrelated
production RPC/permission failure. Verify the deployed SHA and current error codes.

Local validation: unit regressions, the existing attendance confirmation suite,
and a PostgreSQL/PGlite legacy-schema test without migrations 029/031/032. The test
uses the old catalog shape, reads event type as service_role with existing grants,
checks correct Brit matching and ambiguity, prepares a v1 receipt, and proves no
stock movement or employee assignment is saved before confirmation.
The two pre-existing templates.test.ts failures and four baseline lint errors are
outside this hotfix. Typecheck and production build are separate checks.

Release only this hotfix commit/branch, not the dirty main worktree or full-upgrade
archives. Before deployment (separate approval), associate the exact commit with a
staged deployment, check existing environment settings, then smoke-test attendance
and existing-product inventory receipts through explicit confirmation. No 029/031/
032 installation is required. No push, deploy or Production SQL was done here.
