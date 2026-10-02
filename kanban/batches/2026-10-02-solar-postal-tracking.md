# Solar postal tracking, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.18.03.05`: finishes the missing arrival estimate and external tracking link in the existing solar request/postal detail pattern. Stage status, original-document instructions, document review and construction progress remain the existing domain-owned records.
- `03-core-business.md#T-03.12.03.01` through `03-core-business.md#T-03.12.03.06`: preserves guidance, customer shipment entry, optional receipt uploads and separate staff receipt/issue decisions. These were existing features; this batch validates them with the new tracking controls rather than claiming six new implementations.
- `07-ui-ux-design.md#T-07.27.01.03` and `07-ui-ux-design.md#T-07.27.01.07`: retains the existing solar progress stepper and provides Persian/English tracking, date, review, recovery and notification text.

## Build and review

Migration `0239_solar_postal_tracking` adds optional arrival date, tracking URL, public note, server-owned revision and recording time. It invents no estimates for existing shipments. The populated upgrade preserves original rows and historical migration checksums, verifies schema checks and repeat migration, and exercises context, revision, timestamp, date, rollback and parcel reset guards. Apply migration 0239 before deploying the API.

Staff can read tracking with live `orders:read` authority and record an update with live `orders:write`, actual staff session context, CSRF, step-up, an exact reviewed snapshot and an idempotency key. Profile/request/parcel locks reject contention with a recoverable conflict. Changed shipment data, estimates or review contents invalidate the reviewed command. Arrival dates cannot precede the recorded shipment day. Notes are explicitly customer-visible. Identical authorized retries do not duplicate audit or notifications; tracking, audit, notification and idempotency storage commit together and roll back on notification failure.

Recording an estimate does not confirm originals, advance the request, create a contract or collect payment. Receipt and issue decisions clear the pending estimate/note/time. A resent or changed parcel clears all old tracking data and advances its revision. The same parcel's HTTPS tracking link may remain after receipt or an issue. The server stores a reviewed staff-provided HTTPS URL, rejects credentials/IP/local hosts/nonstandard ports and normalizes URLs; it does not fetch the courier site or infer provider links. Customers see only authorized public fields. Reads revalidate the current session and profile-order authority before returning data.

The staff postal screen uses the shared calendar picker and confirmation dialog. The customer and staff screens share shipment dates, estimates, a bidi-isolated tracking number, copy feedback, a link showing its hostname, literal public notes and recording time. Calendar dates retain their day across account zones; Persian dates use the Persian calendar. Tracking links open with `noopener noreferrer`, and unsafe legacy values are hidden. Failed customer reads hide old details and allow reload. Failed previews preserve the update; failed saves and step-up retain the exact confirmed command. Selection/reload changes discard obsolete previews. A lost tracking-read grant clears the selected customer and accepted queue data, including protection against a late queue response.

Review corrects a lingering loading message after a failed customer read and makes tracking hostnames readable on mobile. The existing solar journey fixture now supplies the required upload policy and waits until file selection is enabled, matching the production upload form. Its contract-creation assertion selects the success status independently of concurrent queue loading. No upload assertions or checks are weakened.

## Validation

- Root build and all eleven TypeScript tasks pass. The final web build incorporates the reviewed UI changes.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/solar/solar-postal-tracking.integration.test.ts src/solar/solar-postal-tracking.validation.test.ts src/solar/solar-postal.integration.test.ts src/solar/solar-progress.integration.test.ts`: 40 passing cases, including real HTTP/database tracking, current permissions, CSRF/step-up, ownership isolation, stale reviews, exact replay, notification rollback, contention and reshipment reset.
- `pnpm --filter @barghsa/db test src/solar-postal-tracking-upgrade.migrated.test.ts src/solar-construction-progress-upgrade.migrated.test.ts`: both populated upgrades pass against the current journal.
- Seven related web test files pass all 41 cases, including the existing staff queues/navigation/recovery and customer request/document screens plus tracking date/link/read recovery.
- `pnpm --filter @barghsa/i18n test`: all 67 dictionary cases pass. There are 150 distinct passing unit/HTTP/migration cases across these commands; repeated verification is not counted twice.
- Production browser verification uses `e2e/solar-postal-tracking.spec.ts` and `e2e/solar-journey.spec.ts` on Chromium and mobile Safari. Eighteen distinct cases cover both languages, staff/customer tracking, shared step-up/exact lost-response retry, read-only access, failure recovery, loss of read authority, late reviews, full document-to-postal handoff, draft recovery and contract/invoice review. Scoped Axe checks, literal markup, safe link attributes and mobile width bounds are included. Final results are verified before publication.
- ESLint, formatting, OpenAPI contract, suppressed-error checks, all 68 unchanged gzip budgets, database snapshot, backlog and diff checks pass before publication.
- Strict Semgrep 1.176.1 scans 1,456 files with zero findings/errors; all five rule fixtures pass.

Evidence logs use `/tmp/barghsa-postal-*`. The previous saving commit's integrity/security/secret-history jobs pass while its test job is still running at readback. Exact-commit GitHub CI is read back after this direct-main push; remote CI remains pending at publication.

## Limits

Arrival dates are staff-recorded estimates, not live carrier events or promises. External sites may change their status independently. Receipt confirmation still requires staff review of the originals. Notifications are in-app; this batch adds no carrier integration or SMS/email delivery. Historical supervisor state, completion/event ledgers, generated queue and CI settings are unchanged. Other unfinished product tasks remain open.
