# Customer and staff ticket queue views

Date: October 1, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `07-ui-ux-design.md#T-07.23.01.01`: finish the implemented ticket queue presentation with relative updates, P1/P2/P3 priority indicators and expandable mobile records.
- `07-ui-ux-design.md#T-07.18.01.05` and `07-ui-ux-design.md#T-07.18.01.06`: adopt the shared view controls, responsive defaults, account-scoped preferences and table/card composition for both ticket queues. The all-list parent tasks remain partial.

## Delivered

Customer and staff queues use one accepted page in the shared captioned history table or expandable cards. Responsive defaults select desktop tables and mobile cards until the user chooses a layout. Each account keeps separate customer/staff queue preferences. Both layouts show the escaped subject, localized status, priority code and label, relative update time, exact account-time date, category and existing related-record presentation. Staff records also expose customer ID, assignee and response target. Cards keep secondary fields in keyboard-operable disclosures with ticket-specific accessible names.

Layout changes preserve query/page ownership, selected conversation, unsaved replies, queue errors and exact failed-page Retry without another queue/detail read. Disclosures retain opened ticket IDs across layouts, prune absent IDs and reset with queue criteria. Relative time refreshes once a minute; recent past updates say Just now, while future or invalid timestamps use the account formatter. Invalid target dates cannot throw during rendering. High/normal/low priorities map to P1/P2/P3; unknown values are displayed without guessing a code.

Review caught and fixed a native disclosure race: a deferred toggle event could be lost when the user changed layouts immediately after opening a card. Controlled summary activation now records the disclosure state synchronously, including native keyboard activation. Existing recovery tests explicitly choose the table before testing its horizontal keyboard scrolling; they continue to cover card-first mobile recovery, creation files, replies, assignment, shrinking pages, stale reads and permission denial. Related-record IDs use bidirectional isolation for Persian rendering. Customer invoice links remain available, while staff and unavailable record types retain the truthful existing unavailable-record text rather than guessed URLs.

## Validation and review

- 95 distinct affected unit/dictionary cases pass: 42 web and 53 dictionaries. The web command is `pnpm --filter @barghsa/web test src/components/TicketQueueRecords.test.tsx src/pages/support-queue-recovery.test.tsx src/pages/support-list-query.test.tsx src/hooks/useListView.test.tsx`; dictionaries use `pnpm --filter @barghsa/i18n test`.
- All 68 distinct production browser scenarios pass across Chromium and mobile Safari. They verify real responsive defaults, keyboard disclosure and scrolling, account preference reload, no extra reads on view changes, unsaved conversation work, exact failed-page recovery, existing URL navigation, creation uploads, related invoice links, assignment, status transitions, internal-note visibility, stale reads, actual themes, Axe and mobile bounds. The final 12 affected view/link scenarios also pass after bidirectional ID isolation. Command: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e tickets.spec.ts support-queue-recovery.spec.ts support-list-query.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1`.
- Root build/types/lint/format, contract/suppression and all 66 unchanged route/interaction budgets pass. Admin tickets are 361.01 KB / 500 KB. Backlog validates 1,355 tasks and 116 traceability entries; diff whitespace passes. Strict security passes five fixtures and scans 1,406 files with zero findings/errors. Persian dark customer/staff cards were visually inspected. Final affected checks also pass after ID isolation. Failed or repeated runs are excluded from passing counts.
- Review checked accepted-page and selected-detail ownership, account/history preference isolation, bounded disclosure state, relative/exact dates, priority mapping, staff-only metadata, no implicit ticket reads and preserved permission/recovery paths. Initial failures exposed a stale dictionary build, a table-specific browser fixture and the deferred native toggle race; all were corrected.
- Preceding commit `c8aa01507b90861dd9caa3d739742dbf472d320f` passes all five GitHub CI jobs in run `36923482365`.

## Publication and remaining work

Publish by conventional direct-main commit after validation, then verify local/origin/GitHub SHA, clean tree and exact-commit CI registration. Remote CI remains pending at publication; no remote success is claimed for the new commit. Historical supervisor state, handoffs and completion ledgers remain unchanged, as do existing CI fast mode and coverage exemption.

Other unfinished ticket detail/thread/reply criteria, unavailable related-record destinations and other domain requirements remain open. This batch does not certify those parent features as complete.
