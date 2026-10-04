# Knowledge documents and catalogue presentation, October 4, 2026

## Kanban scope

This batch advances document search, selection, upload and attachment together, including verified removal and the remaining knowledge/policy catalogue metadata gaps. Shared form parents are `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`. Domain context is `05-notifications-documents-ai.md#T-05.17.01`, `05-notifications-documents-ai.md#T-05.17.02`, `05-notifications-documents-ai.md#T-05.18.02`, `02-auth-users-admin.md#T-09.11.02` and `02-auth-users-admin.md#T-09.11.03`. Existing storage, processing and membership services are retained. Wider domain and global form parents remain partial.

## Behavior and review

Search, file selection and upload use the shared deferred validation, owned bilingual feedback, first-error focus and submission indicators. Search retains its existing 200-character limit. Selection requires a currently available document that is not attached. Empty and unsupported files are rejected before storage reservation. Native file registration preserves the selected bytes through validation and failed requests. A verified uploaded key is reused after confirmation cancellation or attachment feedback, without sending the bytes again.

Available-file reads validate names, opaque storage-record keys and uniqueness. Existing legacy keys remain compatible with the API's 500-character contract. Failed or malformed reads preserve search and selection, block selection writes and retry independently. Upload remains available independently of document-list reads. Known URL/API sources disable upload and attachment with bilingual help. Current permission denial clears private work; same-origin upload authorization failures use that boundary, while a signed-storage failure remains an upload error.

Attachment requires the API's existing HTTP 200 response, a matching knowledge-base/storage-key receipt with a document UUID, and a fresh detail read proving the same unique document ID and key. Detachment requires HTTP 204 and a fresh detail proving that both removed ID and key are absent. Mismatched receipts, duplicate identities and failed verification cannot publish success. Unverified writes preserve the affected draft and require a successful read started after settlement plus explicit reset. Recovery resets only that command's owner. Existing password step-up, fresh CSRF, permission checks and audited transactions remain.

Catalogue counts reject negative, fractional and unsafe values. Policy priorities and group counts follow the published numeral preference independently of language. Missing metadata displays an unavailable value instead of a fabricated zero, priority or state. Existing policy-type badges are retained. Attachment validation exposes only its owned public field after permission checks; submitted values and validator messages are not returned.

Review repaired native file retention, made document recovery visible outside the group pane and used the current available-file read immediately. Browser fixtures now use the API's actual 200 attachment contract and UUIDs. The document-selection recovery fixture uses a document source rather than a URL source. There is no new dependency, migration, endpoint path or CI-setting change. Deploy the API with or before the frontend for owned attachment feedback. Optimistic version control for concurrent catalogue changes remains an existing limitation.

## Validation and evidence

All 574 distinct related unit/API/dictionary cases have passing evidence, including 28 new:

- Web: 464 cases across seven files pass in `web-reviewed.log`; the final 32 affected document cases pass after native-file and receipt review in `web-final-affected.log`. Twenty-five new cases cover owned feedback/focus, malformed reads, independent retry, unavailable/deferred validation, duplicate guards, receipt identity, verification, explicit recovery, supported files, uploaded-key reuse and permission denial. Existing configuration, membership, query and permission-boundary suites pass.
- API: 108 controller, service and real HTTP/database cases pass in `api-final.log`, including three new cases for safe owned attachment fields, permission checks before feedback and no invalid-input audit. HTTP tests reuse the compiled application with `BARGHSA_TEST_PREBUILT=1`.
- Dictionaries: both extended bilingual cases pass in `dictionaries-final.log`.
- Production browsers: all 60 distinct affected Chromium/mobile Safari scenarios have passing evidence, including eight new language/theme combinations. `browser-production.log` and its preserved JSON contain 36 passing cases; `browser-final.log` and its JSON contain 24 passing cases; the corrected recovery fixture passes all four cases in `browser-recovery-verified.log`. Their union is 60 unique cases with no unresolved scenario. The eight new document cases pass on the final build. Both languages/themes, RTL, Axe, mobile bounds, native file retention, owned focus, password/CSRF retries, independent recovery and numeral preferences are covered. Persian dark mobile feedback was visually inspected; eight captures are retained.
- Root build: seven tasks pass in `build-verified.log`. Types: 11 tasks pass in `types-final-code.log`. Root and affected lint pass in `lint-verified.log` / `lint-reviewed.log`. Contract and suppression checks pass. All 84 existing bundle budgets pass without limit changes. Strict security passes all five rule fixtures and scans 1,619 files with zero findings/errors in `security-verified.log` / `.json`. Root formatting passes; backlog validates 1,355 tasks/116 entries. The staged diff is checked before publication.

Earlier failed, timed-out and interrupted commands remain preserved and are not claimed passing. These include the repaired native-file bug, outdated/undeclared browser fixture assumptions, a terminated preview, and a security run with scanner timeouts on unchanged files under load. The unchanged strict scanner passes once competing work is settled; rules and error gates are not weakened. Passed unaffected cases are reused instead of repeating the entire browser selection after fixture-only repairs.

Evidence is retained outside the checkout at `/Users/majid/.local/state/barghsa-manual-batches/knowledge-documents-presentation/`. Browser tests use the local production preview. Generated queue/traceability files, historical supervisor state, external loop state and the scheduler remain unchanged.

## Remaining work and publication

Document form adoption and catalogue presentation are addressed by this batch. Broader processing/evaluation and shared customer/admin form work remain partial and require subsequent batches. Publication uses a conventional commit directly to main, followed by local/origin/remote/GitHub SHA agreement, a clean checkout and exact-commit CI registration recorded externally. No PR is created.

The preceding membership commit passes all five jobs in [CI run 37189076748](https://github.com/barghsadev/barghsa-core/actions/runs/37189076748). New exact-commit CI is read back separately and is not inferred successful before completion.
