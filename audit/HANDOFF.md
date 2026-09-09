# Continue here

Read [fix-plan.md](fix-plan.md) and [progress.json](progress.json), then only selected requirements and evidence. Keep feature batches and reuse valid checks.

## Current checkpoint

Workspace `/Users/majid/www/barghsa/barghsa-core`, branch `codex/audit-fixes`. Product/test HEAD **90f6415**. Latest consolidated batch **R01-account-settings**, saved PRs111–114: **2 tasks verified /2 partial;2 PR reviews closed /2 open**. Profile editing and contact changes close locally. Notification delivery consumers remain R02; complete timestamp-consumer coverage remains R03.

Six repairs: profile UI56498a1; account notification defaults e3981b9; shared CSRF race71f5e49; verified notification availability9526cc5; contact transaction/session authority39317d4; profile/timezone authority and audit90f6415. Pre-login CSRFf1b879b remains completed separately.

API evidence groups have120,74 and60 distinct cases within their recorded groups; they overlap, so do not sum them. Creation defaults retain34-case evidence. Browser evidence includes9 profile-settings,6 preference,6 unchanged contact and2 unchanged timezone cases. Types/lint/format/OpenAPI and42 unchanged budgets pass at relevant revisions. Final API-only changes preserve frontend evidence.1370 logs indexed. Initial failing reproductions and fixture corrections remain saved.

An AST comparison proves only named contact/profile/timezone members changed across five classes;83 other members remain unchanged. Current/reused evidence and limitations are consolidated once in [step review](evidence/step-reviews.json#R01-account-settings). No broad V02, coverage, image, deployment or fresh GitHub evidence is renewed.

## Next feature batch

Selected **R01-profile-addresses**, PRs **115–116** and qualified tasks **02-auth-users-admin.md#T-03.04.01** and **#T-03.04.02**. Review address CRUD under current profile, owner/agent permissions, one-main rule, delete/order-history restrictions, fa/en forms and confirmation. Then reconcile order selectors and immutable snapshots across required product flows. PR115 records an order-integration deferral; compare PR116/current implementation before disposition.

No new defect or edit is yet recorded for this batch. Preserve existing address/geography/profile/history and order-form evidence. Review implementation once, repair confirmed gaps with focused checks, and record one combined disposition. Future product/operational dependencies remain explicit.

## Counts and preserved work

**78 verified /20 partial /224 pending =322 claims.244 unresolved task reviews are not coding effort.** Explicit saved PR reviews: **27 closed /7 open /267 not reviewed** of301. Mapping counts220 unresolved/77 verified-only/4 unmapped.58 historical skips:3 verified/55 pending. Saved GitHub inventory ends September3.

Preserve registration/OTP, agents/invitations/ownership, session/recovery, profiles/onboarding and staff/CRM closures. Keep12 older evidence refreshes and original source bindings. Commercial-order verification, sensitive-domain roles, callback/telemetry and lost-contact recovery retain their recorded assignments. Do not ask the lost-contact policy question again.

## Decisions and execution

Retain Vite SPA/ADR004. Dependency license allowlist waived. No identity provider exists; manual verification supported. Contacts:info@barghsa.com,021-26658042,09002550292. Auth150KB covers initial load; estimator900KB separately. Pre-login CSRF explicitly requested and implemented on11 public-auth routes. Migration0123 must precede API rollout; no rollout occurred.

Use rtk and codebase-memory; small output, targeted checks, valid evidence reuse. Do not overlap builds/browser setup with consumer typechecks. Build web before browser fixtures. Local edits and explicit commits only. No push, PR publication/merge, scheduler/state change, deployment or PR304 action. Keep work active while meaningful tasks remain.
