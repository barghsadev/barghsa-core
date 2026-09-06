# Repair plan

Baseline `2f80d92df51556d47f778b5230e5eea577e2a8d4`, reviewed 2026-09-05. This is a plan only. No implementation, queue, loop state, PR, or scheduler changes were made.

Fixes are grouped for planning. Split large groups into reviewable PRs tied to the qualified original task keys; F17 especially is not one implementation task. F02 and F22 are cross-cutting acceptance gates, not claims that every associated task has a separately proven defect.

## Execution order

1. F01: reconcile task records and prevent another wrong dispatch. Keep the feature loop paused through repair.
2. F02-F06: production schema, sessions/CSRF, staff permissions, registration/OTP and verification.
3. F07-F13, F18 and F23: profile/agent correctness, notifications, payment rules, dual approval and deployable/draining workers.
4. F14-F17 and F20: finance regression closure, CRM/tickets/admin missing slices, localized and accessible UI.
5. F19/F21/F22: enforce acceptance gates, consolidate proven duplicates, and sign off every recorded task. Establish relevant tests alongside each earlier repair.
6. Reclassify historical skips and queue gaps. Build only the unmet remainder, in dependency order. Some skipped infrastructure is prerequisite repair work, especially migrations, CI and production worker wiring; do that when its dependent repair needs it.

## Exit rule before resuming feature work

Every P0/P1 finding is closed with evidence or explicitly dispositioned; all 263 PR-backed tasks and 59 legacy claims have truthful statuses; clean install, upgrade and real database/browser tests pass; no required transport silently skips delivery; all privileged/financial paths have real HTTP negative tests; remote state survives restart and cannot silently lose completed keys. Operational claims need actual execution evidence. Unknowns remain blocked/partial rather than being marked done.

## F01 Make task identity and completion durable

Priority P0. Finding type: confirmed.

The selector trusts a mutable completion array. History proves completion loss and repeated dispatch. The queue check compares keys/counts without checking task payload/order; an invalid handoff can leave the builder-supplied task as the next review identity. Runtime state is explicitly excluded from product PRs but has no separate remote persistence transaction.

Evidence: [kanban/scripts/loop-runner.py:141](/Users/majid/www/barghsa/barghsa-core/kanban/scripts/loop-runner.py:141), [kanban/scripts/loop-runner.py:46](/Users/majid/www/barghsa/barghsa-core/kanban/scripts/loop-runner.py:46), [kanban/scripts/loop-runner.py:649](/Users/majid/www/barghsa/barghsa-core/kanban/scripts/loop-runner.py:649), [kanban/scripts/build_backlog.py:271](/Users/majid/www/barghsa/barghsa-core/kanban/scripts/build_backlog.py:271).

Actions:

- Use a supervisor-owned immutable assignment containing qualified task key, canonical requirement digest, branch and attempt ID. Builders return a separate handoff artifact.
- Keep an append-only task event ledger with distinct partial, merged, acceptance_verified, deferred, blocked and retired states. Completion removals require an explicit correction event.
- Persist atomically outside the builder checkout; publish status to a dedicated state branch or state repository and verify the remote revision before dispatching again. Reconcile merged/open PRs before selection, including open #304.
- Validate every generated queue field and ordering against canonical epics. Reject completed-task resumes and identity changes. Align the documented three-fix limit with the current constant of ten.

Acceptance checks:

- Reproduce stale checkout, completion removal, crash during write, two simultaneous ticks, wrong task payload, changed HEAD and wrong handoff task. Each must recover or block without duplicate work.
- Restart on a second checkout using only committed remote state; recover the same assignment and completed set.
- Keep reviewer and merge ticks separate; preserve the existing exact-HEAD/comment binding gates.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F02 Repair the production migration chain

Priority P0. Finding type: confirmed.

The journal begins at 0016 and omits foundational and many later SQL migrations. Its first migration already needs users/profiles/UUIDv7. Source table-creation helpers and tests that create prerequisites do not establish a clean production database. The runner also queries unqualified migration metadata and suppresses every metadata-query error.

Evidence: [packages/db/drizzle/meta/_journal.json:6](/Users/majid/www/barghsa/barghsa-core/packages/db/drizzle/meta/_journal.json:6), [packages/db/drizzle/0016_create_notifications.sql:44](/Users/majid/www/barghsa/barghsa-core/packages/db/drizzle/0016_create_notifications.sql:44), [packages/db/src/migrate.ts:43](/Users/majid/www/barghsa/barghsa-core/packages/db/src/migrate.ts:43).

