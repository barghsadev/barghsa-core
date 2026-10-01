# Ticket reply formatting and verified attachments

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `07-ui-ux-design.md#T-07.23.01.04`: reply textarea, bold/italic/list/link toolbar, preview, file selection/drop, staff internal-note toggle and submission.
- `07-ui-ux-design.md#T-07.23.01.03`: attachment thumbnails and download links in the existing chronological conversation. Full public author names and avatar photos remain partial.
- `07-ui-ux-design.md#T-07.23.01.06`: verify internal reply/file exclusion across API and customer rendering.

## Delivered

The shared reply composer supports both customer and staff routes, Persian/English and RTL. Formatting inserts Markdown into the existing bounded textarea and uses the existing sanitized renderer for previews and new replies. Raw HTML and remote Markdown images remain escaped; dangerous links are removed. Historical and older-client replies keep their literal plain-text rendering. New comments snapshot customer/staff author context, so a staff reply on an owned ticket is not mislabeled as a customer reply.

Users can choose or drop up to five PDF, PNG or JPG files of at most 10 MB each, inspect filenames and remove individual files. Staff can add internal notes with the same composer. Replies may contain files without text. Uploads follow presign, write-once PUT, byte verification and record confirmation before submission. Their new purpose is bound to the actor, operating context, ticket and its stored profile. Current ownership or staff write/assignment permission and lifecycle are checked during upload and again under the comment transaction's ticket lock. The existing ticket-creation attachment purpose keeps its previous authority.

Comment insertion seals verified files to immutable storage and writes the reply, ticket update, audit and notifications in one transaction. Independent cleanup reservations survive rollback. The reply API reads only authorized comments before generating five-minute download URLs, and customers receive public comments only. The frontend also excludes internal/unknown comments before rendering text, images or links. PDF links and image thumbnails use verified storage metadata. Missing download availability is stated explicitly instead of appearing as an empty attachment list.

Failed submissions retain text, internal-note selection and files. Confirmed uploaded files are reused on retry. A stable submission UUID and digest prevent concurrent or lost-acknowledgement retries from adding another comment, sealed copy, audit or notification. Changed content under the same UUID returns conflict. Replay still checks current authority, even after reassignment; an authorized replay can acknowledge an already committed reply after ticket closure. Obsolete selection cancels submission after preparation.

Migration `0233_ticket_reply_evidence` adds format, attachments, author context and nullable retry identity/hash with database checks and a partial unique index. Existing rows default to plain text, unknown author context and no attachments. The new journal timestamp follows the previous migration; old journal entries and snapshots are preserved.

## Validation and review

- 216 distinct affected cases pass: 111 API/upload/storage, 51 web, 53 dictionaries and one real production-migration upgrade/rerun scenario. Failed/repeated runs are excluded.
- API: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/tickets/tickets.service.test.ts src/tickets/tickets-http.integration.test.ts src/upload/upload-access.test.ts src/upload/multipart-http.integration.test.ts src/storage/storage-access-http.integration.test.ts src/storage/storage-record-http.integration.test.ts`.
- Web: `pnpm --filter @barghsa/web test src/components/TicketCommentThread.test.tsx src/components/TicketQueueRecords.test.tsx src/pages/support-queue-recovery.test.tsx src/pages/support-list-query.test.tsx src/hooks/useListView.test.tsx --maxWorkers=2`. Dictionaries: `pnpm --filter @barghsa/i18n test`. Migration: `pnpm --filter @barghsa/db test src/ticket-reply-upgrade.migrated.test.ts`.
- All 76 distinct production browser scenarios pass in Chromium and mobile Safari: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e tickets.spec.ts support-queue-recovery.spec.ts support-list-query.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1`. They cover both languages, existing light/dark flows, previews/toolbar, files/drop/removal, invalid files/links, lost acknowledgements without another upload, private-file exclusion, URL/query/queue/detail recovery, permissions, assignment, status reasons, keyboard access, Axe and mobile bounds. Final ten focused reply/status scenarios pass after review. Persian reply cards/composers were visually inspected.
- Root build/typecheck/lint/format, generated OpenAPI contract, suppression checks, matching Drizzle snapshot, backlog validation and diff whitespace pass. All 66 unchanged route/interaction budgets pass. Strict security passes five fixtures and scans 1,409 files with zero findings/errors.
- Review verified plain-text compatibility, current actor/session/ticket/profile binding, public/internal read boundaries, transactional audit rollback and durable retry uniqueness. It added explicit unavailable-file feedback. Initial fixtures incorrectly expected HTTP 201 from the existing upload-record HTTP 200 endpoint; corrected. The old message selector also matched the new preview, so conversation assertions now use the message list. Test commands were narrowed after an extra separator unintentionally started broad suites; cancelled runs are not validation evidence.

## Publication and remaining work

Publish as a conventional commit directly to main using Git/GitHub CLI, then read back local/origin/GitHub commit SHA, clean tree and exact-commit CI registration. Remote CI remains pending at publication; the preceding detail commit's security, integrity and secret checks pass. Its completed CI run exposed the AI audit-ID redaction regression, repaired in the [following batch](2026-10-02-ai-audit-identifiers.md).

Full public support display names/avatar images, unavailable related-record destinations and other unfinished domain requirements remain open. Existing user-selected CI fast mode and coverage exemption are unchanged. Historical supervisor state, handoffs and completion ledgers are not edited.
