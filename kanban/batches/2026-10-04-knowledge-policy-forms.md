# Knowledge-base, policy and group forms, October 4, 2026

## Kanban scope

This batch advances the shared form parents `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` across four related editors together: knowledge bases, knowledge groups, policies and policy groups. Domain context is `05-notifications-documents-ai.md#T-05.17.01`, `05-notifications-documents-ai.md#T-05.17.03`, `05-notifications-documents-ai.md#T-05.18.01`, `05-notifications-documents-ai.md#T-05.18.02`, and `02-auth-users-admin.md#T-09.11.02` / `02-auth-users-admin.md#T-09.11.03`. Existing CRUD, retrieval, processing and evaluation are retained, not counted as newly built. The global form parents and wider domain journeys remain partial.

## Behavior and review

The four create/edit forms use the existing deferred shared validator, owned bilingual messages and first-error focus. Titles, descriptions, source addresses, chunking, embedding models and structured policy fields validate against the existing API limits. Numeric controls preserve blank and localized input until validation; Persian and Arabic digits normalize only when building a verified command. Decimal, scientific and out-of-range integer entries are rejected. URL sources accept up to 20 HTTPS addresses; API sources require one address. Inactive source errors clear when the source type changes. Policy rules keep their existing seven structured editors, with native checkbox state retained through type changes and errors.

Server validation uses the existing public-field exception helper for the four create/update endpoints after current-role permission checks. Only owned identifiers are returned; submitted content and validator messages are not exposed. Session, password step-up, fresh CSRF, service validation and transactional audit remain in place.

Failed reads preserve drafts and block unverified writes. Refreshed saved configuration preserves local entries and requires explicit reset. Deferred validation has synchronous duplicate protection and becomes obsolete after refresh, category change or permission loss. The captured command freezes inputs during confirmation and network work. Save receipts must have the expected status, a valid identity and every submitted setting, including nested source/rule content. Missing or mismatched receipts retain entries and require a successful catalogue read started after settlement plus explicit reset. Cancel cannot hide the editor during unresolved recovery. Permission denial clears private work. Document and member telemetry do not withdraw an otherwise valid configuration confirmation; existing secondary-command guards remain.

Review corrected the API-address whitespace check, cleared inactive source errors and prevented cancelling unresolved save recovery. Existing recovery assertions now expect retained entries and explicit reset. The older browser create fixture now returns a truthful 201 receipt containing the captured settings. A test type expression was rewritten equivalently for the pinned security parser; scanner strictness and exclusions were not changed.

## Validation and evidence

All 648 distinct related unit/API/dictionary cases have passing evidence, including 53 new:

- Web: 458/458 across six matched files; `web-final.log`. The final editor recovery and scanner-compatible fixture pass all 18 editor cases again; `web-scanner-review.log`. New helper cases cover integer/source/rule limits and exact receipt comparison. Existing permission boundaries, shared resource recovery and catalogue helpers pass.
- API controller/service and real HTTP/database: 188/188 across six files; `api-final.log`. Eight new POST/PUT cases verify owned fields, no submitted-content disclosure, no audit on invalid input and permission denial before field feedback.
- Dictionaries: 2/2 new bilingual cases; `dictionaries.log`.
- Production Chromium/mobile Safari: 40/40 distinct scenarios pass after the recovery fix; `browser-final.log` and `browser-final-results.json`. Eight new combinations cover all four editors in both languages/themes, localized numbers, cold validation, first-error/server-field focus, checkbox state, captured receipts, password/CSRF retries and uncertain recovery. Existing query/document-picker, member-priority and category/history isolation flows also pass. Scoped Axe, RTL and mobile bounds pass; Persian dark mobile feedback was visually inspected.
- Root build: seven tasks pass; root types: 11 tasks pass, with final affected types after the test-only parser rewrite. Root lint and final affected lint pass. Root formatting, contract and suppression checks pass. All 84 existing bundle budgets pass without changing limits. Strict security passes all five fixtures and scans 1,613 files with zero findings and zero scanner errors; `sast-verified.log` / `sast-verified.json`. Backlog validates 1,355 tasks/116 traceability entries. The staged diff is checked before publication.

Evidence and browser captures are retained outside the checkout at `/Users/majid/.local/state/barghsa-manual-batches/knowledge-policy-forms/`. HTTP tests reuse the freshly compiled application with `BARGHSA_TEST_PREBUILT=1`; browser tests use the production preview. Failed exploratory assertions, initial unknown-JSON type errors, asynchronous harness timing and the scanner parser failure are retained in earlier logs and are not counted as passes.

## Remaining work and publication

This batch delivers shared-form adoption for the four configuration editors. Group member assignment/priority, knowledge test queries and document attachment remain separate existing flows and are candidates for the next related batch. The processing/evaluation lifecycles and remaining presentation criteria are not marked complete. The API has no optimistic configuration-version contract: refreshed bases are compared, but concurrent changes between the last read and write remain an existing limitation.

No dependency, migration, endpoint path or CI-setting change is required. Deploy the API with or before the frontend to enable owned server feedback. The preceding presentation commit has successful integrity, static-security and Git-secret jobs in [CI run 37186859742](https://github.com/barghsadev/barghsa-core/actions/runs/37186859742); tests remain running at the last readback. An unfinished CI run is not counted as passing.

Publication uses a conventional commit directly to main, with local/origin/remote/GitHub SHA agreement and a clean checkout read back afterward. Exact-commit CI registration and publication evidence are recorded externally. No PR is created. Generated queue/traceability files, historical supervisor state, external loop state and the scheduler remain unchanged.
