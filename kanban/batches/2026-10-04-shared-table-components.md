# Shared tables, cards and cell renderers — October 4, 2026

## Scope and task identity

This batch implements the remaining shared table foundation as one group:

- `07-ui-ux-design.md#T-07.24.01.01`: expandable sub-rows, sticky headers and existing sortable/selectable table behavior.
- `07-ui-ux-design.md#T-07.24.01.02`: `TextCell`, `NumberCell`, `DateCell`, `StatusCell`, `ActionCell`, `CurrencyCell`, `AvatarCell` and `LinkCell`.
- `07-ui-ux-design.md#T-07.24.01.03`: reusable `CardListView` and an opt-in mobile presentation below the `md` breakpoint.
- `07-ui-ux-design.md#T-07.24.01.04`: native keyboard controls, logical arrow navigation between sort controls, row counts, headers, selection and sort announcements.

The shared components and their public distribution are implemented. Existing business pages retain their current lists; domain-by-domain adoption is separate work. The production-built component fixture exercises the actual library rather than introducing a product demo route. No backend behavior or data-access scope changes.

## Implementation and review

`DataTable` accepts an optional card renderer, row detail renderer, eligibility predicate, row label and controlled expansion set. Table and cards use the same sorted data and selection/expansion state, so crossing the breakpoint preserves chosen rows and open details. Disclosures have distinct table/card IDs and stay bound to stable row keys after sorting. Controlled operations copy sets without mutating caller state and retain unrelated page keys. Ineligible rows and loading states cannot open details. The standalone card list does not invoke row renderers while loading.

The header is sticky within the existing scroll container; callers can disable it. Captions and column scopes describe the table. The current-page row count is announced with the selected numeral preference. Sorting remains native buttons with Enter/Space/Tab behavior; logical arrows and Home/End move between sort controls without changing order. Mobile cards expose the same sort choices and bulk/row selection. The hidden presentation is absent from the browser accessibility tree. The explicit list role follows [MDN's Safari accessibility guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility); a documented exception applies only to the redundant-role lint warning on this list.

Cell renderers keep stored text escaped and isolate mixed-direction values. Number cells reject non-finite values and accept explicit numeral preferences. Date cells expose an ISO time while delegating absolute or relative display to the owner's account-timezone formatter; invalid or absent dates stay unavailable. Currency cells pass exact raw IRR values to the owner's money formatter without converting through `Number`. State and identity cells reuse existing badges/avatars. Reference cells allow ordinary internal/HTTP(S) links and render executable, credentialed or ambiguous URLs as plain text. Row actions reuse the existing menu, honor disabled actions and return focus after keyboard activation. Callers supply translated domain labels and already-authorized identity data.

Review moved keyboard handlers onto their interactive buttons and preserved strict optional props. Browser checks found a missing viewport declaration in the old component fixture and a real RTL overflow from the bulk checkbox's enlarged touch target. The fixture now uses a mobile viewport; the bulk control has enough padding and a visible bilingual label. Narrow cards and the wide RTL table were inspected. The bounds assertion remains intact, with failure diagnostics retained.

No dependency, database, migration, endpoint, CI configuration or supervisor-state change is needed. Generated queue/coverage files and historical loop state remain unchanged.

## Validation and evidence

- All 162 UI unit cases across 16 files pass in `ui-tests-full.log`, including nine new table/cell cases. The final directly affected 15 cases pass in `ui-tests-final.log`; repetitions are not added to the total. Coverage includes controlled/uncontrolled selection, key-bound details, ineligible rows, sorting, RTL arrows, shared card state, loading ownership, literal content, safe references, exact large money values and owner-formatted dates.
- All 65 distinct production-built component browser scenarios pass across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari: 26 in `browser-reviewed.json` and 39 in `browser-other-engines.json`. Twenty combinations are new. There are zero skipped, flaky or unexpected cases. Both languages, opposite numeral preference, keyboard menus, disabled actions, focus return, sticky scrolling, breakpoint state retention, escaped details, scoped Axe and mobile bounds are verified. Twelve final captures are retained externally.
- Root `pnpm build` passes seven tasks in `build-reviewed.log`, including all seven public ESM/CommonJS distribution checks. Strict public consumer fixtures validate the new exports, generic callbacks and invalid prop rejection in both module formats. Root `pnpm typecheck` passes eleven tasks in `types.log`. Root formatting, final lint, contract/suppression checks and all 84 unchanged route/interaction budgets pass.
- Initial lint/suppression attempts encountered disappearing temporary build/test-output paths during concurrent checks. Their logs are retained; the checks are rerun after those writers finish, without relaxing rules.
- Strict security passes all five fixtures and scans 1,629 files with zero findings/errors in `security.log` / `.json`. Final documentation formatting, `python3 kanban/scripts/build_backlog.py --check` and staged `git diff --check` are checked before publication and recorded externally.

The browser command is `pnpm --filter @barghsa/web exec playwright test e2e/data-table-component.spec.ts --workers=2 --reporter=line,json`, run in two non-overlapping project groups. Unit checks use `pnpm --filter @barghsa/ui test`, followed by `pnpm --filter @barghsa/ui exec vitest run src/data-table.test.tsx src/data-table-cells.test.tsx` after the review repair. No unchanged API suite is counted as current evidence.

Evidence and publication records are stored at `/Users/majid/.local/state/barghsa-manual-batches/shared-table-components/`. Checks are read from completed commands; CI completion is tracked separately.

## Remaining work and publication

The shared table/card/cell criteria are implemented. Existing domain lists still need selective adoption where these components improve the actual workflow. Page-specific server sorting/filtering, pagination and permissions remain owned by their current pages. This batch does not claim all admin/customer tables have been migrated.

Publication is a conventional commit directly to main, with local/origin/advertised/GitHub SHA agreement, clean checkout and exact-commit CI registration recorded externally. No PR is created. The preceding shared-chat commit is `aff43a8bf69d8394c613a8e34ab81f21f7af9b3e`; its [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/37214727364) completed successfully.
