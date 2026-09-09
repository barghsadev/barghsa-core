# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then selected requirements and evidence. Use feature batches; preserve valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **09aa638**. Receipt/approval batch **R01-bank-receipts-approval** is consolidated: **9 tasks verified /1 partial;14 saved PR reviews closed /2 open**. Detailed repairs, source bindings, check revisions and failures live once in [the batch review](evidence/step-reviews.json#R01-bank-receipts-approval).

Twelve completed repairs include authority through commit, threshold serialization, both approvers' authority, sealed attachment copies, session/correlation audits, per-receipt emergency settlement, required threshold/staff controls and safe customer retries. Do not rebuild them. Latest customer repair b4356e0 retains file/profile upload identity after a lost acknowledgement, shares strict amount/MIME validation, clears native file selection and fixes submit contrast.49 web unit cases and8 distinct production Chromium cases pass, including fa/en retry/axe cases. Initial6 baseline failures and2 later contrast failures are preserved. Counts overlap across earlier repairs; do not add them.

PR299 and301 remain open for actual customer notification delivery in R02. Rejection state/reason/audit/enqueue are verified; enqueue alone is not delivery evidence. Emergency in-app alerts are immediate and verified separately. T-04.3.01.06 is **separate overpayment wallet credit**, already implemented incidentally byPR298 and reviewed. It is outside the322 historical claim register; retain it during B01 rather than rebuilding it.

Eight wallet/card bindings were refreshed after reading the complete WalletService diff from48ac9d7. Only optional transaction-client routing/type assertions in getWallet/createWallet changed; other bound sources and money mutations are unchanged. Preserve current/reused wallet and dashboard checks. No rerun or renewal of all648 historical finance cases is claimed.

## Next action

Active **R01-online-topups-callbacks**:9 saved PRs259,265,269,270,280,281,288,289,303; four qualified tasks T-04.2.02.01/.02/.06/.07. Exact membership and historical deferrals are in progress.json.active_batch. Read current initiation/callback/expiry owners and exact criteria. Review current customer/staff authority, versioned limits, provider signature/merchant/event/replay binding, atomic credit and expiry races. Disposition the browser payment-return GET against the recorded CSRF requirement. Compare repeated limit/expiry history only when needed for behavior or provenance.

First online batch repair **aeb2d1b** is complete: limit writes retain session/CSRF/step-up through commit, bind current session/correlation audit, and corrupt admin reads return503.70 distinct API checks plus types/lint/format/build pass. Seven true baseline failures and corrected older fixture expectations are saved in progress.json.active_batch.verification. Seven older config fixtures cover the authentication boundary; do not claim they establish post-guard authority for unrelated settings.

Freshly built OpenAPI exposed two missing receipt emergency request fields. **57d6582** adds only those semantic fields; current contract comparison passes. This supersedes the earlier receipt contract-pass claim, which did not establish a fresh build. Receipt threshold methods remain unchanged by the online-limit repair; their evidence is preserved.

**Initiation and expiry repairs complete:** fc7ee0b retains account/session/CSRF/current owner or Finance authority through intent/claim commits and checkout return. Wallet creation, intent and audit are atomic.94 distinct API checks pass, including24 receipt authority cases after shared lock extraction and2 real HTTP cases. Types/lint/format/build/fresh OpenAPI comparison pass.

09aa638 preserves the provider reference when TTL expiry races start/recovery, recovers an ambiguous claim first retried after expiry, prevents expired checkout/new provider starts, and rejects bank-receipt idempotency-key collisions.50 distinct current/reused API checks pass, including the real expiry worker and later exactly-once credit. Four failures reproduced before repair; fixture errors and overlapping runs are recorded in progress.json.active_batch.verification. Do not add counts across repairs.

**Next:** browser payment-return GET still mutates intent/event state and can credit without a session CSRF header. Move browser confirmation to an authenticated CSRF-protected POST while keeping GET safe and preserving server-verified payment reconciliation. Signed callback/replay/credit and expiry acceptance, repeated PR history and consolidated batch closure remain. No new task or PR closures are claimed yet.

Do not rebuild current limit/version UI, receipts/approvals or pre-login CSRF. Run focused checks for confirmed changes or missing evidence; one consolidated review per feature batch. Current receipt backend evidence remains valid; only unrelated online-limit methods changed afterward.

## Counts and preserved work

**97 verified /21 partial /204 pending =322 claims.225 unresolved reviews are not a coding-effort estimate.** Saved PR reviews: **56 closed /10 open /235 not reviewed** of301. Mapping counts190 unresolved/107 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. GitHub inventory still ends September3.12 older source-evidence refreshes remain separately queued.1620 logs indexed.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding, account-settings, addresses/current commercial-order, CRM and wallet closures. Address PR115/116 remain open for savings/solar prerequisites in V01/B01. Pre-login CSRFf1b879b and shared CSRF race71f5e49 are complete. No new budget, broad coverage, full-suite, image or deployment result is claimed.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency licenses waived. No identity provider exists; automatic verification remains unavailable and manual verification is supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB is separate. Lost-contact policy remains pending; do not ask again.

Migrations0123/0124 must precede API rollout; no deployment occurred. Use rtk and codebase-memory. Small output, focused checks, one consolidated batch review. Do not edit source/tests while their tests run. Do not overlap consumer typechecks with shared/API builds or browser setup. Build web before production-preview browser checks. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
