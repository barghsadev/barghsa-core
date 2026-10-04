# AI agent and slot presentation, October 4, 2026

## Kanban scope

This batch closes the remaining recorded presentation criteria of `05-notifications-documents-ai.md#T-05.19.03` and `05-notifications-documents-ai.md#T-05.20.02` together: linked counts, highlighted system-prompt editing and the slot assignment table with last-change timestamps. Existing create/edit, model and link selection, inference overrides, validation, assignment, audit and test-chat behavior is retained. The wider AI module and global shared-form parents remain partial.

## Behavior and review

Agent rows display direct knowledge-base and policy link counts using the current numeral preference. Missing metadata displays an unavailable marker; malformed negative, fractional or unsafe counts invalidate the read. Counts are presentation metadata and do not invalidate an unchanged editor. A real HTTP regression verifies list/detail counts after adding and clearing links, including separate group references.

The system-prompt textarea highlights Markdown headings, lists, links, code and emphasis using the installed parser. All tokens remain escaped text; source HTML and links stay inert. Exact source, including trailing lines, is preserved. Parser normalization or failure falls back to unchanged text. A decorative backdrop shares textarea typography, wrapping, scrollbar space and scroll position, while the native textarea retains labels, field errors, focus and keyboard editing. Native selections use readable foreground and muted background colors. Forced colors hide the decoration and show native readable text. Brand-aware contrast uses the existing color helper; a safe foreground fallback retains dotted source emphasis. No HTML renderer, rich-text conversion or new dependency is introduced.

The five assignments share a semantic table with row/column headers and a named keyboard-scrollable viewport. Each row retains its own dropdown, Save/Reset controls, disabled-agent and cross-slot warnings, draft and exact confirmation. Last-change timestamps come from the audited slot DTO and use the account timezone. Preference failures show a retry without claiming a default timezone; recovery and timezone changes preserve assignment drafts and do not reread agent or slot data. Existing settings routes remain the entry points.

Review inspects Persian dark mobile rendering and verifies visible decorative text contrast separately because it is correctly hidden from screen readers. Colors meet 4.5:1 against the configured background, including an accepted custom dark background. That check exposed low-contrast help and validation messages beside the prompt; help now uses the readable foreground, and shared catalogue field feedback uses the existing contrast helper while retaining native error associations and reserved space. The backdrop cannot obscure native forced-color text. No migration, endpoint path, production API behavior, CI setting or generated/historical supervisor state changes. The existing absence of optimistic agent versions remains unchanged.

## Validation and evidence

All 612 distinct related web/API/dictionary cases have passing evidence, including 14 new:

- Web: 556/556 across twelve files after the contrast correction; `web-reviewed.log`. This includes the original eight-file 489/489 run, prompt/metadata/brand cases and affected model, storage and verification forms that share catalogue feedback. The final root type check passes 11/11 tasks; `types-reviewed.log`.
- API: 54/54 real HTTP/database agent and slot cases; `api-related.log`, including the new exact link-count regression. Existing role/session rechecks, audit rollback, assigned-agent deletion protection, CRUD, group links and cross-slot behavior remain verified.
- Dictionaries: 2/2 bilingual cases with the new presentation keys; `i18n.log`.
- Production browsers: all 36 distinct cases pass. The final eight new language/theme/Chromium/WebKit combinations pass after the contrast and selection corrections; `browser-selection.log`. All 28 existing affected password, test-chat, full-set receipt, changed/unknown recovery and denial scenarios pass; `browser-related.log`. The final enhanced cases verify source-layer contrast/transparency, readable native selection, custom background fallback, font/wrapping/scroll alignment and forced colors. Scoped Axe, RTL, mobile bounds, field focus, literal submitted text, timezone retry and keyboard table scrolling are covered.
- Root build: seven tasks pass; the final affected web build also passes, `web-build-selection.log`. Root types: 11 tasks pass. Root lint and final affected lint pass, `lint-reviewed.log` and `lint-selection.log`. Contract/suppression checks pass. All 84 unchanged route/interaction budgets pass after the review correction, `bundle-selection.log`. Root formatting and final affected-file formatting pass. Strict security passes five rule fixtures and scans 1,610 files with zero findings/errors, `sast-reviewed.log`. Final staged diff is checked before publication.
- Backlog validates 1,355 tasks/116 traceability entries. No generated queue, ledger, historical state or external supervisor cache is edited.

Logs and new browser result JSON/captures are retained outside the checkout at `/Users/majid/.local/state/barghsa-manual-batches/ai-admin-presentation/`. Fresh verified builds are reused with `BARGHSA_TEST_PREBUILT=1`. A redundant narrowed TypeScript comparison in the description branch was corrected; its failed invocation is not claimed passing. The custom-background contrast failure is retained separately; final browser evidence verifies its correction. Unchanged passing regression evidence is reused across the final style correction.

## Publication and remaining work

The prior agent-form [CI run 37185745978](https://github.com/barghsadev/barghsa-core/actions/runs/37185745978) has successful integrity, security and Git-secret jobs; tests remain running at the latest readback. No unfinished CI result is inferred successful. Publish a conventional commit directly to main, read back local/origin/remote/GitHub SHA agreement, verify a clean checkout and exact-commit CI registration. No PR is created.

Knowledge-base/policy/group shared-form adoption, other remaining kanban work and the wider AI orchestration lifecycle remain open. This batch completes the presentation gaps recorded by the preceding form batch; it does not declare the full development goal complete.
