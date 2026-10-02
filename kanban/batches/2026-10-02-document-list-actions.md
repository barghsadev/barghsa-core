# Permission-aware inline document actions

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

Complete `07-ui-ux-design.md#T-07.25.01.04`: shared `DocumentList` with file icon/name, localized size and account upload date, status badges, lazy download and inline removal/replacement according to current permissions. It extends the existing table/card record component, retaining the `DocumentRecords` export for existing consumers. This completes the remaining document-component criterion; other kanban parent criteria remain open.

## Delivered behavior

Document list/detail reads now project download/write/remove/replace permission hints from the current actor, profile, business association and document lifecycle. Read-only staff keep readable files but receive no mutation controls. Archived profiles prohibit writes. Customer contract originals remain read-only, signed-copy replacement respects current version/state, saving documents respect uploader and submission state, and solar documents respect uploader, document stage and postal rules. Grant checks are reused within a page for the same association. Read-time hints neither grant commands nor require step-up; existing command paths still enforce current permissions, step-up, revision, idempotency, immutable evidence and atomic audit/history.

The shared list shows inline Replace and Remove only with explicit affirmative server hints and an operation handler. Replacement opens the existing validated upload flow directly from the accepted row, preserving profile, business/contract association and predecessor. A staff queue spanning profiles uses the selected document's profile. No preliminary detail request is needed. Detail controls also honor explicit denied hints.

Removal uses the existing confirmation dialog with the accepted filename, exact revision and stable idempotency key. Conflict retries and password step-up retain the same proposal. Layout switches preserve it; revised, revoked or disappearing rows invalidate it, and returning an older row cannot resurrect it. Successful removal closes matching detail/replacement work, refreshes the queue and aborts pending file access for the removed record. Late receipts cannot restore its link. Permission changes also invalidate cached file receipts.

Account denial from a file read or removal aborts the current queue read and file requests, clears private rows, links, detail and upload work, and shows the existing bilingual denied message. Late queue responses cannot restore old data. An explicit Refresh can recover currently authorized rows. No new dependencies, endpoints, schema changes or budget increases are required.

## Validation and review

- 97 distinct affected cases pass: 62 web and 35 API cases. Repeated attempts are excluded.
- `pnpm --filter @barghsa/web test src/components/DocumentRecords.test.tsx src/components/DocumentsWorkspace.test.tsx src/components/document-list-recovery.test.tsx` — 62 pass. Coverage includes both layouts/languages, explicit grants and denials, stable confirmation/retry proposals, revision/revocation invalidation, staff multi-profile replacement, pending list denial and obsolete download receipts.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/documents/document-http.integration.test.ts src/solar/solar-documents.integration.test.ts src/solar/solar-postal.integration.test.ts` — 35 pass. Final solar rerun — 6 pass with added permission-projection assertions. Real migrated HTTP fixtures verify read-only staff, role grant/revocation, expired step-up, archived profiles, customer contract delegation, lifecycle transitions, saving uploader/submission restrictions and solar review/postal restrictions. Existing upload, replacement lineage, audit/history, retention and mutation enforcement remain passing.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e e2e/document-records.spec.ts e2e/documents.spec.ts e2e/document-list-recovery.spec.ts e2e/record-list-query.spec.ts --grep "document|documents|template queue|destruction queue" --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — 72 production browser scenarios pass. New flows verify direct replacement, retained profile/predecessor, actual storage PUT and confirmation, inaccessible controls, keyboard removal, conflict and password retries with identical proposal bodies, selected-detail cleanup, account denial, scoped Axe and mobile containment. Existing metadata, upload drafts, review, destruction, template recovery and URL restoration remain covered. The prior file-denial fixture now asserts the stronger account-wide clearing behavior. Persian dark mobile output is visually inspected.
- Review covers current domain grants, command revalidation, stable source identity, explicit missing-permission behavior, stale proposal invalidation, aborts, late receipts, selection/upload cleanup and recovery. Root build/types/lint/format, contract/suppression, all 66 unchanged production budgets and canonical backlog/diff checks pass before publication. Strict security passes all five fixtures and scans 1,426 files with zero findings/errors.

## Limits and publication

Remove remains the domain's audited soft-removal command; retained evidence and destruction approval are unchanged. Permission hints describe the accepted read and may change before confirmation, so existing command checks remain authoritative. Legacy API records without mutation hints do not receive inline mutation shortcuts.

Publication uses a conventional direct-main commit with local/origin/GitHub SHA, clean-tree readback and exact-commit CI registration. Previous preview CI run `36976884198` has integrity/security/history success while tests remain running at the last readback; it is not reported as fully green. New remote CI remains pending at publication. Historical supervisor state, handoffs, completion ledgers and existing CI fast mode/coverage exemption remain unchanged.
