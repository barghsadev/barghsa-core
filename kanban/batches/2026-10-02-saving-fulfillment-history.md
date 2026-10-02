# Saving fulfillment history — October 2, 2026

## Task coverage

- `03-core-business.md#T-03.10.01.02` — staff history displays recorded stage transitions, dates, explanations, handover details and consent-bound names instead of opaque actor identifiers. Existing reviewed stage controls remain intact.
- `03-core-business.md#T-03.10.01.03` and `03-core-business.md#T-03.10.01.04` — customer progress includes started/recorded dates and the same recorded history. Optional skipped handover has a neutral minus marker and explicit localized text. It is not presented as pending or performed work.
- `07-ui-ux-design.md#T-07.27.01.02`, `07-ui-ux-design.md#T-07.27.01.03` and `07-ui-ux-design.md#T-07.27.01.07` — shared StatusTimeline and ProgressStepper integration for saving fulfillment, with Persian/English states and identity fallbacks. Other domain history work remains partial.

## Build and review

A shared API projection reads at most 201 immutable fulfillment events for an already authorized saving order, returns the latest 200 in chronological order and explicitly reports truncation. Customer detail resolves this only after profile ownership/agent authorization; staff detail retains its existing permission boundary. The output excludes actor IDs, private login/directory fields and photos. Names require an active account and separate business-history consent, resolved in one batched query. Consent withdrawal removes a name from later reads. Recorded staff events keep a staff fallback; an identifier is never rendered as a name. No audit-log internals are projected.

Both views use one timeline with previous/new states, recorded dates, literal notes and handover details. Automatic approval/start explanations are localized; staff-entered explanations remain literal. The staff progress-note field explains its customer-visible audience. Existing completion/skip review hashes, payment/contract prerequisites, exact retries and terminal write guards remain unchanged.

The shared stepper gains a neutral skipped state. Completed events retain their checks, current stages their blue indicator, and pending stages their gray indicator. Cancelled/rejected/completed orders cannot highlight an active future stage. Missing legacy dates remain explicitly unrecorded. Existing rows are not backfilled and their dates are not inferred from commercial/financial state.

Customer detail is scoped to the requested order immediately, clears detail during reload/failure and rejects aborted responses. A failed read offers retry. Its outer container uses the shell-owned main landmark. Visual review caught a raw `in_progress` label in Persian; the explicit status mapping now uses the localized label, with regression assertions in unit/browser checks.

## Validation

- `pnpm build` and root `pnpm typecheck` pass. The final web production build/typecheck follows the visual-review fix.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/saving/saving-order.integration.test.ts src/user-settings/conversation-identity-http.integration.test.ts` — 28 cases pass. The complete real HTTP/PostgreSQL saving journey checks matching customer/staff history, skipped evidence, exact completion/retries, consent defaults/withdrawal, disabled identities, omitted private fields, cross-account denial, revoked staff permission, deterministic ordering and truncation beyond 200 events.
- `pnpm --filter @barghsa/web test src/components/SavingFulfillmentProgress.test.tsx src/pages/admin-saving-orders.test.tsx src/pages/saving-order.test.tsx src/components/AcceptedSavingAgreement.test.tsx src/components/SolarStageProgress.test.tsx` — 17 cases pass, including both languages, neutral skips, stopped/legacy evidence and literal names/notes.
- `pnpm --filter @barghsa/ui test src/workflow.test.tsx` — all 33 shared workflow cases pass.
- `pnpm --filter @barghsa/i18n test` — all 67 dictionary cases pass.
- Twelve distinct production browser cases have passing evidence in Chromium/mobile Safari. Eight new bilingual history/recovery scenarios and four existing complete saving journey/prerequisite scenarios cover customer/staff history, consent removal, cancelled stages, read failure/retry, denial, scoped Axe and mobile width bounds. The eight affected cases are repeated after the visual-review fix; overlapping runs are not counted twice.
- Root lint/format, contract/suppression checks and all 68 unchanged bundle budgets pass before publication. Strict Semgrep scans 1,451 files with zero findings/errors; all five fixtures pass. Backlog and diff checks are verified before publication.

## Publication and limits

Publish directly to main after validation and read back local/origin/GitHub SHA, clean worktree and exact-commit CI. The preceding solar CI run `36992059400` verifies successful Poppler installation; its full test result remains pending at the last readback. New CI remains pending at publication.

No migration, dependency, endpoint or new write flow is required. This history covers recorded fulfillment transitions; it does not invent rejected/cancelled events or replace existing price/address/hardware revision histories. Broader domain timelines and solar postal estimates remain open. Historical supervisor state, generated completion ledgers and CI settings are unchanged.
