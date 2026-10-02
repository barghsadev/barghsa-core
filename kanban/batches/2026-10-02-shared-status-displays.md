# Shared business status displays — October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.27.01.01` — complete: reusable StatusBadge maps waiting/review, active/paid, rejected/failed, draft/submitted and completed/resolved states to the specified tones. Visible labels remain mandatory; the dot-only variant keeps a screen-reader label, and every badge has a descriptive title. Explicit domain tones take precedence.
- `07-ui-ux-design.md#T-07.27.01.04` — complete: electricity lists in both layouts and customer/staff details use two separately labeled commercial and financial statuses. Completed commercial status is neutral; unpaid/review/partial funding is warning; paid/refunded is success. Unknown or cross-domain states display a localized neutral fallback.
- `07-ui-ux-design.md#T-07.27.01.05` — complete: all six notification categories retain distinct icons, colors and visible localized labels in the shared inbox/bell row. Titles also carry the label; icons are decorative.
- `07-ui-ux-design.md#T-07.27.01.07` — advanced only for the electricity and notification labels touched here. Localization across other status domains remains open. Status timeline, progress stepper and solar stage tasks `.02/.03/.06` remain open.

## Build and review

One shared tone function supplies presentation defaults without making lifecycle or permission decisions. Electricity domain allowlists prevent unknown machine identifiers, inherited object names and missing translation keys from leaking into labels. Staff detail preserves existing translations and falls back to the customer dictionary for supported states missing in staff copy.

The same DualStatusDisplay renders table and card statuses, with native definition-list associations and field-specific titles. Layout switching preserves the accepted page without reading it again. Persian mobile rendering was inspected: commercial and financial labels remain distinct and their text fits.

## Validation

- `pnpm --filter @barghsa/ui test src/workflow.test.tsx` — **32 passed**.
- `pnpm --filter @barghsa/web test src/lib/electricity-status-tone.test.ts src/components/NotificationStatusBadge.test.tsx src/routes/_app/electricity/orders.test.tsx src/pages/electricity-order-details.test.tsx src/pages/admin-electricity-orders.test.tsx src/pages/staff-business-list-recovery.test.tsx src/pages/staff-order-list-query.test.tsx src/pages/notification-inbox-navigation.test.tsx src/pages/notification-inbox-recovery.test.tsx` — **110 passed**.
- With `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`, `pnpm --filter @barghsa/web e2e e2e/status-displays.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **12 passed**. Covers independent electricity labels/colors in both layouts, unknown-state fallbacks, all notification categories in inbox/bell, staff linked details, English/Persian, scoped Axe and mobile bounds.
- With the same environment, `pnpm --filter @barghsa/web e2e e2e/electricity-journey.spec.ts e2e/electricity-simple-journey.spec.ts e2e/notification-center-recovery.spec.ts e2e/customer-history-filters.spec.ts --grep 'electricity|notification|bell' --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **24 passed**. Covers order/quote/staff approval/payment/published contract, history filters/pagination/URLs and notification read/recovery behavior.
- **142 distinct unit cases and 36 distinct production browser scenarios** pass. Two repeated Persian list scenarios provide targeted visual capture and are excluded from the distinct count. Final web typecheck passes after correcting screenshot options.
- Root `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors` and `pnpm check:bundle` — pass before publication, with all **66 unchanged** budgets. Backlog validation and whitespace checks also pass.
- Strict security scanner — all five fixtures pass; **1,428 files**, **0 findings**, **0 scanner errors**.

## Publication and limits

Publish directly to main after validation, then read back the local/origin/GitHub SHA, clean worktree and exact-commit CI registration. The preceding money batch passes all five CI jobs in run `36980271574`. New remote CI remains pending at publication.

No dependencies, endpoints or schema changes are required. Other kanban parent criteria remain open. Historical supervisor state, scheduler, handoffs and existing CI fast mode/coverage exemption remain unchanged.
