# Epic 07 — UI/UX Foundation & Design System

> **Domain:** Shared UI Components, Theming, Accessibility, Layout & Design Patterns
> **Status:** ⏳ Being drafted
> **Dependencies:** E-01 (Platform & Infrastructure — monorepo, shared packages), E-02 (Auth, Users, CRM & Admin — user-facing pages)
> **Cross-references:** E-05 (Notifications, Documents & AI Orchestration — notification center, AI chat UI), E-03 (Core Business — order/consultation forms), E-04 (Invoices, Wallet, Payments & Contracts — financial data display)

---

## Table of Contents

1. [E-07.01 — Design System Foundation (shadcn/ui + Base UI)](#e-0701--design-system-foundation-shadcnui--base-ui)
2. [E-07.02 — Theming & CSS Custom Properties](#e-0702--theming--css-custom-properties)
3. [E-07.03 — RTL/LTR Bidirectional i18n](#e-0703--rtlltr-bidirectional-i18n)
4. [E-07.04 — Responsive Mobile-First Layout](#e-0704--responsive-mobile-first-layout)
5. [E-07.05 — WCAG 2.2 AA Accessibility](#e-0705--wcag-22-aa-accessibility)
6. [E-07.06 — Light & Dark Themes](#e-0706--light--dark-themes)
7. [E-07.07 — Admin-Configurable Theming (Branding)](#e-0707--admin-configurable-theming-branding)
8. [E-07.08 — Animation System & prefers-reduced-motion](#e-0708--animation-system--prefers-reduced-motion)
9. [E-07.09 — Localized Date Pickers (Jalali & Gregorian)](#e-0709--localized-date-pickers-jalali--gregorian)
10. [E-07.10 — Form System (react-hook-form + zod)](#e-0710--form-system-react-hook-form--zod)
11. [E-07.11 — Toast & Notification System](#e-0711--toast--notification-system)
12. [E-07.12 — Error, Loading & Empty State Patterns](#e-0712--error-loading--empty-state-patterns)
13. [E-07.13 — Confirmation Dialogs & Destructive Action UX](#e-0713--confirmation-dialogs--destructive-action-ux)
14. [E-07.14 — Password Strength Meter](#e-0714--password-strength-meter)
15. [E-07.15 — Profile Switcher UI](#e-0715--profile-switcher-ui)
16. [E-07.16 — Sidebar & Topbar App Shell Layout](#e-0716--sidebar--topbar-app-shell-layout)
17. [E-07.17 — Auth Page Layout (2-Column Brand + Form)](#e-0717--auth-page-layout-2-column-brand--form)
18. [E-07.18 — List Page Patterns (Sort, Filter, Search, Pagination)](#e-0718--list-page-patterns-sort-filter-search-pagination)
19. [E-07.19 — Dashboard Widget System](#e-0719--dashboard-widget-system)
20. [E-07.20 — Chat UI for AI Assistant (Individual, Legal, Staff)](#e-0720--chat-ui-for-ai-assistant)
21. [E-07.21 — Agent Test Chat (Admin)](#e-0721--agent-test-chat-admin)
22. [E-07.22 — Forms & Wizard Patterns (Multi-Step)](#e-0722--forms--wizard-patterns-multi-step)
23. [E-07.23 — Ticket / Comment Thread UI](#e-0723--ticket--comment-thread-ui)
24. [E-07.24 — Data Table / Grid Components](#e-0724--data-table--grid-components)
25. [E-07.25 — Document Upload & Status UI](#e-0725--document-upload--status-ui)
26. [E-07.26 — Wallet / Balance Display Components](#e-0726--wallet--balance-display-components)
27. [E-07.27 — Status Badges, Timeline & State Progress](#e-0727--status-badges-timeline--state-progress)
28. [E-07.28 — Onboarding Flow / Profile Creation Wizard](#e-0728--onboarding-flow--profile-creation-wizard)
29. [E-07.29 — Agent Management UI (Customer Side)](#e-0729--agent-management-ui-customer-side)
30. [E-07.30 — Admin Settings / Config Pages Layout](#e-0730--admin-settings--config-pages-layout)
31. [Cross-Cutting Concerns](#cross-cutting-concerns)

---

## Legend

| Marker | Meaning |
|--------|---------|
| **S** | Small — hours to ~1 day |
| **M** | Medium — ~2–4 days |
| **L** | Large — ~1 week |
| **XL** | Extra large — multi-week, consider splitting |
| 📋 | UI/UX deliverable |
| 🔧 | Backend / API / database |
| ⚠️ | Validation / edge case |

---

## E-07.01: Design System Foundation (shadcn/ui + Base UI)

**Goal:** Establish the `packages/ui` shared component library using shadcn/ui as the headless component foundation with Base UI integration. Every reusable UI pattern — buttons, inputs, cards, modals, tables, toasts, skeletons, badges, dropdowns, navigations — is built once, is themeable, supports RTL, passes a11y, and is used by every feature page.

**Complexity:** XL
**Depends on:** E-01.01 (Monorepo foundation), E-01.02 (TypeScript), E-01.03 (Build pipeline)
**Deliverable:** `packages/ui/src/` with full component set; consumed by `apps/web`

---

### S-07.01.01 — shadcn/ui scaffold & Base UI configuration

**Description:** Initialize shadcn/ui within `packages/ui` with Tailwind CSS v4, Radix UI primitives, and class-variance-authority for component variants. Configure Base UI (React Aria Components or Base UI by MUI) as the supplementary headless layer for complex widgets (comboboxes, date pickers, number input with locale formatting).

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.01.01.01** | Initialize `packages/ui` with Tailwind CSS v4, PostCSS, autoprefixer. Configure `tailwind.config.ts` with extended color palette, font families (Vazirmatn for Persian, Inter for English), border-radius, spacing scale, and animation tokens. | M |
| **T-07.01.01.02** | Install and configure shadcn/ui CLI: set `style: "new-york"`, `baseColor: "zinc"`, `cssVariables: true`. Generate initial component set: Button, Input, Label, Card, Badge, Dialog, DropdownMenu, Select, Separator, Sheet, Skeleton, Toast, Tooltip, Tabs, Avatar, Popover, Command, Switch, Progress, Slider, Textarea, Alert, Breadcrumb, ScrollArea, Calendar, Checkbox, RadioGroup, Sonner (toaster). | L |
| **T-07.01.01.03** | Install and configure Base UI (from MUI or React Aria Components) for complex patterns: NumberField (with locale-aware formatting), DatePicker/DateRangePicker (with Jalali support), ComboBox (with search + keyboard nav), Select (with multi-select + chips), Table (sortable, selectable rows via useTable). | L |
| **T-07.01.01.04** | Configure `cva` (class-variance-authority) or `tailwind-variants` for all components: define `buttonVariants`, `inputVariants`, `cardVariants`, `badgeVariants` as exportable variant objects. | M |
| **T-07.01.01.05** | Set up Storybook or Ladle in `packages/ui` for visual component documentation. Add stories for each component showing all variants, RTL mode, dark mode, and interactive states. | L |
| **T-07.01.01.06** | Create a `packages/ui/src/index.ts` barrel export. Verify tree-shaking: importing only Button should not pull in Dialog or DatePicker. | M |
| **T-07.01.01.07** | ⚠️ Verify all shadcn/ui components render correctly in RTL mode. Patch any component that uses hardcoded `left`/`right` margins or assumes LTR direction. | M |
| **T-07.01.01.08** | ⚠️ Verify all Base UI components respect the theme's CSS custom properties and dark mode. Fix any hardcoded colors in vendor components. | M |

---

### S-07.01.02 — Core primitives: Button, Input, Label, Card, Badge

**Description:** Build and extend the foundational primitives with all required variants, states (loading, disabled, error), and accessibility.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.01.02.01** | **Button** — variants: `default` (primary brand), `secondary`, `destructive` (danger red), `outline`, `ghost`, `link`. Sizes: `xs`, `sm`, `default`, `lg`, `xl` (full-width responsive). States: loading (spinner icon + disabled), disabled (reduced opacity + no events), active (press animation). Support `asChild` from Radix for polymorphic rendering (buttons as anchors or router Links). | M |
| **T-07.01.02.02** | **Input** — variants: `default`, `error` (red border + error icon), `success` (green check). Sizes matching Button. States: disabled, read-only, focused (ring). Supporting elements: leading icon slot, trailing icon slot (for password visibility toggle, clear button), helper text below, error message below. Prefix/suffix text (e.g. IRR currency prefix, kWh suffix). | M |
| **T-07.01.02.03** | **Label** — association with input via `htmlFor`. Required indicator (red asterisk). Optional muted text. Disabled label styling when associated input is disabled. | S |
| **T-07.01.02.04** | **Card** — variants: `default` (bordered, shadow-sm), `interactive` (hover elevation + cursor-pointer), `flat` (no border, subtle bg), `widget` (dashboard card with icon header). Subcomponents: CardHeader, CardTitle, CardDescription, CardContent, CardFooter. | M |
| **T-07.01.02.05** | **Badge** — variants: `default` (neutral), `secondary`, `destructive`, `outline`, `success` (green), `warning` (amber), `info` (blue), `purple` (premium). Sizes: `sm`, `default`, `lg`. Dot mode (colored dot without text background). Used for status indicators throughout the app. | M |

---

### S-07.01.03 — Extended component set

**Description:** Build all remaining design-system components used across feature pages.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.01.03.01** | **Dialog/Modal** — sizes: `sm`, `default`, `lg`, `xl`, `fullscreen`. Props: open/close, onOpenChange, preventCloseOnOverlayClick (for forms), closeButton (optional). Portal rendering, focus trap, Escape to close, aria-labelledby/describedby. Animation: scale + fade on open/close. | M |
| **T-07.01.03.02** | **Sheet (Drawer)** — side: `left` (sidebar mobile menu), `right` (notification panel, details panel), `top`, `bottom` (mobile action sheet). Sizes proportional to viewport. Backdrop blur option. | M |
| **T-07.01.03.03** | **DropdownMenu** — nested submenus, checkbox items, radio items, separator, disabled items, shortcut labels. Used in table row actions, user menu, overflow menus. | M |
| **T-07.01.03.04** | **Popover** — controlled/uncontrolled, placement (top/bottom/left/right + align start/center/end), offset, arrow. Used for date picker popups, filter dropdowns, info tooltips (rich content). | M |
| **T-07.01.03.05** | **Tooltip** — delay show/hide, placement, rich content (HTML, links), disabled trigger handling. | S |
| **T-07.01.03.06** | **Select (native & custom)** — native `<select>` fallback for mobile. Custom Select with search/filter, grouped options, multi-select with chips/tags, clearable. | M |
| **T-07.01.03.07** | **Command Palette / Combobox** — searchable list with keyboard navigation (arrow keys, typeahead). Used for searchable dropdowns (city selector, product selector, agent selector). | M |
| **T-07.01.03.08** | **Tabs** — variants: `underline` (default), `pills`, `boxed`. Orientation: horizontal, vertical. Controlled/uncontrolled. Responsive: horizontal scroll on mobile with overflow buttons. | M |
| **T-07.01.03.09** | **Accordion** — single or multiple open. Used for FAQ, settings sections, order detail sections. Chevron icon rotation animation. | S |
| **T-07.01.03.10** | **Switch / Toggle** — used for boolean settings, enable/disable toggles. Accessible label via `aria-label` or `htmlFor`. | S |
| **T-07.01.03.11** | **Checkbox & RadioGroup** — Checkbox: indeterminate state (for select-all). RadioGroup: horizontal/vertical layout. Both with error state integration. | S |
| **T-07.01.03.12** | **Progress** — linear progress bar (used for order fulfillment stages, document upload progress). Variants: `default`, `success` (green), `warning` (amber). Animated stripe option. | S |
| **T-07.01.03.13** | **Slider** — single thumb and range thumbs. Used for percentage inputs (green rule %, capacity). Step increments. | S |
| **T-07.01.03.14** | **Textarea** — auto-resize, character limit counter, error state. Used for ticket body, staff notes, address input. | S |
| **T-07.01.03.15** | **Alert / Banner** — severity: `info`, `success`, `warning`, `error`, `critical` (red pulse). Dismissible option. Action button slot (e.g. "Retry", "View details"). Use for: no-dead-end messages, profile verification banners, service outage notices. | M |
| **T-07.01.03.16** | **Breadcrumb** — auto-generated from route hierarchy. Collapse on mobile (show only last + "..." indicator). | S |
| **T-07.01.03.17** | **ScrollArea** — custom scrollbar styling matching the theme (thinner, themed thumb). Support for both LTR and RTL scrollbar positions. | S |
| **T-07.01.03.18** | **Avatar** — image fallback to initials (extracted from user name). Sizes: `xs` (24px) through `xl` (96px). Status ring (online/offline/busy). Used in profile switcher, user menu, agent list. | S |
| **T-07.01.03.19** | **Skeleton** — shimmer loading placeholders. Variants: `text` (single line, multi-line), `card`, `avatar` (circle), `table-row`, `chart`. Used on every list, detail, and dashboard page. | M |
| **T-07.01.03.20** | **Separator** — horizontal and vertical. Used in dropdowns, sidebars, form sections. | S |
| **T-07.01.03.21** | — **Pagination** compound component: Previous/Next buttons, page number buttons, ellipsis for large ranges, page size selector (10/20/50/100), total count display ("Showing 1–20 of 154"). Compatible with both cursor and offset pagination. | M |

---

## E-07.02: Theming & CSS Custom Properties

**Goal:** Implement a complete theming system using CSS custom properties that supports light, dark, and admin-configurable brand themes. All components reference CSS variables only — no hardcoded colors in any component.

**Complexity:** L
**Depends on:** S-07.01.01 (shadcn/ui scaffold)

---

### S-07.02.01 — CSS custom property architecture

**Description:** Define the full set of design tokens as CSS custom properties with a clear naming convention. Separate semantic tokens (e.g. `--color-primary`) from raw palette tokens (e.g. `--color-blue-500`).

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.02.01.01** | Define global color palette tokens in `globals.css`: neutral gray scale (`50–950`), brand primary (`50–950`), brand secondary, success (green), warning (amber), danger (red), info (blue). Each scale has light and dark values. | M |
| **T-07.02.01.02** | Define semantic CSS variables mapped from palette: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`, `--shadow-sm` through `--shadow-2xl`. | M |
| **T-07.02.01.03** | Define typography tokens: `--font-sans` (Inter for EN, Vazirmatn for FA), `--font-mono` (monospace for code/data), `--font-heading` (usually same as sans), `--font-size-xs` through `--font-size-4xl`, `--font-weight-normal/medium/semibold/bold`, `--line-height-tight/normal/relaxed`. | M |
| **T-07.02.01.04** | Define spacing tokens: `--spacing-1` through `--spacing-16` (4px base unit). Layout tokens: `--sidebar-width` (default 280px), `--topbar-height` (default 64px), `--container-max-width` (default 1280px), `--auth-panel-max-width` (default 480px). | M |
| **T-07.02.01.05** | Define animation tokens: `--duration-fast` (150ms), `--duration-normal` (200ms), `--duration-slow` (300ms), `--ease-in-out`, `--ease-out`, `--ease-in`. | S |
| **T-07.02.01.06** | ⚠️ Ensure all shadcn/ui and custom components reference CSS variables exclusively in `className` via Tailwind's `theme()` or arbitary `var(--variable)`. Zero hardcoded hex colors in component source files. | M |
| **T-07.02.01.07** | Add a CI lint rule (`stylelint` or `eslint-plugin-tailwind`) that flags hardcoded color values (hex, rgb, hsl) in component files — all colors must use CSS variable references. | S |

---

### S-07.02.02 — Dark & light theme classes

**Description:** Implement `.light` and `.dark` class-based theming via CSS `:where(.light, .dark)`. The root element toggles class based on user preference or admin override.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.02.02.01** | Define `:root` (light default) and `.dark` CSS variable overrides for every semantic token in `globals.css`. Use `oklch` or `hsl` color space for perceptually uniform luminance adjustments. | M |
| **T-07.02.02.02** | Implement `ThemeProvider` React component that reads: (1) user's `prefers-color-scheme` system preference (via `matchMedia`), (2) persisted user choice in localStorage, (3) admin brand config (server-provided). Priority: admin brand > user preference > system preference. | L |
| **T-07.02.02.03** | Add `class` to `<html>` element on initial load to prevent flash of wrong theme (FOUC). Inline a blocking `<script>` in the document `<head>` that reads a cookie or localStorage and sets the class before paint. | M |
| **T-07.02.02.04** | Provide a `useTheme()` hook returning `{ theme, setTheme, resolvedTheme }`. `theme` is the user's choice (`'light'` | `'dark'` | `'system'`); `resolvedTheme` is the actual applied theme (`'light'` | `'dark'`). Persist choice to localStorage. | S |

---

## E-07.03: RTL/LTR Bidirectional i18n

**Goal:** Full RTL support for Persian (default) and LTR support for English. Every layout, component, text direction, icon flip, margin/padding, and alignment responds to the current language direction.

**Complexity:** XL
**Depends on:** E-01 (packages/i18n), S-07.01.01 (component library)
**Cross-refs:** S-07.02.01 (CSS variables)

---

### S-07.03.01 — Direction utility & i18n integration

**Description:** Implement direction-aware layout utilities. All spacing, alignment, and positioning must use logical CSS properties (`margin-inline-start` instead of `margin-left`, `padding-inline-end` instead of `padding-right`, `border-start-start-radius` instead of `border-top-left-radius`).

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.03.01.01** | Configure Tailwind CSS with `rtl` variant: `dark:rtl:bg-red-500`. Add direction-aware utilities: `ps-*` (padding-inline-start), `pe-*` (padding-inline-end), `ms-*` (margin-inline-start), `me-*` (margin-inline-end), `text-start`, `text-end`, `inset-inline-start`, `inset-inline-end`, `start-*`, `end-*`. | M |
| **T-07.03.01.02** | Create `DirectionProvider` that reads the current locale from react-i18next/next-intl, sets `dir="rtl"` or `dir="ltr"` on `<html>`, and provides `isRtl` boolean to the component tree. | S |
| **T-07.03.01.03** | Create `useDirection()` hook returning `{ dir, isRtl, isLtr }`. Create `DirectionAware` utility component that renders different content based on direction. | S |
| **T-07.03.01.04** | Audit all shadcn/ui components for hardcoded LTR assumptions in their Radix props (e.g. `side="right"` in DropdownMenu should be `side="left"` in RTL). Create a `useFlippedPlacement(placement)` hook that flips `left` ↔ `right` when `isRtl`. | L |
| **T-07.03.01.05** | Import and configure `packages/i18n` in `apps/web`. Set up `react-i18next` or `next-intl` with `lng` detection (cookie, URL, user preference), fallback language (`fa`), and language namespaces. | M |
| **T-07.03.01.06** | ⚠️ Icons with directional meaning (arrows, chevrons, carets) must flip horizontally in RTL mode. Implement `Icon` wrapper that auto-flips icons ending in `-left`/`-right` (e.g. `ChevronLeft` → mirrored in RTL). | M |
| **T-07.03.01.07** | ⚠️ Test every component and page in both RTL and LTR modes. Persian Lorem ipsum (`لورم ایپسوم`) should render correctly in all containers. Verify no text overflow, clipped content, or misaligned elements. | L |

---

### S-07.03.02 — Language switcher & persistence

**Description:** Allow users to switch language. Persist choice. Change direction immediately without page reload.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.03.02.01** | Build LanguageSwitcher component: button/dropdown showing "FA" / "EN" labels. Changes language, toggles direction, persists in cookie (for SSR) and localStorage. | M |
| **T-07.03.02.02** | Implement SSR-friendly language detection: read `Accept-Language` header and language cookie. Set `dir` and `lang` attributes on `<html>` during server render. No flash of wrong direction on hydration. | M |
| **T-07.03.02.03** | ⚠️ When language changes: (1) update `dir` on `<html>`, (2) update `lang` attribute, (3) reload i18n resources, (4) re-translate current page without full browser reload. Animations should not be required to transition direction. | M |
| **T-07.03.02.04** | ⚠️ Date and number formatting must change with language — Persian uses Jalali calendar, Arabic numerals with Persian separators; English uses Gregorian calendar and Western numerals. Direction change is decoupled from locale data change but both happen together. | M |

---

## E-07.04: Responsive Mobile-First Layout

**Goal:** Every page works on mobile (320px+) through desktop. Use a mobile-first breakpoint strategy. Touch targets are ≥44px. All layouts stack vertically on mobile and expand horizontally on larger screens.

**Complexity:** L
**Depends on:** S-07.01.01 (Tailwind), E-07.16 (App shell)

---

### S-07.04.01 — Breakpoint strategy & responsive utilities

**Description:** Define Tailwind breakpoints and create shared responsive layout components.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.04.01.01** | Define Tailwind breakpoints: `xs: 375px`, `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`. Use `mobile-first` (min-width) consistently. Document breakpoint usage conventions. | S |
| **T-07.04.01.02** | Create `ResponsiveContainer` component: max-width container with responsive padding. `full` on mobile → `container mx-auto` on desktop. | S |
| **T-07.04.01.03** | Create `Stack` and `Inline` layout primitives: `Stack` (vertical, with gap), `Inline` (horizontal, wraps on mobile). Responsive gap: different gap values per breakpoint. | M |
| **T-07.04.01.04** | Create `Grid` responsive layout component: `columns` prop accepts object `{ base: 1, sm: 2, lg: 3 }` mapping to CSS grid. Used for dashboard card grids, admin table layouts. | M |
| **T-07.04.01.05** | ⚠️ All list pages must have a mobile card view as an alternative to the desktop table view. When viewport < `md`, switch from `<DataTable>` to `<CardList>` where each card shows key fields. | M |
| **T-07.04.01.06** | ⚠️ Touch targets: ensure all interactive elements (buttons, links, inputs, toggles) have minimum 44×44px tap area per WCAG 2.5.8. | M |

---

### S-07.04.02 — Responsive navigation & app shell

**Description:** Sidebar collapses to bottom tab bar on mobile. Topbar adapts to limited horizontal space.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.04.02.01** | On mobile (< `lg`): sidebar becomes a bottom tab bar with 4–5 primary navigation icons (Home, Orders, Wallet, Profile, More). "More" opens a sheet with all remaining navigation items. | L |
| **T-07.04.02.02** | On mobile: topbar shows only hamburger menu, app logo/title, notification bell, and profile avatar. All secondary actions move into the "More" drawer or overflow menus. | M |
| **T-07.04.02.03** | On tablet (`md`–`lg`): sidebar collapses to icon-only rail (60px wide). Expand on hover or tap. | M |
| **T-07.04.02.04** | ⚠️ Verify all pages look correct at `320px`, `375px`, `390px`, `414px`, `768px`, `1024px`, `1280px`, and `1920px` viewport widths. No horizontal scroll, no overlapping text, no tiny touch targets. | L |

---

## E-07.05: WCAG 2.2 AA Accessibility

**Goal:** Meet WCAG 2.2 AA across the entire application. Automated aXe/Playwright checks on every critical page plus manual review for complex flows. Keyboard navigable, screen-reader friendly, high contrast, reduced motion compatible.

**Complexity:** XL
**Depends on:** All component and page epics
**Cross-refs:** E-06 (Testing — a11y automation)

---

### S-07.05.01 — Accessibility foundation

**Description:** Establish a11y patterns, roles, live regions, focus management, and keyboard navigation across the design system.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.05.01.01** | Implement `SkipLink` component (first focusable element on every page, visible on focus: "Skip to main content"). All pages have a `<main>` element with `id="main-content"`. | S |
| **T-07.05.01.02** | Ensure all interactive elements have visible focus indicators. Define a custom focus ring via `:focus-visible` in CSS: `outline: 2px solid var(--ring)`, `outline-offset: 2px`. Never use `outline: none` without a visible replacement. | M |
| **T-07.05.01.03** | Implement a `FocusTrap` component for modals, sheets, and dropdowns. When open, Tab/Shift+Tab cycles within the dialog. Focus returns to trigger on close. | M |
| **T-07.05.01.04** | Add `aria-live="polite"` region for dynamic content updates (toast messages, notifications count, form submission status). `aria-live="assertive"` for critical errors (payment failures, session expiry). | S |
| **T-07.05.01.05** | Ensure all form inputs have programmatically associated labels (`<label htmlFor>` or `aria-label`). Error messages use `aria-describedby` or `aria-errormessage` to link to the input. Required fields use `aria-required="true"`. | M |
| **T-07.05.01.06** | Ensure all images have meaningful `alt` text. Decorative icons use `aria-hidden="true"`. Status icons (success/error/warning) have screen-reader-visible text (visually hidden `sr-only` label). | M |
| **T-07.05.01.07** | Implement proper heading hierarchy (`h1` → `h2` → `h3` → `h4`) on every page. A single `<h1>` per page. Landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` with `aria-label` when multiple instances exist. | M |
| **T-07.05.01.08** | Ensure all color combinations pass WCAG AA contrast ratios: normal text ≥ 4.5:1, large text ≥ 3:1, UI components ≥ 3:1. Verify with automated tools. Provide a "high contrast" mode toggle that strengthens all contrast ratios. | L |
| **T-07.05.01.09** | ⚠️ All custom interactive components (select, combobox, date picker, slider, tabs, accordion) must have correct ARIA roles (`combobox`, `listbox`, `option`, `tab`, `tabpanel`, `slider`, `progressbar`) and keyboard interaction patterns from WAI-ARIA Authoring Practices. | L |
| **T-07.05.01.10** | ⚠️ Ensure custom file upload inputs are keyboard accessible and have clear screen-reader instructions. Drop zones must announce "drop files here or click to browse". | M |
| **T-07.05.01.11** | Add `sr-only` utility class (visually hidden, available to screen readers) and use it for descriptive labels on icon-only buttons, status indicators, and progress information. | S |

---

### S-07.05.02 — Accessibility testing automation

**Description:** Integrate automated aXe checks into component tests and Playwright E2E. Run on every PR for critical pages.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.05.02.01** | Install `@axe-core/playwright` and configure in Playwright test suite. Add `AxeBuilder` to critical page E2E tests (login, dashboard, order list, wallet, contract detail). Verify zero violations for WCAG AA. | M |
| **T-07.05.02.02** | Add component-level a11y tests in React Testing Library using `jest-axe` or testing-library's `toBeInTheDocument` + role queries. Every component must pass basic role/name/value checks. | M |
| **T-07.05.02.03** | Write keyboard-navigation E2E tests for critical flows: Tab through login form, navigate dashboard with arrow keys, open/close modal with Escape, select from combobox with keyboard. | M |
| **T-07.05.02.04** | ⚠️ Add CI gate: a11y violations on critical pages block PR merge. Non-critical pages warn but do not block. Violations must be triaged with reason or exemption. | S |

---

## E-07.06: Light & Dark Themes

**Goal:** Full light and dark theme support across every page and component. No component is missing either theme. Both themes are independently accessible (pass contrast).

**Complexity:** L
**Depends on:** S-07.02.01 (CSS variables), S-07.05.01 (contrast)

---

### S-07.06.01 — Theme toggle & persistence

**Description:** Build theme toggle UI and persistence layer.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.06.01.01** | Build `ThemeToggle` component: sun/moon icon button in topbar. Cycles: `light` → `dark` → `system` → `light`. Shows current icon based on resolved theme. | S |
| **T-07.06.01.02** | Persist theme choice: localStorage key `barghsa-theme`. On server render, read from cookie (set by middleware or client script) to prevent flash. | S |
| **T-07.06.01.03** | ⚠️ Verify dark mode colors pass contrast checks. Dark backgrounds must not be pure `#000` (use `#0a0a0a` or similar). Dark foregrounds must not be pure `#fff` (use `#f5f5f5`). All surface colors appropriate for their role. | M |
| **T-07.06.01.04** | ⚠️ Check all shadcn/ui components for missing dark mode variants. Common issues: shadows too harsh in dark mode, borders invisible, subtle backgrounds not dark enough. | M |
| **T-07.06.01.05** | ⚠️ Verify dark mode renders correctly in all browsers (Chrome, Firefox, Safari, Edge) on desktop and mobile. Verify print stylesheet overrides dark mode to light. | M |

---

## E-07.07: Admin-Configurable Theming (Branding)

**Goal:** Admins can customize brand colors (primary, secondary, accent), upload logo, set favicon, configure app title. Changes are reflected across all user-facing pages. Supports Draft → Active lifecycle.

**Complexity:** L
**Depends on:** S-07.02.01 (CSS variables), E-02 (Admin config framework)
**Cross-refs:** E-02 (Branding settings page T-09.01.01–T-09.01.02)

---

### S-07.07.01 — Dynamic brand token injection

**Description:** Admin-configured brand colors override the default CSS variables. Branding config is loaded on app bootstrap and changes take effect without full reload.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.07.01.01** | Build `BrandConfigProvider`: on app mount, fetch `GET /api/v1/branding` (cached, long TTL). Set CSS custom properties on `:root` based on response. Support `primary`, `secondary`, `accent` colors separately for light and dark themes. | M |
| **T-07.07.01.02** | Support brand logo upload: `logoUrl` (light variant), `logoDarkUrl` (dark variant), `faviconUrl`. Swap logo in topbar, auth pages, and email templates based on current theme. | M |
| **T-07.07.01.03** | Support `appTitle` (brand name shown in topbar, browser tab title, auth pages). `appTitleEn` and `appTitleFa` for bilingual display. | S |
| **T-07.07.01.04** | ⚠️ Validate admin-configured colors have sufficient contrast against backgrounds. If an admin sets primary to a low-contrast value, show a warning before activation. Use WCAG contrast formula to check. | M |
| **T-07.07.01.05** | ⚠️ Branding changes use Draft → Active lifecycle. When a new branding version is saved as Draft, show a "Preview brand" button that temporarily applies Draft tokens so admin can see before activating. | M |
| **T-07.07.01.06** | ⚠️ Fallback: if branding API is unreachable or returns invalid data, use hardcoded defaults. Never crash the app on branding load failure. | S |

---

## E-07.08: Animation System & prefers-reduced-motion

**Goal:** Small, tasteful animations for micro-interactions (hover, focus, page transitions, skeleton loading, toast entry, modal open/close). Every animation respects `prefers-reduced-motion`. Animations never block comprehension or action.

**Complexity:** L
**Depends on:** S-07.02.01 (CSS animation tokens)

---

### S-07.08.01 — Animation system

**Description:** Define CSS keyframe animations and a React animation utility layer. Use Tailwind's `animate-*` classes and `framer-motion` (or `motion`) for complex animations.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.08.01.01** | Define CSS keyframes for: `fadeIn`, `fadeOut`, `slideInUp`/`slideInDown`/`slideInLeft`/`slideInRight`, `scaleIn` (popover, modal open), `scaleOut`, `shimmer` (skeleton), `spin` (loading spinner), `pulse` (attention). | M |
| **T-07.08.01.02** | Create `useReducedMotion()` hook: reads `prefers-reduced-motion` media query. When true: disable all non-essential animations, set transition duration to 0, skip entrance animations. Essential animations (loading spinner) use reduced-speed variant (slower spin). | M |
| **T-07.08.01.03** | Create `Animated` wrapper component: `fade`, `slide`, `scale`, `shimmer` variants. Respects `reducedMotion` — uses instant show/hide instead of animate when reduced motion is preferred. | M |
| **T-07.08.01.04** | Apply entrance animations to: page transitions (subtle fade + slide up), list items appearing (staggered fade), dashboard cards (staggered scale + fade), skeleton loading (shimmer). | M |
| **T-07.08.01.05** | Apply micro-interactions: button press scale(0.97), card hover lift, switch toggle slide, accordion chevron rotate, progress bar fill, toast slide-in from top-right (LTR) / top-left (RTL). | M |
| **T-07.08.01.06** | ⚠️ `prefers-reduced-motion: reduce` must disable: all entrance animations, hover transitions, parallax, shimmer (show flat gray instead), scale/rotate transforms. Keep only: loading spinner (reduced speed), progress bar fill (reduced speed), toast appear (instant, no slide). | M |

---

### S-07.08.02 — Page transitions & route change animations

**Description:** Subtle animated transitions between routes for a polished feel.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.08.02.01** | Implement route-level page transition using TanStack Router's `onEnter`/`onExit` hooks or a layout animation wrapper. Transition: 200ms fade + slight vertical slide (20px). | M |
| **T-07.08.02.02** | ⚠️ Respects `prefers-reduced-motion`: when enabled, page transitions are instant with no animation. | S |
| **T-07.08.02.03** | ⚠️ Ensure animations don't cause layout shift or inaccessible content delays. Content must be immediately readable even during animation. | S |

---

## E-07.09: Localized Date Pickers (Jalali & Gregorian)

**Goal:** All date pickers and date displays respect the user's language: Persian displays Jalali (Shamsi) calendar, English displays Gregorian. The underlying stored date is always UTC `timestamptz`; the display and picker toggle representation only.

**Complexity:** XL
**Depends on:** E-01 (packages/i18n date utilities), S-07.01.01 (Base UI DatePicker/Calendar)

---

### S-07.09.01 — Jalali/Gregorian calendar library integration

**Description:** Integrate a Persian/Jalali date library (e.g. `date-fns-jalali` or `jalaali-js`) with the locale system. Create a switching layer that serves the correct calendar based on language.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.09.01.01** | Integrate `date-fns-jalali` (or equivalent) into `packages/i18n`. Create `useCalendar()` hook that returns `{ calendar, format, parse, addDays, ... }` pointing to either `date-fns` (Gregorian) or `date-fns-jalali` functions based on current locale. | M |
| **T-07.09.01.02** | Create `DateDisplay` component: renders a date in the active calendar. Props: `date` (ISO string or Date), `format` (e.g. `"PPP"` for full, `"PP"` for medium, `"P"` for short), `showTime` (optional). Example: Persian `۱۴۰۳/۰۶/۰۱`, English `2024/08/22`. | M |
| **T-07.09.01.03** | Create `DateTimeDisplay` component: renders date + time in user's timezone. `date` + `timezone` props. Falls back to profile timezone if not provided. Displays: Persian `۱۴۰۳/۰۶/۰۱ ۱۵:۳۰`, English `2024-08-22 15:30`. | M |
| **T-07.09.01.04** | Create `RelativeTime` component: "2 hours ago", "3 days ago", "لحظاتی پیش", "۲ ساعت پیش". Respects locale. Updates automatically within a page (poll or mount-time calculation). | M |
| **T-07.09.01.05** | ⚠️ Ensure timezone conversion is correct. Dates stored as UTC `timestamptz`; display converts to user's timezone (default Iran Standard Time, UTC+3:30, with DST awareness). Profile timezone setting overrides default. | L |

---

### S-07.09.02 — Jalali/Gregorian DatePicker & DateRangePicker

**Description:** Build fully localized date pickers that switch calendar system based on language. Used in electricity order period selection, contract dates, solar construction dates.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.09.02.01** | Build `DatePicker` component using Base UI DatePicker primitives or a purpose-built Jalali-aware picker (e.g. `react-day-picker` with Jalali adapter). Props: `value`, `onChange`, `minDate`, `maxDate`, `disabled`, `error`, `placeholder`. Calendar switches to Jalali in Persian locale, Gregorian in English. | L |
| **T-07.09.02.02** | Build `DateRangePicker` component: selects start and end dates. Used in advanced electricity ordering (custom period). Same locale switching as single DatePicker. | L |
| **T-07.09.02.03** | Build `MonthPicker` component: selects a single Jalali/Gregorian month (used in simple electricity ordering for "current month" / "next month" selection). | M |
| **T-07.09.02.04** | Build `DateTimePicker` component: date + time selection. Time formats: Persian uses 24-hour, English uses 12-hour with AM/PM. | M |
| **T-07.09.02.05** | ⚠️ Ensure keyboard accessibility: date picker is fully navigable via arrow keys, Tab, Enter, Escape. Screen reader announces selected date in correct calendar system. | M |
| **T-07.09.02.06** | ⚠️ Jalali leap years must be handled correctly. Test boundary dates (Esfand 29th in non-leap, Esfand 30th in leap, Farvardin 1st). | L |
| **T-07.09.02.07** | ⚠️ When language switches from Persian to English (or vice versa), the displayed date in the picker converts. For example, ۱۴۰۳/۰۶/۰۱ becomes 2024/08/22. The underlying Date value doesn't change. | M |

---

## E-07.10: Form System (react-hook-form + zod)

**Goal:** A consistent form pattern using `react-hook-form` for state management and `zod` for schema validation. Every form field shows validation errors inline. Complex forms (multi-step, dependent fields, dynamic arrays) have reusable patterns.

**Complexity:** L
**Depends on:** S-07.01.02 (Input, Label, Select, Checkbox, etc.)
**Cross-refs:** All feature epics with forms

---

### S-07.10.01 — Form foundation

**Description:** Build reusable form utilities, wrappers, and validation infrastructure.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.10.01.01** | Install `react-hook-form`, `@hookform/resolvers`, `zod`. Create shared form utilities in `packages/ui/src/form/`: `FormField` (wrapper with label + error + helper text), `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`. | M |
| **T-07.10.01.02** | Create `useZodForm()` hook: wraps `useForm` with default zod resolver config, automatic focus-on-error, and `mode: 'onTouched'` for validation timing (validate on blur + change after first interaction). | S |
| **T-07.10.01.03** | Create form field components for each input type: `FormInput`, `FormSelect`, `FormTextarea`, `FormCheckbox`, `FormSwitch`, `FormRadioGroup`, `FormCombobox`, `FormDatePicker`, `FormDateRangePicker`, `FormSlider`, `FormPhoneInput`. Each auto-binds to react-hook-form `field` and displays `fieldState.error`. | M |
| **T-07.10.01.04** | ⚠️ Server-side validation errors (returned from API) must be mapped back to form fields using `setError()`. Generic server errors (e.g. "network error") display as a top-of-form Alert component. | M |
| **T-07.10.01.05** | ⚠️ All forms must preserve valid input values when a server validation error occurs. Never clear a field because another field failed validation. | S |
| **T-07.10.01.06** | ⚠️ Form submission button shows loading spinner and is disabled during submission. Prevent double submission via `formState.isSubmitting`. | S |

---

### S-07.10.02 — Form patterns: multi-step wizard, dynamic arrays, dependent fields

**Description:** Implement reusable patterns for complex forms.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.10.02.01** | Build `FormWizard` component: multi-step form with step indicator (numbered steps, completed/current/pending states), next/back navigation, server-side draft save after each step, resume capability. Used for: electricity ordering (4–5 steps), solar construction, onboarding. | L |
| **T-07.10.02.02** | Build `FormStep` component within wizard: each step validates only its fields on "Next". Steps store partial data in react-hook-form. On last step "Submit", validate all fields. | M |
| **T-07.10.02.03** | Build `DynamicFieldArray` component: add/remove/reorder items in a list. Used for: invoice lines (manual invoice creation), document uploads, agent permissions. Each item has its own sub-fields with validation. | M |
| **T-07.10.02.04** | Build `DependentSelect` component: selecting option A filters options in select B. Used for: Province → City cascading selects in address forms. Supports async options (fetch cities when province changes). | M |
| **T-07.10.02.05** | Build `FormReview` component (read-only summary of all form fields before final submission). Used for order review step before submit. Backend-rendered snapshot for financial orders. | M |

---

## E-07.11: Toast & Notification System

**Goal:** A unified toast system for transient messages (success, error, info, warning) and an in-app notification center for persistent business notifications. Toasts auto-dismiss; notifications require user action. Every CRUD operation shows a toast.

**Complexity:** L
**Depends on:** S-07.01.01 (Sonner/Toaster component), E-05 (Notifications module)

---

### S-07.11.01 — Toast system

**Description:** Build a toast system using shadcn's Sonner integration. All CRUD operations emit toasts.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.11.01.01** | Configure Sonner (shadcn's toast wrapper) in `apps/web`. Set up `<Toaster />` with: position (top-right for LTR, top-left for RTL), close button, rich colors (success green, error red, warning amber, info blue), max 3 visible toasts, swipe to dismiss. | M |
| **T-07.11.01.02** | Create `useToast()` hook: `toast.success(msg)`, `toast.error(msg)`, `toast.warning(msg)`, `toast.info(msg)`, `toast.promise(promise, { loading, success, error })`. Supports i18n keys or string messages. | M |
| **T-07.11.01.03** | Create an API response interceptor that auto-shows toasts for: successful CRUD operations ("Invoice created", "Profile updated", "Order submitted"), API errors (error message from API), network failures ("Connection lost. Retrying..."). | M |
| **T-07.11.01.04** | ⚠️ Toasts must not block or interrupt critical flows. Only one persistent toast for in-progress operations (e.g. "Uploading document..."). | S |
| **T-07.11.01.05** | ⚠️ Ensure toasts are reachable by screen readers via `aria-live="polite"`. Toast content must be announced without stealing focus. | S |

---

### S-07.11.02 — In-App Notification Center

**Description:** Integrate E-05's notification center UI within the app shell. Bell icon badge, dropdown, and full page.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.11.02.01** | Build `NotificationBell` component in topbar: bell icon with unread count badge. Fetches unread count via API (short-poll every 30s or SSE stream). Animates badge on new notification. | M |
| **T-07.11.02.02** | Build `NotificationDropdown`: last 10 notifications with icon (per type: security, payment, contract, order, system, document), title, body, relative time, read/unread dot. "Mark all as read" action. "View all" link to full notification center. Click navigates to linked record. | L |
| **T-07.11.02.03** | Build full `/app/notifications` page: cursor-based pagination, filter by `all` / `unread`, grouped by date (Today, Yesterday, This Week, Older). Each notification: icon + title + body + timestamp + action link. Mark single as read, mark all as read. Empty state when no notifications. | L |
| **T-07.11.02.04** | ⚠️ Optimistic mark-as-read (low-risk, reversible). Show read state immediately, queue API call. If API fails, revert to unread with a toast warning. | S |
| **T-07.11.02.05** | ⚠️ Update document title with unread count when tab is backgrounded: "Barghsa (3)" or "برقسا (۳)". | S |

---

## E-07.12: Error, Loading & Empty State Patterns

**Goal:** Every data-fetching view has three states: loading (skeleton or spinner), empty (helpful message + suggested action), error (retry button + message). No blank pages or broken layouts.

**Complexity:** L
**Depends on:** S-07.01.03 (Skeleton, Alert, Card)

---

### S-07.12.01 — State pattern utilities

**Description:** Build reusable components and hooks for consistent loading, empty, and error states.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.12.01.01** | Create `AsyncView` component: renders one of three states based on `{ loading, error, data }` props. Loading → `<Skeleton />`, Error → `<ErrorState />`, Empty (data=[] or null) → `<EmptyState />`, Data→ children. | M |
| **T-07.12.01.02** | Create `ErrorState` component: icon (sad face, broken connection, warning), error title (i18n), error description, retry button ("Try again"), optional "Contact support" link with pre-filled correlation ID. Error details in collapsible section for debugging (safe, no stack traces). | M |
| **T-07.12.01.03** | Create `EmptyState` component: icon (empty box, search icon, document icon), title ("No items yet", "No results found"), description (helpful message), action button ("Create first order", "Clear filters", "Browse products"), optional illustration. | M |
| **T-07.12.01.04** | Create `LoadingSkeleton` variants for common patterns: `PageSkeleton` (full page shimmer), `TableSkeleton` (5 row shimmer), `CardGridSkeleton` (6 card shimmers in grid), `FormSkeleton` (input + button shimmers), `DetailSkeleton` (header + body shimmers). | M |
| **T-07.12.01.05** | Create `useAsyncData<T>(fetcher, deps)` hook: returns `{ data, loading, error, refetch }`. Handles: initial fetch, re-fetch on dependency change, abort on unmount, error transform (localized message + code). | M |
| **T-07.12.01.06** | ⚠️ Every list page, detail page, dashboard widget, and admin page must implement the loading/empty/error pattern. No view renders a blank white page or infinite spinner. | L |
| **T-07.12.01.07** | ⚠️ Error boundaries per route: React Error Boundary catches unhandled render errors. Shows `ErrorState` with "Something went wrong" + reload button. Logs error to Sentry. | M |

---

## E-07.13: Confirmation Dialogs & Destructive Action UX

**Goal:** Every destructive, irreversible, or financial action requires explicit user confirmation. Confirmation dialogs explain consequences. Financial actions show a structured preview before the user can confirm.

**Complexity:** L
**Depends on:** S-07.01.03 (Dialog component)

---

### S-07.13.01 — Confirmation dialog system

**Description:** Reusable confirmation patterns for different severity levels.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.13.01.01** | Build `ConfirmDialog` component: configurable title, description, confirm button text + variant (`primary` for info, `destructive` for delete/cancel, `warning` for financial), cancel button text. Props: `open`, `onConfirm`, `onCancel`, `loading` (spinner on confirm button). Variants: | M |
| **T-07.13.01.02** | Build `DestructiveConfirmDialog`: confirm button is red/destructive. User must type a confirmation phrase (e.g. "DELETE") to enable the button. Used for: deleting resources, removing agents, cancelling contracts. | M |
| **T-07.13.01.03** | Build `FinancialConfirmDialog`: shows structured financial preview before user can confirm. Displays: amounts in IRR and toman, what will happen, what the consequences are, refund policy. User must check "I understand" checkbox to enable confirm button. Used for: wallet payments, order submissions, contract acceptance, gift code redemption. | L |
| **T-07.13.01.04** | Create `useConfirm()` hook: `const confirm = useConfirm()` → `await confirm({ title, description, variant })`. Returns `true` if user confirmed, `false` if cancelled. Promise-based API for inline use. | M |
| **T-07.13.01.05** | ⚠️ All destructive UI actions (delete, cancel, remove, revoke, disable) must use `DestructiveConfirmDialog`. No one-click delete for any resource. Financial actions use `FinancialConfirmDialog`. | M |
| **T-07.13.01.06** | ⚠️ Confirmation dialogs maintain focus trap, close on Escape, and have a clear "Cancel" button. The destructive action button is never the default/auto-focused button. | S |

---

## E-07.14: Password Strength Meter

**Goal:** A real-time password strength indicator on register and password-change forms that appears on focus. Hidden by default, appears when the password field is focused.

**Complexity:** M
**Depends on:** S-07.01.02 (Input, Progress)

---

### S-07.14.01 — Password strength component

**Description:** Build password strength meter with real-time feedback in Persian and English.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.14.01.01** | Build `PasswordStrengthMeter` component: hidden by default, appears with slide-down animation when password field is focused. Stays visible as long as password field has content. Contains: strength bar (0–4 segments, color-coded: empty=gray, weak=red, fair=orange, strong=yellow, very-strong=green), strength label (i18n), optional checklist of requirements. | M |
| **T-07.14.01.02** | Implement strength calculation: `weak` (< 8 chars or only lowercase), `fair` (8+ chars, mixed case), `strong` (8+ chars, mixed case + number), `very-strong` (12+ chars, mixed case + number + special char). Bonus points for length > 16. | M |
| **T-07.14.01.03** | Localize strength labels and recommendation text. Persian: `خیلی ضعیف` / `ضعیف` / `متوسط` / `قوی` / `بسیار قوی`. Each level shows improvement hint in the correct language. | S |
| **T-07.14.01.04** | ⚠️ Password strength meter is informational only — never block form submission based on strength. Minimum strength requirements are enforced by backend zod validation. | S |
| **T-07.14.01.05** | ⚠️ Password visibility toggle button (eye icon) in the password input's trailing slot. Clicking toggles between `password` and `text` input types. | S |

---

## E-07.15: Profile Switcher UI

**Goal:** Allow users with multiple profiles (Individual + Legal) to switch context. The switcher is accessible from the sidebar top section. Switching changes all visible data to the new profile's scope.

**Complexity:** M
**Depends on:** E-02 (Profile management), S-07.01.03 (DropdownMenu, Avatar, Command)

---

### S-07.15.01 — Profile switcher

**Description:** Build profile switcher dropdown in sidebar header area.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.15.01.01** | Build `ProfileSwitcher` component: shows currently active profile avatar + name + type badge (Individual/Legal). Clicking opens a dropdown listing all user's profiles. Each row: avatar, name, type badge, verification badge (verified/unverified). Selected profile has checkmark. "Manage profiles" link at bottom. | M |
| **T-07.15.01.02** | Build `ProfileBadge` in topbar: compact version showing avatar + type icon + name. Used in topbar when sidebar is collapsed. | S |
| **T-07.15.01.03** | On profile switch: show a full-page loading state (not jarring), refetch all dashboard/list data for the new profile. Persist the selected profile as default in the backend (so next login restores it). | M |
| **T-07.15.01.04** | ⚠️ If active profile is unverified and verification is enforced: show a warning banner but allow profile switch to view data. Block only new commercial orders. | M |
| **T-07.15.01.05** | ⚠️ Profile switching must never expose another profile's data. All API requests include `profileId` header or query param, validated server-side for ownership. | S |

---

## E-07.16: Sidebar & Topbar App Shell Layout

**Goal:** A responsive app shell with sidebar (primary navigation), topbar (secondary actions, profile, notifications), and main content area. Works on mobile (bottom tab), tablet (icon rail), and desktop (full sidebar).

**Complexity:** L
**Depends on:** S-07.04.02 (Responsive navigation)

---

### S-07.16.01 — App shell layout

**Description:** Build the authenticated application shell that wraps all `/app/*` routes.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.16.01.01** | Build `AppShell` layout component: CSS grid or flex layout with `--sidebar-width` and `--topbar-height` variables. Sidebar (left in LTR, right in RTL) + Topbar + `<main>` scrollable content. | M |
| **T-07.16.01.02** | Build `Sidebar` component: app logo/brand at top, `ProfileSwitcher` below, main navigation links with icons and labels, section dividers, "Admin" section visible only for admin users. Active link highlighted. Collapsible on tablet. | L |
| **T-07.16.01.03** | Build `Topbar` component: `LanguageSwitcher`, `ThemeToggle`, `NotificationBell`, `ProfileMenu` (avatar + dropdown: settings, logout). Compact on mobile. | M |
| **T-07.16.01.04** | Build `ProfileMenu` dropdown: avatar, name, email/mobile, "My Profile" link, "Settings" link, "Logout" button. Staff+admin users see "Switch to staff view" link. | S |
| **T-07.16.01.05** | Build `BottomTabBar` (mobile < `lg`): 5 primary navigation tabs with icons + labels. Active tab highlighted. "More" tab opens a Sheet with remaining navigation items. | M |
| **T-07.16.01.06** | Build `BreadcrumbBar` below topbar: shows current page path. Collapse on mobile (show only last + "..." with dropdown). | S |
| **T-07.16.01.07** | ⚠️ Sidebar navigation items must be role-aware. Staff see different items than customers. Admin sees additional items. Individual vs Legal profiles see different items. Navigation config fetched from backend based on permissions. | L |

---

### S-07.16.02 — Navigation configuration

**Description:** Define the navigation structure based on user role and active profile type.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.16.02.01** | Define navigation groups and items per role: Customer (Dashboard, Orders, Contracts, Invoices, Wallet, Consultations, Solar, Tickets, Documents, My Profile), Staff (same + CRM, document templates, operations queues), Admin (all staff + Admin Settings with sub-sections). | M |
| **T-07.16.02.02** | Legal Entity customers see additional items: Agents, Legal Profile details. Individual customers see: Saving Plans, Personal Profile. Both see shared items. | M |
| **T-07.16.02.03** | ⚠️ Show/hide navigation items based on backend-resolved permissions, not frontend role checks alone. Navigation config fetch at app mount, cached session-long. | S |

---

## E-07.17: Auth Page Layout (2-Column Brand + Form)

**Goal:** All unauthenticated pages (login, register, forgot password, reset password, TOS) share a two-column layout: left column shows brand details (logo, title, slogan, value propositions), right column contains the form. On mobile, stack vertically.

**Complexity:** M
**Depends on:** S-07.01.02 (Card, Input, Button)

---

### S-07.17.01 — Auth layout

**Description:** Build the shared auth layout component.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.17.01.01** | Build `AuthLayout` component: CSS grid with two columns. Left column (50%): brand logo, app title (persian + english), slogan, 3–4 value propositions with icons (e.g. rocket for speed, shield for security, heart for support). Right column (50%): centered card containing the form. | M |
| **T-07.17.01.02** | On mobile (< `md`): single column. Brand section collapses to compact strip at top (logo + title only), form takes full width. Value propositions are hidden or moved below the form. | M |
| **T-07.17.01.03** | Auth layout must NOT render the app sidebar, topbar, or bottom tab bar. It is a completely separate layout from `AppShell`. Use TanStack Router's layout nesting for auth routes. | M |
| **T-07.17.01.04** | Add language switcher in auth pages (top-right for LTR, top-left for RTL) so users can switch language before login/register. | S |
| **T-07.17.01.05** | ⚠️ Auth pages must never render authenticated app data. If already authenticated, redirect to `/app/dashboard`. | S |

---

### S-07.17.02 — Auth page components

**Description:** Build the individual auth page components that use the shared layout.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.17.02.01** | Build `LoginPage`: username field (email or mobile, auto-detect type), password field with visibility toggle, "Forgot password?" link, "Login" button, "Register" link. OTP step appears conditionally after credential validation. | M |
| **T-07.17.02.02** | Build `RegisterPage`: username field, password field with strength meter, TOS acceptance checkbox with link, "Register" button. OTP step after submission. Back-to-login and forgot-password links. | M |
| **T-07.17.02.03** | Build `ForgotPasswordPage`: username field, "Send reset code" button. OTP step. New password entry with strength meter. Success → redirect to login. | M |
| **T-07.17.02.04** | Build `OtpInput` component: 6-digit code entry. Auto-focus first digit, auto-advance on entry, paste support, backspace to previous. Countdown timer for resend (60s). Resend button after countdown. Error display for invalid/expired OTP. | M |
| **T-07.17.02.05** | Build `ForcePasswordChangePage`: shown when user is required to change password (admin-enforced). New password + confirm. Strength meter. On success → show success toast → redirect to login. | S |
| **T-07.17.02.06** | Build `TosPage`: simple page rendering TOS content (fetched from API). Shows last-updated date. Version history accessible. Used both for TOS display and re-acceptance flow. | S |
| **T-07.17.02.07** | ⚠️ OTP responses must always be generic: "If valid, a code was sent." Never reveal whether an account/email/mobile exists. | S |

---

## E-07.18: List Page Patterns (Sort, Filter, Search, Pagination)

**Goal:** Every list page across the application (orders, invoices, contracts, profiles, tickets, products, etc.) has a consistent pattern for sorting, filtering, searching, and pagination. Server-side filtering/sorting for performance.

**Complexity:** L
**Depends on:** S-07.01.03 (DataTable, Pagination, Command/Combobox), S-07.12.01 (AsyncView)

---

### S-07.18.01 — List page framework

**Description:** Build reusable list page components and hooks.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.18.01.01** | Create `useListQuery` hook: manages `{ search, sort, filters, page, pageSize }` from URL search params. Syncs with router (shareable URLs). Returns query params for API calls. Supports cursor pagination as a variant. | M |
| **T-07.18.01.02** | Build `ListToolbar` component: search input (with debounce, 300ms), filter button (opens filter popover/drawer), sort dropdown, "Add new" button (for create actions). Responsive: wraps on mobile. | M |
| **T-07.18.01.03** | Build `ListFilterPanel`: popover/drawer with filter fields. Each field type: text, select (single/multi), date range, number range, status checkboxes. "Apply" and "Clear all" buttons. Active filter count badge on filter button. Populated filters shown as tag/chips above the list. | L |
| **T-07.18.01.04** | Build `ListSortDropdown`: selects sort field + direction (asc/desc). Uses allowlisted sort fields from API. Default sort applied if none selected. | S |
| **T-07.18.01.05** | Build `ListViewToggle`: switch between Table view and Card view. Persisted preference per user (localStorage). Default: table on desktop, cards on mobile. | S |
| **T-07.18.01.06** | Build `ListPage` compound component: combines ListToolbar + ListFilterPanel + AsyncView(DataTable or CardList) + Pagination. All list pages use this compound component for consistency. | L |

---

### S-07.18.02 — Filter types & patterns

**Description:** Implement reusable filter controls for various data types.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.18.02.01** | `StatusFilter`: multi-select checkboxes for status values. Show colored badges for each status in the filter list. | M |
| **T-07.18.02.02** | `DateRangeFilter`: two date pickers (start/end) with preset ranges (Today, Last 7 days, This month, Last month, Custom). Localized (Jalali/Gregorian). | M |
| **T-07.18.02.03** | `TextFilter`: single search input with debounce. `NumberFilter`: min/max range inputs. `SelectFilter`: single-select dropdown with search. `MultiSelectFilter`: combobox with chips. | M |
| **T-07.18.02.04** | ⚠️ All filter state serialized to URL search params so filters survive page refresh and are shareable. | S |
| **T-07.18.02.05** | ⚠️ "Clear all filters" button shown only when filters are active. Active filter count badge on filter button. | S |

---

## E-07.19: Dashboard Widget System

**Goal:** Dashboard pages (customer, staff, admin) composed of independent widgets that fetch their own data. Widgets show loading/error/empty states individually. Each card is clickable and navigates to the relevant section.

**Complexity:** L
**Depends on:** S-07.01.02 (Card), S-07.12.01 (AsyncView), E-02 (Dashboard API)

---

### S-07.19.01 — Dashboard framework

**Description:** Build the dashboard layout and widget system.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.19.01.01** | Build `DashboardLayout` component: responsive grid of widgets. 1 column mobile, 2 columns tablet, 3 columns desktop. Each widget is a Card with header (icon + title + optional "View all" link) and body (data content). | M |
| **T-07.19.01.02** | Build `DashboardWidget` wrapper: loading skeleton (per-widget), error state (per-widget retry), empty state, data content slot. Each widget independently fetches data with `useAsyncData`. | M |
| **T-07.19.01.03** | ⚠️ Widget layout must be stable — no layout shift as widgets load. Each widget reserves its card space with a skeleton placeholder. | M |

---

### S-07.19.02 — Dashboard widgets

**Description:** Build individual widget components.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.19.02.01** | `WalletBalanceWidget`: current available balance (IRR/toman), charge button, low-balance warning if pending invoices exceed balance. Alert banner if wallet data fails to load. | M |
| **T-07.19.02.02** | `QuickStatusWidget`: grid of 4 small stat cards — Active Contracts, Pending Orders, Open Tickets, Unpaid Invoices. Each: icon + count + label + color indicator (green/yellow/red). Click navigates to filtered list. | M |
| **T-07.19.02.03** | `PendingVerificationWidget` (staff): profiles awaiting verification. Count + last 5 entries + "Show all" link. | S |
| **T-07.19.02.04** | `AgentInvitationWidget` (customer): banner for pending legal entity invitations. Accept/Decline buttons. Not dismissible until action taken. | M |
| **T-07.19.02.05** | `LatestOrdersWidget`: last 5 orders with status, date, amount. "View all" link. | S |
| **T-07.19.02.06** | `UpcomingInvoicesWidget`: next due invoices with amount, due date, days remaining. Color-coded urgency. Pay Now button. | M |
| **T-07.19.02.07** | `ActiveContractsWidget`: active contracts with end date, status, progress. | S |
| **T-07.19.02.08** | `StaffWorkQueueWidget` (staff): pending tickets, awaiting-review orders, unassigned consultations. Counts with links to each work queue. | M |
| **T-07.19.02.09** | `FailedJobsWidget` (admin): failed background jobs count, failed notifications in dead-letter queue, unresolved refund obligations. Severity indicators. | M |

---

## E-07.20: Chat UI for AI Assistant

**Goal:** A chat interface embedded in the app that allows users to interact with the AI Assistant. The chat UI adapts to the profile type (Individual, Legal, Staff) and shows appropriate agent responses with source attribution.

**Complexity:** L
**Depends on:** E-05 (AI Agent slots, AI Orchestration), E-07.16 (App shell)

---

### S-07.20.01 — Chat UI

**Description:** Build the AI Assistant chat interface, available as a slide-over panel or full page.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.20.01.01** | Build `AIChatPanel`: slide-over sheet from right (LTR) / left (RTL) triggered by a floating action button (bottom-right/bottom-left corner of the app). Contains: chat header (AI avatar + "Barghsa AI Assistant" + close button), message list (scrollable, auto-scroll to bottom), input area (textarea + send button + suggested prompts). | L |
| **T-07.20.01.02** | Build `ChatMessage` component: user message (right-aligned, brand-colored bubble), AI message (left-aligned, muted bubble). AI messages include: text content, source KB citations (expandable "Sources" section with KB name + title + excerpt), policy filter badges applied. Timestamp per message. | L |
| **T-07.20.01.03** | Build `ChatInput` component: auto-resizing textarea, send button (disabled while AI is responding), suggested prompt chips (3–4 contextual suggestions, e.g. "Show my invoices", "What's my wallet balance?"). Enter to send, Shift+Enter for newline. | M |
| **T-07.20.01.04** | Build `ChatWelcome` component: greeting message ("Hi [name]! How can I help you today?"), suggested starting prompts, profile context indicator ("You're asking as [profile name]"). | S |
| **T-07.20.01.05** | Implement streaming AI response: show typing indicator (animated dots) while waiting for response. Render response progressively as tokens arrive (SSE or WebSocket stream). | M |
| **T-07.20.01.06** | Build `TrustedUIConfirmation` component: for write actions proposed by AI, show a structured action card above the chat input area. Card displays: action type, parameters, consequences. User confirms or rejects with explicit buttons. AI cannot programmatically confirm. | L |
| **T-07.20.01.07** | ⚠️ Chat must respect user's language preference. AI responses in same language as user's messages. Date/number formatting locale-aware. | M |
| **T-07.20.01.08** | ⚠️ Data isolation: Individual chatbot sees only Individual profile data. Legal chatbot sees only Legal profile data. Staff chatbot sees data based on staff roles. | M |

---

## E-07.21: Agent Test Chat (Admin)

**Goal:** A test chat UI in the admin panel for admins to test AI agent configurations before deploying to a slot.

**Complexity:** M
**Depends on:** E-05 (A6 — Agent Test Chat), E-07.20 (Chat UI components)

---

### S-07.21.01 — Admin test chat

**Description:** Build the test chat interface in the admin AI configuration pages.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.21.01.01** | Build `AgentTestChat` component: agent selector dropdown (lists all agents), chat message list (reuses ChatMessage from E-07.20), input area + send button. Below chat: response metadata panel showing source KBs (expandable with excerpts), policy filters applied, token usage, latency. | M |
| **T-07.21.01.02** | Build `ResponseMetadataPanel`: expandable sections for "Knowledge Bases Used" (KB name + document title + excerpt), "Policies Applied" (policy name + rule matched), "Token Usage" (prompt/completion/total), "Latency" (ms). | M |
| **T-07.21.01.03** | Build "New Conversation" button to clear test chat history. | S |
| **T-07.21.01.04** | ⚠️ Rate limit test chat: 10 requests/min per admin. Show remaining quota. Return 429 with retry-after. | S |
| **T-07.21.01.05** | ⚠️ Test chat is isolated — does not affect production conversations or AI audit logs. | S |

---

## E-07.22: Forms & Wizard Patterns (Multi-Step)

**Goal:** Shared multi-step wizard pattern used by electricity ordering (simple 4–5 steps, advanced 5 steps), solar construction request, onboarding (profile creation), and saving plan ordering.

**Complexity:** L
**Depends on:** S-07.10.02 (FormWizard), E-03 (Order forms)

---

### S-07.22.01 — Wizard framework

**Description:** Build the multi-step form wizard infrastructure shared across all multi-step flows.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.22.01.01** | Build `FormWizard` component: step indicator (numbered circles with labels, completed/active/pending visual states, connector lines), step content area, navigation bar (Back/Save Draft/Next). Back button preserved on all non-first steps. Next validates current step fields only. | M |
| **T-07.22.01.02** | Implement server-side draft saving: after each completed step, POST server draft. On resume, fetch draft and prefill form. Drafts have TTL (admin-configurable, default 7 days). | L |
| **T-07.22.01.03** | Build `StepReviewPage`: final step showing all collected data in read-only format. Backend-rendered snapshot for financial orders (authoritative total). "Edit" links next to each section to return to that step. | M |
| **T-07.22.01.04** | ⚠️ If user navigates away mid-wizard, show confirmation dialog: "You have unsaved changes. Save draft before leaving?" | S |
| **T-07.22.01.05** | ⚠️ Wizard state preserved in URL (step number as search param) for deep-linkability. | S |

---

### S-07.22.02 — Specific wizard implementations

**Description:** Implement each wizard using the shared framework.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.22.02.01** | Simple electricity order wizard: Step 1 (Period type: weekly/monthly + period selector), Step 2 (kWh entry with bill data suggestion), Step 3 (Price preview with green composition breakdown), Step 4 (Gift code optional), Step 5 (Review + submit). | L |
| **T-07.22.02.02** | Advanced electricity order wizard: Step 1 (Date range: start/end Jalali date pickers), Step 2 (Bundle builder: 4 product quantity inputs with green rule derivation), Step 3 (Price preview), Step 4 (Gift code), Step 5 (Review + submit). | L |
| **T-07.22.02.03** | Solar construction request wizard: Step 1 (Solar type + property details), Step 2 (On-Grid/Off-Grid selection + bill identifier for On-Grid), Step 3 (Contract stages preview + TOS check), Step 4 (Review + submit). | L |
| **T-07.22.02.04** | Saving plan order wizard: Step 1 (Select plan), Step 2 (Select hardware), Step 3 (Bill identifier), Step 4 (Address select/add), Step 5 (Accept agreement + Review + Submit). | L |
| **T-07.22.02.05** | Onboarding wizard: Step 1 (Select profile type: Individual/Legal), Step 2a (Individual: name, national ID, province/city, address, postal code), Step 2b (Legal: company info, representative, address, registration info), Step 3 (Review + Submit). | L |

---

## E-07.23: Ticket / Comment Thread UI

**Goal:** A support ticket system with conversation threads. Comments from customer and staff are visually distinct. Staff can add internal notes (customer-invisible).

**Complexity:** L
**Depends on:** E-02 (Ticketing system), S-07.01.03 (Avatar, Card, Textarea)

---

### S-07.23.01 — Ticket UI

**Description:** Build the ticket list, detail, and comment thread components.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.23.01.01** | Build `TicketListPage`: uses ListPage compound component. Columns: subject, status badge, priority indicator (P1/P2/P3), last update (relative time), related entity link. Expandable row on mobile. | M |
| **T-07.23.01.02** | Build `TicketDetailPage`: header (subject, status badge, priority, created date, related entity), conversation thread, reply input area (for public reply), internal note toggle (staff only). | L |
| **T-07.23.01.03** | Build `CommentThread` component: chronological message list. Customer comments (white bubble, left-aligned in LTR), Staff comments (brand-colored border, same alignment), Internal notes (yellow background, "INTERNAL" badge, visible only to staff). Each comment: author avatar + name, timestamp, content, attachment thumbnails. | L |
| **T-07.23.01.04** | Build `TicketReplyInput`: textarea with formatting toolbar (bold, italic, list, link), file upload (drag & drop), "Add internal note" toggle (staff only), "Submit reply" button. | M |
| **T-07.23.01.05** | Build `TicketStatusDropdown` (staff): change ticket status with reason input. Statuses: Open, In Progress, Waiting on Customer, Waiting on Staff, Resolved, Closed. | M |
| **T-07.23.01.06** | ⚠️ Staff internal notes must never be visible to customers. Backend enforces visibility flag. Frontend never renders internal notes when role is customer. | M |

---

## E-07.24: Data Table / Grid Components

**Goal:** A flexible, sortable, selectable data table for admin lists and complex data views. Responsive: collapses to card list on mobile.

**Complexity:** L
**Depends on:** S-07.01.03 (Table, ScrollArea)

---

### S-07.24.01 — DataTable component

**Description:** Build an enterprise-grade data table with sorting, selection, row actions, expandable rows, and sticky header.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.24.01.01** | Build `DataTable` component using Base UI Table or TanStack Table. Features: column definition with header, accessor, cell renderer, sorting (client or server), row selection (checkbox), expandable rows (sub-row), sticky header, horizontal scroll for many columns, row hover highlight. | L |
| **T-07.24.01.02** | Build column renderers: `TextCell`, `NumberCell` (locale-formatted), `DateCell` (localized relative/absolute), `StatusCell` (colored badge), `ActionCell` (dropdown menu with row actions), `CurrencyCell` (IRR/toman formatted), `AvatarCell` (small avatar + name), `LinkCell` (clickable reference). | M |
| **T-07.24.01.03** | Build `CardListView` as mobile alternative: each row renders as a card showing key fields. Responsive switch at `md` breakpoint. | M |
| **T-07.24.01.04** | ⚠️ Ensure table is keyboard navigable: Tab through rows, Enter/Space for row actions, arrow keys for sort/filter navigation. Screen reader announces row count, column headers, current sort. | M |

---

## E-07.25: Document Upload & Status UI

**Goal:** A consistent file upload experience across the application. Drag-and-drop, progress indication, status display, and preview for supported types.

**Complexity:** L
**Depends on:** E-05 (Document storage, upload pipeline), S-07.01.03 (Progress)

---

### S-07.25.01 — File upload component

**Description:** Build a reusable file upload component with drag-and-drop, validation, and progress.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.25.01.01** | Build `FileUpload` component: drop zone (dashed border, icon, "Drag files here or click to browse" text), file list (name, size, progress bar per file), file type validation (extension + MIME against configured allowlist), size validation, max file count. Accessibility: keyboard-accessible drop zone, screen reader announces upload progress. | L |
| **T-07.25.01.02** | Build `FilePreview` component: image preview (thumbnail), PDF preview (first page), document icon fallback. Used in document lists, ticket attachments, upload review. | M |
| **T-07.25.01.03** | Build `DocumentStatusBadge` component: state labels with colored badges — Uploading (gray), Pending scan (yellow pulse), Available (green), Submitted for review (blue), Approved (green check), Rejected (red, with reason shown), Superseded (outline), Quarantined (red alert), Removed (gray strikethrough). | M |
| **T-07.25.01.04** | Build `DocumentList` component: list of documents with icon, filename, size, upload date, status badge, download/delete/replace actions per permission. | M |
| **T-07.25.01.05** | ⚠️ Upload validation errors must be specific: "PDF files up to 25MB are accepted", "File type .exe is not supported". | S |
| **T-07.25.01.06** | ⚠️ Quarantined files show safe message: "This file cannot be accepted. Please upload a replacement." — never reveal malware detection details to customer. | S |

---

## E-07.26: Wallet / Balance Display Components

**Goal:** Consistent display of monetary values, wallet balance, and transaction history across all pages. All amounts in IRR, displayed with locale-aware formatting.

**Complexity:** M
**Depends on:** S-07.01.02 (Card, Badge)

---

### S-07.26.01 — Currency display

**Description:** Build reusable components for displaying monetary values.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.26.01.01** | Build `Currency` component: displays amount in IRR with locale formatting. Props: `amount` (integer IRR), `showToman` (show toman equivalent in parentheses), `showCurrencyCode` (show "IRR" suffix), `variant` (default, large for wallet balance, small for inline). Persian format: `۱,۲۳۴,۵۶۷ ریال`, English format: `IRR 1,234,567`. | M |
| **T-07.26.01.02** | Build `WalletBalanceCard`: available balance (large), posted balance (muted), reserved balance (muted, if > 0). "Charge wallet" button. Low-balance warning (red text) when pending invoices exceed balance. Clickable → navigates to wallet page. | M |
| **T-07.26.01.03** | Build `TransactionList` component: chronological list of wallet transactions. Each row: date (localized), type icon + label (top-up, payment, refund, etc.), amount (+/- in green/red), state badge, description, reference link. Cursor-based pagination. | M |
| **T-07.26.01.04** | Build `InvoicePaymentSummary`: shows invoice total, paid amount (green progress fill), remaining amount (red if > 0), payment status bar, wallet pay button (enabled if sufficient balance). | M |

---

## E-07.27: Status Badges, Timeline & State Progress

**Goal:** Consistent status representation using colored badges, state machine visualization (timeline), and progress indicators. Every domain entity (order, invoice, contract, document, ticket) has a visual state representation.

**Complexity:** M
**Depends on:** S-07.01.02 (Badge, Progress)

---

### S-07.27.01 — Status display components

**Description:** Build reusable status display components.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.27.01.01** | Build `StatusBadge` component: maps state strings to colored badges. Color map: `pending/waiting` → yellow, `active/approved/paid/signed` → green, `rejected/cancelled/failed` → red, `draft/submitted` → blue, `completed/resolved` → gray. Supports dot-only variant. Each badge has a descriptive title attribute. | M |
| **T-07.27.01.02** | Build `StatusTimeline` component: vertical timeline showing state transitions. Each entry: dot (colored by state), date (localized), state label (i18n), actor name, reason/note. Used in: order detail, contract detail, invoice detail, consultation detail. | M |
| **T-07.27.01.03** | Build `ProgressStepper` component: horizontal step indicator (used for solar construction stages, saving plan fulfillment). Steps: completed (green check), current (blue circle + pulse), pending (gray circle). Connector lines between steps. | M |
| **T-07.27.01.04** | Build `DualStatusDisplay` for electricity orders: shows commercial status (e.g. "Active") AND financial status (e.g. "Paid") as two separate labeled badges side by side. Never combine into one. | M |
| **T-07.27.01.05** | ⚠️ All status labels are i18n. Persian labels match the product's business language (e.g. `در انتظار بررسی` not `Pending`). | M |

---

## E-07.28: Onboarding Flow / Profile Creation Wizard

**Goal:** First-time users with no profiles are redirected to `/onboarding`. They create one or more profiles (Individual, Legal, or both). After onboarding, they land in `/app/dashboard`.

**Complexity:** L
**Depends on:** E-02 (Profile creation), S-07.22.01 (FormWizard)

---

### S-07.28.01 — Onboarding UI

**Description:** Build the onboarding page and profile creation wizard.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.28.01.01** | Build `OnboardingPage`: full-page wizard (not inside AppShell). Step 1: "What type of profile would you like to create?" — two large cards with icons: "Individual" and "Legal Entity". User can select one or both (checkboxes). "Continue" button. | M |
| **T-07.28.01.02** | Build `IndividualProfileForm`: title (optional, text input), first name (required), last name (required), province → city cascading selects (fetched from API), full address (textarea), postal code (required, 10-digit Iranian format validation), national ID number (required, 10-digit validation). Save as draft after each step. | L |
| **T-07.28.01.03** | Build `LegalProfileForm`: legal name (required), national identifier / شناسه ملی (required, unique), registration number (required), company type dropdown (required), registration date (optional Jalali date picker), economic code (optional), official phone/email (optional), province → city → address → postal code (required), authorized representative name + title (required), optional document uploads. | L |
| **T-07.28.01.04** | Build `OnboardingReviewPage`: shows created profile(s) summary. "Done" button redirects to `/app/dashboard` with first profile selected as default. | M |
| **T-07.28.01.05** | ⚠️ If user has no profiles and tries to access any `/app/*` route, redirect to `/onboarding`. | S |

---

## E-07.29: Agent Management UI (Customer Side)

**Goal:** Legal entity owners and managers can view, invite, and manage agents. Invite by mobile/email. Assign roles (Manager, Finance, Legal). View pending invitations.

**Complexity:** M
**Depends on:** E-02 (Agent management), S-07.18.01 (ListPage), S-07.01.03 (Dialog, Command)

---

### S-07.29.01 — Agent management UI

**Description:** Build the customer-side agent management page.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.29.01.01** | Build `AgentListPage`: list of all agents for the active legal profile. Columns: avatar + name, username (masked email/mobile), role badges (Manager/Finance/Legal), status (active/pending), invited date, last active date. Owner has crown icon. Owner row shows "Transfer ownership" action. "Invite agent" button. | M |
| **T-07.29.01.02** | Build `InviteAgentDialog`: input field for username (email or mobile), role radio/select (Manager, Finance, Legal), optional message. "Send invitation" button. Validates: cannot invite existing agent, cannot invite self. | M |
| **T-07.29.01.03** | Build `AgentDetailDialog`: shows agent details, role, activity history. Actions: change role, remove agent (with destructive confirmation dialog), withdraw pending invite. | M |
| **T-07.29.01.04** | Build `AgentInvitationBanner` (on dashboard): when the current user has been invited to a legal entity, show a prominent card: "You've been invited to join [Legal Entity Name] by [Inviter Name]". Accept / Decline buttons. Not dismissible until action taken. | M |
| **T-07.29.01.05** | ⚠️ Removing the last owner is blocked unless ownership is transferred first. Show explanatory message. | S |

---

## E-07.30: Admin Settings / Config Pages Layout

**Goal:** Consistent layout for all admin configuration pages. Tabbed or sidebar-nested sections, versioned settings with Draft → Active lifecycle, audit history display.

**Complexity:** L
**Depends on:** E-02 (Admin pages), S-07.01.03 (Tabs, Card, Dialog, Alert)

---

### S-07.30.01 — Admin settings framework

**Description:** Build shared admin settings page patterns.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.30.01.01** | Build `AdminSettingsLayout`: nested sidebar navigation (left) + content area (right). Categories: Branding, Staff & Roles, Geography, Products, Pricing & VAT, Gift Codes, Notifications, Documents, Electricity, AI Orchestration, Security, System. Section collapse on mobile into dropdown. | L |
| **T-07.30.01.02** | Build `SettingsFormSection` pattern: card with title, description, form fields. Save button per section (not full page save). Shows toast on success. | M |
| **T-07.30.01.03** | Build `VersionedSettingsCard`: shows current active config, last updated date, updated by. "Edit" button opens edit mode. Save creates Draft version. "Activate" button promotes Draft to Active. "View history" shows versions (date, author, status badge). Rollback button on superseded versions. | M |
| **T-07.30.01.04** | Build `ConfigPreviewCard`: side-by-side "Current" vs "Draft" comparison. Used for branding preview, template changes, VAT rate changes. | M |
| **T-07.30.01.05** | Build `AuditLogViewer`: timeline of config changes — field changed, old value, new value, changed by, timestamp. Expandable per entry. | M |
| **T-07.30.01.06** | Build `StepUpAuthGate`: when admin attempts a sensitive action (provider config, refund threshold, role change), show MFA step-up dialog. User re-authenticates (OTP) and the action proceeds only after successful step-up. Dialog shows "Sensitive action requires re-authentication." | M |

---

### S-07.30.02 — Admin-specific page implementations

**Description:** Build key admin configuration pages using the shared framework.

**Tasks:**

| ID | Task | Complexity |
|----|------|------------|
| **T-07.30.02.01** | **BrandingSettingsPage**: logo upload with preview (light + dark), color pickers (primary, secondary, accent), app title inputs (FA/EN), favicon upload, preview toggle, versioned save + activate. | M |
| **T-07.30.02.02** | **StaffRolesPage**: roles table with permissions grouped by module (checkbox grid). Read-only for predefined roles initially. "View effective permissions" per staff user. | M |
| **T-07.30.02.03** | **GeographyPage**: provinces table with expandable cities per row. Add/edit/delete actions. Persian and English names. Bulk import for city seed. | M |
| **T-07.30.02.04** | **TosEditorPage**: rich text editor (TipTap-like) with side-by-side diff against current active version, "Mark as material change" toggle, version history list. | M |
| **T-07.30.02.05** | **NotificationTemplatesPage**: template list (event key filter, language toggle, channel filter), template editor with variable sidebar, preview pane with sample data, test send button. | L |
| **T-07.30.02.06** | **EmailProviderPage**: provider selector (SMTP/Resend), conditional credential fields (secrets masked), test connection button, activate/disable/rollback buttons, current active version display. | L |
| **T-07.30.02.07** | **SmsProviderPage**: API key (masked), sender line, throughput, low-credit threshold. Template mapping sub-section: event key → SMS template ID + variable mapping. Test send. | L |
| **T-07.30.02.08** | **AiOrchestrationPage**: nested tabs — Models (table + add/edit), Knowledge Bases (tree/list + upload + processing status), Policies (list + editor), Agents (list + create/edit + test chat at bottom), Agent Slots (table + assignment dropdown). | XL |
| **T-07.30.02.09** | **ElectricitySettingsPage**: two sections (Simple/Advanced green rule), each with enable toggle, threshold input, percentage slider. Online top-up limit. Max contract duration, lead days. Customer increase max %. Safety validation on activation. | M |
| **T-07.30.02.10** | **VatSettingsPage**: table of VAT configurations (category, rate, effective dates), product override toggle. Add new rate with future effective date. | M |
| **T-07.30.02.11** | **GiftCodesPage**: codes list with search/filter, create/edit form, usage statistics per code, active/inactive toggle. | M |
| **T-07.30.02.12** | **UploadPoliciesPage**: table (category, allowed formats, max size), edit modal per category. Deployment-safe boundary warnings. | M |
| **T-07.30.02.13** | **DualApprovalPage**: threshold input (IRR) with large number format, description of affected actions. Step-up required to change. Emergency override section. | M |

---

## Cross-Cutting Concerns

### Observability

- All components emit `data-testid` attributes for E2E testing
- Component render timings tracked via React DevTools Profiler in dev
- Error boundaries per route log to Sentry with component stack trace
- Toast operations tracked: count, type, auto-dismiss rate
- Chat UI tracked: messages sent, response latency, token usage per session

### Performance

- Route-level code splitting: admin pages, AI chat UI, document editors, chart widgets lazy-loaded
- Customer purchase paths never lazy-loaded
- List pages: server-side sorting/filtering, cursor pagination for large datasets
- Date pickers: locale data lazy-loaded per language
- Chat UI: virtualized message list for conversations > 50 messages
- Skeleton loading prevents layout shift (CLS budget: < 0.1)

### Testing

- **Unit tests**: each component variant renders correctly; each component passes a11y checks; form validation patterns; date locale switching; theme switching; animation reduced-motion behavior
- **Component tests**: RTL tests for form interaction, dialog open/close, list sort/filter, date picker keyboard navigation, chat message rendering, file upload state transitions
- **E2E**: full auth flow (login → OTP → dashboard), onboarding → profile creation → dashboard, electricity order wizard (all steps), AI chat open → ask question → see response, admin theme change → verify customer sees new brand, RTL/LTR toggle → verify layout flips

### Localization

- Every string uses i18n key — no hardcoded text in any component
- Date and number formatting uses locale-aware formatters
- Direction (RTL/LTR) changes with language
- Calendar system (Jalali/Gregorian) changes with language
- Error messages, validation messages, toast messages all localized
- Empty state, loading, and confirmation dialog text all localized

### Accessibility

- Every component passes automated aXe checks
- Keyboard navigation for all interactive components
- Focus management for modals, sheets, dropdowns
- Screen reader announcements for dynamic content updates
- Focus indicators visible on all interactive elements
- `prefers-reduced-motion` respected globally
- Touch targets ≥ 44px on mobile

### Security

- AI chat data isolation per slot/session — never mix profile contexts
- File upload validation at client and server
- Sensitive financial values rendered with `aria-label` only when needed
- Confirmation dialogs for destructive actions — never one-click delete
- Step-up auth gate for sensitive admin actions
- No secrets in rendered HTML, component props, or data attributes

---

*Document generated for Epic 07 — UI/UX Foundation & Design System*