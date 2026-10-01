# Ticket detail, conversation context and status reasons

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `07-ui-ux-design.md#T-07.23.01.02`: finish the implemented ticket detail header with status/priority badges, creation/update dates and related-record context around the existing reply and staff-note controls.
- `07-ui-ux-design.md#T-07.23.01.05`: add bounded reasons to staff status transitions and persist them in the existing transactional audit.
- `07-ui-ux-design.md#T-07.23.01.03` and `07-ui-ux-design.md#T-07.23.01.06`: improve the existing chronological conversation presentation and verify the customer visibility boundary. Full thread/composer requirements remain partial.

## Delivered

Detail headers reuse the queue's status/priority components and display the creation timestamp already returned by the API. Missing creation values are not inferred from updates. Both dates use the existing account timezone/calendar formatter; heading focus, related invoice links, customer contacts, contextual attachments, privacy actions and existing conversation/reply behavior remain available.

The extracted conversation component renders the server's chronological order as an ordered list. Owner replies use the card background, support replies use a brand border, and internal notes use the semantic warning background and localized INTERNAL badge. Initials avatars, isolated author labels and exact account-time timestamps give each message context. Only the existing authorized staff directory/customer detail can supply names to a staff view. Customer views use localized role labels and never render staff login emails/phones or internal/unknown-visibility messages. This does not add new public profile data or avatar image reads.

Staff must enter a nonblank reason before submitting a status change. Reasons survive failed writes and queue Retry, including layout changes; confirmed status writes clear them, and discarding/changing the selected ticket clears obsolete work. The API validates provided reasons as trimmed text of 1–2,000 characters and preserves optional omission for older clients. The service independently enforces the bound and writes the reason with from/to/actor in the same transaction as the status, audit and notification. Permission/session checks, assigned scope, lifecycle transitions and audit rollback remain enforced. No-op repeats neither add another audit nor replace its original reason. Staff audit reasoning is not included in customer ticket responses. The generated OpenAPI contract describes the new input.

## Validation and review

- 179 distinct affected cases pass: 77 API, 49 web and 53 dictionaries. API command: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/tickets/tickets.service.test.ts src/tickets/tickets-http.integration.test.ts`. Web command: `pnpm --filter @barghsa/web test src/components/TicketCommentThread.test.tsx src/components/TicketQueueRecords.test.tsx src/pages/support-queue-recovery.test.tsx src/pages/support-list-query.test.tsx src/hooks/useListView.test.tsx`. Dictionaries: `pnpm --filter @barghsa/i18n test`.
- All 68 distinct production browser scenarios pass with `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e tickets.spec.ts support-queue-recovery.spec.ts support-list-query.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1`. They cover exact creation dates, required reason/failure/confirmed retry, both languages and actual themes, queue/detail/query/draft/permission recovery, files, assignments, status transitions, internal visibility, responsive views, keyboard access, Axe and mobile bounds. The final four mobile Safari capture/recovery cases also pass. Persian customer/staff message cards were visually inspected; repeated runs are excluded from counts.
- Root build/types/lint, generated contract/suppression and all 66 unchanged route/interaction budgets pass. Admin tickets are 362.50 KB / 500 KB. Strict security passes five fixtures and scans 1,408 files with zero findings/errors. Root formatting, backlog and diff whitespace checks also pass; backlog validates 1,355 tasks and 116 traceability entries.
- Review checked transactional reason binding and private output, API compatibility, current permission/session/assignment guards, no-op/audit rollback, exact dates, staff-only names, strict message visibility, semantic colors and state ownership. Initial tests found a missing reason field from an edit and the audit fixture's text JSON column; both were corrected, and the final affected suites pass.
- Preceding commit `7301117d919defffaf0b4567badf60bb84d9ed9b` passes all five GitHub CI jobs in run `36924960405`.

## Publication and remaining work

Publication uses a conventional direct-main commit with local/origin/GitHub SHA, clean tree and exact-commit CI registration read back. New remote CI remains pending at publication. Historical supervisor state, handoffs and completion ledgers remain unchanged, as do existing CI fast mode and coverage exemption.

Comment attachment thumbnails, reply formatting/uploads, public support display names/avatar images, unavailable related-record destinations and other unfinished domain requirements remain open. Full thread/composer and all-list parents are not certified by this batch.
