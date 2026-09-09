# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then selected requirements/evidence. Use feature batches and preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **a1d9959**. Online batch **R01-online-topups-callbacks** consolidated: **3 tasks verified /1 partial;7 saved PR reviews closed /2 open**. Exact repairs, revisions, failures and source bindings are recorded once in [the batch review](evidence/step-reviews.json#R01-online-topups-callbacks).

Six repairs are complete: limit writes retain session/CSRF/step-up through commit; initiation preserves current authority and atomic wallet/intent/audit; provider references and recovery survive TTL expiry; browser GET is read-only with explicit session/CSRF-protected confirmation; callbacks reject bank-receipt entries; recovered credits must be Completed and match wallet, amount, channel, original intent and provider authority. Do not rebuild them.

Latest credit repair a1d9959 reproduced five false-success cases.54 distinct callback/API cases pass after correcting two old credit-provenance fixtures.69 provider adapter and24 expiry worker checks pass. Browser repair aaf669b has54 distinct API,15 wallet unit and4 production Chromium cases plus42 unchanged route/interaction budgets. Counts overlap across repairs; do not add them. Types/lint/format/build/fresh OpenAPI checks are recorded with revisions. No live provider or deployment validation claimed.

PR265/task T-04.2.02.02 remains partial for an explicit requirements decision: signed machine webhooks have independent HMAC/time/event/merchant proof but the CSRF task currently forbids all exemptions. Asked once; awaiting owner. Do not repeat or change the requirement without the answer. Browser confirmation already requires current session CSRF. PR281 remains open for actual expiry customer failure notification delivery in R02.

## Next action

Active **R01-chargebacks-alerts**:4 saved PRs276,277,294,295; tasks `04-invoices-wallet-contracts.md#T-04.2.04.02` and `.03`. Exact requirements and all four PR descriptions are read. Trace current detection/locator precedence, immutable event payload replay, same-client compensating reversal, unmatched exception, immediate Finance push and dashboard permission. An immediate outbox row is not delivery proof. Original PR277/295 warning access was admin-only despite Finance recipients; check the current staff permission implementation. PR277's alert helper claimed its own transaction on the callback client; inspect current ownership before changing it.

Retain verified WalletService.reverseTransaction and PR275/285 from the wallet batch. Do not repeat the completed online, receipt or pre-login CSRF work. Review each confirmed repair with focused checks, then record one consolidated batch review. The signed-webhook policy answer can be applied when it arrives; other work continues.

## Counts and preserved work

**100 verified /22 partial /200 pending =322 historical claims.222 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **63 closed /12 open /226 not reviewed** of301.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3; no live refresh claimed.12 older source-evidence refreshes remain separately queued.1667 logs indexed.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, settings, addresses/current commercial-order, CRM, wallet and receipt closures. Receipt batch has9 verified/1 partial and14 closed/2 open PRs. Actual customer delivery keeps PR299/301 open in R02. T-04.3.01.06 separate overpayment wallet credit is already implemented and reviewed; retain it in B01. PR115/116 savings/solar prerequisites remain V01/B01. Pre-login CSRFf1b879b and shared CSRF race71f5e49 are complete.

Receipt lock extraction and optional payment-return panel were reviewed with focused checks. Existing receipt evidence is preserved. Older stale shared bindings were deliberately not renewed wholesale; keep the12-item refresh queue. Raw English over-limit API explanations still drive the current UI classifier; when R03 localizes them, use the existing structured limit snapshot to preserve classification.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB is separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not edit source/tests while their tests run. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before production-preview browser checks. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
