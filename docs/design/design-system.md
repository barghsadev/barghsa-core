# Barghsa design system

## Product direction

Barghsa serves Persian-speaking electricity customers and the staff who review their orders, payments, profiles and support requests. Screens should make amounts, current status and the next available action easy to identify. The agreed direction is calm and precise, with warm neutral surfaces, deep teal actions and restrained amber accents.

Vazirmatn is used throughout, including Latin text. It is self-hosted in `packages/ui/src/fonts` with its SIL Open Font License. The Arabic and Latin variable-font subsets cover weights 100–900. No third-party font request is made at runtime. Monetary values continue to use the existing exact IRR formatters and user numeral preferences.

This work changes the authentication, customer application and admin shells. Existing feature page sections, forms, lists and workflow order remain in place. Their shared controls, feedback colors and table treatments now follow this system.

## Source of truth

| Concern                                            | Source                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| Palette, semantic colors, layout, motion and fonts | `packages/ui/src/styles.css`                    |
| Additional Tailwind scales                         | `packages/ui/tailwind.config.ts`                |
| Public component exports                           | `packages/ui/src/index.ts`                      |
| Active administrator branding                      | `apps/web/src/providers/BrandThemeProvider.tsx` |
| Application frame and navigation rendering         | `apps/web/src/components/AppShell.tsx`          |
| Customer and admin route inventories               | `DashboardLayout.tsx` and `AdminLayout.tsx`     |
| Authentication frame                               | `apps/web/src/components/AuthLayout.tsx`        |
| Shared shell copy                                  | `packages/i18n/src/shell.ts`                    |
| Component catalogue                                | `apps/web/e2e/fixtures/design-system/main.tsx`  |

The installed shadcn configuration is `base-nova` with `@base-ui/react`. Preserve it. Epic 07's older references to a Radix-based `new-york` preset and legacy MUI package names do not describe the current library. Replacing the installed headless layer would create a separate migration with little visual benefit.

## Color

Use semantic classes in components. Keep literal colors in the token stylesheet or validated brand configuration.

| Role             | Light     | Dark      | Use                                  |
| ---------------- | --------- | --------- | ------------------------------------ |
| Background       | `#f6f7f4` | `#15201c` | Workspace canvas                     |
| Foreground       | `#203631` | `#e7eee6` | Main text                            |
| Card             | `#fdfefb` | `#1d2c25` | Forms, records and widgets           |
| Muted            | `#edf0eb` | `#293a30` | Secondary surfaces                   |
| Muted foreground | `#5f6e65` | `#afc0b2` | Descriptions and secondary text      |
| Primary          | `#176b5b` | `#8acfb0` | Main action                          |
| Border           | `#dbe2da` | `#374b3e` | Surface boundaries                   |
| Input            | `#85958a` | `#819889` | Identifiable field boundaries        |
| Success          | `#236c45` | `#9cdbb1` | Verified or completed                |
| Warning          | `#83500f` | `#f2ca83` | Attention or waiting                 |
| Destructive      | `#a42c35` | `#ffafb2` | Failure or destructive action        |
| Info             | `#285f91` | `#a5c9ed` | Processing or informational feedback |
| Purple           | `#704995` | `#d1b4ee` | Premium classification               |

Pair feedback text with its matching soft background, such as `text-warning bg-warning-soft`. Never assign business status from a color alone. Labels remain visible. The dashboard preserves its existing high-count attention threshold with a restrained icon treatment.

`BrandThemeProvider` still owns active primary, secondary and accent colors, foreground contrast and the administrator's light/dark choice. Its validated server configuration overrides fallback tokens. The refresh deliberately does not change saved branding or introduce another theme-preference owner. The auth illustration uses separate dark brand-panel tokens so its text stays readable for arbitrary configured action colors.

## Typography

| Element              | Size          | Weight  | Guidance                                          |
| -------------------- | ------------- | ------- | ------------------------------------------------- |
| Auth brand statement | Fluid 40–72px | 500     | Short, two-line statement on desktop only         |
| Auth form heading    | 30px          | 600     | One main heading per form                         |
| Page title           | Fluid 24–30px | 600–650 | One h1 per page                                   |
| Section heading      | 18–20px       | 600     | Name the content, omit promotional copy           |
| Body and controls    | 14–16px       | 400–500 | At least 16px for mobile text inputs              |
| Supporting copy      | 12–14px       | 400     | Use muted foreground, never low-opacity body text |
| Financial amount     | Fluid 24–32px | 600     | Tabular digits, explicit unit, exact formatter    |

Persian text has natural letter spacing and a relaxed line height. Avoid uppercase tracking on Persian headings. Use `bdi` for mixed-direction identifiers and money strings. Set `dir="ltr"` only on a field whose data requires it, such as a phone number or email.

## Space and shape

Use the existing 4px spacing grid. Related controls use 8–12px gaps, field groups use 16–24px, and major sections use 24–32px. A card normally has 24px padding, with the existing compact size available for dense content.

| Token                    | Value  |
| ------------------------ | ------ |
| `--sidebar-width`        | 280px  |
| `--topbar-height`        | 72px   |
| `--container-max-width`  | 1280px |
| `--auth-panel-max-width` | 448px  |
| `--radius`               | 12px   |
| `--duration-fast`        | 150ms  |
| `--duration-normal`      | 200ms  |
| `--duration-slow`        | 300ms  |

Use borders before shadows. Shadows identify raised cards and overlays. Do not add large decorative icons or nested cards to every section. Tables keep their existing columns, sorting and controls; the shell supplies a common header surface and row hover treatment.

## Controls