Actions:

- Inventory all schema definitions, SQL migrations and runtime SQL consumers. Establish a complete ordered forward migration baseline, including users, profiles, products, orders, invoices, providers and notifications.
- Do not blindly register every SQL file: 0001_down_uuidv7_function.sql is a down migration. Preserve already-applied history and provide a tested upgrade path.
- Match Drizzle migration metadata schema and identifiers; distinguish missing metadata from permission/network failures. Package migrations in the production image and close direct pools.

Acceptance checks:

- Empty PostgreSQL database -> production migration command -> seed -> API and worker startup.
- Representative old database -> upgrade -> validate constraints, indexes, functions, backfills and unchanged financial totals.
- Second migration run is a no-op; injected migration failure blocks rollout; schema matches runtime queries.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F03 Fix session loading and CSRF execution order

Priority P0. Finding type: reproduced.

The API installs no cookie parser, while session guards read request.cookies. The global CSRF guard runs before route session guards and allows a request with no session yet. A minimal Nest HTTP reproduction using the actual compiled CsrfGuard and the same guard ordering accepted a POST without a CSRF header, returned 201, and showed cookies=null despite a Cookie header.

Evidence: [apps/api/src/main.ts:10](/Users/majid/www/barghsa/barghsa-core/apps/api/src/main.ts:10), [apps/api/src/session/session.guard.ts:55](/Users/majid/www/barghsa/barghsa-core/apps/api/src/session/session.guard.ts:55), [apps/api/src/session/session.module.ts:24](/Users/majid/www/barghsa/barghsa-core/apps/api/src/session/session.module.ts:24), [apps/api/src/session/csrf.guard.ts:73](/Users/majid/www/barghsa/barghsa-core/apps/api/src/session/csrf.guard.ts:73).

Actions:

- Parse cookies before authentication. Resolve the session before the CSRF decision, using a consistent middleware/guard order.
- Audit route exemptions and rotate/invalidate CSRF tokens with login, password changes and session changes. Update clients that omitted CSRF while the guard was ineffective.

Acceptance checks:

- Real HTTP login cookie authenticates the next request.
- Authenticated state-changing requests with missing, incorrect or stale CSRF tokens return 403; valid tokens succeed.
- Run the checks through AppModule and real browser requests, including logout and step-up.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F04 Restore staff permission boundaries

Priority P0. Finding type: confirmed.

Creating any staff user sets is_admin=true, granting wildcard authority regardless of assigned roles. Initial role IDs must be UUIDs at the controller but are named values such as role-finance in the service. Several privileged controllers use an isAdmin shortcut instead of the required capability.

Evidence: [apps/api/src/admin/admin.service.ts:491](/Users/majid/www/barghsa/barghsa-core/apps/api/src/admin/admin.service.ts:491), [apps/api/src/admin/admin.controller.ts:54](/Users/majid/www/barghsa/barghsa-core/apps/api/src/admin/admin.controller.ts:54), [packages/db/src/schema/staff-roles.ts:74](/Users/majid/www/barghsa/barghsa-core/packages/db/src/schema/staff-roles.ts:74), [apps/api/src/admin/dual-approval.controller.ts:68](/Users/majid/www/barghsa/barghsa-core/apps/api/src/admin/dual-approval.controller.ts:68).

Actions:

- Separate being staff from being a platform administrator. Repair creation and role DTOs; enforce current role capabilities consistently at sensitive endpoints.
- Review existing staff accounts created by this code before changing flags. Preserve legitimate bootstrap/admin accounts and record corrections.
- Refresh or revoke relevant sessions after role removal/disable. Complete activation-link delivery and one-time consumption without misleading success messages.

Acceptance checks:

- Support-only, finance-only, legal-only, no-role and administrator accounts have exactly their intended permissions.
- Create staff with valid named roles through HTTP; reject unknown roles.
- Role removal/disable invalidates access immediately; the administrator bootstrap still works.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F05 Complete registration and OTP delivery

Priority P0. Finding type: confirmed.

OTP challenges are generated and stored but are not sent through an external transport/outbox. Registration accepts a placeholder TOS identifier, and completion records whichever TOS is active at verification time rather than the version accepted for the challenge. Existing-username prechecking is a placeholder.

