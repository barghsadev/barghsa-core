# Invoice deadline and service due-period forms, October 3, 2026

## Scope and behavior

This related batch adopts shared forms for invoice lookup, staff deadline overrides and default service due periods. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`. These global migration tasks remain partial. Existing `04-invoices-wallet-contracts.md#T-04.1.03.01/.03` business behavior is retained.

React Hook Form and deferred Zod Mini validate after touch and on submit. Linked bilingual feedback focuses the first editable error after the submission lock clears. The invoice ID, customer-visible reason, changed deadline on/after issue and whole due days (1–365) are checked. Persian/Arabic digits, whitespace and companion values stay raw in drafts; captured requests normalize them. Unchanged original instants retain seconds and their DST-fold offset, while unchanged deadlines are rejected without a write. DST gaps remain invalid; timezone changes require an explicit reload before editing or confirmation.

Synchronous ownership blocks duplicate submission before deferred validation yields. Writes, confirmation and reads disable the relevant inputs. Read errors retain unchanged drafts and block writes until recovery; changed invoice/version/timezone bases replace them. Successful deadline acknowledgements compare business fields, excluding write-only audit IDs, so unchanged post-save reads cannot erase a later draft. Invoice/ledger selection changes, denial, unmount and obsolete callbacks cannot restore private work. Deadline receipts must match captured identity, date and reason; service receipts must match the selected service/days and a valid current version. Changed days cannot be confirmed with the old version ID. Conflicts require refresh on direct writes. Existing live permissions, CSRF, password verification, period version checks, transactions, reminder cancellation and attributed audits remain.

The APIs return only owned editable field identifiers using the existing public error envelope. Private version identifiers, unknown fields and mixed due-period errors remain generic. Legacy shared deadline parsing keeps its messages and adds typed public identifiers; API responses do not echo draft values or validator text.

The extracted deadline panel preserves the existing page position and loads as part of the initial route; its code is included in the existing invoice-route budget. Validation loads only when needed. A new 20 KB interaction budget measures its complete dependency graph; the measured validator is 14.18 KB. Small digit conversion imports keep the existing invoice validator at 15.01 KB. All 81 existing definitions/limits remain unchanged; all 82 measured budgets pass. The invoice route is 493.97 KB / 500 KB.

## Validation and review

- Real invoice/due-period API, service and controller checks: **40/40 cases pass**, including 10 added HTTP metadata/no-write/authorization cases.
- Related deadline, invoice, confirmation and refund web checks: **77/77 pass**, including 16 added deadline cases. The separate CI repair is rechecked at 18/18 after its final wait adjustment.
- Shared deadline/due-period/calculation contracts: **47/47 pass**, including 3 new public-field cases.
- Shared form controls: **47/47 pass**. Bilingual dictionary checks: **68/68 pass**.
- **279 distinct unit/integration cases have passing evidence**; 29 are new in this feature batch.
- **48/48 production browser scenarios pass** in Chromium and mobile Safari; 20 are new. Both languages and actual light/dark themes, RTL, touched/focused/owned feedback, unchanged-read recovery, denial, captured step-up retries, missing modules, unchanged timestamps, DST gaps, timezone reload and mobile bounds are exercised. Scoped Axe reports no violations. Persian dark mobile rendering is inspected at `/tmp/barghsa-deadline-forms-fa-dark-mobile.png`.
- The older finance timestamp fixtures now provide explicit current shell authority and locale. They reject unchanged deadlines consistently with the real API, supply matching successful override snapshots and retain the original timestamp/timezone assertions. Older deadline/due-period branding fixtures now supply valid complete configuration and explicitly assert the requested dark class.
- Root build (7 tasks), types (11 tasks), lint/format, OpenAPI consistency, suppression and strict SAST (five rule fixtures, 1,557 files, zero findings/errors) pass. Backlog and staged-diff checks run before publication. Detailed command logs are `/tmp/barghsa-deadline-*.log`.

Review covers source/selection ownership, locked/touched focus, raw draft retention, matching receipts, mixed-error privacy, unchanged business snapshots, timezone invalidation, version conflicts and the full manifest dependency graph. No dependencies, endpoint paths or database migrations are added. The separate [refund CI repair](2026-10-03-refund-deferred-review-ci.md) accompanies this feature in a single normal push. Remote CI is tracked separately from passing local evidence.

## Continuation

VAT rate, override and window forms are the next related batch. Other forms and the global parent tasks remain open. No generated kanban queue/ledger, historical loop state, scheduled supervisor assignment/handoff or completion history is changed. Follow the user's manual batch/review/test/commit/direct-main workflow.
