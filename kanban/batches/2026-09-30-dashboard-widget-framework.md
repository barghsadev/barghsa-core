# Customer dashboard widget framework — September 30, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.19.01.01`: shared widget grid and Card header/body composition; customer adoption.
- `07-ui-ux-design.md#T-07.19.01.02`: independent loading, errors, retry and empty/data slots with `useAsyncData`; customer adoption.
- `07-ui-ux-design.md#T-07.19.01.03`: reserved customer widget space during loading, failure, retry and success.

The reusable framework and customer dashboard adoption are built. Staff/admin widget adoption remains open; these entries do not certify every dashboard widget in the repository.

## Behavior

The profile/context request resolves the current profile and allowed sections first. Wallet, quick counts, upcoming invoices, recent orders and active contracts then load independently. One failed section retains its title and local retry while successful sections remain usable. Retry requests only that resource. Profile changes immediately discard loaded data and abort old requests.

The responsive grid has one column on phones, two on tablets and three on desktop. Each card reserves 32rem; long lists scroll within an accessible, keyboard-focusable body. The four summary cards use a compact two-column arrangement inside their widget. Existing exact money, dates, urgency, contract progress and domain links are preserved, including bilingual RTL presentation. Small primary-colored text falls back to the current foreground when the active brand color lacks 4.5:1 contrast against the page, card or muted surface. Brand fills keep their configured color; both light and dark modes have separate text choices.

Authenticated context and widget endpoints send `private, no-store`. Each widget requires an expected profile UUID, checks current ownership/agent permissions before domain reads, and checks profile and authority again before returning data. Unauthorized business tables are not queried. Wallet warnings aggregate all customer-payable unpaid invoices, including rows beyond the three-item invoice widget. Existing bounded SQL is shared with the overview endpoint, which remains available for the assistant's account-status feature.

## Validation

Validation passes. Evidence logs are `/tmp/barghsa-dashboard-framework-*.log`. The preceding main batch CI, run `36763125527`, is green. CI for this batch is checked after push.

- Root build, typecheck, lint, format, OpenAPI contract, suppression checks and 64 gzip budgets.
- Dashboard service and PostgreSQL HTTP tests — 18 cases: authorization, expected-profile binding, parameter validation, private headers, exact amounts, query isolation, and all five resources.
- Full web suite — 1,176 cases, including hook/page, wallet/count and branding tests: isolated retries, aborted late responses, hidden denied widgets, context retry and foreign-profile response rejection.
- i18n package tests — 53 cases.
- Browser validation covers 66 distinct scenarios across the final runs. Bilingual dashboard flows on Chromium, Firefox, WebKit and both mobile projects: independent states/retry, unchanged card/grid dimensions, 1/2/3 columns, exact amounts, empty states, accessibility and profile-switch cleanup.
- Affected profile-switch, assistant, login-recovery and consumer-theme browser fixtures; live dashboard balance/error recovery against PostgreSQL.

## Review and limits

Reviewed permission boundaries, request cancellation/revision scoping, exact financial arithmetic, preserved assistant API compatibility, OpenAPI parameters and keyboard/RTL layout. Browser assertions account for initialization aborts and Firefox's subpixel coordinate rounding instead of assuming one bootstrap request or exact floating-point equality.

The context/permission bootstrap remains a page-level failure; individual business-query failures are isolated after bootstrap. The independent resources use six initial HTTP reads instead of one aggregate read and recheck current authority; each widget reads only its own data. This trades modest request overhead for independent completion and retry. Staff adoption, other dashboard criteria, and broader business journey work remain open. Older browser fixtures were repaired for required session reads, persisted language, valid branding, staff/customer route context, the canonical `/app` redirect and uniquely named profile selection. These repairs exposed and verified the supporting brand-text contrast fix. A separate customer operating-context session lets the live dashboard fixture read the same real profile without changing its staff session. No schema migration or CI gate changes are included.

## Commands

- `pnpm build` and `pnpm typecheck`
- `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:bundle`, `pnpm check:suppressed-errors`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/dashboard/dashboard.service.test.ts src/dashboard/dashboard-upcoming-invoices-http.integration.test.ts`
- `pnpm --filter @barghsa/web test` and `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/profile-switch.spec.ts e2e/knowledge-assistant.spec.ts e2e/login-recovery.spec.ts e2e/consumer-theme.spec.ts e2e/dashboard-widget-loading.spec.ts e2e/dashboard-upcoming-invoices.spec.ts --project=chromium` — 52 scenarios; seven initial failures were repaired and their paths rerun in the remaining/late-profile logs.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/consumer-theme.spec.ts e2e/profile-switch.spec.ts --project=chromium --grep 'late old-profile|page error states|populated pages'` — all twelve theme scenarios pass; the late-profile case then passes separately with `--grep 'late old-profile'` after waiting for its actual held dashboard request.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/dashboard-widget-loading.spec.ts e2e/dashboard-upcoming-invoices.spec.ts --project=firefox --project=webkit --project=mobile-chrome --project=mobile-safari` — 12 pass.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/admin-settings-live.spec.ts --project=chromium --grep 'dashboard displays exact live'` — 2 pass.
- `python3 kanban/scripts/build_backlog.py --check` and `git diff --check`
