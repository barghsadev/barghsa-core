# Staff/admin dashboard widget framework — September 30, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.19.01.01`: adopt the shared responsive widget grid and Card header/body on the staff/admin dashboard.
- `07-ui-ux-design.md#T-07.19.01.02`: independently fetch, validate, load and retry staff queues, open work, failures, profile verification, chargebacks and maintenance.
- `07-ui-ux-design.md#T-07.19.01.03`: reserve existing 32rem widget slots throughout loading/error/empty/data states.
- Preserve `07-ui-ux-design.md#T-07.19.02.03`, `.08` and `.09`: verification entries and CRM links, staff work queues, and permission-scoped failure/refund triage links.

The framework now serves the existing customer and staff/admin dashboard widgets. The full business-journey backlog remains open; this does not certify every dashboard-related acceptance criterion or the entire admin product.

## Behavior

Six sibling widget resources have their own loading, failure and retry. Business work counts are split into queue/work/failures endpoints. Each selects only its static, permission-gated SQL expressions; failed background-job reads cannot prevent queue or other business work reads. The legacy aggregate endpoint stays compatible. Authenticated widget reads use private/no-store caching and the current session guards. Denied categories never render invented zero counts.

All staff resources keep their thirty-second refresh, skip overlapping requests and abort on unmount, retry and profile-context revision. Permission denial and disabled verification hide their widgets. Authorized widgets retain the same grid/card dimensions as requests finish; hiding revoked categories intentionally reflows the remaining cards.

An unresolved chargeback warning remains visible during a failed refresh or manual retry, alongside its update failure. A confirmed resolution or permission denial removes it. A failed refresh after a previously loaded zero produces a retryable error rather than claiming no current exceptions. Maintenance and verification have explicit empty messages. Existing counts, exact amounts, severity indicators, five latest profile entries and queue/detail links retain bilingual and RTL support.

## Validation and review

Evidence logs are `/tmp/barghsa-staff-widgets-*.log`.

- Root build, typecheck, lint, format, suppression, OpenAPI contract and all 64 route gzip budgets.
- Six real PostgreSQL HTTP cases cover existing aggregate behavior, scoped counts, current permissions, private caching, unauthenticated/invalid widget parameters, failure isolation and recovery, and permission removal.
- Full web suite passes 1,179 tests. Seventeen final focused tests cover the changed page/counts/hooks plus customer dashboard compatibility; these include the subsequently added stale-zero case. The embedded landmark correction also has a final component rerun and browser verification.
- i18n suite passes 53 tests.
- Twenty-four distinct browser flows are verified across the final runs: ten new bilingual staff-widget scenarios on Chromium, Firefox, WebKit and both mobile projects, plus fourteen affected Chromium verification/chargeback/navigation/customer flows. Initial new-widget failures exposed a duplicate embedded landmark; removing it passes the final ten-project scenarios. Chargeback scenarios are rerun after the stale-zero correction.
- Browser checks cover independent retry counts, reserved geometry, one/two/three columns, empty summaries, permission revocation, automatic refresh, no overlapping held reads, preserved warnings and malformed responses, live CRM/queue navigation and accessibility. Persian mobile rendering is inspected.

Review confirms static SQL selection, existing staff permission predicates and assigned-ticket restrictions, preserved financial warning behavior, abort/revision scoping, bounded requests and accessible embedded markup. No migration, dependency or CI changes are included. Separate resources increase staff business count requests from one to three per refresh in exchange for failure isolation and targeted retry. Longer lists scroll within the existing keyboard-focusable card body.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:bundle`, `pnpm check:suppressed-errors`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/admin/business-work-counts.integration.test.ts`
- `pnpm --filter @barghsa/web test` and `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/AdminDashboard.test.tsx src/components/AdminBusinessWorkCounts.test.tsx src/hooks/useAsyncData.test.tsx src/pages/DashboardPage.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/staff-dashboard-widgets.spec.ts e2e/crm-dashboard.spec.ts e2e/chargeback-dashboard.spec.ts e2e/dashboard-entry.spec.ts e2e/dashboard-widget-loading.spec.ts --project=chromium` — fourteen existing flows pass; two new landmark failures subsequently repaired.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/staff-dashboard-widgets.spec.ts` — ten pass across all five projects after the landmark correction.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/chargeback-dashboard.spec.ts e2e/staff-dashboard-widgets.spec.ts --project=chromium` — final chargeback/staff cases after stale-zero correction.
- `python3 kanban/scripts/build_backlog.py --check` and `git diff --check`

## Publication

The preceding customer-framework CI run `36769075010` passes all five gates. This validated batch is published directly to main after that run finishes. Its own remote CI is checked after push; no remote pass is claimed here.