Evidence: [apps/api/src/auth/auth.service.ts:81](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/auth.service.ts:81), [apps/api/src/auth/auth.service.ts:93](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/auth.service.ts:93), [apps/api/src/auth/auth.service.ts:918](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/auth.service.ts:918), [apps/api/src/auth/otp.service.ts:13](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/otp.service.ts:13).

Actions:

- Persist an immediate OTP delivery event with the challenge; connect verified email/SMS providers, expiry, resend limits and safe retries. Keep bypass/printing restricted to development.
- Bind consent to the exact published TOS version shown to the user. Preserve it across OTP verification and record the required acceptance evidence.
- Replace placeholder registration checks with real validation. Verify reset, contact change, login OTP and staff activation all use the same working delivery path.

Acceptance checks:

- Register and reset a password using a controlled test mailbox/provider; no manual database extraction of OTPs.
- Publish TOS v2 after a user accepted v1 but before OTP completion; record v1 or require explicit new consent, never silently record v2.
- Exercise resend, expiry, consumed challenge, failed delivery and duplicate registration.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F06 Remove unconditional identity verification

Priority P0. Finding type: confirmed.

ProfilesService.verifyProfileApi updates the profile to VERIFIED when configuration says api without calling a provider. A stub provider is registered in the verification module. This does not satisfy the required asynchronous external verification, retries and pending-on-failure behavior.

Evidence: [apps/api/src/profiles/profiles.service.ts:278](/Users/majid/www/barghsa/barghsa-core/apps/api/src/profiles/profiles.service.ts:278), [apps/api/src/verification/verification-provider.service.ts:5](/Users/majid/www/barghsa/barghsa-core/apps/api/src/verification/verification-provider.service.ts:5).

Actions:

- Create a durable verification request from profile submission. A worker calls a configured real adapter outside the business transaction and applies an authenticated result.
- Make production configuration fail closed without a working provider. Keep stub adapters in explicit test/development configuration.
- Encrypt provider credentials, retain verification evidence and emit a localized notification in the same state-change transaction.

Acceptance checks:

- Provider success verifies; timeout, unavailable provider and negative result never silently verify.
- Duplicate callbacks/retries cannot apply twice; stale results cannot overwrite a newer profile version.
- Manual and disabled modes retain their specified behavior.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F07 Finish agent membership and ownership transfer

Priority P1. Finding type: confirmed.

Registration automatically accepts invitations and adds agent membership rather than linking pending invitations for the user to accept. Ownership transfer has initiation only. Profile listing selects only directly owned profiles even though switching authorization has an agent-aware path, making legitimate agent profiles difficult to select.

Evidence: [apps/api/src/auth/auth.service.ts:882](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/auth.service.ts:882), [apps/api/src/profiles/agents.service.ts:723](/Users/majid/www/barghsa/barghsa-core/apps/api/src/profiles/agents.service.ts:723), [apps/api/src/profiles/profiles.service.ts:122](/Users/majid/www/barghsa/barghsa-core/apps/api/src/profiles/profiles.service.ts:122).

Actions:

- Link invitations on registration without accepting them; preserve explicit accept/decline and privacy rules.
- Complete ownership acceptance, decline, expiry and cancellation with step-up and one-owner constraints. Add the required agent/transfer screens.
- List and switch permitted agent profiles consistently; enforce the role matrix for addresses, finance and legal actions.

Acceptance checks:

- Register an invited user: invitation remains pending until acceptance.
- Race two ownership decisions; exactly one owner remains and the old owner retains control until acceptance.
- Removed agents lose access; finance cannot sign contracts; legal cannot move wallet funds; manager cannot transfer ownership.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F08 Fix address deletion against the actual order schema

Priority P1. Finding type: confirmed.

Deleting a non-main address queries orders.address_snapshot_id, which is absent from the current order schema. Orders store copied address fields. The linked-address path also still contains a soft-delete TODO.

Evidence: [apps/api/src/profiles/profiles.service.ts:781](/Users/majid/www/barghsa/barghsa-core/apps/api/src/profiles/profiles.service.ts:781), [packages/db/src/schema/orders.ts:61](/Users/majid/www/barghsa/barghsa-core/packages/db/src/schema/orders.ts:61).

Actions:

- Align deletion with the snapshot model and required retention behavior. Remove the nonexistent-column query or introduce an intentional source-address association through a migration.
- Verify main-address uniqueness and switching in a transaction, and apply agent permissions rather than owner-only checks where the requirement permits managers.

