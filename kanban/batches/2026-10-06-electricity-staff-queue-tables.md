# Electricity staff queue tables, October 6, 2026

Release `v0.1.22`. Manual direct-main batch, no PR or supervisor-state changes.

## Canonical scope

Operational presentation for `03-core-business.md#T-03.07.02.04`, retaining the existing detail and decision engine under `#T-03.07.02.05`. Both review and conversation lanes use shared table/cell/mobile-card primitives from `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`. This records domain adoption, not completion of all global sorting/selection/expansion criteria. Generated queues and historical supervisor completion remain unchanged.

## Delivered and reviewed

The full-width review queue shows customer/public order reference, priority, age in hours, commercial and financial status, delivery period, exact quantity, total/paid amounts and submission date. Conversations substitute the latest-comment date for review-only priority and age. Existing API cursors, server order, authorization and DTOs are retained; no age or priority is invented for conversation records. Account timezone/calendar and the exclusive period-end adjustment reuse the existing detail formatter. Published numeral preference and exact string amounts are retained without floating-point conversion.

Desktop records have a named table, row/column headers and a named keyboard-scroll viewport. Mobile records have headings and labeled definitions. Escaped isolated text, explicit missing-value markers, status text/badges and 44-pixel Open order actions reuse established primitives. Selected actions announce their state and exact customer/order identity. One existing detail/form/decision owner remains outside both presentations, so viewport changes do not reset raw drafts, duplicate reads or captured confirmation commands.

The original linked-order empty-state suppression is retained: an empty queue cannot add a second misleading empty message while an independently linked detail is open. Retry, current permission denial, stale preview rejection, captured commands, uncertain-result locks and idempotent retry retain their existing behavior. Source mocks now include the established exact-number formatting helpers; one detail assertion is scoped away from mobile-card definition lists. The existing correction browser selector now targets the exact order identity after adding the Open order action label.

No API, migration, shared-component, dependency, permission, CI or budget change. Increase requests remain a separate batch.

## Validation

- **149** related source/dictionary cases pass: 37 across four staff/order/recovery/reason-form files and 112 dictionary cases.
- **32 distinct** related Chromium/mobile Safari cases pass, **16 per engine**, with zero retries: 16 new review/conversation cases, eight URL/cursor/selection cases, four queue retry/denial cases and four complete staff correction cases. These cover both languages/themes, exact amounts above JavaScript safe integer range, published numerals, escaping, scoped axe checks, responsive bounds, draft/password retention and one decision owner. Two final mobile capture cases pass after sizing captures to complete content.
- Production web build, workspace types with 11 successful tasks, root/focused lint, contract/suppression checks, strict SAST with 1,798 files and zero findings/errors, five scanner fixtures and all 85 unchanged budgets pass. The electricity-order route is 441.58 KB gzip against its unchanged 500 KB limit.
- Two full original Persian light/dark mobile captures are reviewed. Fixtures are synthetic. External source/assets binding covers the unchanged tested production build and 493 assets; passing case reports and final screenshots are recorded separately. Formatting, diff and canonical backlog checks pass before commit.

Initial failures remain preserved. The new test originally tried to refresh after a cancelled step-up had correctly left an uncertain-command lock, then tried to recover permission without a fresh mount. Recovery is now checked before command capture, with the original denial/lock semantics explicitly asserted. No product guard or test assertion is weakened.

An additional customer journey run, outside this staff-presentation scope, exposed old profile/address fixtures missing required fields. A temporary fixture repair reached order/payment success but then exposed a separate existing `/contracts?contractId=...` deep-link regression: the linked contract detail does not open automatically. The fixture experiment is saved externally and restored from this commit's scope. Those failed customer journey runs are not counted as passing evidence. Prioritize that defect in the next coherent batch.

Publication and exact deployment/Telegram results remain separate external receipts.

## Preceding release

`v0.1.21` completed at `2026-10-05T23:05:01.590678+00:00`, with healthy exact live commit `10b4172839e54b76a4023e6f33740dd73725bfde`. Persian Telegram note `64` and reviewed screenshots `65`, `66` are confirmed. Its report and external receipt record completion.

External evidence: `~/.local/state/barghsa-manual-batches/electricity-staff-queue-tables/`.

## Following repair

The separate customer contract-link defect is repaired in `v0.1.23`; see `2026-10-06-customer-contract-deep-links.md` for passing source/journey evidence. Its customer fixture repairs belong to that batch.

## Deployment confirmed

`v0.1.22` completed at `2026-10-05T23:28:21.385967+00:00`, with healthy exact live commit `824075a5279d02e6d15e80b944fe85a132ae28e3`. Persian Telegram note `67` and captures `68`, `69` are confirmed. External `deployment-completed.json` records the readback.
