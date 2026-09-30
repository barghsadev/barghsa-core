# Customer service history table and card views

Canonical work: customer service-list adoption of `07-ui-ux-design.md#T-07.18.01.05`. Electricity orders, saving orders, solar requests and consultation requests now use the shared ListViewToggle, account/history preference hook and HistoryTable. Together with the preceding financial-history batch, all six main customer business histories support both views. The full ListPage compound framework (`07-ui-ux-design.md#T-07.18.01.06`), filter drawer/popover with combined Apply, other lists and staff adoption remain open.

Saving tables retain the accepted plan/equipment names, bill identifier, submission date, exact IRR total, order/financial status and payment or contract-review action. Electricity tables retain fulfillment and financial status, exact amount/quantity, submission date, inclusive delivery period and invoice/contract actions. The delivery-period formatter is shared with cards and preserves the API's exclusive end bound. Solar tables retain building/connection type, status, submission date, next step and responsible party; actionable steps link directly to invoices, contracts or the matching request document/postal section. Consultation tables retain the requested product title, status, date, staff owner/team and payment/information/offer actions.

Without a saved choice, desktop shows tables and mobile shows cards. Explicit choices persist separately for the authenticated account and each history. View changes retain loaded cursor pages, filters and sorting without another list request. The consultation product selection, confirmation and enabled submit action survive switching; the form keeps its existing maximum width while tables can use wider desktop space. Existing cards and detail links remain available. Tables use captions, scoped headers, labeled status badges and the shared keyboard-accessible horizontal scroll area, with account-timezone/calendar and exact number formatting in both languages.

Review checked the unchanged query/cursor/request lifecycle, next-action policy reuse, link destinations and detail-page fragment IDs, exclusive period handling, retained financial and ownership fields, consultation form state, stored preference isolation, localization, keyboard scrolling and mobile overflow. No API, database or dependency changes were needed.

Validation:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and all 64 `pnpm check:bundle` budgets pass.
- `pnpm --filter @barghsa/web test`: 1,168 passing; `pnpm --filter @barghsa/i18n test`: 53 passing.
- Chromium: 16 passing scenarios covering the eight existing bilingual history filter/reset flows and eight new view flows.
- Firefox, WebKit, Android and iPhone: 32 passing new view scenarios. Total: 48 passing browser scenarios, covering responsive defaults, exact amounts and inclusive periods, loaded-page retention, invoice/contract/document/postal/information links, consultation form retention, saved views, URL sorting, keyboard scrolling, accessibility and viewport overflow.
- Diff whitespace and `python3 kanban/scripts/build_backlog.py --check` pass (1,355 tasks and 116 traceability entries).

The preceding financial-history batch's [GitHub CI](https://github.com/barghsadev/barghsa-core/actions/runs/36749236042) completed successfully. This batch is pushed directly to main and its CI is checked after push. The scheduler remains paused; historical loop state and generated queue/ledger are unchanged.