Acceptance checks:

- Delete an unused non-main address against the migrated database.
- Edit/delete a saved address after placing an order; historical order snapshots remain unchanged.
- Concurrent main-address changes preserve the required invariant.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F09 Connect real notification delivery and template test-send

Priority P1. Finding type: confirmed.

The running worker registers only in-app transport. Missing external adapters are skipped. Template test-send validates an external destination but creates an old-style in-app notification and records delivered. Provider configuration and test adapters exist, but do not make the business outbox deliver email/SMS.

Evidence: [apps/worker/src/main.ts:167](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/main.ts:167), [apps/worker/src/notifications/outbox-reader.ts:149](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/notifications/outbox-reader.ts:149), [apps/api/src/notifications/notification-template.service.ts:504](/Users/majid/www/barghsa/barghsa-core/apps/api/src/notifications/notification-template.service.ts:504).

Actions:

- Resolve the active tested provider and channel template in the worker; connect SMTP/Resend and the required SMS adapter. Honor suppression, verified contacts, consent, retry and circuit-breaker policy.
- Treat an unavailable required transport as an explicit delivery failure; never report success because an adapter was absent.
- Make template test-send use the selected channel and active provider, and report the actual destination and outcome.

Acceptance checks:

- A business event reaches in-app plus each allowed verified external destination.
- No configured adapter, provider timeout, hard bounce, complaint and breaker-open states produce truthful statuses and recovery behavior.
- Template test-send proves external delivery using only controlled destinations.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F10 Make notification retries and quiet hours correct

Priority P1. Finding type: confirmed.

In-app transport ignores the supplied idempotency key and inserts each time, so a retry after another channel fails can duplicate the inbox item. Most external channel keys identify event type plus profile, not the event occurrence. Quiet-hour reconciliation uses one global timezone and parks the entire mixed-channel row, delaying in-app too.

Evidence: [apps/worker/src/notifications/in-app-transport.ts:56](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/notifications/in-app-transport.ts:56), [apps/worker/src/notifications/outbox-writer.ts:76](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/notifications/outbox-writer.ts:76), [apps/worker/src/notifications/outbox-runner.ts:434](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/notifications/outbox-runner.ts:434).

Actions:

- Give each logical event occurrence a durable ID; derive stable per-channel keys from it. Migrate legacy in-flight keys explicitly to avoid redelivery.
- Deduplicate in-app inserts at the database boundary and persist channel outcomes independently.
- Schedule external legs in the recipient timezone while delivering in-app immediately. Preserve the specified timing behavior when configuration changes.

Acceptance checks:

- Fail email after in-app succeeds, retry repeatedly, and retain exactly one in-app item.
- Two top-ups for one profile produce two notifications; retries of one top-up produce one.
- A mixed in-app/email daytime event outside the recipient window displays in-app now and sends email at the correct next opening.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F11 Unify notification inboxes and active-profile context

Priority P1. Finding type: confirmed.

Legacy notifications write to notifications, while the new center reads in_app_notifications. Verification still uses the old writer and a /app/settings/profile link although the current route is /settings/profile. The center resolves a default owned profile instead of the selected agent/profile context. In-app rendering still derives convention keys rather than using active versioned templates.

Evidence: [apps/api/src/notifications/notifications.service.ts:71](/Users/majid/www/barghsa/barghsa-core/apps/api/src/notifications/notifications.service.ts:71), [apps/api/src/notifications/notification-center.service.ts:171](/Users/majid/www/barghsa/barghsa-core/apps/api/src/notifications/notification-center.service.ts:171), [apps/worker/src/notifications/in-app-transport.ts:63](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/notifications/in-app-transport.ts:63).

Actions:

- Consolidate writers and inbox delivery with a migration preserving old unread/read history.
- Resolve the authorized active profile consistently for list, count, mark-read and navigation; preserve account-level notices without leaking other profiles.
- Render actual localized event templates and valid links with the user timezone.

Acceptance checks:

- Manual/API verification appears once in the visible center and opens the correct settings page.
- Switch between two owned profiles and an agent profile; list/count/read actions target only the selected authorized profile.
- Every emitted implemented event has a usable fa/en title, body and link.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F12 Resolve payable-overdue and refund transition conflicts

Priority P1. Finding type: requirement_conflict.

The due-date requirements say an overdue invoice remains payable; the earlier transition table and implementation omit payment transitions from Overdue. Wallet and receipt settlement consequently reject overdue invoices. The partial-refund state has no final Refunded transition either; settle the intended cumulative-refund rule before future refund work consumes this model.

