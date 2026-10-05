# Staff team and consultation tables, October 6, 2026

Release `v0.1.19`. Manual direct-main batch, no PR or supervisor-state changes.

## Canonical scope

- `02-auth-users-admin.md#T-09.08.02` and `07-ui-ux-design.md#T-07.30.02.16`: staff-team directory presentation around the existing membership and routing editors.
- `03-core-business.md#T-03.03.03.01`, `#T-03.03.03.02` and `#T-03.03.03.04`: consultation work queue/detail presentation and correct post-confirmation refresh, including staff assignment.
- Domain adoption of `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`.

Existing routing, response targets, financial decisions and table/card foundations are reused. Whole-task and global list completion are not inferred from this batch.

## Delivered and reviewed

Both catalogues use shared desktop tables and mobile cards, with native record/column headers, named keyboard viewports, row counts and published numeral preferences. Team records retain their names, descriptions, member counts and guarded edit/delete actions, and now expose saved lead names, skill tags and status. Missing saved values use the existing empty marker. Consultation records retain title, requesting profile, status, priority, account-zone submission day, assignment and selection, and show the exact request identifier. Buttons identify the product, buyer and request; mobile actions are at least 44px high. Consultation cards use level-two headings below the page heading.

One team editor/routing owner and one selected consultation detail/reason/financial owner remain outside both presentations. Drafts and captured deletion/password work survive breakpoint changes without duplicate reads. Existing stable dialog focus, permissions, exact receipts, field feedback and uncertain-write recovery remain. A real workflow regression shows successful generic review/assignment/reason actions attempting refresh while still holding the command lock. The matching acknowledgement now clears that action before refreshing, following the existing fee/resolution path. Changed or unverified acknowledgements still fail before ownership release. Staff-team failed reads retain records and raw editor work. Consultation toolbar refresh deliberately starts a fresh queue snapshot while preserving selected detail work; retry restores the queue, and denial clears private work. Existing filters, cursor semantics and server ordering are retained.

No API, migration, dependency, CI, budget or historical state change. Unchanged backend suites are not rerun; the real team API browser flow still creates, changes rules, edits and deletes a team.

## Validation

- All **261** related cases pass: 149 source/form/recovery cases across nine files and 112 dictionary cases across 44 files.
- All **84 distinct** related Chromium/mobile Safari cases pass, **42 per engine**, including 16 new table cases, four real-API team cases and both complete customer/staff consultation journeys, with zero retries. Seventy-four cases pass in the final combined run; the eight affected assignment cases and two journey cases pass in targeted final runs. The external verified ledger binds current product source, all 493 browser assets, eight unchanged browser modules and the two repaired modules.
- Web production build, workspace type checks (11 successful tasks), root/focused lint, contract/suppression checks, strict SAST (1,796 files; zero findings/errors; five scanner fixtures) and all 85 unchanged bundle budgets pass. Changed-file formatting and queue validation are checked before commit.
- Full original Persian staff-team dark and consultation light mobile screenshots are reviewed for readable metadata/actions, responsive bounds and synthetic fixture content.

Earlier failures remain preserved. The first source tests expose a missing buyer identity in the new selection action, corrected in the product label. Two legacy ownership tests then need their metadata assertions scoped to native records and their click directed at the record action. Browser fixtures are corrected to use actual admin request paths/envelopes, trigger the existing step-up challenge before expecting a password, select the reason by its accessible label and respect the existing fresh-snapshot refresh behavior. Accessibility testing catches a skipped consultation heading level, fixed in the product. An initial scanner warning on an unchanged API file is followed by a passing strict scan. The assignment test retains its asynchronous fresh-read requirement and now waits for exact target headings. The complete journey fixture supplies verified navigation metadata, a matching requesting profile and the complete fee-review receipt required by the existing exact-term guard. Assignment selection assertions target the action button instead of the new record container; all eight variants confirm a fresh post-assignment read and updated ownership. No accessibility rules, financial guards or recovery constraints are disabled.

Clean committed-head preflight, exact remote SHA, independent enqueue and healthy deployment/Telegram confirmation are separate publication receipts.

## Preceding release

`v0.1.18` completed at `2026-10-05T21:08:44.193198+00:00`, with healthy exact live commit `2bf268a64327abfe87728cfa507d84e8b0b1456c`. Persian Telegram note `55` and reviewed screenshots `56`, `57` are confirmed. Its report and external completion receipt record that outcome.

External evidence: `~/.local/state/barghsa-manual-batches/staff-operation-tables/`.
