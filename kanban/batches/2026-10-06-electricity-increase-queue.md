# Electricity increase queue and account-zone adjustment dates, October 6, 2026

Release `v0.1.24`. Manual direct-main batch, no PR or supervisor-state changes.

## Canonical scope

Staff increase queue presentation under `03-core-business.md#T-03.08.01.04`, retaining approval/rejection engines under `#T-03.08.01.05` and `#T-03.08.01.06`. Repairs effective-date interpretation in both increase and price-adjustment staff callers of the shared helper. Domain adoption advances `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`; broader/global criteria remain partial. No new completion count for already built business engines.

## Delivered and reviewed

Pending and expired increases now have named desktop tables and mobile cards. They show public request identity, exact original/requested quantities, the established percentage calculation, account-zone effective/end/request dates, contract status and direct links to the exact staff contract and order. Expired records additionally show adjustment invoice status/reference, exact paid amount and the server's financial-follow-up outcome. Invoice badges and references occupy separate lines. Missing invoices/payments remain explicit.

A 44-pixel Review request button focuses the existing decision card for that exact request. Per-request approval/rejection forms remain outside the table/card switch with their existing keys and raw draft maps. Resizing neither recreates these owners nor duplicates previews or commands. Existing pending/expired URLs, exact cursors, recovery, current denial, actor scope, captured reviews, receipts, step-up and idempotent retry retain their engine.

Both staff adjustment screens previously used browser-local dates. Displays and financial summaries now use the saved account timezone/calendar. Gregorian datetime-local fields state their interpretation zone and resolve through the existing timezone-aware invoice/date-picker helper. Invalid dates, DST gaps, invalid/unavailable zones are rejected; optional increase dates retain server selection, and supported seconds/milliseconds are preserved. Approval/proposal controls wait for a verified timezone and expose its retry notice. Preview validation/results are bound to the timezone used to interpret the raw draft; a changed zone cannot publish that obsolete result. Already captured commands retain the resolved ISO instant, body, hash and key.

No API, database, shared-component, dependency, permission-model, CI or budget change. Price-adjustment list presentation remains a separate task.

## Validation

- **207** distinct related source/dictionary cases pass: 95 across nine increase/price/navigation/recovery/date-helper files and 112 dictionary cases. Added regression checks account-zone conversion independent of browser defaults, precision, rollover/DST gaps, unavailable approval settings and zone changes during a held preview.
- **52 distinct** Chromium/mobile Safari cases pass, 26 per engine, with zero retries: 16 new pending/expired directory cases and 36 existing request/signing, staff decision, price publication, customer disclosure, URL/cursor and recovery cases. New cases run a Los Angeles browser with a Tehran account and verify exact quantities/payments above the JavaScript safe-integer range, account dates, direct reference links, focused decision owners, raw draft/confirmation retention, axe, responsive bounds and 44-pixel actions. Eight final expired-directory cases and the refreshed expired capture use the reviewed invoice layout; 36 unchanged engine cases and eight unchanged pending-directory cases retain their passing evidence.
- Production web build, workspace types, root/focused lint, contract/suppression, strict SAST (1,798 files; zero findings/errors; five fixtures), all 85 unchanged bundle budgets, formatting, backlog and diff checks pass. Increase and price-adjustment routes remain within their existing 500 KB gzip limits.
- Two original Persian light/dark native-browser directory captures are reviewed. Fixtures are synthetic. External source/assets and passing-report hashes bind the final browser build and 494 assets; publication/deployment receipts remain separate.

Failed attempts remain external. Checks caught missing shared-cell props and the second effective-date helper caller; both are corrected. Existing mocked formatters now include exact money/numeral preferences and verified account time. Source focus checks await asynchronous validation focus without weakening the assertions. Browser expectations preserve exact values while allowing localized grouping and the browser engine's Intl punctuation. Visual review separates the expired invoice badge/reference. No test retries, forced clicks, guard relaxation or budget changes.

## Prior release confirmations

`v0.1.22` completed at `2026-10-05T23:28:21.385967+00:00`, with exact healthy live commit `824075a5279d02e6d15e80b944fe85a132ae28e3`; Persian Telegram note `67` and captures `68`, `69` are confirmed. `v0.1.23` completed at `2026-10-05T23:37:56.723877+00:00`, with exact healthy live commit `5757a0b600db101d7cefb2504fdb566364bc19e3`; note `70` and capture `71` are confirmed. Their reports and external completion receipts record these results.

External evidence: `~/.local/state/barghsa-manual-batches/electricity-increase-queue/`.
