# Customer and staff support queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for the customer and staff ticket queues.

The customer comment guard also implements the frontend visibility requirement in `07-ui-ux-design.md#T-07.23.01.06`: customer rendering excludes internal entries even if a response contains them. Existing server visibility enforcement is unchanged.

Other list adoption, legacy filter URL serialization and broader search/sort remain open, so the all-list parent stays partial. Relative timestamps, mobile expandable rows and richer reply/thread features in the separate ticket UI tasks are not marked complete by this batch.

## Behavior and review

Queue failures recover independently from ticket detail, creation options and staff assignment resources. Accepted rows stay visible during later loading and temporary failures. Pagination displays the last accepted page while retry requests the failed page with the same search, status, sort and active-profile scope. A changed filter cannot display rows accepted under the old criteria. Invalid page counts are rejected; when tickets are removed and the requested page disappears, the queue automatically loads the last valid page.

Queue retry preserves selected detail, conversation, reply/internal-note drafts, team/assignee choices and creation text/files. It does not reload detail or assignment resources, and it does not erase a failed write's error. Failed detail reads retry only that ticket and its conversation. Form-option and assignment retries reload only their own resources. Assignment controls wait for valid resources.

Permission denial clears retained queue/selected work, creation options and assignment data. It invalidates pending detail reads so late responses cannot restore denied work. Creation remains unavailable until a successful queue read restores authority. Detail denial leaves an independently authorized list available, with no detail retry action.

The existing profile-closure review stays mounted across queue recovery, preserving confirmation/password state; denial removes it. Its execution, step-up and server guards are unchanged. Existing upload-key reuse, ticket status transitions, broad-read/assigned-write restrictions and deep links remain intact.

Both locales use translated recovery and pagination labels. Tables have captions, column-header scope and named horizontal ScrollArea regions supporting keyboard scrolling. Persian mobile Safari rendering is inspected for both pages. Review covers resource separation, accepted/requested pages, criteria identity, stale response guards, draft preservation, authority changes, closure lifecycle and customer comment visibility.

No API, database, permission-model, dependency, scheduler or CI changes are included.

## Validation

Evidence logs: `/tmp/barghsa-support-queue-*.log`.

The full web regression passes 1,235 tests in 123 files before the final cached-options cleanup on permission denial. After that cleanup and the final shrinking-page fix, all fourteen focused cases pass: twelve support recovery cases and the two existing closure-review cases. These include closure mounting, racing denial, creation authority recovery, malformed responses, exact page retry, draft/file-input preservation, independent resource recovery and public-only customer rendering. The 53 dictionary tests pass.

Final root build/typecheck, targeted lint, all 64 route budgets and diff validation pass. Root lint, contract and suppressed-error checks also pass. Formatting and canonical backlog validation pass.

Eight new bilingual recovery scenarios and 28 existing ticket regressions pass across Chromium and mobile Safari, for 36 distinct browser scenarios. Existing tests cover attachment upload reuse after failed submission, related invoices, customer contacts, staff assignment/status transitions, internal notes, assigned-only editing, stale filters and profile-free deep links. The new scenarios cover local recovery, exact request parameters, retained drafts/files, shrinking pages, denial races, keyboard scrolling, accessibility and mobile overflow. After the final pagination fix, all twelve affected recovery, stale-filter and deep-link scenarios pass again.

The initial browser run passes 32 scenarios and fails four dark-color cases because their old branding fixture lacks required Persian title and support contact fields. The repaired fixture's final focused run passes all eight light/dark color scenarios. Failed and repeated cases are excluded from passing totals. Existing shell fixtures now initialize persisted locale and explicitly authenticate customer/staff.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/pages/support-queue-recovery.test.tsx src/components/ProfileClosureReview.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test support-queue-recovery.spec.ts tickets.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Final pagination verification: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test support-queue-recovery.spec.ts tickets.spec.ts --grep 'support queue recovers|stale lists cannot replace|ticket deep links' --project=chromium --project=mobile-safari --workers=2`
- Final fixture verification: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test tickets.spec.ts --grep 'readable (dark|light) colors' --project=chromium --project=mobile-safari --workers=2`
- Targeted `pnpm exec eslint`, `pnpm exec prettier --check` and web typecheck cover the final browser fixture and edited progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding customer browsing batch is published as `29fa57135b892e8a9c290bb30c440f774d935775`; CI run `36787096726` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This support queue batch is committed and pushed directly to main after review and related checks. Its remote commit and CI are verified after publication.
