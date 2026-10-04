# Customer and staff order comment forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch adopts shared forms for customer and staff electricity/saving comments. It advances `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06`; these global parents remain partial. Existing append-only messaging supplies context `03-core-business.md#T-03.07.04.02`, `03-core-business.md#T-03.07.04.03`, `03-core-business.md#T-03.09.04.04`, `03-core-business.md#T-03.10.02.02` and `03-core-business.md#T-03.90.04`, without counting that previously built messaging again.

- Deferred touched validation covers trimmed 1–10,000-character bodies and explicit public/internal visibility for electricity staff. Linked bilingual help/errors and first-invalid focus retain raw drafts. Saving and customer commands do not gain a visibility field.
- Only all-owned input failures receive field metadata after the existing live write/resource/session authority. Protected, mixed, extra and root failures retain their generic 400 response; valid inputs retain the original transaction. Staff writes still require `contracts:write` and step-up. Customer ownership/legal-manager checks, submitted electricity source, lock order and final session recheck remain unchanged.
- Complete chronological pages validate identities, author fields, bodies, timestamps, visibility and visible cursors. Equal-millisecond rows retain server order because the database cursor uses greater timestamp precision. Customer electricity pages reject internal data. Denial or missing resources withdraw private thread, draft and command state.
- Synchronous preparation/command owners and actor/profile-context/order/kind/source generations fence delayed validation, reads and dialog callbacks. Full matching 200 receipts bind the captured actor, order, normalized body, visibility and persisted identity/time before clearing a draft. Unknown responses or foreign receipts preserve the exact body/key for explicit retry; GET and an identical older message cannot prove that POST committed.

## Review and corrections

Review added the confirmed profile-context revision to the editor scope, preserved opaque string actor IDs, rejected coerced array visibility values and repaired exact-cursor retry after a failed older-page read. A staff account can legitimately receive a staff author label in customer context; receipt matching preserves that actual API behavior while binding its exact actor and public visibility.

The original electricity page tests now provide authenticated context and actual complete rows with UUID resources and service-format timestamps. Their financial, navigation and history assertions remain. The empty send button is enabled so submission can show and focus invalid fields.

The initial bundle check measured admin invoices at 500.23 KB against its unchanged 500 KB budget. Moving the eleven new, unchanged bilingual strings to a dedicated `@barghsa/i18n/order-comments` subpath restores the global dictionary exactly to its published base. The final invoice route measures 499.91 KB/500 KB and all 84 budgets pass. Other copy and form/receipt behavior remain unchanged.

## Validation

**80 distinct related source/API/dictionary cases and eight distinct production browser cases have passing evidence**, excluding reruns.

- API: 19 controller boundary and eight same-authority preflight cases, plus three existing live HTTP flows. HTTP proof covers owned/protected failures, live grants and step-up, missing and foreign-owned resources, complete receipts, full exact replay and unchanged comments, keys, audit, notifications and core financial state. Existing public/internal exclusion, once-only notifications, append-only protection, paging and domain assertions remain.
- Frontend: 29 component, six helper and one dedicated-dictionary parity case. All 35 component/helper cases pass again after translation isolation. Fourteen original electricity customer/staff page cases pass; unrelated saving ordering tests and mocked comment widgets are excluded.
- The production matrix runs `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/order-comment-forms.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json`. Four customer cases initially pass; four staff cases reach the selection check but fail because the fixture misses the plain queue URL. The corrected staff-only queue matcher preserves every assertion. Selecting `--grep 'staff comment forms'` passes all four affected cases with zero skipped, flaky or failed outcomes. Customer proof remains valid on the unchanged production bundle and customer fixture branch.
- English light and Persian dark flows cover linked focus, the 10,001-character bound, lazy duplicate protection, literal script-looking text, older-page retry, privacy withdrawal, visibility, OTP, exact captured recovery, stale selection, scoped Axe with explicit hover/focus and mobile bounds. All sixteen compact electricity/saving customer/staff captures are preserved and individually inspected with no actionable issue. Visual approval binds both successful runs and the final production sources; initial screenshots and traces are preserved.
- Final build passes seven tasks and types pass eleven. Root lint, contracts, final suppression scan and all 84 unchanged budgets pass. Strict security passes five fixtures over 1,672 files with zero findings/errors. Formatting, canonical backlog and staged checks precede publication. Fourteen unchanged production inputs bind the final build.

External logs, initial failures, final source bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/order-comment-forms/`.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted command/receipt shape change is required. Deploy the API with or before the frontend for owned field feedback. Financial policy, messaging visibility, audit, notification and paging policy remain unchanged.

The preceding price-form commit has three successful CI gates while its test job remains pending in [run 37235719585](https://github.com/barghsadev/barghsa-core/actions/runs/37235719585); this batch's exact-commit CI is tracked separately. Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler and supervisor state remain unchanged. Saving customer hardware/address changes and staff paid-address form adoption are the next selected candidate; wider shared-form and customer/staff journey work remains open.
