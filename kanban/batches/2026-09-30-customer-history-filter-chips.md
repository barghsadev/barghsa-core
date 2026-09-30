# Removable customer history filter chips

Canonical work: the applied-filter chip portion of `07-ui-ux-design.md#T-07.18.01.03`, adopted by customer saving orders, solar requests, consultations, electricity orders, invoices and contracts. The broader drawer/popover, combined Apply workflow, full list framework, MultiSelectFilter and staff-list adoption remain open; parent tasks are not marked wholly complete.

Applied search, each selected status, date range, invoice amount range and contract service now appear above the fields as removable chips. They remain available while the filter fields are collapsed. Each removal changes only its own criterion in one navigation and resets pagination, while retaining other filters, the view, sort order and contract detail parameter. Back restores the prior selections. Consultation form state and unapplied edits to other fields survive individual removals; Clear all retains its separate draft-reset behavior.

Date captions use the account timezone and localized calendar, distinguish From from the exclusive Before bound, and show the relevant submission, invoice-creation or contract-publication label. Invoice amount captions use the existing exact IRR formatter, including integers beyond JavaScript's safe range. Status and service captions use the same translated labels as their controls. Chip buttons wrap on narrow screens, isolate their text for RTL, have translated removal names and return focus to the Filters button.

Review checked per-field URL mutations, retention of other criteria and view/detail parameters, multi-status removal, exact amount handling, draft isolation, cursor reset, localization, focus and mobile layout. Browser assertions now parse TanStack-encoded search values and compare semantic criteria rather than parameter order, preserving quoted numeric strings. The browser review also exposed stale service-dropdown search text after external selection changes; SelectFilter now synchronizes its input with the selected value and label and shows all choices when that caption is displayed.

Validation:

- `pnpm build` and `pnpm typecheck` pass.
- `pnpm --filter @barghsa/web test`: 1,162 passing, including pending-draft isolation, one-status/range removal, exact amount text and keyboard focus.
- `pnpm --filter @barghsa/i18n test`: 53 passing.
- English/Persian history, invoice and contract browser scenarios: 60 passing across Chromium, Firefox, WebKit, Android and iPhone. Chromium history/invoice scenarios pass, the two contract scenarios pass after the dropdown correction, and the remaining four browser projects pass all 48 scenarios. Coverage includes individual chip removal while collapsed, one request without an old cursor, retention of other selections, Back, Clear all, service choices, consultation form preservation, overflow and accessibility.
- `pnpm lint`, `pnpm format:check`, `pnpm check:bundle` with all 64 budgets, diff whitespace and `python3 kanban/scripts/build_backlog.py --check` pass.

The preceding filter-count/reset batch's GitHub CI completed successfully, including combined source coverage. This batch’s [GitHub CI](https://github.com/barghsadev/barghsa-core/actions/runs/36744453738) completed successfully after the direct main push. The scheduler remains paused; historical loop state and generated queue/ledger are unchanged.