`Button` supports default, secondary, destructive, outline, ghost and link variants. Theme color updates are immediate to preserve contrast; hover and press feedback use shadows and movement. Its default height is 44px, small is 36px and large is 48px. The `loading` prop adds a decorative spinner, keeps the label, disables activation and sets `aria-busy`. Use an existing progress label such as "Saving" when appropriate. Plain anchors use `buttonVariants`, preserving link semantics.

`Input` exposes `inputVariants`, `variant="error" | "success"`, and `controlSize`. Existing native `size` remains the HTML character-width prop. Labels, help and validation descriptions remain associated by `htmlFor`, `id` and `aria-describedby`. An error variant supplies `aria-invalid`; callers must still supply a useful message. InputGroup is exported for leading/trailing icons and unit text. Password controls keep a 44px visibility target.

`Card` exposes `cardVariants` and default, interactive, flat and widget variants. An interactive appearance does not make a div accessible; wrap content in a real link or button. `Badge` supports semantic status variants and three sizes. `StatusBadge` requires a readable label and provides an optional decorative dot.

`Alert` adds success, warning and info variants to the existing default/destructive set. Use polite status announcements for nonurgent ongoing work. Reserve alerts for errors or conditions requiring attention. Do not render an error toast and an identical alert repeatedly.

## Shells and navigation

Both customer and admin areas use AppShell. Its responsibilities are the brand, current-page context, language switch, grouped navigation, mobile disclosure, scrolling and skip link. Callers supply routes, profile controls, notification actions and existing banners.

The mobile menu remains an inline disclosure. It is not a modal and does not trap focus. The trigger exposes its expanded state. Escape closes the menu and restores focus to the trigger; selecting a link closes it. On desktop the sidebar remains visible and scrolls independently. This keeps long admin route lists reachable by keyboard.

The admin route inventory is unchanged. API permission checks and existing access gates remain authoritative. Role-filtered navigation is still a separate Epic 07 item; the design refresh does not imply that every visible admin link is authorized.

Customer navigation hides the existing placeholder-only AI, Documents and Videos pages. Their routes remain available for later implementation. Do not expose new navigation until the destination has a working user flow. The profile switcher, invitation and ownership banners, terms gates and notification bell keep their original data ownership.

The language switch changes the document locale without navigation, preserving in-progress form values. Existing entry-bundle locale handoff continues to work. This control does not introduce a persisted account-language preference.

## Reusable workflow patterns

| Component              | Responsibility                                      | Caller must supply                                       |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| PageHeader             | Title, supporting text and optional actions         | Localized text and real actions                          |
| StatusBadge            | Label and semantic tone                             | Business-state mapping                                   |
| ProgressStepper        | Read-only complete/current/pending steps            | Ordered states and localized labels                      |
| Timeline               | Chronological entries with machine-readable dates   | Ordering and localized date labels                       |
| LoadingSkeleton        | Detail, form, table or card placeholders            | Localized loading label                                  |
| AsyncView              | Explicit loading/error/empty/content choice         | All states and their rendered content                    |
| NoDeadEndBanner        | Failure, responsible team, next action and help     | Real recovery action and contact destination             |
| WaitingForBarghsa      | Submitted, update and expected-response information | Actual server status and help link                       |
| FinancialReviewSummary | Read-only rows and total                            | Authoritative server preview, preformatted exact amounts |
| ConfirmDialog          | Focus-safe confirmation and optional exact phrase   | Submit state, errors, consequence text, confirmed write  |
| Pagination             | Bounded offset page navigation                      | Page count, localized labels and fetch handler           |

These components are exported for current and future features. They do not fetch records, invent a deadline, calculate a financial total, persist a draft, or mutate a business object. Do not render a promised response time unless the backend actually supplies it.

Confirmation opens with the cancel control focused. With a required phrase, the confirm action stays disabled until the exact phrase matches. Pending submission disables both actions and prevents dismissing the dialog. The parent owns server errors and closes only after a verified response. Reopening clears the phrase. A typed phrase alone is not a replacement for financial acknowledgement or step-up authentication.

The progress primitive accepts either its default track or a composed track. Password strength previously rendered both; it now renders one.

## Accessibility and responsive behavior

- Preserve native links, buttons, lists, inputs and table semantics.
- Every icon-only button needs a localized accessible name; decorative icons are hidden.
- Keep visible keyboard rings. Never replace them with a subtle border alone.
- Touch controls target 44px. Compact variants are for dense desktop interfaces.
- Menus and focus order follow document direction; chevrons mirror in RTL.
- Check 390px and 1440px widths with long Persian labels and large monetary values.
- Check light/dark with both default colors and custom administrator colors.
- Global reduced-motion rules stop transitions and shimmer without removing state labels.
- Support links and retry actions remain available in failed states.

Automated checks cover sampled screens and component behavior. They do not establish full WCAG conformance across every unfinished feature.

## Browse the catalogue

Run `pnpm --filter @barghsa/ui build` and `WEB_PORT=5173 pnpm --filter @barghsa/web dev`, then open:

`http://localhost:5173/e2e/fixtures/design-system/index.html`

The catalogue switches between Persian/English and light/dark, and includes control variants, validation, badges, finance preview, progress, timeline, loading, empty states, pagination and typed confirmation. It is a development fixture, omitted from application navigation and production build entries. Example amounts are clearly marked as samples.

[AI Native UI](https://ai-native-ui.com) was inspected as an optional reference. Its current focus is prompt composers and chat controls. The current customer AI route is a placeholder, so this change does not add a live composer or a second component dependency.

## Validation

See [validation results](validation.md) for checked behavior and limitations, and `epic-07-coverage.md` for delivered scope and deferred acceptance criteria. Run the shared package tests, web typecheck and build, repository lint and the affected auth, theme, shell and profile-switch browser suites before changing these foundations.