Evidence: [kanban/epics/04-invoices-wallet-contracts.md:137](/Users/majid/www/barghsa/barghsa-core/kanban/epics/04-invoices-wallet-contracts.md:137), [apps/api/src/invoice/invoice-state.model.ts:77](/Users/majid/www/barghsa/barghsa-core/apps/api/src/invoice/invoice-state.model.ts:77), [apps/api/src/invoice/invoice-state.model.ts:79](/Users/majid/www/barghsa/barghsa-core/apps/api/src/invoice/invoice-state.model.ts:79).

Actions:

- Reconcile the inconsistent canonical rules, then align model, guards, wallet settlement, both receipt services, UI eligibility and tests.
- Keep cancellation and credit-note restrictions explicit. Preserve amount caps and audit transitions.
- Resolve the final refund state rule as a specification decision; do not implement the unstarted refund module as part of this repair.

Acceptance checks:

- Pay an overdue invoice by full wallet debit and partial/full bank receipts with correct audit and reminder behavior.
- Cancelled invoices remain unpayable; paid_amount never exceeds total_amount.
- A model-level test captures the agreed cumulative-refund terminal rule.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F13 Apply dual approval to every built bank-payment path

Priority P1. Finding type: confirmed.

Invoice bank_receipts have a threshold gate, while wallet bank-receipt confirmation has no approval-request/threshold check. The generic approval workflow also retains an isAdmin shortcut and no step-up on resolution. Two similar payment entry points therefore apply different controls.

Evidence: [apps/api/src/wallet/bank-receipt-confirmation.service.ts:278](/Users/majid/www/barghsa/barghsa-core/apps/api/src/wallet/bank-receipt-confirmation.service.ts:278), [apps/api/src/admin/dual-approval.controller.ts:68](/Users/majid/www/barghsa/barghsa-core/apps/api/src/admin/dual-approval.controller.ts:68), [packages/shared/src/finance/invoice-bank-receipt-dual-approval.ts:5](/Users/majid/www/barghsa/barghsa-core/packages/shared/src/finance/invoice-bank-receipt-dual-approval.ts:5).

Actions:

- Share the applicable threshold rule across wallet and invoice receipt confirmation; bind approval to receipt, amount, initiator and current version.
- Require a distinct currently eligible finance reviewer and step-up. Resolve the generic “above” versus invoice “at or above” threshold wording explicitly.
- Add the required pending-approval UI and prevent alternative endpoints from bypassing approval.

Acceptance checks:

- Amounts below, equal to and above the configured threshold follow the agreed rule on both receipt paths.
- Self-approval, stale approval, changed amount, removed reviewer permission and repeated confirmation never credit funds.
- Concurrent confirmations settle once and atomically record approval, ledger and audit.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F14 Close invoice integration and duplicate-payment regression checks

Priority P1. Finding type: verification_gap.

Finance contains substantial implementation and multiple corrective merges. Passing shared-model tests cannot verify SQL transactions, migration compatibility, provider callbacks or the completeness of the staff workflow. Service-only tasks must be judged against their actual task boundary; missing future ordering/refund consumers are separate backlog work.

Evidence: [apps/api/src/invoice/manual-invoice.service.ts:138](/Users/majid/www/barghsa/barghsa-core/apps/api/src/invoice/manual-invoice.service.ts:138), [apps/api/src/invoice/auto-invoice.service.ts:145](/Users/majid/www/barghsa/barghsa-core/apps/api/src/invoice/auto-invoice.service.ts:145), [apps/api/src/wallet/pay-invoice-with-wallet.service.ts:125](/Users/majid/www/barghsa/barghsa-core/apps/api/src/wallet/pay-invoice-with-wallet.service.ts:125).

Actions:

- Trace each currently required caller through HTTP/service/transaction and document any service-only acceptance boundary. Complete missing integration only where the implemented task itself requires it.
- Preserve fixes for receipt idempotency, lock order, nonnegative balances, chargeback payload binding, reversal writers, expiry concurrency and overpayment notifications.
- Reconcile incidental coverage of T-04.3.01.06 in PR #298 before starting that next queue item.

Acceptance checks:

