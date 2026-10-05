# Notification-template event and status filters — October 5, 2026

Release: `v0.1.18`. Manual direct-main batch; no PR or supervisor-state changes.

## Canonical scope

- `02-auth-users-admin.md#T-09.04.01`: finish the bounded notification-template catalogue read/filter gap around the existing editor.
- `05-notifications-documents-ai.md#T-05.04.01`: existing entity/CRUD list filtering and all-version reads; reuse existing authoring, permission, publication and audit engines.
- `07-ui-ux-design.md#T-07.30.02.05`: exact event-key filter alongside the existing language, channel and status controls.

The existing editor, variables, preview/version selector, test-send and table/card foundation are retained. Whole-task and global all-list completion are not inferred from this bounded batch.

## Implementation and review

A shared bounded parser accepts exact event keys up to 100 characters, trims outer whitespace and rejects arrays, objects, embedded whitespace and oversized inputs. The permission-checked API binds event equality as a SQL parameter alongside independent language/channel/status criteria. Literal quote/wildcard characters remain literal, and PostgreSQL equality never becomes a partial search. Archived is now an accepted status. Omitting status includes all saved versions, matching the UI's All Status label. Only the notification-template GET contract changes; no migration or dependency is needed.

The native filter form offers known and saved event keys and applies through Enter or its explicit button. Unapplied filter text does not trigger reads or discard raw editor work, including across breakpoints. Applied criteria use the existing URL owner and restore on Back/Forward/reload. Clearing event retains independent catalogue and preview/failed-queue parameters. Invalid input has linked bilingual feedback and focus. Applying a different scope retires obsolete editor/confirmation work through the existing ownership engine. Failed or out-of-scope reads preserve accepted records; a saved template outside the applied event scope cannot leak into the catalogue if refresh fails. Current permission denial clears private work.

Review caught missing GET/response wiring before browser validation; it is connected and built before the accepted browser snapshot. Existing write receipts, permissions, variables, protected actions and uncertainty rules remain. The real-API browser flow creates/edits/publishes/archives an exact event, restores the archived read-only editor and verifies the minute delivery window against migrated PostgreSQL.

## Validation

- Root types: all **11** applicable tasks pass; API and web production builds pass.
- Four focused API files: **292/292** tests pass, including real migrated PostgreSQL/HTTP reads, malformed/duplicate query inputs, literal SQL wildcard characters and permission revocation.
- Six focused web source files: **87/87** tests pass. Dictionaries: **112/112** tests across 44 files pass; **491** API/source/dictionary cases total.
- **94 distinct** Chromium/mobile Safari cases have passing evidence, **47 per engine**, including **eight new** filter cases and **four real-API** cases. All accepted results have zero retries.
- Root lint and focused checks of the subsequently changed web/test files pass. Format, OpenAPI contract and suppressed-error checks pass. Strict SAST scans **1,796 files**, with zero findings/errors and all five rule fixtures passing. All **85 unchanged** gzip budgets pass.
- Five initial product/integration paths and **493 production assets** retain their browser snapshot hashes. Nine existing browser modules are unchanged. The new test changes only its Persian mobile screenshot branch after its passing eight-case run; exact reconstruction proves the other six cases unchanged, and the two affected cases pass again.
- Two complete original Persian synthetic-data captures, light and dark, are reviewed with coherent saved dates, visible filter controls and complete actions. A taller capture viewport prevents fixed application navigation from covering the catalogue.
- Canonical backlog validation and whitespace checks pass. No CI completion or deployment completion is inferred from these local checks.

The accepted browser ledger combines 86 unchanged passes from `browser-report.json`, six unchanged new cases from `browser-new-verified-report.json`, and two final capture cases from `browser-captures-report.json`. The eight-case filter run passes in 15.3 seconds. Earlier failures/traces and complete result bytes remain preserved. `browser-passing-cases.json` and `browser-capture-only-proof.json` bind the retained cases to immutable product assets and the only changed screenshot branch.

Earlier failed unit runs are preserved: filter fixture inputs omitted their asserted event/independent preview values, and one new receipt-recovery assertion used an incorrect translation literal. The corrected tests keep the intended ownership, raw-value, write-count and retained-record assertions. The first SAST command supplied a directory instead of a report filename; the accepted final invocation writes the requested JSON and passes. New browser history tests initially wait for a full document-load event after navigating back from a protected dialog, then expose an incorrect error-label key. Those test issues are corrected. WebKit email preview frames contribute joint session-history entries during editing; the protected-action case traverses back to its captured catalogue URL and asserts actual URL/filter/record/dialog state, retaining obsolete-write checks without extending timeouts or changing product navigation.

Clean committed-head preflight, remote SHA readback, independent enqueue and healthy exact-commit deployment/Telegram outcomes are separate publication receipts. Build completion does not claim deployment completion.

## Preceding releases

`v0.1.16` completed at `2026-10-05T20:44:32.882953+00:00`, with healthy exact live commit `c5f2778628e492189549da9ba29a1fd5f3838d57`. Persian Telegram note `48` and reviewed screenshots `49`, `50`, `51` were confirmed. Its external completion receipt and report retain that outcome. `v0.1.17` completed at `2026-10-05T20:52:44.305169+00:00`, with healthy live commit `114d397416731589af624cc6d057b1a93b4913a3`. Persian Telegram note `52` and both reviewed screenshots (`53`, `54`) were confirmed; its external receipt/report retain completion.

External evidence: `~/.local/state/barghsa-manual-batches/notification-template-filters/`.

## Deployment outcome

Exact release `v0.1.18` completed at `2026-10-05T21:08:44.193198+00:00`, with healthy live commit `2bf268a64327abfe87728cfa507d84e8b0b1456c`. Persian Telegram note `55` and both reviewed screenshots (`56`, `57`) are confirmed. The external `release-completed.json` binds this outcome to the published batch.
