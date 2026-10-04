# AI agent and slot assignment forms, October 4, 2026

## Kanban scope

This batch advances the shared form parents `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` across agent configuration and all five slot assignments together. Domain context is `05-notifications-documents-ai.md#T-05.19.03` and `05-notifications-documents-ai.md#T-05.20.02`. Existing CRUD, runtime assignment, audit, test chat and slot-protected deletion are not counted as new functionality. Global form adoption and complete domain presentation remain partial.

## Behavior and review

Agent configuration uses deferred shared validation, bilingual owned feedback and stable linked errors for text, model selection, nullable inference overrides, enabled state and all four link sets. Temperature is 0–2; maximum tokens is a whole number from 1–8192. Blank overrides retain model defaults. Current selections must use available identifiers, unique link sets and at most 200 links per set. Ambiguous catalogue identities and malformed detail settings are rejected. Composite link groups receive focus without replacing their arrays. Unavailable choices remain visible and removable.

Each slot has an independent shared form and a distinct accessible Save name. Current disabled-agent and cross-slot warnings remain. Validation and confirmation have synchronous ownership; delayed validation is cancelled on refresh, duplicate proposals are prevented and unrelated slot drafts remain intact. Password/CSRF retries preserve captured commands. Safe server field identifiers map only to the owning editor; private server values are never rendered.

Failed reads preserve drafts. Refreshed saved configuration requires explicit reset, while link ordering and display-name changes preserve work. Agent writes require an exact scalar acknowledgement followed by a fresh detail read verifying all four full link sets: the mutation DTO alone does not include those sets. Slot acknowledgements retain the existing exact identity, enabled state and sharing checks. An unknown or mismatched result freezes writes until successful reads started after settlement and explicit reset. Local mutation receipts and failed/older reads cannot satisfy slot recovery. An uncertain deletion can recover when a fresh list proves absence, even if the removed agent detail returns 404. The editor cannot close in the middle of unresolved recovery. Denial clears private work and invalidates late completions.

API field errors use the existing safe exception contract after permission checks. Current-role authorization, step-up, CSRF, transactional audit and assignment/deletion rules remain intact. There is no optimistic agent-version API: refreshed bases are compared, but a concurrent update between the last read and write remains an existing limitation. No dependency, database migration, endpoint path or CI-setting change.

## Validation and evidence

All 736 distinct related unit/API/dictionary cases have passing evidence, including 39 new:

- Web: 619/619 cases across 12 matched files; `web-related.log`. This includes the final uncertain-deletion regression, shared resource consumers, independent retries, permission boundaries, prior model editors and confirmation handling. Thirteen new editor cases and 19 new helper cases pass.
- API controller/service and real HTTP/database: 115/115; `api-related.log`. Two new controller cases cover all owned identifiers; three new HTTP cases prove safe feedback and no mutation/audit on invalid input. Existing current-authority, expired-session, audit rollback, CRUD and cross-slot regressions remain passing.
- Dictionaries: 2/2 new bilingual cases; `i18n.log`.
- Production Chromium/WebKit: the new eight language/theme combinations pass; `browser-new.log`. The final affected run passes 28/28, including those eight plus existing slot/password, test-chat, captured group and independent recovery cases; `browser-final.log`. Scoped Axe, mobile bounds, RTL, field/group focus, fresh CSRF, exact full-set receipts, uncertain recovery and denial are covered. Persian dark mobile feedback was visually inspected.
- Root build: seven tasks pass; types: 11 tasks pass. Contract and suppression checks pass; all 84 unchanged route/interaction budgets pass. Lint passes. Strict security passes all five fixtures and scans 1,607 files with zero findings and zero scanner errors; `sast.log` and `sast.json`. Root formatting and the staged diff pass. Backlog validates 1,355 tasks/116 traceability entries. Final staged diff is checked before publication.

Logs, result JSON and browser captures are retained outside the checkout at `/Users/majid/.local/state/barghsa-manual-batches/ai-agent-slot-forms/`. Database/browser suites reuse the freshly verified build with `BARGHSA_TEST_PREBUILT=1`. Initial old assertions expecting automatic draft discard or retrying an unknown write were updated for explicit reset. A new harness initially mixed incompatible row projections and two HTTP assertions required explicit unknown-result types; these failed invocations are not claimed passing.

## Remaining work and publication

Agent and slot shared-form adoption is delivered. Global form parents and other staff editors remain partial. Agent linked-count presentation/prompt highlighting and slot last-change presentation are outside this form batch; their domain parents are not marked complete. Existing runtime behavior is not reimplemented.

The preceding model batch [CI run 37184605195](https://github.com/barghsadev/barghsa-core/actions/runs/37184605195) has successful integrity, static-security and Git-secret jobs; tests remain running at the last readback. No unfinished CI result is inferred successful. Publish a conventional commit directly to main, verify local/origin/remote/GitHub SHA agreement and a clean checkout, and read back CI registration for that exact commit. No PR is created. Generated queue/traceability files, historical supervisor state, external loop state and the scheduler remain unchanged.
