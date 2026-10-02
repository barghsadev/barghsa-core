# Solar construction progress — October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.27.01.06` — shared six-stage solar tracker for customer request detail and staff construction operations, with recorded dates, customer-visible details and an accessible milestone history.
- `07-ui-ux-design.md#T-07.27.01.03` — solar integration of the existing green completed, blue current and gray pending stepper; vertical mobile layout and RTL connectors.
- `07-ui-ux-design.md#T-07.27.01.07` — Persian/English construction stages, staff actions, review, recovery and notification text. Other domain localization remains open.
- `07-ui-ux-design.md#T-07.18.03.05` — construction progress is integrated into the existing customer postal/request page. This does not claim estimated delivery dates or the entire postal page specification are complete.

The domain owner E-03 requires document approval and postal originals before final approval and contract preparation/signature. Its order takes precedence over E-07.27.01.06's conflicting illustrative label order. The tracker therefore shows Document review → Postal originals received → Contract signing → Work started → Equipment delivered → Installation recorded. The original five-stage contract preparation checklist remains available.

## Build and review

Migration `0238_solar_construction_progress` adds an event table for three physical milestones. It creates no historical events. Existing request, contract and document evidence remains intact. Database constraints enforce stage/revision pairing, unique stages/revisions/operation IDs, bounded trimmed notes and reviews. A guard requires the exact linked solar contract/profile, recorded current-version signature and activation, confirmed postal originals, eligible profile, and ordered revision. It sets the recording timestamp on the server. Updates/deletions cannot rewrite evidence; account anonymization may remove only the actor link. Populated upgrade tests verify checksums, preserved data, schema constraints, repeat migrations, ordering/concurrency, rollback, timestamps and immutability.

A dedicated staff queue at `/admin/solar-construction` provides fifty-row cursor pages, literal request/contract-number search, selected request URLs and read-only access. The API rechecks live `orders:read`/`orders:write` grants, account/session authority, actual staff context, CSRF and step-up. Profile/contract/request locks follow financial lifecycle ordering and return a recoverable conflict on contention. Reviewed snapshots bind the command, current revision, contract state and exact version. Concurrent updates cannot skip milestones. Reusing an operation with changed contents, actor or resource conflicts; an identical authorized retry creates no duplicate evidence, audit or notification.

Each new milestone, audit event and bilingual in-app customer notification commits in one transaction. A failed notification rolls everything back. Notifications link to the authorized customer request. No milestone activates/completes a contract or collects payment. An ended service term does not prove delivery or installation: an activated completed contract may receive genuine late evidence, but completion never creates physical events. Closed/cancelled requests keep their recorded history without an active future step.

The customer detail API authorizes the request before resolving progress or chosen staff names. Display identities require existing business-activity consent and an active account; later consent withdrawal removes the name from later reads. The response excludes internal actor IDs and private login/directory fields. Dates are recording times, not fabricated work dates; legacy paperwork without a date says no date was recorded. Both screens use account timezone/calendar preferences and literal, bidi-isolated names/notes.

Failed previews preserve the note. A failed save or required step-up preserves the exact confirmed command. Switching selection, reloading details or losing access discards obsolete review work; late responses cannot restore it. Accepted queue rows survive a page-load failure. The shared confirmation dialog now retains successful password verification across a failed save. Review also removes nested main landmarks from both affected detail screens and updates the existing solar invoice browser test for current table/card and mobile locale behavior.

## Validation

- Root build and TypeScript checks pass. ESLint, formatting, OpenAPI contract, suppressed-error, schema snapshot, backlog and diff checks are recorded before publication.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/solar/solar-progress.integration.test.ts src/solar/solar-request.integration.test.ts src/solar/solar-documents.integration.test.ts src/solar/solar-postal.integration.test.ts` — 19 cases pass, including 11 real HTTP/database construction scenarios and the existing intake/documents/postal/contract flows.
- `pnpm --filter @barghsa/db test src/solar-construction-progress-upgrade.migrated.test.ts src/receipt-activity-upgrade.migrated.test.ts` — both populated upgrades pass against the current journal.
- Nine affected web test files provide 48 distinct passing cases. Final targeted checks repeat the shared dialog, tracker, query normalization and existing document screen after review fixes; overlapping cases are not counted twice.
- `pnpm --filter @barghsa/i18n test` — all 67 dictionary cases pass.
- Fourteen distinct production browser cases have passing evidence across Chromium/mobile Safari and English/Persian: twelve new construction flows and both existing invoice handoffs. The four complete construction journeys are repeated on the final build after review changes. Scoped Axe, mobile width bounds, dark Persian rendering, literal notes/names, step-up, lost-response retries, readonly access, URL recovery and late-response denial are covered.
- All 68 existing/generated route and interaction gzip budgets pass without raising limits.
- Strict Semgrep 1.176.1 scans 1,447 files with zero findings/errors, and all five security fixtures pass. A generated test-only password replaces a literal credential in the dialog regression fixture.

The preceding main CI run `36987951653` failed six ticket PDF-preview cases because the Ubuntu test job lacked Poppler; the existing renderer availability check also skipped the PDF unit case. The test job now installs `poppler-utils` and verifies `pdftoppm` before building/testing. Assertions, security checks, and fast-mode settings remain unchanged. Prettier parses and validates the updated workflow. `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/tickets/tickets-http.integration.test.ts src/documents/document-preview.test.ts` passes all 75 cases locally, including the six failed preview scenarios and the renderer unit case, with zero skips. The installation itself requires the next Linux CI run for confirmation.

Validation evidence is local. Exact-commit GitHub CI is read back after direct-main publication; its result remains pending at publication.

## Limits and deployment

Apply migration 0238 before deploying the API. Physical events are staff attestations; notes are explicitly customer-visible and there is no backdated work-date editor or automated delivery/installation inference. Existing legacy activation/signature evidence is not reconstructed; an otherwise active legacy contract without those records is read-only here. External email/SMS delivery, estimates, schedule management and correcting a recorded milestone are outside this batch. Parent tasks covering other order histories remain partial. Historical supervisor state and generated completion/event ledgers are unchanged. CI only gains the missing PDF renderer dependency.
