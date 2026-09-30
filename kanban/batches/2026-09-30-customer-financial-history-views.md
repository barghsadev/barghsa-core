# Customer financial history table and card views

Canonical work: `07-ui-ux-design.md#T-07.18.01.05` (shared ListViewToggle, responsive defaults and per-user persistence), with customer-list adoption portions of `07-ui-ux-design.md#T-07.18.03.01` (contracts) and `07-ui-ux-design.md#T-07.18.03.02` (invoices). The full ListPage framework, other customer/staff lists and remaining parent-task criteria stay open; parent tasks are not marked wholly complete.

Customers can switch invoice and contract histories between semantic tables and the existing cards. Without an explicit choice, screens at least 768 pixels wide show tables and narrower screens show cards; resizing follows this default. Explicit choices persist independently for each authenticated account and history, survive reload/navigation and synchronize across tabs. Invalid or blocked localStorage falls back safely, and anonymous or another account's choices cannot populate the new account's preference. The existing session guard supplies the account ID through context without another session request.

Invoice tables show the existing reference, correction type, state, service period, exact total/confirmed payment amounts, issue date and due date, retaining explanations and detail links. The current API supplies an invoice UUID rather than a separate invoice number; this batch does not invent one. Contract tables retain reference/number, service, state and pending amendment, the immutable accepted party or current draft account, service dates, fixed/variable commercial value, publication/acceptance history and linked invoice/order actions. Switching views preserves loaded cursor pages, filters, sorting and open contract details without another list/detail request. Staff contract cards keep their existing presentation and actions.

Both languages use existing account-calendar/timezone and exact IRR formatting. Toggle buttons expose their pressed state and have 44-pixel targets; tables have captions and scoped column headers. Wide tables scroll within the existing shared ScrollArea with a horizontal scrollbar. Its focused horizontal viewport handles unmodified Left/Right keys consistently in Safari, leaving nested controls, modified keys and vertical areas alone. Browser review caught this Safari gap and verified the correction. An older staff-context browser fixture was repaired to supply the authenticated session and persisted locale.

Review checked account/history isolation, storage failures and cross-tab updates, responsive defaults, preservation of cursor/filter/detail state, immutable party names, exact large amounts and references, existing staff actions, localization, keyboard scrolling and viewport overflow.

Validation:

- `pnpm build`, `pnpm typecheck`, `pnpm lint` and all 64 `pnpm check:bundle` budgets pass.
- Full web unit suite: 1,168 passing. After the final horizontal keyboard adjustment, the 11 directly related preference, session and invoice unit tests pass again. UI suite: 64 passing; i18n suite: 53 passing.
- New financial-history browser scenarios: 10 passing across Chromium, Firefox, WebKit, Android and iPhone, in English/Persian. They cover defaults, account/history persistence, loaded pages, open details, retained links/party/amounts, keyboard scrolling, accessibility and mobile overflow.
- Existing invoice/contract filter browser scenarios: 20 passing across the same five projects. Existing publication, acceptance/upload, signature, activation and version-bound staff context workflows: 14 passing in Chromium, including the two context scenarios rerun after fixture repair.
- `pnpm format:check`, diff whitespace and `python3 kanban/scripts/build_backlog.py --check` pass.

The preceding filter-chip batch's GitHub CI completed successfully. This batch was committed and pushed directly to main; its [GitHub CI](https://github.com/barghsadev/barghsa-core/actions/runs/36749236042) completed successfully. The scheduler remains paused, and historical loop state and generated queue/ledger are unchanged.
