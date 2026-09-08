# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements/evidence. Preserve feature batches and valid completed work.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **ffd77e1**. Session/recovery product checkpoint remains1695680. Session/recovery is consolidated in `evidence/step-reviews.json#R01-session-recovery`: **4 verified task acceptances including preserved reset /3 partial;4 PR reviews closed /3 open**. Session creation/revocation and forgot/reset are locally verified. Open items have domain or policy assignments.

Completed repairs: b68f408 removes credential/exception/URL secrets from logs;f1b879b implements owner-requested pre-login CSRF on11 public-auth routes;1695680 gives recovery the shared six-digit OTP input.53 logging cases,217 distinct preauth API cases,98 preauth browser cases,11 helper units,40 migration checks and31 later affected recovery browser cases pass. These groups overlap; do not sum them. Applicable types/lint/build/OpenAPI/snapshot and42 payload gates pass.1240 logs remain indexed.35-method AST evidence preserves nonlogging behavior.

Migration0123 must precede API rollout. Its snapshot adds one table;94 existing tables remain unchanged. No rollout occurred. No broad V02, coverage, images or deployed-operation evidence is renewed.

## Next feature batch

Active **R01-profiles-onboarding**, saved PRs **#102–#110**, eight tasks. Exact membership, criteria, frozen PR106 deferral and reuse sources are in progress.json.active_batch. Review profile selection/default/switching, verification restrictions, individual/legal drafts, geography/identity/address boundaries, optional documents/autosave and completion. Compare PR108's later legal slice with PR106's UI deferral. Review once; repair only confirmed gaps and check each meaningful change.

Completed first repair atffd77e1: settings now provides the required saved profile selection.10 browser cases,web types/lint/build/format and42 unchanged budgets pass. Backend and sidebar source are unchanged.14 selected profile/onboarding files match9529872; current reuse comparison and remaining review are in progress.json.active_batch.checkpoint. Preserve this evidence and finish form/domain acceptance before consolidating the batch.

Session CSRF remains partial for payments/callbacks in R01, email delivery in R02 and actual CSP reporting in R03. Step-up retains required domain authorization/audit/UI checks; refund/contract/no-provider callers remain separate prerequisites. Lost-contact policy remains unanswered; do not ask again or invent approvers/evidence/retention. Credential-change execution and complete case audit remain required. Open records do not prevent independent batches continuing.

## Counts and preserved work

**69 verified /17 partial /236 pending =322 claims.253 unresolved reviews are not coding effort.** Explicit saved PR reviews: **17 closed /4 open /280 not reviewed** of301. Mapping counts230 unresolved/67 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. Saved GitHub inventory stops September3; no fresh query is claimed. Keep the12 older evidence-refresh entries and original source bindings.

Registration/OTP closes9 tasks/9 PRs atc706820. Agents/invitations/ownership closes4 PRs at1bf4680;PR134 and T-05.04.04 retain linked domain-role checks. Preserve completed staff/CRM and all other repairs. Keep R01–B01 order; new skipped builds follow repair closure.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency license allowlist waived. No identity provider exists; automatic verification unavailable, manual supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB budget covers initial load; estimator900KB measured separately. Pre-login CSRF explicitly requested and implemented. Do not ask these questions again.

Use rtk and codebase-memory; small output, targeted checks, valid evidence reuse. Build dependencies before web; browser fixtures serve existing web dist and rebuild API/shared in setup. Never overlap builds/setup with consumer typechecks. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
