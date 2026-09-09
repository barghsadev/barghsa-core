# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid evidence reuse. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **6b9831c**. Invoice deadlines/reminders consolidated: **8 tasks verified /2 partial;8 PR reviews closed /2 open** from saved PRs236–241,243–246.

Seven repairs cover deadline authority/form, unsent reminder replanning, customer-visible reasons, reminder-setting authority/confirmation and missing default-period administration.69 DB and71 reminder worker cases pass. Due API21 and later customer/API29 overlap; toggle19 and default-period9 pass. Browser files each have4 distinct cases for staff override, customer reason and default settings, covering FA/EN and light/dark. New defaults affect new invoices while retaining issued deadlines and future periods. All42 budgets pass. Full counts and failed logs are preserved in the consolidated review.1911 logs indexed.

PR243/245 stay open for R02: actual versioned FA/EN delivery and current invoice/deadline/offset/channel/window policy after a reminder was planned or queued. The old new-plans-only toggle limit is unfinished acceptance. Already-sent schedule rows mean accepted by the outbox, not externally delivered. Old deadline overrides without dirty markers require operational reconciliation. Roll out the updated reminder worker before or with the API; no deployment occurred.

## Next action

Active **R01-invoice-corrections**: saved PRs247–250, tasks `04-invoices-wallet-contracts.md#T-04.1.05.01` through `.04`. Exact story/task criteria read. Read the four saved PR bodies, then review cancellation/replacement, post-payment adjustment amounts and credit, immutable lines, current staff authority through commit, snapshots and customer profile/agent isolation. Resolve the retained snapshot refresh for `cancel-and-replace-invoice.service.ts` and `create-adjustment-invoice.service.ts`. Preserve the reviewed customer reason display and invoice-state/creation evidence. Fix confirmed gaps and review before advancing.

## Counts and preserved work

**118 verified /27 partial /177 pending =322 claims.204 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **87 closed /18 open /196 not reviewed** of301.58 skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed.11 older evidence-refresh records remain.

Preserve completed auth/profile/settings/address/CRM, wallet, receipt, online, chargeback, invoice-state and creation batches. PR225 remains open for concrete auto-invoice submission consumers; current order creation saves DRAFTs and must not charge them. PR227 retains missing contract/consultation target tables/FKs in V01/B01. No repeated-PR deletion is needed. Incidental T-04.3.01.06 overpayment credit is already implemented/reviewed; retain for B01.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook exception already asked and pending; do not ask again or change the requirement. Lost-contact owner policy also remains pending; do not repeat the question.

R02 retains the seed check12 pass/1 failure: missing auth.refresh_token_reused template. Actual receipt/expiry delivery remains under PR281/299/301. R03 retains structured online limit snapshots and shared contrast/localization work. Do not repeat unchanged finance suites or claim external PSP/delivery/deployment proof.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors remain unchanged.

Use rtk and codebase-memory. Small outputs; parse JSON shapes before printing. Save full logs and inspect failures. Do not edit source/tests while their checks run. Do not overlap shared/API builds with consumer typechecks or browser setup. Build web before production-preview tests. Read process exit status before dependent edits or commits.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124 precede API rollout; no deployment occurred. Continue while meaningful authorized work remains.
