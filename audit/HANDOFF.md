# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only the selected requirements and evidence. Use feature batches; preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **48ac9d7**. Latest consolidated batch **R01-wallet-ledger**:8 new task acceptances plus preserved balance card;14 PR reviews closed. Schema, credit/debit, reservation/release, version conflicts, nonnegative balances, reconciliation and dashboard balance are locally verified.

One repair: ledger sums beyond PostgreSQL int8 no longer abort the reconciliation scan. Three overflow cases now report alongside ordinary mismatches with exact deltas, no balance mutation and no duplicate exception.14 distinct scanner checks pass:5 full-production-migration integration cases and9 unit cases. Worker types/lint/format pass.1454 logs indexed; initial failures retained.

Core wallet/schema/tests are unchanged since7af0a76. Preserve their prior money/concurrency evidence; the historical648-case finance regression is not a new run or complete receipt/payment acceptance. Dashboard/card source and existing fa/en live-browser checks remain valid. Source comparison records the unrelated added default-selection tests and geoip/password-estimator dependencies. Four repeated wallet groups contain useful corrections; no duplicate current service needs removal. Details live once in [batch review](evidence/step-reviews.json#R01-wallet-ledger).

## Next feature batch

Selected **R01-bank-receipts-approval**:16 saved PRs **195,196,266,267,268,278,279,286,287,296,297,298,299,300,301,302**;10 mapped tasks. Exact keys and historical deferrals are in progress.json.active_batch.

Review receipt upload/attachment ownership, current actor authority and step-up through settlement, amount/threshold policy, independent approval, rejection, invoice overpayment credit and customer/staff UI. Compare repeated confirmation/overpayment PRs once. PR298 may incidentally cover T-04.3.01.06 notification; inspect before declaring it unbuilt. Provider callbacks/expiry remain a following batch. No new receipt defect confirmed yet.

## Counts and preserved work

**88 verified /20 partial /214 pending =322 claims.234 unresolved task reviews are not coding effort.** Saved PR reviews: **42 closed /8 open /251 not reviewed** of301. Mapping counts205 unresolved/92 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3.12 older evidence refreshes remain separately queued.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, account-settings, addresses/current commercial-order and CRM closures. Address PR115/116 remain open for savings/solar product dependencies in V01/B01. Current address/order batch1c06613 has110 distinct API,24 Chromium and2 production migration cases; no rerun needed for worker-only changes. Pre-login CSRFf1b879b and shared CSRF race71f5e49 are completed. Do not rebuild them.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB is separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before browser fixtures. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Broad V02, coverage and image evidence remain revision-bound. Keep work active while meaningful tasks remain.
