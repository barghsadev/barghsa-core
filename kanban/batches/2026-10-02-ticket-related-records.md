# Ticket business-record associations and navigation

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `02-auth-users-admin.md#T-06.01.01`: complete optional association with an owned published contract, alongside existing order and invoice associations.
- `02-auth-users-admin.md#T-06.01.02` and `#T-06.01.03`: expose verified related destinations in authorized customer/staff ticket reads.
- `07-ui-ux-design.md#T-07.23.01.01` and `#T-07.23.01.02`: implement related-record navigation in queue tables/cards and conversation context.

This batch covers the association and navigation criteria. It does not certify every criterion in these parent tasks.

## Delivered behavior

The contract selector now includes published contracts on the selected owned active profile. Creation verifies publication, record type and profile inside the existing locked transaction. Internal drafts, foreign profiles, malformed identifiers and mismatched record types cannot create contract associations.

A single additional query resolves an authorized page of ticket references. Resolution rechecks current profile ownership and archival, verifies each record's profile, and returns a bounded destination type and actual detail ID. Saving detail IDs are resolved through the generic parent order ID, rather than incorrectly using that parent ID in the detail route. Electricity links require the contract and initial invoice associations used by the existing detail API. Unsubmitted drafts, unsupported legacy order types, missing records and lost profile ownership return an explicit unavailable destination.

Customer and staff views use existing contract, invoice, electricity and saving routes. Staff invoice links filter and open the matching ledger record. Contract and staff order destinations open the selected record even when it is outside the current queue page. The frontend checks source identity, destination/type compatibility and UUID syntax before building a fixed application route. Persian record IDs remain isolated with `bdi`. Old customer invoice responses retain their encoded link during mixed-version deployment; explicit unavailable metadata never falls back to a link. Destination APIs keep their existing independent permissions and profile authorization.

## Validation and review

- All 85 affected API cases pass: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/tickets/tickets-http.integration.test.ts src/tickets/tickets.service.test.ts`. Real migrated PostgreSQL covers publication/draft boundaries, profile/type rejection, ticket ownership/assignment scope, list/detail parity, profile transfer/archival, mixed-case source UUIDs, distinct saving IDs, valid electricity associations and unavailable legacy/draft orders.
- All 46 affected web cases pass: `pnpm --filter @barghsa/web test src/components/TicketQueueRecords.test.tsx src/components/TicketCommentThread.test.tsx src/lib/support-list-query.test.ts`. Table/card, both contexts/languages, source/type/UUID validation, unavailable metadata and legacy invoice compatibility are covered.
- All 84 distinct production browser scenarios have passing evidence across the broad run and final eight-case mobile remainder: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e tickets.spec.ts support-queue-recovery.spec.ts support-list-query.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1`, then `tickets.spec.ts --grep "formatted reply attachments|business links" --project=mobile-safari --workers=1 --max-failures=1` with the same environment. The first run stopped on one existing 30-second mobile reply timeout after 77 passes; the trace showed general browser slowness. After restoring the interrupted preview and Docker runtime, the final eight-case remainder passes. Failed attempts and repeated scenarios are excluded from the distinct total. The focused new navigation scenarios open all four real destination pages across customer/staff, Persian/English, Chromium/mobile Safari, with keyboard contract navigation. The contract-linked attachment creation scenario verifies the selected association survives failed submission alongside uploaded files.
- Review checks authorization boundaries, one-query page resolution, stable source versus destination identity, existing mutation refetch behavior and draft eligibility. The resolver preserves the exact text of mixed-case UUID source references while PostgreSQL resolves the destination to its canonical UUID, so the frontend identity check remains valid. No schema migration or dependency is needed.
- Root build/types/lint/format, generated contract, suppression checks, all 66 unchanged route/interaction budgets, backlog and diff whitespace pass before publication. Strict security passes five fixtures and scans 1,410 files with zero findings/errors. Admin tickets remain 389.65 KB gzip within the unchanged 500 KB budget.

## Remaining scope and publication

Publication uses a conventional direct-main commit with local/origin/GitHub SHA, clean worktree and exact-commit CI registration read back. New CI remains pending at publication. The preceding audit fix `c0b5054b185d8aadd7af8109cc91b46d5ec328d9` passes all five CI jobs in run `36929161743`. Historical supervisor state, handoffs and completion ledgers remain unchanged. Existing CI fast mode and coverage exemption remain unchanged.

Internal unpublished contracts and electricity drafts without readable detail associations intentionally stay unavailable. Unsupported solar/legacy generic order destinations remain open. Full public support author names/avatar photos and other unfinished domain criteria remain open.
