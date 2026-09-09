# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only the selected requirements and evidence. Use feature batches and reuse valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **1c06613**. Latest consolidated batch **R01-profile-addresses** covers PR115–116 plus linked PR103 verification enforcement. **2 task records verified /1 partial;1 linked PR closed /2 open.** Address CRUD and current commercial verification pass locally. Electricity address selection/snapshots pass; savings/solar consumers remain incomplete.

Five repairs: current address-session authority47bdfc2; retained address history/migration0124 e8f9007; localized confirmation and displayed-profile binding9fc1da7; current order-session/commercial-policy enforcement c77aafb; draft/suspended order UI gate1c06613. Required pre-login CSRFf1b879b and shared CSRF race71f5e49 remain completed separately.

**110 distinct affected API cases**:59 address/profile/CRM and51 order. **24 distinct Chromium cases**:8 address and16 ordering, fa/en. Two production migration cases, applicable types/lint, production build, OpenAPI and42 unchanged budgets pass. Focused reruns overlap; do not sum them.1444 logs indexed. Initial reproductions and corrected fixture failures remain saved. Generated OpenAPI differed only in key ordering; the original artifact bytes were preserved.

Four verification service methods, VerificationBanner and its HTTP suite are unchanged sinceab09a87. Their comparison and prior evidence are reused. Current order enforcement has independent tests, including policy/profile lock waits, immutable snapshots, existing-record access and session-expiry rollback of order/audit/gift redemption. Details live once in [batch review](evidence/step-reviews.json#R01-profile-addresses). No broad V02, coverage, image, deployment or fresh GitHub evidence is renewed.

## Next feature batch

Selected **R01-wallet-ledger**:14 saved PRs **149,153,251,252,253,254,255,256,257,258,260,261,262,263**. Nine qualified tasks: `04-invoices-wallet-contracts.md#T-04.2.01.01` through`.08`, plus `02-auth-users-admin.md#T-08.01.02`.

Review schema, ledger credit/debit, reservations/releases, version conflicts, nonnegative balances, reconciliation and balance-card presentation. Compare repeated wallet PRs once; preserve corrective implementations and valid money/concurrency evidence. PR252/254 each have one saved deferral, copied into progress.json.active_batch. No new defect or edit is yet recorded for this batch. Provider callbacks, receipts and invoice settlement stay in following finance batches.

## Counts and preserved work

**80 verified /20 partial /222 pending =322 claims.242 unresolved task reviews are not coding effort.** Saved PR reviews: **28 closed /8 open /265 not reviewed** of301. Mapping counts218 unresolved/79 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3.

Keep registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, account-settings and CRM closures. Preserve12 older evidence refreshes and source bindings. Address PR115 remains open because its order-flow deferral is only partly satisfied; PR116 remains open for savings/solar product flows. Those requirements belong with their unmet product prerequisites in V01/B01. Do not rebuild whole future flows inside a repair batch.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB is initial load; estimator900KB separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Keep output small, save logs, run focused checks and one combined batch review. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before browser fixtures. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
