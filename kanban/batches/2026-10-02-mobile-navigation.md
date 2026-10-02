# Mobile navigation, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.16.01.05`: four primary links and a fifth More tab below the `lg` breakpoint. More opens the remaining navigation groups in an RTL/LTR sheet. The shared customer and staff shells use the same implementation.
- `07-ui-ux-design.md#T-07.16.01.06`: breadcrumbs below the topbar, with the full supplied navigation path on desktop and the current page plus an ancestor disclosure on phones and tablets.

## Build and review

Primary customer links prioritize dashboard, electricity, invoices and wallet; staff links prioritize dashboard, inbox, electricity orders and tickets. Selection uses only routes supplied by the existing layout, preserves remaining groups and never manufactures links for missing routes. Longest route-boundary matching highlights detail routes and More correctly. Unnamed detail pages use a localized Details label rather than exposing a record identifier.

The bar reserves its own space, including the device safe area. The customer guide launcher stays above it. The sidebar and header menu now use the same `lg` breakpoint, and the header shares the shell's viewport subscription. More supports keyboard activation, Escape and focus return; resizing to desktop closes the sheet. Breadcrumb ancestors close on navigation or Escape from either the summary or a focused link.

The mobile bar downloads only at compact widths; the More sheet downloads on demand. Download failures preserve the current page and offer the original navigation menu. Loading does not create a second Menu button. Desktop route and interaction budgets remain unchanged and all 68 pass. Persian/English labels, logical spacing and sheet direction are shared across both layouts.

Review covers route boundaries, supplied-route isolation, duplicate primary links, focus behavior, failed chunk recovery, mobile content/launcher bounds, tablet and desktop transitions, and Persian screenshots. This batch reuses the existing customer/staff navigation groups and route authorization. Backend-resolved role/profile navigation remains separate; this work adds no grants or financial actions. Unknown routes receive a generic Details breadcrumb rather than an inferred business name.

## Validation

- Root build passes, followed by a final web production build. All eleven root TypeScript tasks, ESLint, formatting, contract and suppressed-error gates pass before publication.
- `pnpm --filter @barghsa/web test`: 208 files and 2,454 cases pass. The final related run of `src/lib/shell-navigation.test.ts`, `src/pages/ContractsNavigation.test.tsx` and `src/pages/DocumentsNavigation.test.tsx` passes all seven cases; those cases are included in the suite count.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass.
- Production Playwright checks run `e2e/mobile-navigation.spec.ts`, the existing shell navigation scenarios and the customer guide smoke/full-page scenarios on Chromium and mobile Safari. All 28 selected scenarios pass on the reviewed build, including both languages, both shell areas, real route changes, keyboard focus, record-ID privacy, failed bar/sheet downloads, Axe checks and phone/tablet/desktop bounds. Screenshots cover Persian mobile and desktop layouts.
- All 68 existing route/interaction gzip budgets pass, including the staff contracts route at 499.99 KB against its 500 KB limit. No budget is increased.
- Strict Semgrep 1.176.1 scans 1,462 files with zero findings or scanner errors; all five rule fixtures pass. Backlog validation checks 1,355 tasks and 116 traceability entries; diff and generated contract checks pass. Logs use `/tmp/barghsa-mobile-navigation-*`.

No API, database or migration changes are required. Exact-commit GitHub CI is read back after the direct push to main; remote checks remain pending at publication. Historical supervisor state, generated completion/event ledgers and CI settings remain unchanged.
