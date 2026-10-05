# Solar contract and initial invoice forms — October 5, 2026

This batch completes the staff solar contract editor's form, preview, issuance and retry interactions together. Staff can select a template version or an uploaded document, enter fixed or variable commercial terms, and review ordered initial invoice rows before issuing the linked draft and invoice. Bilingual touched feedback preserves raw conditional and row values; the complete financial summary and contract text disclosure remain available.

## Task coverage

The selected shared UI tasks `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06` remain **partial** across the wider product. This batch closes their solar contract editor adoption gaps. The existing atomic creation foundation `03-core-business.md#T-03.13.01.02`, lifecycle tasks `03-core-business.md#T-03.13.02.01` through `.03`, and financial review context `07-ui-ux-design.md#T-07.18.03.01` are preserved. Generated queue, coverage ledger and supervisor history are unchanged.

## Result

- The editor matches the complete current preview: request/profile/captured key, contract terms, source label/version, commercial value, ordered calculated rows, taxable VAT, IRR totals, due rule and outcome. Stated fixed commercial value remains independent of the initial invoice total. Existing zero, leading-zero row price, int8, UTF-8 content and rounding policies remain unchanged.
- Issuance captures the original body, review hash and idempotency key through password verification and rotated CSRF. The actual three-field receipt is validated before success. Uncertain or malformed responses expose an explicit retry and retain the original command; later rejection or dialog closure cannot erase that uncertainty. The response has no request/hash/review identity, so no such returned binding is claimed.
- Synchronous shared ownership blocks competing postal, final-decision, guidance, row and navigation actions. Independent drafts survive issuance. Actor/request/profile/source changes fence stale callbacks; current authority or complete missing-resource denial withdraws the selected private editor without allowing an obsolete response to erase fresh work.
- Both API parsers project only known editable flat field identifiers after current authority. Protected, root, extra and mixed input stays generic without echoing private values. An invalid discriminator cannot hide nested extra or opposite-branch keys. Row-price refinement checks accepted digits before `BigInt`, preventing malformed values from throwing.

The new invalid-input preflight uses the existing profile-first transaction/session wrappers and scoped eligible request. Preview retains its contracts/current-session authority; writes retain step-up and the existing invoice grant. Removing only the additive preflight and import exactly reconstructs the published service. Creation, idempotency, source eligibility, invoice calculation, due rules, audit, notifications and lifecycle engines are unchanged.

## Validation

| Check | Result |
| --- | --- |
| Related source/API/dictionary cases | **92 distinct pass**: frontend 61, API 30, connected atomic HTTP 1; reruns are not counted |
| Existing atomic HTTP proof | Original 1,367 lines preserved; creation, stored actor-key command/receipt, rejected-input effects and replay after actual publication pass; five unrelated cases intentionally unselected |
| Production browser matrix | **8/8 pass**, first run, zero retries/skips/flakes: template/fixed and document/variable VAT rows, English light and Persian dark, Chromium and mobile Safari |
| Browser assertions | Held native lazy validation, linked focus, raw drafts, complete preview/text, malformed receipt recovery, exact retry, step-up/CSRF, parent locks, privacy, scoped Axe and control bounds |
| Build / TypeScript | Root build 7/7 tasks; root typecheck 11/11 tasks |
| Lint / API contracts / suppressed errors | Pass |
| Strict security scan | Five rule fixtures; 1,707 files, zero findings or scanner errors |
| Bundle sizes | All 84 existing limits pass; no budget or configuration change |

Source review corrected hidden retry visibility, the physical pagination lock, complete missing-resource withdrawal and stale preview transport handling before the build. Initial component fixture failures came from unawaited React work, an incorrect button label and an incorrect conflict code; original business assertions remain. Browser fixture feedback uses the actual flat row field identifier. Original logs and whole browser results are preserved externally.

Independent visual inspection approves all sixteen original compact field and total/outcome captures. They do not represent full-dialog, physical keyboard or device coverage. Mobile Safari uses WebKit mobile emulation. Browser network proofs are mocked; durable financial and authority effects are verified separately by the connected HTTP case.

## Publication and continuation

Exact reviewed source and built asset hashes are recorded under `~/.local/state/barghsa-manual-batches/solar-contract-issue-forms`. Final visual, formatting, backlog and staged checks precede a conventional commit and normal direct push to `main`, with remote SHA and clean-checkout readback. Remote CI is tracked separately; no PR, migration, dependency, endpoint, financial policy, CI configuration or supervisor-state change is included. The next selected batch is contract review reason and signature-document selection forms, activated only after publication and fresh source reconciliation; completed cancellation, acceptance and activation engines are excluded.
