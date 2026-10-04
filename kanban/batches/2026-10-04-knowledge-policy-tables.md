# Knowledge and policy tables — October 4, 2026

## Scope and task identity

This batch adopts the shared table foundation across four related catalogues together: knowledge bases, knowledge-base groups, policies and policy groups. The two owning pages share desktop tables and mobile cards while retaining their existing protected edit, delete, membership, document and query flows.

- `07-ui-ux-design.md#T-07.24.01.01`, `07-ui-ux-design.md#T-07.24.01.02`, `07-ui-ux-design.md#T-07.24.01.03` and `07-ui-ux-design.md#T-07.24.01.04`: actual domain adoption of the shared table, text cells, mobile cards and native accessible controls.
- `05-notifications-documents-ai.md#T-05.17.01` and `05-notifications-documents-ai.md#T-05.17.03`: knowledge and group catalogue UI slices.
- `05-notifications-documents-ai.md#T-05.17.04`: existing query context remains usable through the catalogue views.
- `05-notifications-documents-ai.md#T-05.18.01` and `05-notifications-documents-ai.md#T-05.18.02`: policy and group catalogue UI slices.

These are presentation and integration changes. This report does not mark the complete backend CRUD, processing pipeline, evaluation engine or all domain table adoption as finished.

## Implementation and review

`CatalogueRecordTable` presents titles, escaped descriptions, domain metadata and existing row actions in three named desktop columns. Mobile cards expose the same information and actions. Captions, column headings, native buttons, isolated text and the shared sticky header preserve table semantics and keyboard use. Hidden table/card markup is absent from the browser accessibility tree. The current-page count follows the published numeral preference, including a preference opposite to the interface language.

The owning pages still control returned ordering, category URLs, permissions, pending work and recovery. Local sorting is disabled so the presentation cannot independently reorder a server result. Crossing the breakpoint preserves an active edit draft. Failed reads retain accepted records with disabled actions; permission denial withdraws private records from both renderers. Missing counts/priorities remain unavailable rather than becoming zero. A policy without recorded type now explicitly labels unavailable metadata.

Integration found that the shared `DataTable` generic rejected ordinary domain interfaces without an index signature. Its constraint now accepts objects; the fallback accessor performs the narrow record cast. Public ESM and CommonJS consumer checks instantiate an interface-based table to cover this contract.

Review repaired a recovery unit selector that could become empty after the markup change and added an explicit nonempty assertion. Document browser assertions now target the named visible card list instead of matching both hidden and visible text. The older policy editor mock now persists created and updated records, returns those records on fresh reads, and waits for an enabled creation control. This preserves the product's save-verification guard; no assertion is skipped or production guard relaxed. Persian desktop/light, English desktop/light and Persian mobile/dark views were inspected.

No API, database, migration, dependency, endpoint, CI configuration or supervisor-state change. Generated queue/coverage files and historical loop state remain unchanged.

## Validation and evidence

- All 99 distinct related unit/dictionary cases pass: 82 web cases across six files, 15 shared table/cell cases and two dictionary cases. Three web cases are new. Coverage includes exact row callbacks, disabled actions in both renderers, withdrawn private rows, escaped content, drafts, membership, document operations and recovery.
- All 92 distinct affected production-built browser scenarios have passing evidence across Chromium and mobile Safari. Eight combinations are new. The initial regression run has 56 passes and 12 fixture failures; all 12 repaired cases pass in the final 20-case run, alongside the eight new cases. Sixteen category URL/history/privacy scenarios pass separately. `browser-passing-cases.json` records unique file/title/project identities, excluding repeated runs. Final runs have zero skipped, flaky or unexpected cases. Both languages/themes, desktop/mobile, opposite numerals, protected actions, password/CSRF recovery, scoped Axe and bounds are covered. Twenty-eight final captures are retained.
- Root `pnpm build` passes seven tasks, including all seven public distribution checks. Root `pnpm typecheck` passes eleven tasks on the final source. An initial concurrent attempt saw transient missing shared-package declarations; completed serial retries pass without changing API source. The unsuccessful log is retained.
- Root `pnpm lint`, `pnpm check:contract` and `pnpm check:suppressed-errors` pass. All 84 unchanged route/interaction budgets pass, including knowledge bases at 398.77 KB and policies at 395.14 KB against their existing 500 KB limits. Strict security passes five fixtures and scans 1,631 files with zero findings/errors.
- Root formatting, final backlog validation and staged whitespace checks are verified before publication, with outcomes retained externally.

The new browser command is `pnpm --filter @barghsa/web exec playwright test e2e/knowledge-policy-tables.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json`, using the current production build through `PLAYWRIGHT_BASE_URL`. Existing forms, membership, documents, recovery, knowledge-base and policy suites provide the business-flow regressions. The final review run repeats only affected fixture cases and the enhanced table checks; unchanged passing cases are not repeated or counted twice.

Evidence, reviewed failures, capture files and publication readback are stored at `/Users/majid/.local/state/barghsa-manual-batches/knowledge-policy-tables/`. No unchanged API suite is counted as current evidence.

## Remaining work and publication

The four catalogue presentations are implemented. Other domain lists still require selective table/card adoption, and wider AI processing/evaluation criteria remain separate work. Existing page-owned ordering, navigation, authorization and protected mutation contracts remain intact.

Publication uses a conventional commit directly to main, with local/origin/advertised/GitHub SHA agreement and a clean checkout recorded externally. No PR is created. Exact new-commit CI is tracked separately from local validation. The preceding shared-table commit is `2d2803504218de0325f307e73b682f330ea028d3`; its [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/37215809034) completed successfully.
