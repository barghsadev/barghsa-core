# Shared recorded status timelines — October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.27.01.02` — reusable StatusTimeline and recorded-event integration delivered for electricity customer/staff detail, contract customer/staff detail, invoice receipt review and consultation detail. State-colored dots, localized dates/labels, approved actor text and literal reasons/notes are supported. Personal actor names remain open where domain APIs provide only roles or opaque IDs; internal IDs are not displayed as names. This task is not marked globally complete.
- `07-ui-ux-design.md#T-07.27.01.03` — existing shared/saving fulfillment stepper refined: current stages use blue with reduced-motion-aware pulse, completed stages keep green checks, pending stages stay gray and connectors remain. The existing server-provided saving milestones retain dates/details. Solar construction integration remains open.
- `07-ui-ux-design.md#T-07.27.01.06` — open. The solar API has request/postal paperwork events rather than the specified six construction milestones. Delivery/installation and their dates cannot be inferred from request status; this needs explicit domain records and staff operations before the stepper can report them accurately.
- `07-ui-ux-design.md#T-07.27.01.07` — advances only for touched timeline labels and localized unknown-event/status fallbacks. Other domains remain open.

## Build and review

The existing Timeline export delegates to StatusTimeline, preserving callers without state/actor metadata. Logical-direction marker spacing keeps dots and their rings inside the component in both directions. Reasons render as literal React text, and actor names/roles use bidi isolation. Persian mobile contract and receipt histories were inspected.

Contract reads now include a version-bound recorded history. Authorized customers receive only events at/after that version's publication; staff can review its draft history. Publication, activation and completion come from immutable domain records. The other allowed events come from audit records, with only the necessary event/date/actor-role/reason projected. No directory names, usernames, IPs or other audit metadata are exposed. At most the latest 200 events are returned, with an explicit truncation notice. Selecting another version replaces its history; access denial clears private detail.

Review/testing caught publication-time ordering within a transaction. Reading the publication record fixes the missing event without revealing pre-publication audit work. Existing snapshot/rollback tests retain exact equality with explicit assertions for the new history fields. A contract-upload browser fixture was missing the required effective-policy response; it now supplies that response and waits for the enabled file control before selection, retaining the original association and retry assertions.

## Validation

- `pnpm --filter @barghsa/ui test src/workflow.test.tsx` — **33 passed**.
- `pnpm --filter @barghsa/web test src/components/ContractStatusTimeline.test.tsx src/components/ContractsWorkspace.test.tsx src/components/ContractCancellationRequestPanel.test.tsx src/components/contract-finance-list-recovery.test.tsx src/pages/InvoiceDetailsPage.test.tsx src/pages/electricity-order-details.test.tsx src/pages/admin-electricity-orders.test.tsx` — **109 passed**.
- `pnpm --filter @barghsa/i18n test src/contracts.test.ts` — **1 passed**.
- With `BARGHSA_TEST_PREBUILT=1`, `pnpm --filter @barghsa/api test src/contract/contract-review-http.integration.test.ts src/contract/contract-http.integration.test.ts` — **68 passed** against real HTTP/PostgreSQL. Covers publication/acceptance/activation/completion, draft privacy, version/access isolation, history limits, exact snapshots, retries and rollback.
- **211 distinct affected unit/HTTP cases** pass; repeated attempts are excluded.
- With `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`, `pnpm --filter @barghsa/web e2e e2e/status-timelines.spec.ts e2e/contracts.spec.ts e2e/contract-context.spec.ts e2e/consultation-journey.spec.ts e2e/electricity-journey.spec.ts e2e/electricity-simple-journey.spec.ts e2e/saving-journey.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **36 distinct scenarios passed on the final production build**. Includes 12 new timeline scenarios and 24 existing customer/staff journeys, both languages, version selection, denial, literal notes, scoped Axe, marker/ring bounds and mobile width. Earlier failed/repeated attempts are excluded.
- Root `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors` and `pnpm check:bundle` — **pass** before publication, with all **66 unchanged** budgets. Final web typecheck, backlog validation and whitespace checks also pass.
- Strict security scanner — all five fixtures pass; **1,431 files**, **0 findings**, **0 scanner errors**.

## Publication and limits

Publish directly to main after validation, then read back local/origin/GitHub SHA, clean worktree and exact-commit CI registration. The preceding status display batch passes all five CI jobs in run `36982131481`. New remote CI remains pending at publication.

No dependencies, new endpoints or schema changes are required. Historical supervisor state, scheduler, handoffs and existing CI settings remain unchanged. Actor identity data and solar construction milestones remain separate open domain work.
