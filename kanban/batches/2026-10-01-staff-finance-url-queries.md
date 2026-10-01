# Staff finance and order queue URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` URL serialization to the staff invoice ledger, reviewed receipt history, electricity review/conversation queue and saving review/fulfillment queue using the completed `T-07.18.01.01` query hook. It contributes to the invoice and receipt page patterns, without claiming their whole domain criteria complete. Other legacy filters, broad ListPage adoption and unfinished domain requirements remain open.

## Behavior and review

The ledger retains status, invoice ID, customer profile ID, order ID and its cursor in the URL. Existing `invoiceId` deep links continue to filter and open that invoice. Reviewed receipt history owns separate prefixed status, invoice and cursor fields. Changing one list leaves the other list's criteria and pagination intact. Applied filters survive reload and Back/Forward; invalid form IDs do not navigate or issue reads.

Filtered receipt-history links open the relevant queue and history panel. Explicit collapse is also saved, preserving applied filters across reload without reopening a panel the user closed. Receipt detail, due-date edits, refund drafts and financial confirmation data are not serialized into these list queries.

Finance cursors validate UUIDs and real UTC calendar timestamps while preserving the exact microseconds. Direct router-decoded pairs and generated router string values normalize to the same bounded representation. Unknown fields, malformed cursors and unsupported statuses are discarded. A restored cursor has no invented Previous page; observed navigation supplies the local history.

Ledger Load more still accumulates accepted pages. Refreshing the same page replaces its prior result, and returning to an earlier cursor resets the displayed accumulation rather than duplicating rows. Failed page retry retains accepted rows and the selected invoice detail. Receipt-history retry keeps its exact cursor. Criteria changes exclude rows from another filter basis, while denial clears retained rows. Both expired sessions and missing permission are treated as denial.

Electricity and saving queues keep their queue view/lane, selected order UUID and page cursor in the router URL. Existing electricity order links still open orders outside the active queue; saving orders now support the same deep links. Lane changes clear the cursor and selection together. Selecting an order leaves the queue page intact and does not reload the list. Reload and Back/Forward restore these fields without inventing prior pages.

Queue accumulation accepts a next page only when its cursor follows the accepted page for the same lane. Returning to the first or another restored page replaces the accumulation. Failed next-page retry retains accepted rows and staff drafts, while changing the selected order clears its private drafts and invalidates any pending financial review. Both 401 and 403 discard rows, detail, drafts and confirmation. Navigation stays visible and disabled while loading; repeated server cursors cannot cycle.

Review corrected millisecond-only validation, router cursor escaping, first-page accumulation and pagination visibility during loading. It also added the missing Previous translation. It verified separate query ownership, abort cleanup, repeated-page behavior, receipt collapse and existing finance recovery. The new Previous label is translated in both dictionaries. API production code, database, dependencies, CI, scheduler and supervisor are unchanged. The preceding CI failures required two HTTP fixture repairs. Configuration tests now seed fresh OTP proof as well as password proof, retaining authorization, expiry, current-grant, rollback and audit assertions. The invitation expiry race now waits for the current locked SELECT, including its added created_at column. Two legacy UI cursor fixtures now use UUIDs, and the saving recovery browser test explicitly targets the order queue rather than its embedded cancellation list.

## Validation

The full web suite passes all 1,813 tests across 156 files. All 53 dictionary cases pass. The three relevant PostgreSQL HTTP suites pass all 153 cases, covering the preceding CI failures and the sensitive threshold authorization boundary. This is not a full local API-suite claim.

The finance portion has 36 passing production browser scenarios in Chromium and mobile Safari. Sixteen bilingual/themed URL scenarios cover filters, reload, Back/Forward, independent list scopes, exact microsecond cursors, invalid IDs, panel collapse and honest restored pagination. Twelve existing finance recovery scenarios cover retained rows and financial drafts, exact retries and denial. Eight deadline scenarios cover captured targets and step-up. The final expanded queue run passes all 28 scenarios across the same two browsers: sixteen bilingual/themed URL journeys and twelve queue recovery regressions. This gives 64 distinct passing browser scenarios across the batch. The queue cases cover restored lanes/selections/cursors, reload, Back/Forward, independent detail loading, private draft reset, exact failed-page retry and permission denial. Scoped Axe and mobile bounds pass. Failed and repeated runs are excluded.

Root build, types, lint and formatting pass alongside unchanged OpenAPI consistency, suppression checks, all 64 route budgets, backlog validation and diff checks. The pinned strict security scanner passes five fixtures and scans 1,357 files with zero findings or scanner errors. Persian mobile finance and order-detail rendering in both themes is inspected.

## Publication and CI

The preceding query-framework commit is `e3e85e1add2428906a79beeda8e5c8b4a648c711`; [CI run 36869765546](https://github.com/barghsadev/barghsa-core/actions/runs/36869765546) failed tests and the dependent coverage gate. Integrity, static security and secret scanning passed. Its API suite passed 5,767 cases, failed five and skipped one. The five failures are the outdated OTP/lock-wait fixtures repaired in this batch, with all 153 related HTTP cases now passing locally. That historical run remains failed. Earlier failures remain historical failures, not green runs.

This batch is committed and pushed directly to main after local validation, with remote SHA, clean worktree and exact-commit CI registration read back. Remote CI remains pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged; the exemption supplies no coverage measurement. No PR, handoff, historical loop-state or scheduler change is included.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web test`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/admin/config-write-http.integration.test.ts src/profiles/invitation-http.integration.test.ts src/admin/dual-approval-http.integration.test.ts`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs finance-list-query.spec.ts staff-finance-list-recovery.spec.ts invoice-deadline.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs staff-order-list-query.spec.ts staff-business-list-recovery.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
