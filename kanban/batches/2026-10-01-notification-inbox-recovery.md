# Customer and staff notification inbox recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition and cursor pagination for customer and staff inboxes, with matching header-bell recovery. Existing notification center and badge polling requirements (`05-notifications-documents-ai.md#T-05.02.03` and `.04`) are not counted as newly built. The all-list parent, remaining filter URL serialization and wider delivery-history adoption stay partial.

## Behavior and review

Full inboxes retain accepted notifications during first-page refresh, older-page loading and transient failure. Retry repeats the exact failed cursor; appended pages update repeated IDs without duplicating rows, and repeated cursors fail rather than loop. Changing the filter or operating context discards obsolete page and command completion. Locale changes rerender accepted rows without throwing away the current page. Empty and unread-empty results retain their localized guidance.

Read marking remains optimistic. Failed or malformed acknowledgement restores rows and count, blocks further commands until refresh, and cannot navigate to the linked record. Successful marking uses an integer, non-negative unread-count receipt. Existing route allowlisting and staff/customer destination isolation remain intact. Notification pages validate complete item and envelope shapes, unique IDs, timestamps, localized content, counts, page size and unread-filter semantics before replacing accepted state.

The bell preserves accepted rows through retry, pauses actions during unavailable reads and retains its badge on transient count failure. Permission denial clears private rows, cursor, optimistic work and counts across the inbox and bell in the same operating context. Denied polling stops until accepted list recovery; older count, list and command callbacks cannot restore cleared state. Other operating contexts are not cleared by the event. Poll overlap protection, optimistic-count invalidation and background document-title formatting remain supported.

Review corrected shared pagination composition and empty-state retention, removed whole-row opacity that broke read-notification contrast, and replaced menu semantics around ordinary notification controls with the shared named popover. Hover uses the muted surface to maintain text contrast. Bell controls and the view-all link use explicit tab stops for native keyboard navigation in mobile Safari; Tab/Shift+Tab move between a notification and view-all, and Escape returns focus to the bell. Browser fixtures use persisted locale and current staff/customer sessions; the Persian brand-title expectation is corrected. Long notification bodies can wrap within mobile rows.

No backend, database, dependency, scheduler or CI configuration changes are included. Inbox filter URL serialization remains separate. Automated accessibility checks cover the full inbox page and the open bell content; dependency focus sentinels outside the popover are not included in the content scan.

## Validation

All 92 related web cases pass: nineteen new inbox recovery/race cases, thirty-two new API receipt/page cases, twenty-five notification helpers, five unread-count cases including two new denial cases, four document-title cases and seven category-badge cases. All 53 dictionary cases pass. Final production build and root typecheck pass. Root lint plus the final affected-file lint, all 64 route budgets and contract/suppression checks pass. All 32 distinct production browser scenarios pass across the full run and final sixteen-scenario affected run; failed and repeated cases are excluded. Both contexts, languages and themes, retained cursor pages, writes, denial recovery, background title and numeral preference, open-panel/page Axe checks, keyboard focus and mobile overflow are verified across Chromium/mobile Safari. Persian screenshots are inspected. Final formatting/backlog/diff checks pass. The pinned security scan passes all five rule fixtures and scans 1,318 files with zero findings or scanner errors. No full-web-suite or measured combined-coverage claim is made.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/notification-inbox-recovery.test.tsx src/lib/notification-inbox-api.test.ts src/lib/notifications.test.ts src/hooks/useUnreadCount.test.tsx src/hooks/useUnreadDocumentTitle.test.tsx src/components/NotificationStatusBadge.test.tsx`
- `pnpm exec eslint apps/web/src/components/NotificationBell.tsx --max-warnings 0` — final affected lint
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs notification-inbox-list-recovery.spec.ts notification-center-recovery.spec.ts notification-numerals.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser run uses the same harness/projects with `notification-inbox-list-recovery.spec.ts` alone.
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-inbox-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding assignment-settings batch is published as `135bde3bba3efbf5723bfd24a1e7e758c3db08c0`. CI run `36842678973` passes all five jobs under the existing temporary fast mode; combined-coverage success remains an exemption, not measured coverage. Its progress records are updated.

This inbox batch is published directly to main after review and final validation. Remote SHA and CI availability are read back after publication; no remote CI success is claimed without a registered, passing run. No PR is created. Historical supervisor state remains unchanged.
