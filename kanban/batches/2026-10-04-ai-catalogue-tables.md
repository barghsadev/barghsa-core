# AI model and agent catalogue tables — October 4, 2026

## Scope and task identity

This batch adopts shared desktop tables and mobile cards across AI models and agents together:

- `05-notifications-documents-ai.md#T-05.16.03`: model catalogue presentation, operational metadata and existing protected row actions.
- `05-notifications-documents-ai.md#T-05.19.03`: agent catalogue presentation, model identity, linked counts and existing protected editing/deletion.
- `07-ui-ux-design.md#T-07.24.01.01`, `07-ui-ux-design.md#T-07.24.01.02`, `07-ui-ux-design.md#T-07.24.01.03` and `07-ui-ux-design.md#T-07.24.01.04`: actual domain adoption of shared tables, text cells, mobile cards and accessible controls.

Existing CRUD, model testing, budgets, prompt editing, assignment, test chat and authority checks are retained. This is presentation/integration work; it does not claim new backend capabilities or completion of the wider AI module and all domain table adoption.

## Implementation and review

`AiModelRecordTable` preserves the five model columns and presents the same title, endpoint, provider, masked token, model name, enabled/reachability state, circuit recovery time, last test, latency and budget metadata in mobile cards. Model titles remain native row headers. Captions, named scroll regions, keyboard controls and sticky headers retain accessibility. Missing budgets retain their existing unavailable presentation. Amounts and counters use the published numeral preference; USD budget formatting now follows that preference independently of interface language. Mixed-direction amounts are isolated, and timestamps remain supplied by the owning account-timezone formatter.

Agents reuse `CatalogueRecordTable`. Titles and descriptions remain escaped, and model identity, status and direct link counts accompany the existing actions in both presentations. Missing counts remain unavailable. The owning pages still control API order, permissions, pending work and captured commands; local table sorting is disabled. Crossing the breakpoint preserves drafts. Failed or malformed reads retain accepted records with disabled actions, while permission denial withdraws private records from both presentations. The existing model validator continues to reject raw-token payloads; new browser checks verify that such a payload neither exposes the token nor discards a retained draft.

Shared `DataTable` gains optional native row headers and a named keyboard-scrollable viewport. Safari testing exposed the same horizontal-arrow issue already handled by `ScrollArea`. Both components now use that existing behavior through a small shared helper. Nested controls, modified shortcuts and native vertical scrolling are preserved. A new unit case covers row semantics, viewport focus and guarded key handling; public ESM/CommonJS consumers cover both options.

Review corrected unsupported styling/direction props on `TextCell` by using native wrappers. Legacy browser checks now use visible record headings/cards and the named table viewport instead of obsolete row/viewport markup. Recovery checks exercise desktop keyboard scrolling before returning to their mobile form flow. Save-verification, contrast, privacy and recovery assertions remain intact. English desktop and Persian dark mobile rendering were inspected.

No API, database, migration, dependency, endpoint, CI-setting or supervisor-state change. Generated queue/coverage files and historical loop state remain unchanged.

## Validation and evidence

- All 215 distinct related unit/dictionary cases pass: all 163 UI cases across 16 files, 50 affected web cases across six files and two bilingual dictionary cases. One UI case is new. The final web and full UI runs use the reviewed source; earlier affected subsets and repetitions are not added to the total.
- All 72 distinct affected production-built browser scenarios have passing evidence across Chromium and mobile Safari. Eight combinations are new and cover both catalogues, both languages/themes, opposite numerals, native row headers, keyboard scrolling, breakpoint drafts, masked/unsafe token payloads, metadata, protected actions, failed reads, denial, scoped Axe and bounds. The initial 56-case business-flow run has 48 passes and eight obsolete-selector failures; all eight are repaired and pass in the final 20-case run, alongside four repeated business cases and eight shared table/card scenarios. The final new eight-case run also passes after the Safari correction. Unique file/title/project identities are recorded in `browser-passing-cases.json`; no repeated, skipped, flaky or failed case is counted as distinct passing evidence. Forty final captures are retained.
- Root `pnpm build` passes seven tasks in `build-reviewed.log`, including all seven public distribution checks. Root `pnpm typecheck` passes eleven tasks in `types-final.log`. The unsupported cell-prop failure and an API typecheck collision are retained separately. Investigation traced the collision to browser global setup rebuilding shared packages during validation. Subsequent browser runs use the existing `BARGHSA_TEST_PREBUILT=1` contract after the verified build; serial typechecks pass without changing API source.
- Root lint, contract and suppression checks pass. All 84 unchanged route/interaction budgets pass, including agents at 410.75 KB and models at 389.75 KB against their existing 500 KB limits. Strict security passes five fixtures and scans 1,633 files with zero findings/errors. Final formatting, backlog validation and staged whitespace checks are verified before publication and recorded externally.

The new browser command is `pnpm --filter @barghsa/web exec playwright test e2e/ai-catalogue-tables.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json`. Existing model, agent, form, presentation and recovery suites provide the protected business-flow evidence. The final repair run targets only the changed legacy checks and shared responsive/sticky table cases. Browser commands reuse the current production build through `PLAYWRIGHT_BASE_URL`; remaining runs also reuse the verified API build. No unchanged API suite is counted as current evidence.

Logs, initial failures, result JSON, captures and publication readback are stored at `/Users/majid/.local/state/barghsa-manual-batches/ai-catalogue-tables/`.

## Remaining work and publication

Models and agents now use the shared responsive presentation. Other domain lists and unfinished kanban criteria remain separate work. Existing absence of optimistic agent versions and wider AI orchestration limitations remain unchanged.

Publication uses a conventional commit directly to main, with local/origin/advertised/GitHub SHA agreement and a clean checkout recorded externally. No PR is created. Exact new-commit CI is tracked separately from local validation. The preceding knowledge/policy commit is `1010ab796d1070c1c43034cee265a77734d7991b`; its [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/37216964155) completed successfully.
