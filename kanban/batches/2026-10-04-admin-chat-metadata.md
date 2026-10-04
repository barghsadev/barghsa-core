# Admin test-chat response metadata, October 4, 2026

## Kanban scope

This batch implements the response panel in `07-ui-ux-design.md#T-07.21.01.02` and advances its integration under `07-ui-ux-design.md#T-07.21.01.01` and `05-notifications-documents-ai.md#T-05.21.02`. It builds on the preceding shared customer/admin chat-form batch. Broader chat-message reuse, streaming and assistant tools remain separate.

## Behavior and review

`ResponseMetadataPanel` provides independently expandable knowledge-source, applied-policy, token-usage and latency sections. Sources retain KB name, document title and expandable excerpts. Policy rows include effective priority and named rule checks. Prompt/completion counts and their total use the published numeral preference, independently of language. Total means prompt plus completion tokens; absent usage and sums outside safe integer range remain unavailable. Empty source/policy collections have explicit bilingual messages.

The backend records stable rule identifiers and outcomes rather than raw authored topics, blocked terms, scope values or prompts. Input topic/action/filter/scope checks retain their existing behavior. Tone/language and output-format metadata follows actual priority selection; maximum length identifies the final strictest constraint; required sources identifies the selected enforcing policy. Rules superseded by another rule are shown explicitly. Output-filter success is added only after the original and redacted outputs pass enforcement. No inference, retrieval, policy-enforcement, rate-limit or audit behavior is changed.

Completed-turn responses persist the new metadata with the existing receipt. A real HTTP replay verifies the identical rule results without another provider call or quota use. Customer responses retain their separate public policy-category contract; staff rule details do not appear there. Existing stored replies lacking rule details remain usable and show “not recorded.” Invalid priorities, unknown rule/outcome values, duplicated checks and array-valued discriminants are rejected before displaying a new answer; captured retries remain governed by the preceding batch.

The renderer treats stored source and policy text as plain React text, including HTML-looking fixtures. Visual review inspected English light desktop and Persian dark mobile panels. Review set an explicit left-to-right direction for the combined numeric token pair so RTL cannot swap prompt/completion counts. Native disclosure controls remain keyboard accessible; mobile bounds, both language/theme combinations, Axe, permission withdrawal and the existing customer guide remain covered.

No dependency, migration, endpoint-path, provider contract or CI-setting change is needed. The optional metadata supports rolling API/frontend deployment and older replay receipts. Queue/traceability files, historical supervisor state, external loop state and scheduler remain unchanged.

## Validation and evidence

All 125 distinct related unit/API/dictionary cases pass, including nine new:

- Web: 98 cases across five files in `web-tests.log`. Six new cases cover recorded/legacy metadata, malformed checks/priorities, safe totals, precedence display and escaped stored markup. Existing chat forms, source metadata and agent configuration suites pass. The three new panel cases pass again after the RTL adjustment in `web-tests-rtl.log`.
- API: 25 real HTTP/database and policy cases across three files in `api-tests.log`, using `BARGHSA_TEST_PREBUILT=1`. Two new cases verify rule identity/value privacy and precedence/invalid-rule behavior. Existing HTTP coverage now verifies output-filter success, rate rules, group priority and exact replay metadata. Customer public-metadata/privacy, authorization, retrieval, provider failures and quotas remain covered.
- Dictionary: two bilingual cases pass in `i18n-tests.log`, including the new metadata/rule/outcome dictionary case.
- Production browsers: all 50 distinct Chromium/mobile Safari scenarios pass in `browser.log` / `.json`, with zero skipped, flaky or unexpected cases. Four new combinations cover legacy unknowns, null/overflow usage, keyboard disclosure and literal source text. Existing modern-response scenarios now verify priority, applied/superseded rules and totals with numeral preferences opposite to language. All 12 directly affected metadata scenarios pass again on the rebuilt RTL source in `browser-rtl.log` / `.json`. Eight metadata captures are retained externally and final narrow/wide views are inspected.
- Root build passes seven tasks in `build.log`; final changed web/auth builds pass in `web-build-rtl.log`. Root types pass 11 tasks in `types.log`. Root lint/format and affected final lint pass. Contract/suppression and all 84 unchanged route/interaction budgets pass; final budget evidence is `budgets-rtl.log`. Strict security passes all five fixtures and scans 1,625 files with zero findings/errors in `security-final.log` / `.json`. Backlog and staged diff are checked before publication.

Evidence and exact command records are retained at `/Users/majid/.local/state/barghsa-manual-batches/admin-chat-metadata/`. Passing results are read from completed commands; CI completion is tracked separately.

## Remaining work and publication

The dedicated metadata panel and its owning response contract are implemented. Broader agent-test-chat and customer-assistant parents still include shared message components, streaming and additional assistant/tool work. Global shared-form adoption remains partial. Publication is a conventional commit directly to main, with local/origin/advertised/GitHub SHA agreement, clean status and exact-commit CI registration recorded externally. No PR is created. The preceding chat-form commit is `2bf5bfd824c00761c4ae5b70c044f09457440ced`; its [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/37212174304) is tracked separately rather than inferred successful.
