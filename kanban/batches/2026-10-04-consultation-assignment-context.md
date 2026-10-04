# Consultation assignment context and status history — October 4, 2026

Status: built, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Kanban scope

This batch finishes the missing assignment presentation in `03-core-business.md#T-03.03.03.01` and adopts the shared history presentation in `03-core-business.md#T-03.03.03.02`. It applies `07-ui-ux-design.md#T-07.27.01.01` and `07-ui-ux-design.md#T-07.27.01.02` to the staff consultation journey. The shared components already exist; their wider adoption remains broader than this batch.

- Queue cards and selected details show the staff owner and team. The API batches consent-approved activity names once per returned page and shares the detail lookup with existing history actors. It does not infer names from usernames, email or profiles. Hidden, disabled or unavailable names return null.
- Assigned requests without a shared name display a bilingual “Assigned staff” fallback. Team-only requests display “Awaiting staff owner”; genuinely unassigned requests remain distinct. Older API responses without the additive name field work safely. Internal owner IDs and unbound names are not rendered.
- Shared status badges give submitted work a blue tone, pending staff/customer work amber, accepted offers green and declined/rejected/cancelled states red. Completed and unknown states remain gray. Unknown states use a localized label.
- The shared timeline retains the recorded order, account-timezone dates, original ISO timestamps, consented actor names/roles and reasons. Unknown actor types have a localized fallback. Mixed-direction names are isolated and markup-like names/reasons remain literal text.
- Existing filters, cursor paging, selected-request URLs, protected reassignment, denial cleanup and financial confirmations remain intact. Reassignment is verified through a fresh saved-detail response.

## Review and validation

Independent API and frontend reviews found no material defects. Browser review strengthened the privacy assertions in the detail/timeline and explicitly required a new detail GET after successful reassignment. Initial source-test failures were date assertion mistakes: the timeline uses a textual account date, while queue dates retain their numeric format. Both were corrected without changing production behavior; initial logs are preserved.

**47 related unit/API/dictionary cases and 22 distinct production browser cases pass**, excluding reruns. An additional unchanged query-helper suite also has passing evidence.

- API: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/consultation/consultation-workflow.integration.test.ts src/consultation/consultation-assignment.integration.test.ts src/consultation/consultation-request.integration.test.ts src/consultation/consultation-payment.integration.test.ts src/consultation/consultation-state.test.ts` — 22 pass. Live HTTP/PostgreSQL coverage includes consent removal, disabled owners, owner-only details, team/unassigned contexts, 100+1 paging, authority, assignment, offers and payment.
- Web: `pnpm --filter @barghsa/web exec vitest run src/pages/admin-consultations-queue.test.tsx src/pages/staff-business-list-recovery.test.tsx src/pages/support-list-query.test.tsx` — 23 pass. Both locales cover all consultation states, fallback identities, timezone rollover and literal text alongside existing queue/recovery/financial regressions.
- Dictionary: `pnpm --filter @barghsa/i18n exec vitest run src/consultation.test.ts` — two pass.
- Production browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/consultation-assignment-context.spec.ts e2e/consultation-journey.spec.ts e2e/staff-business-list-recovery.spec.ts e2e/support-list-query.spec.ts --grep consultation --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` — 22 pass, zero skipped/flaky/unexpected cases. The final strengthened eight context cases are repeated separately. Coverage includes English/Persian, both themes, RTL, scoped Axe, mobile bounds, protected reassignment, denial privacy, URL recovery and the offer/payment/completion journey. English light and Persian dark captures are inspected.
- Root build — seven successful tasks; types — eleven successful tasks. Lint, contract and suppression checks pass. All 84 existing route/interaction budgets pass. Strict security passes five fixtures over 1,633 files with zero findings/errors. Final formatting, canonical backlog and staged diff checks precede publication.

External logs, retained initial outcomes, screenshots, source-bound validation and publication evidence: `/Users/majid/.local/state/barghsa-manual-batches/consultation-assignment-context/`.

## Deployment and remaining scope

No migration or new endpoint is required. Deploy the API with or before the frontend to show shared names; the frontend safely handles older responses. Name visibility continues to follow existing activity consent and account state.

This is consultation presentation coverage, not completion of the wider shared-component backlog. No dependency, CI setting, canonical generated queue/ledger, historical loop state, scheduler or supervisor-state changes are included.