- Run real-PostgreSQL tests for all 56 merged finance tasks after F02.
- Cover money above Number.MAX_SAFE_INTEGER, rollback at each write, competing receipts/wallet debit, callback retry/replay/late arrival, reversal overdraw and ledger reconciliation.
- Verify snapshot replay, VAT version selection, half-up rounding, due-date overrides, reminder toggles/cancellation and correction links through their required callers.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F15 Complete CRM screens and correct list queries

Priority P1. Finding type: confirmed.

The CRM list route renders a coming-soon placeholder despite completed list/filter tasks. The backend cursor predicate always uses descending comparison even when ascending order is requested. Filters also use status labels that need reconciliation with the actual profile lifecycle.

Evidence: [apps/web/src/pages/CrmProfileList.tsx:18](/Users/majid/www/barghsa/barghsa-core/apps/web/src/pages/CrmProfileList.tsx:18), [apps/api/src/crm/crm.service.ts:102](/Users/majid/www/barghsa/barghsa-core/apps/api/src/crm/crm.service.ts:102).

Actions:

- Build the required list/filter UI and complete profile detail/edit/verification-case actions against actual capability gates.
- Make cursor encoding and comparison match every supported sort key and direction. Align verification filters with stored states.
- Exercise identity-edit restrictions, business blockers for deletion, session expiry and audit diffs through HTTP.

Acceptance checks:

- Paginate identical timestamps in both directions with no repeats or omissions; search/filter combinations remain stable.
- A permitted CRM staff account can complete each required action; a finance-only account cannot.
- Profile deletion with active financial/business records is blocked without losing history.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F16 Finish customer and staff ticket workflows

Priority P1. Finding type: missing_ui.

Ticket APIs exist, but the current route inventory has no ticket list/detail/create or staff ticket-management screens matching the completed tasks. A support/recovery page is not the required ticket workflow.

Evidence: [apps/api/src/tickets/tickets.controller.ts:24](/Users/majid/www/barghsa/barghsa-core/apps/api/src/tickets/tickets.controller.ts:24), [apps/web/src/routeTree.gen.ts:95](/Users/majid/www/barghsa/barghsa-core/apps/web/src/routeTree.gen.ts:95).

Actions:

- Add the required customer and staff ticket UI with attachments, related records, assignment, comments and status transitions.
- Connect existing team/assignment configuration where required and verify that internal notes never appear in customer responses.

Acceptance checks:

- Customer creates a ticket and attachment, staff assigns/replies internally and publicly, customer sees only public content, and reopen/resolve flows work.
- Cross-profile access, unsupported transitions and unauthorized assignment fail.
- Both locales, keyboard navigation and empty/error/loading states work.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F17 Complete deferred administration screens and required consumers

Priority P1. Finding type: missing_ui.

Many merged PRs explicitly delivered API slices and deferred UI, then the loop marked the full task completed. Current admin/users points to AdminDashboard. Required screens remain for staff/audit, approvals, targets/teams, reconciliation/failed jobs/dead letters, green rules, AI configuration, catalogue/VAT/gift codes, contract templates and upload policies. Team assignment configuration also deferred its assignment engine.

Evidence: [apps/web/src/routes/admin/users.tsx:6](/Users/majid/www/barghsa/barghsa-core/apps/web/src/routes/admin/users.tsx:6), [apps/api/src/admin/admin.service.ts:395](/Users/majid/www/barghsa/barghsa-core/apps/api/src/admin/admin.service.ts:395), [apps/worker/src/main.ts:6](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/main.ts:6).

Actions:

- Create one bounded repair per original task rather than one large admin rewrite; use the task register and deferral inventory for exact scope.
- Connect the existing APIs to the required list/form/detail actions, step-up prompts and effective permissions. Finish automatic team assignment if required by that original task.
- Leave actual AI document processing, new ordering/contract modules and other explicitly separate future task consumers in the skipped/unstarted backlog.

Acceptance checks:

- For each repaired task, a staff user completes the exact epic UI flow with a real migrated API.
- Test create/edit/activate/rollback or resolve/retry as applicable; validate failure, permissions, fa/en and RTL states.
- Mark a parent task acceptance_verified only after every required slice is delivered.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F18 Test the actual production images and drain running work

Priority P1. Finding type: confirmed.

The shared image packages API output but no worker output, and production compose defines no worker service. The production web entry point is the newer server.js while shutdown tests import server/index.js. Worker shutdown waits on currentJob, which is never assigned; interval work can still be running when resources close. Container dependency resolution also needs a real image boot test.

