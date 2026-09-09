# Continue here

Read [fix-plan.md](fix-plan.md) and the active batch in [progress.json](progress.json). Use feature batches, focused checks and valid earlier evidence. Detailed reviews live in [step-reviews.json](evidence/step-reviews.json).

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **1858caf**. Verification mode now uses a saved draft and explicit activation of the reviewed revision. Draft saves leave runtime policy unchanged. Activation requires fresh password confirmation; current role/session/CSRF and expiry are checked through commit. Both transitions preserve audit history. API mode remains unavailable because no provider exists. FA/EN settings show active mode, draft, global-impact warning and conflict reload. No migration or remote execution.

**90 distinct focused backend cases and18 production-browser cases pass**:19 new policy HTTP tests,71 existing admin cases,8 OTP browser compatibility cases,6 verification settings cases,2 ordering cases and2 new activation cases. API/web types, lint/format, build, OpenAPI and42 unchanged budgets pass. **2133 logs indexed.**25 previously current source bindings refreshed;24 retained/identified stale evidence records remain. The increase identifies older stale bindings, not24 new coding defects. Failed and interrupted logs are retained. An accidentally unfiltered API run was interrupted; its unrelated wallet-controller mock failures need V02 reconciliation and are not broad evidence.

Ticket batch remains consolidated atd776019:1 task verified/2 partial,1 PR closed/2 open. Preserve its74 API/service,14 browser,9 assignment,19 correction and3 migration cases. PR138 retains contract linking; PR139 retains unavailable order/contract record destinations. PR140 staff management and historical assignment deferrals are verified. [Review](evidence/step-reviews.json#R01-tickets).

Counts: **128 verified /29 partial /165 pending =322 claims**.194 unresolved task reviews are not an effort estimate. Saved PR reviews: **105 closed /20 open /176 unreviewed** of301.58 skips:3 verified/55 pending. GitHub inventory ends September3; no live refresh claimed. Full regression and coverage remainV02.

## Next action

Active **R01-verification-policy**, saved PRs141,142,146; `02-auth-users-admin.md#T-07.01.01` through `.03`. Exact requirements and all three saved PR bodies are already read. Mode implementation is verified at1858caf; do not rebuild it. Finish provider/no-provider disposition and verification notifications, then consolidate individual task/PR outcomes. No new acceptance closures at this intermediate checkpoint.

Preserve manual identity/correction and assignment repairs. Initial review found CRM verification notifications are atomic and localized but omit the required profile name and correction/resubmission guidance. Compare existing notification tests, inbox and dashboard behavior next. Actual email/SMS delivery remainsR02. Provider configuration stores plain JSON today, but no production adapter is registered. Real encrypted credentials, atomic provider configuration, async integration and retry require explicit prerequisite dispositions, not acceptance passes. Never simulate approval or ask again for a provider.

Graph snippets use indexed line ranges. After editing a file, reindex or read bounded current source before the next edit. Do not use stale ranges to generate patches.

## Preserve these boundaries

Prior authentication, profile/onboarding, contact/address, agents/invitations/ownership, CRM, wallet, receipt, online payment, chargeback and invoice repairs are consolidated. Wallet settlement/reversal atcb7ac5b and adjustment approval at8a9ea42 remain verified. Preserve them. PR225 auto-invoicing still has no actual submission caller; current DRAFT orders must not be charged. Refund/order/contract workflows retain their own prerequisites. Contract and ticket record-view dependencies have exact keys in `progress.json.open_domain_reviews`. Overpayment credit T-04.3.01.06 is already implemented.

R02 retains actual notification delivery, current queued-reminder policy, expiry/receipt notices and the missing auth.refresh_token_reused seed. PR243/245 and281/299/301 remain open. R03 retains shared contrast/localization and structured online-limit snapshots. Legacy invoice/reversal CHECK reconciliation and validation remainV01. No operational execution is claimed.

Pre-login CSRFf1b879b and shared race71f5e49 are complete. Browser payment-return GET is read-only; explicit confirmation uses session CSRF. Signed-webhook wording and lost-contact owner policy remain pending. Do not ask again or change those requirements.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No automatic identity provider; supported manual verification remains. Contacts:info@barghsa.com,021-26658042,09002550292. Ticket categories:General,Billing,Orders. Auth150KB covers initial load; estimator900KB separately. Numeric budgets and coverage floors remain unchanged.

Use rtk and codebase-memory. Keep output small. Save ended logs and inspect failures. Do not edit source/tests while their checks run or overlap shared/API builds with consumer checks. Build web before browser checks. Read every process exit before dependent edits or commits. Reuse valid evidence; do not rerun broad suites at each checkpoint.

Local edits and explicit commits only. No push, PR publication/merge, scheduler/state changes, deployment or PR304 action. Migrations0123/0124/0125 precede API rollout. Continue authorized work; the full plan is unfinished.
