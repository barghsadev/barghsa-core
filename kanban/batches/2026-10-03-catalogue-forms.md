# Catalogue product, price and capacity forms, October 3, 2026

## Scope and behavior

This related batch adopts shared forms across bilingual product creation/editing, categories, saving-plan hardware selection, initial prices, versioned prices and electricity capacity bounds. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`; these global tasks remain partial. Existing `02-auth-users-admin.md#T-09.12.01` catalogue business behavior is retained. Saving agreement and inventory editors are separate remaining form work.

React Hook Form and deferred Zod Mini validate after touch and on submission. Both dictionaries provide linked feedback and first-error focus after the submission lock clears. Titles, descriptions, category membership, unique available hardware, capacity relationships and scheduled wall times validate together. Persian/Arabic integer input remains exact above JavaScript's safe integer range and preserves the raw draft. New products remain inactive. Existing price history, account-zone conversion and DST-gap rejection remain.

Synchronous ownership blocks duplicate submissions before deferred validation yields. Editors and competing mutation controls lock during validation/confirmation. Failed or malformed detail/settings reads retain accepted work, block writes and retry independently. Unchanged accepted data preserves drafts; changed product/rules/configuration cancel stale confirmation and load the new basis. Withdrawn hardware remains visible and removable, and cancels affected confirmation. Changed timezone requires a new scheduled date while retaining the amount. Denial, changed selection, unmount and obsolete callbacks cannot restore private work.

Save responses must match the captured product identity, submitted values, exact price/capacity and hardware set. Saving-plan detail/write DTOs now include persisted hardware IDs, including no-op updates. Price acknowledgements use version history rather than the legacy current-price cache, verify requested scheduled instants and permit the existing same-open-price no-op. Mismatched responses retain confirmation and drafts. An unverified creation receipt blocks another submit and asks staff to cancel the editor and review the catalogue before creating again.

API schema errors expose only editable field identifiers, including nested bilingual fields, category/hardware arrays, capacity bounds and scheduled date/time. Unknown/protected or mixed errors remain general; submitted values and validator text are not returned. Current permission precedes field validation. Existing live permission checks, CSRF, step-up, serialized mutations, audit rollback, price windows and immutable electricity products remain.

The calendar trigger now owns its form bindings, linked feedback and focus. Scheduled-price and fresh-picker regressions use native Date constructors with a fixed `Date.now`: the browser test clock's replacement Date broke the timezone library's subclasses and falsely shifted days or accepted a DST gap. UTC/Istanbul browser checks with a New York account cover the existing shared picker's fresh selections; no shared picker implementation change is needed.

Review caught and repaired composite checkbox registration: directly registering a fieldset caused the first checkbox's default `on` value to replace selected IDs. Stable focus references preserve category/hardware arrays and let group errors receive focus. Existing successful-write browser fixtures now return actual-shaped matching DTOs; recovery assertions reflect retained drafts.

## Validation and review

- Catalogue controller/service/real HTTP: **77 distinct cases pass**, including 11 added owned-field/privacy/permission/persisted-receipt cases.
- Product/price drafts, recovery, group registration, safe feedback, receipt verification and shared action dialog: **47/47 pass**, including 26 added cases.
- Shared forms and date helpers: **75/75 pass**. Dictionary checks: **68/68 pass**.
- **267 distinct related unit/integration cases pass; 37 are new.**
- **100 distinct browser scenarios have passing evidence; 20 are new.** The final 52/52 catalogue-form and shared date-picker scenarios pass in Chromium/mobile Safari; the 48 unchanged category navigation, recovery and captured step-up scenarios passed earlier. Both languages, actual light/dark themes, RTL, linked focus, raw input, exact receipts, denied writes, delayed/unavailable validators, duplicate submission, changed/unchanged recovery, scheduled account time and DST gaps are exercised. Fresh selections also cover different browser/account zones and half-open ranges. Scoped Axe reports no violations; mobile containment passes and Persian dark mobile rendering is inspected at `/tmp/barghsa-catalogue-forms-fa-dark-mobile.png`. No timeout or production gate is weakened.
- Root lint and formatting pass. Strict SAST passes all five rule fixtures and scans **1,562 files with zero findings/errors**; four scanner report-handling tests pass. Backlog and staged diff checks precede publication.
- All **84 measured budgets** pass. Every one of the 37 previous budget definitions/limits is unchanged. The new interaction validator is **14.25 KB/20 KB**; the complete initial catalogue route is **427.54 KB/500 KB**, and the invoice route remains **494.02 KB/500 KB**.
- Root build (7 tasks), types (11 tasks), contract consistency and suppression checks pass. Backlog validation covers 1,355 tasks and 116 traceability entries. No dependencies, endpoint paths or migrations are added. Detailed validation logs are `/tmp/barghsa-catalogue-*.log`.

## Continuation

Related settings and the remaining saving agreement/inventory forms are next candidates. Global form parents remain partial. Generated queue/ledger, scheduler assignment/handoff, historical loop state and completion history are unchanged. The user's manual build/review/test/commit/direct-main workflow applies. Publication verifies local/remote SHA readbacks and a clean checkout; exact-head remote CI is tracked separately.