Evidence: [Dockerfile.base:29](/Users/majid/www/barghsa/barghsa-core/Dockerfile.base:29), [docker-compose.prod.yml:17](/Users/majid/www/barghsa/barghsa-core/docker-compose.prod.yml:17), [Dockerfile.web:32](/Users/majid/www/barghsa/barghsa-core/Dockerfile.web:32), [apps/worker/src/main.ts:101](/Users/majid/www/barghsa/barghsa-core/apps/worker/src/main.ts:101).

Actions:

- Package a deployable API/worker artifact with all workspace runtime dependencies and migration assets; add the worker to the intended deployment.
- Choose one web server implementation, retain the earlier graceful shutdown behavior and point tests at the production entry point.
- Track every in-flight worker task, stop leases/timers first, await completion up to a bounded deadline, then release pools.

Acceptance checks:

- Build and boot web, API and worker images from a clean checkout with read-only filesystem and non-root user.
- Readiness reflects required dependencies; an unavailable optional Redis service follows the documented fallback policy.
- Send SIGTERM during an outbox dispatch and finance job; prove committed/retryable outcomes and no lost work.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F19 Make quality gates reflect the promised requirements

Priority P1. Finding type: confirmed.

The API coverage gate is 38% lines/30% branches and excludes CRM, while the epic requires 80/75 generally and 90/85 for critical domains unless an approved exception exists. The main web budget permits 700 KB gzip; measured main JS is 220.12 kB and includes auth, exceeding the specified 150 KB auth budget. Root lint/format commands have no substantive per-package tasks.

Evidence: [apps/api/vitest.config.ts:21](/Users/majid/www/barghsa/barghsa-core/apps/api/vitest.config.ts:21), [apps/api/vitest.config.ts:12](/Users/majid/www/barghsa/barghsa-core/apps/api/vitest.config.ts:12), [.size-limit.json:5](/Users/majid/www/barghsa/barghsa-core/.size-limit.json:5), [.github/workflows/ci.yml:29](/Users/majid/www/barghsa/barghsa-core/.github/workflows/ci.yml:29).

Actions:

- Restore meaningful changed-code and critical-domain coverage checks, or record an explicit approved exception with expiry. Do not raise coverage through implementation-mirroring tests.
- Add actual lint/format, clean+upgrade migration and OpenAPI contract-drift gates. Audit PR affected-package filtering against shared dependency changes.
- Measure the complete route payload including common chunks; split auth as needed. Resolve TanStack Start versus Vite SPA and skipLibCheck differences through an architecture/requirements decision.

Acceptance checks:

- A deliberately failing critical-domain regression, contract drift and over-budget auth bundle each fail CI.
- The entire real database suite and relevant browser flows run in CI, with no silent skips presented as passes.
- Repeated queue/backlog checks validate full task payloads, not only keys.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F20 Verify localization, calendar behavior and accessibility

Priority P2. Finding type: verification_gap.

Repair status: the shared picker and all five current consumers now use the saved account timezone. Bounds, full Persian/English labels, numeral controls, month selection, half-open ranges, Nowruz/Esfand and DST checks are implemented. The current checkpoint passes 37 focused browser checks; details and limitations are in [repair-progress.md](repair-progress.md). The subsequent render/accessibility checkpoint passes 63 combined browser checks and has zero scan errors; 42 of 43 current-baseline accessibility diagnostics are resolved, with the remaining toast wrapper warning reviewed explicitly. See [accessibility-triage.md](accessibility-triage.md). Global non-picker date displays, administrator numeral preference wiring, untranslated screens and broader interaction review still require work. The evidence below records the original audit baseline.

Foundational components exist, but accessibility and localized behavior are not certified by the current test run. React Doctor reported 237 diagnostics including 92 accessibility warnings; these require triage, not blanket fixes. The date picker formats selected text as Jalali while using the generic DayPicker calendar with a cast locale, so actual Jalali month/day behavior needs a focused verification. Some shell components default to Persian.

Evidence: [packages/ui/src/components/base-ui/date-picker.tsx:111](/Users/majid/www/barghsa/barghsa-core/packages/ui/src/components/base-ui/date-picker.tsx:111), [packages/ui/src/components/ui/calendar.tsx:9](/Users/majid/www/barghsa/barghsa-core/packages/ui/src/components/ui/calendar.tsx:9), [apps/web/src/pages/DashboardLayout.tsx:22](/Users/majid/www/barghsa/barghsa-core/apps/web/src/pages/DashboardLayout.tsx:22).

