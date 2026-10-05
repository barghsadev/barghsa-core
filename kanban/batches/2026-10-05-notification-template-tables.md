# Notification-template catalogue tables — October 5, 2026

Release: `v0.1.17`. Manual direct-main batch; no PR or supervisor-state changes.

## Canonical scope

- `02-auth-users-admin.md#T-09.04.01`: notification-template editor/list presentation, retaining the existing native authoring, variable insertion, publication, test-send and recovery engines.
- `05-notifications-documents-ai.md#T-05.04.03`: existing preview/version selector retained and checked, rather than building another version-history owner.
- `07-ui-ux-design.md#T-07.30.02.05`: domain adoption for the existing NotificationTemplatesPage.
- Domain adoption of `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`.

The existing backend entity/CRUD, shared table foundation and previously completed journeys are not recounted. Wider all-list/table adoption remains partial.

## Implementation and review

The notification-template catalogue reuses shared desktop tables and mobile cards. Eight native columns retain event/version, channel, language, status, full subject, active state, saved-version metadata and guarded actions. Sticky headers, record headers, published numerals, named keyboard scrolling and localized row counts use the existing shared table. Creation/publication dates preserve the account timezone and machine-readable instants; the creating staff identifier is isolated text. An archived badge uses the neutral state rather than the active color.

The editor, preview selector and captured protected action remain single page owners outside both presentations. Published versions stay read-only; a new version copies into the same native draft editor. Raw fields, confirmation password and current command survive breakpoint changes. Failed reads retain accepted records/work and block writes; denial retires private work. Existing filters, permissions, receipt validation, variable rules, step-up and uncertain-write recovery remain unchanged.

No API, migration, dependency, CI, budget or historical supervisor-state changes. Unchanged API suites are not rerun. The real-API notification test's record selector is adapted to visible tables/cards; that integration harness is not run in this presentation batch.

## Validation

- Root types: all 11 applicable tasks pass.
- Five focused source files: **73/73** tests pass. Dictionaries: **112/112** tests across 44 files pass; **185** source/dictionary cases total.
- **82 distinct** Chromium/mobile Safari cases have passing evidence, **41 per engine**, including **eight new** cases. Every accepted result has zero retries.
- Production build, focused lint/format, contract and suppressed-error checks pass. Strict SAST scans **1,795 files** with zero findings/errors and all five fixtures passing. All **85 unchanged** gzip budgets pass.
- Six production source/version/shared paths and **493 assets** remain identical to the browser snapshot. The six unaffected browser modules retain their full initial hashes. The two retained form-accessibility test bodies and all source outside the changed control-name case remain byte-identical to the affected run; exact reconstruction is checked in `browser-retained-test-proof.json`.
- Two complete original Persian synthetic-data captures, light and dark cards, are reviewed with coherent saved dates and no clipping or secrets.
- Canonical backlog validation and whitespace checks pass. The unmodified backend suites and real-API harness are not rerun.

The first run records 62 passes and 20 failures. Three older admin scenarios use customer authentication fixtures, while the original saved-template fixtures also lacked metadata required by the existing validator. Staff fixtures and complete saved records correct those fixture issues. The new broad accessibility check waits inside the unrelated email preview frame; scanning the relevant catalogue/editor region corrects its scope without disabling accessibility rules. Existing control assertions are adapted to linked validation and persistent failure feedback, keeping exact raw values and write counts. A known failed response permits deliberate retry; the existing unknown-write tests still enforce uncertainty recovery. Production permission, receipt and recovery rules are not relaxed.

The accepted ledger combines 62 unchanged passes from `browser-report.json`, eight read-only/test-send passes from `browser-affected-report.json`, four final control cases from `browser-controls-report.json`, and eight final new cases from `browser-new-final-report.json`. Earlier failing results/traces and their complete report bytes are preserved. The verified ledger is `browser-passing-cases.json`.

Clean committed-head preflight, remote SHA verification, independent enqueue and exact healthy deployment/Telegram outcomes remain separate publication receipts. Build completion does not claim deployment completion.

## Next confirmed gap

The canonical template-page criteria include an event-key filter. The current catalogue query and service options have no event-key filter, and the controller accepts only draft/active status despite the UI offering archived. Address that bounded read/filter gap next under `02-auth-users-admin.md#T-09.04.01`, `05-notifications-documents-ai.md#T-05.04.01` and `07-ui-ux-design.md#T-07.30.02.05`. Whole-task/global completion is not inferred from this presentation batch.

External evidence: `~/.local/state/barghsa-manual-batches/notification-template-tables/`.
