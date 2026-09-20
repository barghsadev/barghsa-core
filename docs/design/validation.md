# UI refresh validation

Validated on 13 September 2026. Browser checks use local servers and mocked account data.

| Check                                                                         | Result                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm --filter @barghsa/ui build`                                             | Pass, including 5 distribution checks                                                            |
| `pnpm --filter @barghsa/web build`                                            | Pass for application and isolated authentication bundles                                         |
| `pnpm typecheck`                                                              | Pass across all 11 workspace tasks                                                               |
| `pnpm lint`                                                                   | Pass with zero warnings                                                                          |
| `pnpm --filter @barghsa/i18n --filter @barghsa/ui --filter @barghsa/web test` | 449 tests pass: i18n 50, UI 56, web 343                                                          |
| `pnpm check:bundle`                                                           | All 42 route and interaction budgets pass                                                        |
| Selected Chromium regression suites below                                     | 184 tests pass                                                                                   |
| Component catalogue, full axe scan                                            | No violations in 8 combinations: Persian/English × light/dark × 390/1440px                       |
| Catalogue overflow and font check                                             | No horizontal overflow; Vazirmatn applied in all 8 combinations                                  |
| Confirmation keyboard check                                                   | Cancel receives initial focus; exact phrase enables confirmation; Escape returns focus to opener |
| `python3 kanban/scripts/build_backlog.py --check`                             | Pass: 1,355 tasks and 116 traceability entries                                                   |
| Prettier on changed text files; `git diff --check`                            | Pass                                                                                             |

## Browser regression command

Build the web application and serve its production preview on port 5174, then run:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 pnpm --filter @barghsa/web exec playwright test \
  e2e/login-ui.spec.ts e2e/login-recovery.spec.ts e2e/registration-strength.spec.ts \
  e2e/shell-navigation.spec.ts e2e/consumer-theme.spec.ts e2e/public-theme.spec.ts \
  e2e/profile-switch.spec.ts e2e/theme-components.spec.ts e2e/branding-theme.spec.ts \
  e2e/form-accessibility.spec.ts --project=chromium --workers=2
```

The existing suites cover authentication recovery, password-strength loading, profile switching and stale responses, shell navigation, custom branding, keyboard interaction, and implemented admin/customer form states. The new shared-library tests cover loading/empty/error selection, pending-button activation, composed progress, exact financial text, typed confirmation and pagination bounds.

The test updates align SMTP field counts with its existing timeout controls, resolve anonymous password-strength build chunks while supporting Vite source requests, and check the visible portions of the scrollable admin navigation at both ends. Contrast checks still fail on violations and unresolved visible text.

Theme-color transitions briefly produced invalid foreground/background pairs. Button color changes are now immediate; hover feedback uses shadows, preserving contrast even with custom administrator colors.

## Limits

These results cover Chromium and sampled viewports. Firefox, WebKit, manual screen-reader review, full WCAG 2.2 AA certification, and unfinished feature acceptance remain outside this verification. The production build still reports its existing large-chunk advisory; the project-specific gzip budgets pass.

An additional development-server run passed all 6 password-strength checks. Its 4 full-page login accessibility checks flagged the development-only TanStack Router launcher during the test’s color-endpoint simulation. The production-preview login checks pass; the launcher is absent from production.

No live financial or account writes were made for visual verification. The development catalogue contains clearly labelled sample data. See [Epic 07 coverage](epic-07-coverage.md) for remaining work.
