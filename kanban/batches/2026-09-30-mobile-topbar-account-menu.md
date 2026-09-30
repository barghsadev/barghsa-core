# Mobile topbar and account menu — September 30, 2026

## Kanban scope

- `07-ui-ux-design.md#T-07.04.02.02`: compact mobile header with logo, navigation, notification bell and account avatar; secondary preferences move into the account popup.
- `07-ui-ux-design.md#T-07.16.01.03`: named shared Topbar with desktop language/theme controls and a compact mobile layout.
- `07-ui-ux-design.md#T-07.16.01.04`: ProfileMenu with validated account username, email/mobile, initials fallback, profile/settings links, logout and deliberate staff/customer workspace switching.
- `07-ui-ux-design.md#T-07.04.02.04`: verify the header at all eight listed widths. The requirement for every product page remains open.

## Behavior and review

Below 1024px the shared staff/customer header moves theme and language controls into a keyboard-accessible Base UI popup. Its preference controls remain mounted while closed, so the saved theme applies at entry. Closing or moving the control no longer clears the saved choice. Header controls, including the home link and Safari's native selector, have 44px targets. Escape restores focus; both languages and RTL work.

Account details use the existing authenticated user endpoint and strict session parsing, and recheck on opening so saved identity changes appear. Unavailable details have a local retry. The workspace control reuses that validated identity rather than making another read. Logout sends the existing CSRF-protected POST, prevents duplicate submission, keeps the current page with a retryable failure, and reloads to login only after success. No backend session or permission policy changes are made.

Staff can reach an explicit set of personal settings in the staff shell: settings index, username/contact identity, security, privacy and timezone. The same allowlist governs notification links. Business profiles, addresses, wallet and other customer routes still require customer mode. Staff's My Profile points to account identity; customer My Profile points to the existing business profile settings. This uses usernames and initials, not an invented personal-name or avatar-upload feature.

The shared menu adds approximately 3.6 KB gzip to the electricity entry payload. Its one budget moves from 251 to 255 KB, with the final measured payload at approximately 252.48 KB. All other budgets stay unchanged. No migration, dependency or workflow change is included.

## Validation

Evidence logs: `/tmp/barghsa-mobile-account-*.log`.

- Root build and typecheck; lint, formatting, contract consistency, suppression checks and all 64 route/interaction gzip budgets pass.
- Web suite: 1,182 tests; final focused session/notification/workspace checks: 33 tests. UI: 64 tests. i18n: 53 tests.
- Twenty new bilingual account flows pass across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari. They verify all eight header widths, keyboard access, contrast, saved theme, language switching, identity and changed-username refresh, settings navigation, staff route isolation, failed logout/retry and protected entry after logout.
- Fifty-one distinct affected Chromium scenarios pass across the final runs: workspace switching, staff inbox, branding, consumer themes, navigation/terms, language persistence, profile switching and both dashboards. Final repairs align stale branding/language fixtures with existing validation and Persian defaults, use localized menu selectors and wait for responsive rendering before measuring overflow. The initial failures are not recorded as passes.
- Persian mobile Safari rendering is inspected. Four additional mobile Safari workspace/inbox scenarios pass across the final runs. Navigation assertions wait for the destination heading before leaving, avoiding premature document-navigation races.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:bundle`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/ui test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/lib/session-role.test.ts src/lib/notifications.test.ts src/components/OperatingContextSwitch.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test e2e/account-menu.spec.ts`
- Related Chromium run: `e2e/operating-context.spec.ts e2e/staff-inbox.spec.ts e2e/branding-theme.spec.ts e2e/consumer-theme.spec.ts e2e/shell-navigation.spec.ts e2e/language-preference.spec.ts e2e/profile-switch.spec.ts e2e/dashboard-widget-loading.spec.ts e2e/staff-dashboard-widgets.spec.ts --project=chromium`
- Final affected rerun: `e2e/branding-theme.spec.ts e2e/language-preference.spec.ts e2e/staff-dashboard-widgets.spec.ts e2e/staff-inbox.spec.ts --project=chromium`
- Mobile rerun: `e2e/operating-context.spec.ts e2e/staff-inbox.spec.ts --project=mobile-safari`
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding staff-dashboard batch is published as `5f473f6419c4aef3b692eca2b622914ccb694aed`; its CI run `36772450580` passes all five gates. This reviewed and locally validated batch is published directly to main after that verification. Its own remote CI is checked after push; no remote pass is claimed here.
