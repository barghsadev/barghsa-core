# Shared file previews across documents, tickets and upload review

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

Deliver `07-ui-ux-design.md#T-07.25.01.02`: reusable image thumbnails, bounded PDF first-page images and safe document-icon fallbacks in document records/details, initial ticket attachments, reply attachments, document uploads, new-ticket drafts and reply drafts. Inline permission-aware document mutation shortcuts remain open under `.04`. No supervisor completion/event ledger is changed.

## Delivered behavior

`FilePreview` displays authorized HTTP(S) image derivatives with escaped names and no referrer. It rejects executable URLs and embedded credentials. A failed derivative falls back to an accessible icon while retaining the original file action. Document list/detail placements reuse existing authorization and cache invalidation. Customer ticket rendering filters internal comments before any attachment markup or request.

Initial and reply ticket projections retain each file's original JSON-array index when unavailable metadata is omitted. Only immutable verified initial attachments receive download URLs and metadata. Customer/staff PNG endpoints check current ticket ownership, staff assignment/permissions, comment visibility, exact source association and immutable storage before accessing a cached derivative. Session and authority checks remain inside the existing locked transaction. Removed sources and revoked authority cannot use a cached preview. Derivative errors never return original PDF bytes.

Selected images stay in the browser and own revocable Blob URLs. Selected PDFs are processed only when Preview is opened, through authenticated, CSRF-protected `POST /api/upload/preview`. Processing uses the existing first-page renderer: 10 MB input, 640-pixel output, 10-second timeout, 5 MB output cap and 12 requests per user per minute. It creates no reservation, storage row or object. The account/session is verified before and after rendering. Output must have PNG content type and signature. Hide, removal, replacement and unmount abort pending work and revoke owned URLs; late responses cannot restore obsolete previews. Account denial clears private document/reply/new-ticket drafts. Unsupported, oversized and malformed previews retain a safe icon. File upload policy and confirmation checks remain independent.

This batch also repairs the preceding upload batch's CI failure in the signed-contract upload fixture. The fixture now supplies the required upload-policy response and retains all six signed-contract association assertions. No checks or assertions are disabled.

## Validation and review

- 253 distinct affected cases have passing evidence: 150 web cases and 103 API cases. Repeated attempts are excluded.
- Web: `pnpm --filter @barghsa/web test src/components/FilePreview.test.tsx src/lib/file-preview.test.ts src/components/DocumentUpload.test.tsx src/components/FileUpload.test.tsx src/components/DocumentRecords.test.tsx src/components/TicketCommentThread.test.tsx src/components/ContractsWorkspace.test.tsx` — 117 pass. `pnpm --filter @barghsa/web test src/components/DocumentsWorkspace.test.tsx src/components/document-list-recovery.test.tsx` — 30 pass. `pnpm --filter @barghsa/web test src/components/TicketReplyInput.test.tsx` — 3 pass.
- API: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/tickets/tickets-http.integration.test.ts` — 71 pass. `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/documents/document-http.integration.test.ts src/documents/document-preview.test.ts` — 32 pass. Real migrated HTTP fixtures process PDFs, verify PNG bytes, deny internal/cross-ticket/unbound/removed sources, recheck revoked permissions/session and prove transient processing stores nothing. The final ticket rerun verifies missing/removed initial sources produce no download URLs.
- Browser: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e e2e/document-upload-controls.spec.ts e2e/document-records.spec.ts e2e/documents.spec.ts e2e/document-list-recovery.spec.ts e2e/tickets.spec.ts --grep "previews|resumes|ticket queue|formatted reply|document-records.spec|documents.spec|document-list-recovery.spec" --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — 88 pass. Final `e2e/tickets.spec.ts --grep "previews verified"` repeats eight cases with the added new-ticket draft preview proof. Assertions cover actual 640-pixel first-page images, no upload reservation, keyboard controls, original-index paths, derivative failure recovery, internal privacy, scoped Axe and mobile containment. The fixture PNG is generated from the exact fixture PDF. Persian dark mobile output is visually inspected.
- Review covers source/index association, verified-only initial downloads, current authorization before cached reads, bounded PDF processing, account denial, safe URLs, abort/revocation and accessible filename labels. Root build/typecheck/lint/format, API contract, suppression checks, all 66 unchanged route/interaction budgets and canonical backlog/diff checks pass before publication. Strict security passes all five fixtures and scans 1,426 files with zero findings/errors. No schema changes, new dependencies or budget increases are required.

## Limits and publication

PDF rendering uses the existing deployment `pdftoppm` dependency. A selected PDF over 10 MB may remain valid for upload under its category policy while its preview is unavailable. Preview images are informational; they do not replace source download or server upload verification. Legacy ticket projections without verified metadata retain their existing safe file links and icon fallback.

Publication uses a conventional direct-main commit with local/origin/GitHub SHA, clean-tree readback and exact-commit CI registration. Preceding upload CI run `36974305445` failed one missing-policy contract fixture; its repair is included and passes locally. New remote CI remains pending at publication. Historical supervisor state, handoffs, completion ledgers and existing CI fast mode/coverage exemption remain unchanged.