Actions:

- Triage the saved diagnostics, fixing confirmed keyboard, label, focus, error-state and interaction failures first.
- Verify a true Jalali calendar grid/range selection, Gregorian mode, user timezone, Persian digits/IRR and language switching across shared components and implemented screens.
- Unify actual locale context and add missing dictionaries for completed UI slices.

Acceptance checks:

- Keyboard-only and screen-reader checks cover auth, profile, receipts, templates and admin configuration.
- Known Nowruz/Esfand boundary dates and ranges display/select correctly in fa and en.
- Automated accessibility checks plus manual RTL/focus review pass for the implemented task flows.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F21 Keep useful follow-up fixes and remove proven implementation drift

Priority P2. Finding type: confirmed.

Twenty-three task keys have multiple merged PRs. They are not twenty-three duplicate features to delete: five Docker tasks were rebuilt, fifteen wallet groups contain follow-up corrections, legal profile work is backend plus UI, one pair is bookkeeping, and the invoice snapshot was reverted/replaced.

Evidence: [apps/web/test/server.spec.ts:2](/Users/majid/www/barghsa/barghsa-core/apps/web/test/server.spec.ts:2), [Dockerfile.web:32](/Users/majid/www/barghsa/barghsa-core/Dockerfile.web:32).

Actions:

- Preserve merged financial corrections. Deduplicate task bookkeeping with provenance for every PR.
- Consolidate the two web servers after behavior comparison; compare Docker requirements against the selected implementation.
- Inspect open #304 before any new dispatch; do not merge or close it automatically as part of this audit.

Acceptance checks:

- No active production path is tested through a different implementation.
- Regression tests retain protections introduced by wallet follow-ups.
- Task selection does not rebuild a merged task merely because its status was overwritten.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F22 Run acceptance closure for every recorded task

Priority P1. Finding type: verification_gap.

263 current task keys have merged PR evidence; another 59 current completion claims lack a direct mapped PR. A merge is not acceptance certification. This audit identifies confirmed defects and missing slices, but database, provider, browser, load and operational acceptance cannot all be proven by static source review.

Evidence: [kanban/task-queue.json:3](/Users/majid/www/barghsa/barghsa-core/kanban/task-queue.json:3).

Actions:

- Use task-review.json as the closure checklist. For every task, retain canonical requirements, current source evidence, required caller, tests and exact reviewed SHA.
- Classify each as acceptance_verified, partial, deferred, blocked or retired. Preserve original completed/merged evidence separately.
- Require end-to-end evidence for user workflows and actual restore/deployment records for operational tasks. Do not treat a document/script as a completed restore exercise.

Acceptance checks:

- All 263 PR-backed tasks and 59 legacy claims receive a final disposition with evidence.
- No partial parent or historical skip is used as completed input to the selector.
- Resume new feature work only after P0/P1 repairs and domain acceptance checks pass; keep remaining approved deferrals visible.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

## F23 Align authentication rate limits with account and destination rules

Priority P1. Finding type: confirmed.

The login account-and-IP counter is keyed only by IP, and progressive delay starts after one prior attempt rather than the specified five failed attempts. The generic guard also keys only by IP. The required destination/account limits therefore need an explicit check at the service boundary, independent of broad IP protection.

Evidence: [apps/api/src/auth/auth.service.ts:146](/Users/majid/www/barghsa/barghsa-core/apps/api/src/auth/auth.service.ts:146), [apps/api/src/rate-limit/rate-limit.guard.ts:60](/Users/majid/www/barghsa/barghsa-core/apps/api/src/rate-limit/rate-limit.guard.ts:60).

Actions:

- Use normalized account-plus-IP failure counters for login and separate broad IP/device limits. Count failed attempts with the specified 15-minute window and threshold.
- Verify per-destination registration, OTP resend/hour/day, challenge verification and password-reset quotas, including Redis-loss behavior.
- Keep Retry-After and localized recovery information consistent through the global HTTP exception filter and all auth clients.

Acceptance checks:

- Two legitimate accounts behind the same IP do not share the account-specific delay; broad abuse limits still apply.
- The sixth failed attempt triggers the specified progressive policy, without permanent lockout.
- Changing IP does not bypass destination/account quotas; Redis loss preserves the PostgreSQL-backed protection.

Task scope is enumerated in [findings.json](findings.json) and the per-task register.

