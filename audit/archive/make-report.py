from pathlib import Path
from current_requirements import requirement_record
import json,csv,re,collections,subprocess,shutil
ROOT=Path('/Users/majid/www/barghsa/barghsa-core')
OUT=Path('/tmp/barghsa-full-audit')
Q=json.loads((ROOT/'kanban/task-queue.json').read_text()); QM={r['key']:r for r in Q}
PRS=json.load(open(OUT/'merged-pr-evidence.json')); FILES=json.load(open(OUT/'pr-files.json'))
REG=json.load(open('/tmp/barghsa-kanban-audit/completed-task-register.json'))
STATE=json.loads((ROOT/'kanban/loop-state.json').read_text())
SKIPS=json.load(open(OUT/'historical-skips.json')); SKIPSET=set(SKIPS)
REQ={r['key']:r['requirement'] for f in OUT.glob('*.md.json') for r in json.load(open(f))}
HEAD=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
F=[]
def finding(id,priority,title,kind,selectors,evidence,problem,work,checks):
    keys=[k for k in QM if any(k.startswith(s) for s in selectors)]
    refs=[]
    for path,needle in evidence:
        text=(ROOT/path).read_text(); line=next((i for i,l in enumerate(text.splitlines(),1) if needle in l),None)
        assert line,(path,needle)
        refs.append({'path':path,'line':line})
    F.append(dict(id=id,priority=priority,title=title,kind=kind,task_keys=keys,evidence=refs,problem=problem,work=work,acceptance_checks=checks))
I='01-platform-infrastructure.md#'; A='02-auth-users-admin.md#'; B='03-core-business.md#'; W='04-invoices-wallet-contracts.md#'; N='05-notifications-documents-ai.md#'; U='07-ui-ux-design.md#'
finding('F01','P0','Make task identity and completion durable','confirmed',[I+'T-01.'],[
('kanban/scripts/loop-runner.py','def next_task'),('kanban/scripts/loop-runner.py','def save_json'),('kanban/scripts/loop-runner.py','def select_or_resume_task'),('kanban/scripts/build_backlog.py','def main')],
'The selector trusts a mutable completion array. History proves completion loss and repeated dispatch. The queue check compares keys/counts without checking task payload/order; an invalid handoff can leave the builder-supplied task as the next review identity. Runtime state is explicitly excluded from product PRs but has no separate remote persistence transaction.',
['Use a supervisor-owned immutable assignment containing qualified task key, canonical requirement digest, branch and attempt ID. Builders return a separate handoff artifact.', 'Keep an append-only task event ledger with distinct partial, merged, acceptance_verified, deferred, blocked and retired states. Completion removals require an explicit correction event.', 'Persist atomically outside the builder checkout; publish status to a dedicated state branch or state repository and verify the remote revision before dispatching again. Reconcile merged/open PRs before selection, including open #304.', 'Validate every generated queue field and ordering against canonical epics. Reject completed-task resumes and identity changes. Align the documented three-fix limit with the current constant of ten.'],
['Reproduce stale checkout, completion removal, crash during write, two simultaneous ticks, wrong task payload, changed HEAD and wrong handoff task. Each must recover or block without duplicate work.', 'Restart on a second checkout using only committed remote state; recover the same assignment and completed set.', 'Keep reviewer and merge ticks separate; preserve the existing exact-HEAD/comment binding gates.'])
finding('F02','P0','Repair the production migration chain','confirmed',[I+'T-02.',B,W,N,A],[
('packages/db/drizzle/meta/_journal.json','"idx": 16'),('packages/db/drizzle/0016_create_notifications.sql','uuid_generate_v7'),('packages/db/src/migrate.ts','FROM __drizzle_migrations')],
'The journal begins at 0016 and omits foundational and many later SQL migrations. Its first migration already needs users/profiles/UUIDv7. Source table-creation helpers and tests that create prerequisites do not establish a clean production database. The runner also queries unqualified migration metadata and suppresses every metadata-query error.',
['Inventory all schema definitions, SQL migrations and runtime SQL consumers. Establish a complete ordered forward migration baseline, including users, profiles, products, orders, invoices, providers and notifications.', 'Do not blindly register every SQL file: 0001_down_uuidv7_function.sql is a down migration. Preserve already-applied history and provide a tested upgrade path.', 'Match Drizzle migration metadata schema and identifiers; distinguish missing metadata from permission/network failures. Package migrations in the production image and close direct pools.'],
['Empty PostgreSQL database -> production migration command -> seed -> API and worker startup.', 'Representative old database -> upgrade -> validate constraints, indexes, functions, backfills and unchanged financial totals.', 'Second migration run is a no-op; injected migration failure blocks rollout; schema matches runtime queries.'])
finding('F03','P0','Fix session loading and CSRF execution order','reproduced',[A+'T-02.02.',A+'T-02.01.',A+'T-03.01.'],[
('apps/api/src/main.ts','NestFactory.create'),('apps/api/src/session/session.guard.ts','request.cookies?'),('apps/api/src/session/session.module.ts','provide: APP_GUARD'),('apps/api/src/session/csrf.guard.ts','if (!authRequest.session)')],
'The API installs no cookie parser, while session guards read request.cookies. The global CSRF guard runs before route session guards and allows a request with no session yet. A minimal Nest HTTP reproduction using the actual compiled CsrfGuard and the same guard ordering accepted a POST without a CSRF header, returned 201, and showed cookies=null despite a Cookie header.',
['Parse cookies before authentication. Resolve the session before the CSRF decision, using a consistent middleware/guard order.', 'Audit route exemptions and rotate/invalidate CSRF tokens with login, password changes and session changes. Update clients that omitted CSRF while the guard was ineffective.'],
['Real HTTP login cookie authenticates the next request.', 'Authenticated state-changing requests with missing, incorrect or stale CSRF tokens return 403; valid tokens succeed.', 'Run the checks through AppModule and real browser requests, including logout and step-up.'])
finding('F04','P0','Restore staff permission boundaries','confirmed',[A+'T-05.03.',A+'T-05.04.04',A+'T-09.05.',A+'T-10.'],[
('apps/api/src/admin/admin.service.ts','VALUES ($1, $2, $3, true'),('apps/api/src/admin/admin.controller.ts','roleIds: z.array(z.string().uuid())'),('packages/db/src/schema/staff-roles.ts',"id: 'role-finance'"),('apps/api/src/admin/dual-approval.controller.ts','req.session.isAdmin')],
'Creating any staff user sets is_admin=true, granting wildcard authority regardless of assigned roles. Initial role IDs must be UUIDs at the controller but are named values such as role-finance in the service. Several privileged controllers use an isAdmin shortcut instead of the required capability.',
['Separate being staff from being a platform administrator. Repair creation and role DTOs; enforce current role capabilities consistently at sensitive endpoints.', 'Review existing staff accounts created by this code before changing flags. Preserve legitimate bootstrap/admin accounts and record corrections.', 'Refresh or revoke relevant sessions after role removal/disable. Complete activation-link delivery and one-time consumption without misleading success messages.'],
['Support-only, finance-only, legal-only, no-role and administrator accounts have exactly their intended permissions.', 'Create staff with valid named roles through HTTP; reject unknown roles.', 'Role removal/disable invalidates access immediately; the administrator bootstrap still works.'])
finding('F05','P0','Complete registration and OTP delivery','confirmed',[A+'T-01.',A+'T-02.01.',A+'T-02.03.',A+'T-04.01.',A+'T-03.03.04'],[
('apps/api/src/auth/auth.service.ts','const usernameTaken = false'),('apps/api/src/auth/auth.service.ts',"new Set(['current'])"),('apps/api/src/auth/auth.service.ts','Look up the current active TOS version'),('apps/api/src/auth/otp.service.ts','class OtpService')],
'OTP challenges are generated and stored but are not sent through an external transport/outbox. Registration accepts a placeholder TOS identifier, and completion records whichever TOS is active at verification time rather than the version accepted for the challenge. Existing-username prechecking is a placeholder.',
['Persist an immediate OTP delivery event with the challenge; connect verified email/SMS providers, expiry, resend limits and safe retries. Keep bypass/printing restricted to development.', 'Bind consent to the exact published TOS version shown to the user. Preserve it across OTP verification and record the required acceptance evidence.', 'Replace placeholder registration checks with real validation. Verify reset, contact change, login OTP and staff activation all use the same working delivery path.'],
['Register and reset a password using a controlled test mailbox/provider; no manual database extraction of OTPs.', 'Publish TOS v2 after a user accepted v1 but before OTP completion; record v1 or require explicit new consent, never silently record v2.', 'Exercise resend, expiry, consumed challenge, failed delivery and duplicate registration.'])
finding('F06','P0','Remove unconditional identity verification','confirmed',[A+'T-07.01.',A+'T-03.01.02',A+'T-03.02.',A+'T-05.02.03'],[
('apps/api/src/profiles/profiles.service.ts','async verifyProfileApi'),('apps/api/src/verification/verification-provider.service.ts','StubVerificationProvider')],
'ProfilesService.verifyProfileApi updates the profile to VERIFIED when configuration says api without calling a provider. A stub provider is registered in the verification module. This does not satisfy the required asynchronous external verification, retries and pending-on-failure behavior.',
['Create a durable verification request from profile submission. A worker calls a configured real adapter outside the business transaction and applies an authenticated result.', 'Make production configuration fail closed without a working provider. Keep stub adapters in explicit test/development configuration.', 'Encrypt provider credentials, retain verification evidence and emit a localized notification in the same state-change transaction.'],
['Provider success verifies; timeout, unavailable provider and negative result never silently verify.', 'Duplicate callbacks/retries cannot apply twice; stale results cannot overwrite a newer profile version.', 'Manual and disabled modes retain their specified behavior.'])
finding('F07','P1','Finish agent membership and ownership transfer','confirmed',[A+'T-05.04.',A+'T-05.05.02',A+'T-03.03.01',A+'T-03.03.02'],[
('apps/api/src/auth/auth.service.ts','Mark invitation as accepted'),('apps/api/src/profiles/agents.service.ts','async initiateOwnershipTransfer'),('apps/api/src/profiles/profiles.service.ts','async getProfilesByUserId')],
'Registration automatically accepts invitations and adds agent membership rather than linking pending invitations for the user to accept. Ownership transfer has initiation only. Profile listing selects only directly owned profiles even though switching authorization has an agent-aware path, making legitimate agent profiles difficult to select.',
['Link invitations on registration without accepting them; preserve explicit accept/decline and privacy rules.', 'Complete ownership acceptance, decline, expiry and cancellation with step-up and one-owner constraints. Add the required agent/transfer screens.', 'List and switch permitted agent profiles consistently; enforce the role matrix for addresses, finance and legal actions.'],
['Register an invited user: invitation remains pending until acceptance.', 'Race two ownership decisions; exactly one owner remains and the old owner retains control until acceptance.', 'Removed agents lose access; finance cannot sign contracts; legal cannot move wallet funds; manager cannot transfer ownership.'])
finding('F08','P1','Fix address deletion against the actual order schema','confirmed',[A+'T-03.04.',A+'T-03.03.03'],[
('apps/api/src/profiles/profiles.service.ts','WHERE address_snapshot_id'),('packages/db/src/schema/orders.ts',"snapshotProvinceId: text('snapshot_province_id')")],
'Deleting a non-main address queries orders.address_snapshot_id, which is absent from the current order schema. Orders store copied address fields. The linked-address path also still contains a soft-delete TODO.',
['Align deletion with the snapshot model and required retention behavior. Remove the nonexistent-column query or introduce an intentional source-address association through a migration.', 'Verify main-address uniqueness and switching in a transaction, and apply agent permissions rather than owner-only checks where the requirement permits managers.'],
['Delete an unused non-main address against the migrated database.', 'Edit/delete a saved address after placing an order; historical order snapshots remain unchanged.', 'Concurrent main-address changes preserve the required invariant.'])
finding('F09','P1','Connect real notification delivery and template test-send','confirmed',[N+'T-05.01.',N+'T-05.04.',N+'T-05.05.',N+'T-05.06.',A+'T-09.04.',A+'T-09.06.',A+'T-07.01.03'],[
('apps/worker/src/main.ts','const transports = { in_app'),('apps/worker/src/notifications/outbox-reader.ts','if (!transport)'),('apps/api/src/notifications/notification-template.service.ts','async testSend')],
'The running worker registers only in-app transport. Missing external adapters are skipped. Template test-send validates an external destination but creates an old-style in-app notification and records delivered. Provider configuration and test adapters exist, but do not make the business outbox deliver email/SMS.',
['Resolve the active tested provider and channel template in the worker; connect SMTP/Resend and the required SMS adapter. Honor suppression, verified contacts, consent, retry and circuit-breaker policy.', 'Treat an unavailable required transport as an explicit delivery failure; never report success because an adapter was absent.', 'Make template test-send use the selected channel and active provider, and report the actual destination and outcome.'],
['A business event reaches in-app plus each allowed verified external destination.', 'No configured adapter, provider timeout, hard bounce, complaint and breaker-open states produce truthful statuses and recovery behavior.', 'Template test-send proves external delivery using only controlled destinations.'])
finding('F10','P1','Make notification retries and quiet hours correct','confirmed',[N+'T-05.01.02',N+'T-05.01.03',N+'T-05.01.04',N+'T-05.02.01',N+'T-05.03.',W+'T-04.1.04.',W+'T-04.2.02.04',W+'T-04.2.02.05',W+'T-04.2.04.03'],[
('apps/worker/src/notifications/in-app-transport.ts','INSERT INTO in_app_notifications'),('apps/worker/src/notifications/outbox-writer.ts','CHANNEL_IDEMPOTENCY_INCLUDES_OUTBOX_KEY_EVENTS'),('apps/worker/src/notifications/outbox-runner.ts','export async function reconcileDeliveryWindows')],
'In-app transport ignores the supplied idempotency key and inserts each time, so a retry after another channel fails can duplicate the inbox item. Most external channel keys identify event type plus profile, not the event occurrence. Quiet-hour reconciliation uses one global timezone and parks the entire mixed-channel row, delaying in-app too.',
['Give each logical event occurrence a durable ID; derive stable per-channel keys from it. Migrate legacy in-flight keys explicitly to avoid redelivery.', 'Deduplicate in-app inserts at the database boundary and persist channel outcomes independently.', 'Schedule external legs in the recipient timezone while delivering in-app immediately. Preserve the specified timing behavior when configuration changes.'],
['Fail email after in-app succeeds, retry repeatedly, and retain exactly one in-app item.', 'Two top-ups for one profile produce two notifications; retries of one top-up produce one.', 'A mixed in-app/email daytime event outside the recipient window displays in-app now and sends email at the correct next opening.'])
finding('F11','P1','Unify notification inboxes and active-profile context','confirmed',[N+'T-05.02.',A+'T-07.01.03',A+'T-05.02.03',A+'T-03.03.06'],[
('apps/api/src/notifications/notifications.service.ts','INSERT INTO notifications'),('apps/api/src/notifications/notification-center.service.ts','SELECT id FROM profiles'),('apps/worker/src/notifications/in-app-transport.ts','notifications.${payload.eventKey}.title')],
'Legacy notifications write to notifications, while the new center reads in_app_notifications. Verification still uses the old writer and a /app/settings/profile link although the current route is /settings/profile. The center resolves a default owned profile instead of the selected agent/profile context. In-app rendering still derives convention keys rather than using active versioned templates.',
['Consolidate writers and inbox delivery with a migration preserving old unread/read history.', 'Resolve the authorized active profile consistently for list, count, mark-read and navigation; preserve account-level notices without leaking other profiles.', 'Render actual localized event templates and valid links with the user timezone.'],
['Manual/API verification appears once in the visible center and opens the correct settings page.', 'Switch between two owned profiles and an agent profile; list/count/read actions target only the selected authorized profile.', 'Every emitted implemented event has a usable fa/en title, body and link.'])
finding('F12','P1','Resolve payable-overdue and refund transition conflicts','requirement_conflict',[W+'T-04.1.01.',W+'T-04.1.03.04',W+'T-04.2.02.05',W+'T-04.2.03.',W+'T-04.3.01.03'],[
('kanban/epics/04-invoices-wallet-contracts.md','Overdue invoice remains payable'),('apps/api/src/invoice/invoice-state.model.ts',"Overdue: ['Cancelled']"),('apps/api/src/invoice/invoice-state.model.ts',"PartiallyRefunded: ['PartiallyRefunded']")],
'The due-date requirements say an overdue invoice remains payable; the earlier transition table and implementation omit payment transitions from Overdue. Wallet and receipt settlement consequently reject overdue invoices. The partial-refund state has no final Refunded transition either; settle the intended cumulative-refund rule before future refund work consumes this model.',
['Reconcile the inconsistent canonical rules, then align model, guards, wallet settlement, both receipt services, UI eligibility and tests.', 'Keep cancellation and credit-note restrictions explicit. Preserve amount caps and audit transitions.', 'Resolve the final refund state rule as a specification decision; do not implement the unstarted refund module as part of this repair.'],
['Pay an overdue invoice by full wallet debit and partial/full bank receipts with correct audit and reminder behavior.', 'Cancelled invoices remain unpayable; paid_amount never exceeds total_amount.', 'A model-level test captures the agreed cumulative-refund terminal rule.'])
finding('F13','P1','Apply dual approval to every built bank-payment path','confirmed',[A+'T-09.07.',W+'T-04.2.02.04',W+'T-04.2.02.05',W+'T-04.3.01.05'],[
('apps/api/src/wallet/bank-receipt-confirmation.service.ts','async confirm'),('apps/api/src/admin/dual-approval.controller.ts','req.session.isAdmin'),('packages/shared/src/finance/invoice-bank-receipt-dual-approval.ts','threshold')],
'Invoice bank_receipts have a threshold gate, while wallet bank-receipt confirmation has no approval-request/threshold check. The generic approval workflow also retains an isAdmin shortcut and no step-up on resolution. Two similar payment entry points therefore apply different controls.',
['Share the applicable threshold rule across wallet and invoice receipt confirmation; bind approval to receipt, amount, initiator and current version.', 'Require a distinct currently eligible finance reviewer and step-up. Resolve the generic “above” versus invoice “at or above” threshold wording explicitly.', 'Add the required pending-approval UI and prevent alternative endpoints from bypassing approval.'],
['Amounts below, equal to and above the configured threshold follow the agreed rule on both receipt paths.', 'Self-approval, stale approval, changed amount, removed reviewer permission and repeated confirmation never credit funds.', 'Concurrent confirmations settle once and atomically record approval, ledger and audit.'])
finding('F14','P1','Close invoice integration and duplicate-payment regression checks','verification_gap',[W],[
('apps/api/src/invoice/manual-invoice.service.ts','class ManualInvoiceService'),('apps/api/src/invoice/auto-invoice.service.ts','class AutoInvoiceService'),('apps/api/src/wallet/pay-invoice-with-wallet.service.ts','class PayInvoiceWithWalletService')],
'Finance contains substantial implementation and multiple corrective merges. Passing shared-model tests cannot verify SQL transactions, migration compatibility, provider callbacks or the completeness of the staff workflow. Service-only tasks must be judged against their actual task boundary; missing future ordering/refund consumers are separate backlog work.',
['Trace each currently required caller through HTTP/service/transaction and document any service-only acceptance boundary. Complete missing integration only where the implemented task itself requires it.', 'Preserve fixes for receipt idempotency, lock order, nonnegative balances, chargeback payload binding, reversal writers, expiry concurrency and overpayment notifications.', 'Reconcile incidental coverage of T-04.3.01.06 in PR #298 before starting that next queue item.'],
['Run real-PostgreSQL tests for all 56 merged finance tasks after F02.', 'Cover money above Number.MAX_SAFE_INTEGER, rollback at each write, competing receipts/wallet debit, callback retry/replay/late arrival, reversal overdraw and ledger reconciliation.', 'Verify snapshot replay, VAT version selection, half-up rounding, due-date overrides, reminder toggles/cancellation and correction links through their required callers.'])
finding('F15','P1','Complete CRM screens and correct list queries','confirmed',[A+'T-05.01.',A+'T-05.02.',A+'T-05.05.01'],[
('apps/web/src/pages/CrmProfileList.tsx','coming soon'),('apps/api/src/crm/crm.service.ts','(u.created_at, u.user_id) <')],
'The CRM list route renders a coming-soon placeholder despite completed list/filter tasks. The backend cursor predicate always uses descending comparison even when ascending order is requested. Filters also use status labels that need reconciliation with the actual profile lifecycle.',
['Build the required list/filter UI and complete profile detail/edit/verification-case actions against actual capability gates.', 'Make cursor encoding and comparison match every supported sort key and direction. Align verification filters with stored states.', 'Exercise identity-edit restrictions, business blockers for deletion, session expiry and audit diffs through HTTP.'],
['Paginate identical timestamps in both directions with no repeats or omissions; search/filter combinations remain stable.', 'A permitted CRM staff account can complete each required action; a finance-only account cannot.', 'Profile deletion with active financial/business records is blocked without losing history.'])
finding('F16','P1','Finish customer and staff ticket workflows','missing_ui',[A+'T-06.01.'],[
('apps/api/src/tickets/tickets.controller.ts','class TicketsController'),('apps/web/src/routeTree.gen.ts',"'/support'")],
'Ticket APIs exist, but the current route inventory has no ticket list/detail/create or staff ticket-management screens matching the completed tasks. A support/recovery page is not the required ticket workflow.',
['Add the required customer and staff ticket UI with attachments, related records, assignment, comments and status transitions.', 'Connect existing team/assignment configuration where required and verify that internal notes never appear in customer responses.'],
['Customer creates a ticket and attachment, staff assigns/replies internally and publicly, customer sees only public content, and reopen/resolve flows work.', 'Cross-profile access, unsupported transitions and unauthorized assignment fail.', 'Both locales, keyboard navigation and empty/error/loading states work.'])
finding('F17','P1','Complete deferred administration screens and required consumers','missing_ui',[A+'T-09.07.',A+'T-09.08.',A+'T-09.09.',A+'T-09.10.02',A+'T-09.10.03',A+'T-09.11.',A+'T-09.12.',A+'T-10.'],[
('apps/web/src/routes/admin/users.tsx','AdminDashboard'),('apps/api/src/admin/admin.service.ts','class AdminService'),('apps/worker/src/main.ts','breach')],
'Many merged PRs explicitly delivered API slices and deferred UI, then the loop marked the full task completed. Current admin/users points to AdminDashboard. Required screens remain for staff/audit, approvals, targets/teams, reconciliation/failed jobs/dead letters, green rules, AI configuration, catalogue/VAT/gift codes, contract templates and upload policies. Team assignment configuration also deferred its assignment engine.',
['Create one bounded repair per original task rather than one large admin rewrite; use the task register and deferral inventory for exact scope.', 'Connect the existing APIs to the required list/form/detail actions, step-up prompts and effective permissions. Finish automatic team assignment if required by that original task.', 'Leave actual AI document processing, new ordering/contract modules and other explicitly separate future task consumers in the skipped/unstarted backlog.'],
['For each repaired task, a staff user completes the exact epic UI flow with a real migrated API.', 'Test create/edit/activate/rollback or resolve/retry as applicable; validate failure, permissions, fa/en and RTL states.', 'Mark a parent task acceptance_verified only after every required slice is delivered.'])
finding('F18','P1','Test the actual production images and drain running work','confirmed',[I+'T-03.',I+'T-05.01.02',I+'T-04.01.06'],[
('Dockerfile.base','Build — compile the NestJS API'),('docker-compose.prod.yml','api:'),('Dockerfile.web','server.js'),('apps/worker/src/main.ts','let currentJob: Promise<void> | null = null')],
'The shared image packages API output but no worker output, and production compose defines no worker service. The production web entry point is the newer server.js while shutdown tests import server/index.js. Worker shutdown waits on currentJob, which is never assigned; interval work can still be running when resources close. Container dependency resolution also needs a real image boot test.',
['Package a deployable API/worker artifact with all workspace runtime dependencies and migration assets; add the worker to the intended deployment.', 'Choose one web server implementation, retain the earlier graceful shutdown behavior and point tests at the production entry point.', 'Track every in-flight worker task, stop leases/timers first, await completion up to a bounded deadline, then release pools.'],
['Build and boot web, API and worker images from a clean checkout with read-only filesystem and non-root user.', 'Readiness reflects required dependencies; an unavailable optional Redis service follows the documented fallback policy.', 'Send SIGTERM during an outbox dispatch and finance job; prove committed/retryable outcomes and no lost work.'])
finding('F19','P1','Make quality gates reflect the promised requirements','confirmed',[I+'T-01.03.',I+'T-01.04.',I+'T-05.03.',I+'T-07.03.'],[
('apps/api/vitest.config.ts','lines: 38'),('apps/api/vitest.config.ts',"'src/crm/**'"),('.size-limit.json','700 KB'),('.github/workflows/ci.yml','pnpm check:bundle')],
'The API coverage gate is 38% lines/30% branches and excludes CRM, while the epic requires 80/75 generally and 90/85 for critical domains unless an approved exception exists. The main web budget permits 700 KB gzip; measured main JS is 220.12 kB and includes auth, exceeding the specified 150 KB auth budget. Root lint/format commands have no substantive per-package tasks.',
['Restore meaningful changed-code and critical-domain coverage checks, or record an explicit approved exception with expiry. Do not raise coverage through implementation-mirroring tests.', 'Add actual lint/format, clean+upgrade migration and OpenAPI contract-drift gates. Audit PR affected-package filtering against shared dependency changes.', 'Measure the complete route payload including common chunks; split auth as needed. Resolve TanStack Start versus Vite SPA and skipLibCheck differences through an architecture/requirements decision.'],
['A deliberately failing critical-domain regression, contract drift and over-budget auth bundle each fail CI.', 'The entire real database suite and relevant browser flows run in CI, with no silent skips presented as passes.', 'Repeated queue/backlog checks validate full task payloads, not only keys.'])
finding('F20','P2','Verify localization, calendar behavior and accessibility','verification_gap',[U,I+'T-06.02.',I+'T-06.03.',A+'T-01.',A+'T-03.',A+'T-08.',A+'T-09.',N+'T-05.02.'],[
('packages/ui/src/components/base-ui/date-picker.tsx','locale={jalali ?'),('packages/ui/src/components/ui/calendar.tsx','from "react-day-picker"'),('apps/web/src/pages/DashboardLayout.tsx',"locale = 'fa'")],
'Foundational components exist, but accessibility and localized behavior are not certified by the current test run. React Doctor reported 237 diagnostics including 92 accessibility warnings; these require triage, not blanket fixes. The date picker formats selected text as Jalali while using the generic DayPicker calendar with a cast locale, so actual Jalali month/day behavior needs a focused verification. Some shell components default to Persian.',
['Triage the saved diagnostics, fixing confirmed keyboard, label, focus, error-state and interaction failures first.', 'Verify a true Jalali calendar grid/range selection, Gregorian mode, user timezone, Persian digits/IRR and language switching across shared components and implemented screens.', 'Unify actual locale context and add missing dictionaries for completed UI slices.'],
['Keyboard-only and screen-reader checks cover auth, profile, receipts, templates and admin configuration.', 'Known Nowruz/Esfand boundary dates and ranges display/select correctly in fa and en.', 'Automated accessibility checks plus manual RTL/focus review pass for the implemented task flows.'])
finding('F21','P2','Keep useful follow-up fixes and remove proven implementation drift','confirmed',[I+'T-03.01.',I+'T-03.03.03',W+'T-04.2.'],[
('apps/web/test/server.spec.ts',"server/index.js"),('Dockerfile.web','server.js')],
'Twenty-three task keys have multiple merged PRs. They are not twenty-three duplicate features to delete: five Docker tasks were rebuilt, fifteen wallet groups contain follow-up corrections, legal profile work is backend plus UI, one pair is bookkeeping, and the invoice snapshot was reverted/replaced.',
['Preserve merged financial corrections. Deduplicate task bookkeeping with provenance for every PR.', 'Consolidate the two web servers after behavior comparison; compare Docker requirements against the selected implementation.', 'Inspect open #304 before any new dispatch; do not merge or close it automatically as part of this audit.'],
['No active production path is tested through a different implementation.', 'Regression tests retain protections introduced by wallet follow-ups.', 'Task selection does not rebuild a merged task merely because its status was overwritten.'])
finding('F22','P1','Run acceptance closure for every recorded task','verification_gap',[I,A,B,W,N,U],[('kanban/task-queue.json','01-platform-infrastructure.md#T-01.01.01')],
'263 current task keys have merged PR evidence; another 59 current completion claims lack a direct mapped PR. A merge is not acceptance certification. This audit identifies confirmed defects and missing slices, but database, provider, browser, load and operational acceptance cannot all be proven by static source review.',
['Use task-review.json as the closure checklist. For every task, retain canonical requirements, current source evidence, required caller, tests and exact reviewed SHA.', 'Classify each as acceptance_verified, partial, deferred, blocked or retired. Preserve original completed/merged evidence separately.', 'Require end-to-end evidence for user workflows and actual restore/deployment records for operational tasks. Do not treat a document/script as a completed restore exercise.'],
['All 263 PR-backed tasks and 59 legacy claims receive a final disposition with evidence.', 'No partial parent or historical skip is used as completed input to the selector.', 'Resume new feature work only after P0/P1 repairs and domain acceptance checks pass; keep remaining approved deferrals visible.'])
finding('F23','P1','Align authentication rate limits with account and destination rules','confirmed',[A+'T-02.01.02',A+'T-02.04.01',A+'T-01.02.',I+'T-04.02.02'],[
('apps/api/src/auth/auth.service.ts',"rateLimitKey('login:account-ip', ip)"),('apps/api/src/rate-limit/rate-limit.guard.ts','rateLimitKey(config.namespace, ip)')],
'The login account-and-IP counter is keyed only by IP, and progressive delay starts after one prior attempt rather than the specified five failed attempts. The generic guard also keys only by IP. The required destination/account limits therefore need an explicit check at the service boundary, independent of broad IP protection.',
['Use normalized account-plus-IP failure counters for login and separate broad IP/device limits. Count failed attempts with the specified 15-minute window and threshold.', 'Verify per-destination registration, OTP resend/hour/day, challenge verification and password-reset quotas, including Redis-loss behavior.', 'Keep Retry-After and localized recovery information consistent through the global HTTP exception filter and all auth clients.'],
['Two legitimate accounts behind the same IP do not share the account-specific delay; broad abuse limits still apply.', 'The sixth failed attempt triggers the specified progressive policy, without permanent lockout.', 'Changing IP does not bypass destination/account quotas; Redis loss preserves the PostgreSQL-backed protection.'])
# Remove incidental selector mapping for F01; it is a protocol issue across the queue, not an infrastructure-task defect.
F[0]['task_keys']=[]
(OUT/'findings.json').write_text(json.dumps(F,indent=2,ensure_ascii=False)+'\n')

def link(path,line=None):
    return f'[{path}'+(f':{line}' if line else '')+f']({ROOT/path}'+(f':{line}' if line else '')+')'
def csvwrite(path,rows,fields):
    with open(path,'w') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)

# Historical skip evidence. These are assessments of existing pieces, never automatic completion.
E={
'T-05.01.01':('no_matching_artifact_found','deploy/pilot','No deployment playbook/script found; proxy configuration alone is insufficient.'),
'T-05.01.02':('partial','docker-compose.prod.yml','Compose exists; lacks worker and tested complete production wiring. F18.'),
'T-05.01.03':('needs_document_review','architecture.md','Deployment material exists; validate explicit single-server availability warning.'),
'T-05.02.01':('needs_document_review','architecture.md','Architecture material exists; verify complete commercial HA topology and failure domains.'),
'T-05.02.02':('no_matching_artifact_found','.github/workflows','Only CI workflow found, no rolling/blue-green deployment automation.'),
'T-05.02.03':('partial','apps/api/src/provider-config','Email provider circuit-breaker work exists; not proof of coverage for every external provider.'),
'T-05.02.04':('no_matching_artifact_found','apps/api/src','No complete per-capability maintenance-mode implementation identified.'),
'T-05.03.01':('existing_implementation_revalidate','.github/workflows/ci.yml','CI exists; repair acceptance gaps under F19 rather than recreate it.'),
'T-05.03.02':('partial','packages/db/src/test','Tests exist, but production clean+upgrade migration gate remains F02/F19.'),
'T-05.03.03':('partial','apps/api/package.json','OpenAPI generation exists; committed contract/client drift gate needs completion.'),
'T-05.03.04':('no_matching_artifact_found','.github/workflows/ci.yml','No full required scan gate in the current CI workflow.'),
'T-05.03.05':('later_merged_needs_fix','apps/api/vitest.config.ts','Later PR #121; current critical-domain thresholds are inadequate. F19.'),
'T-05.04.01':('no_matching_artifact_found','.github/workflows','No staging deployment gate workflow found.'),
'T-05.04.02':('no_matching_artifact_found','.github/workflows','No production canary/promotion workflow found.'),
'T-05.04.03':('no_matching_artifact_found','.github/workflows','No post-deploy smoke/SLO comparison workflow found.'),
'T-05.04.04':('partial','docs/operations/backup/config-restore-runbook.md','Config restore runbook exists; not all rollback scenarios.'),
'T-05.05.01':('no_matching_artifact_found','.github/workflows/ci.yml','Current CI has pull_request/push triggers, no nightly schedule.'),
'T-05.05.02':('no_matching_artifact_found','.github/workflows','No weekly load/performance workflow found.'),
'T-05.05.03':('operational_evidence_required','docs/operations/backup/config-restore-runbook.md','Runbooks are not evidence a quarterly exercise happened.'),
'T-05.05.04':('operational_evidence_required','docs','No execution evidence for access review/threat-model exercise; another machine was not inspected.'),
'T-06.01.01':('existing_implementation_revalidate','packages/shared/package.json','Shared package builds and its 620 tests passed.'),
'T-06.01.02':('existing_implementation_revalidate','packages/shared/src/validation/normalize-username.ts','Username normalization/validation exists; retain and test against full requirement.'),
'T-06.01.03':('existing_implementation_revalidate','apps/web/src/components/PasswordField.tsx','Password validation and strength UI exist; reconcile shared-helper location and policy.'),
'T-06.01.04':('existing_implementation_revalidate','packages/shared/src/errors/error-codes.ts','Stable errors exist; verify HTTP/client localization contracts.'),
'T-06.01.05':('partial','packages/shared/src','Pagination is implemented per feature; shared schema and all cursor semantics need review.'),
'T-06.02.01':('existing_implementation_revalidate','packages/i18n/src/index.ts','Both dictionaries exist; validate parity across completed features.'),
'T-06.02.02':('partial','packages/ui/src/components/base-ui/date-picker.tsx','Jalali display exists; actual calendar semantics require F20.'),
'T-06.02.03':('partial','apps/web/src/routes/_app/settings/timezone.tsx','Timezone preference exists; all consumers do not yet consistently apply it.'),
'T-06.02.04':('partial','apps/web/src/pages/DashboardLayout.tsx','RTL/locale pieces exist; complete context propagation and F20 checks.'),
'T-06.02.05':('partial','apps/web/src','Per-screen currency/number formatting exists; verify centralized exact IRR formatting.'),
'T-06.03.01':('existing_implementation_revalidate','packages/ui/package.json','UI package, shadcn and Base UI exist through later design work.'),
'T-06.03.02':('existing_implementation_revalidate','packages/ui/src/components','Themed component set exists; perform RTL acceptance checks.'),
'T-06.03.03':('acceptance_gap','packages/ui/src/components','WCAG acceptance is not established; triage React Doctor and run F20.'),
'T-06.03.04':('partial','packages/ui/src/components/base-ui/date-picker.tsx','DatePicker and range support exist; F20 must verify Jalali grid behavior.'),
'T-06.03.05':('existing_implementation_revalidate','apps/web/src/pages/AdminBrandingConfig.tsx','Admin branding configuration exists; verify theme propagation/contrast.'),
'T-06.03.06':('partial','packages/ui/src/components/ui/skeleton.tsx','Skeleton and per-screen states exist; verify required shared empty/error components.'),
'T-06.04.01':('no_matching_artifact_found','apps/web/src','No complete privacy-safe analytics abstraction identified; marketing notification consent is a different feature.'),
'T-07.01.01':('no_matching_artifact_found','package.json','Root setup:dev script is absent.'),
'T-07.01.02':('partial','apps/api/src/auth/otp.service.ts','Development OTP printing exists; validate bypass gating and production exclusion.'),
'T-07.01.03':('existing_implementation_revalidate','packages/db/package.json','Inspect existing database push scripts and development-only constraints before adding anything.'),
'T-07.01.04':('no_matching_artifact_found','apps/api/src/app.module.ts','No complete required environment-indicator middleware identified.'),
'T-07.02.01':('partial','packages/shared/src/config-cache/config-cache.ts','app_config and versioned feature configurations exist; no single fully certified store contract.'),
'T-07.02.02':('partial','packages/shared/src/admin','Typed per-feature validators exist; verify framework-wide version/activation rules.'),
'T-07.02.03':('partial','apps/api/src/provider-config','Provider rollback exists; verify required scope for general configuration rollback.'),
'T-07.02.04':('partial','apps/api/src/provider-config/provider-secrets.service.ts','Provider and AI secret encryption exist; verification provider handling needs F06.'),
'T-07.02.05':('partial','apps/api/src/provider-config','Provider lifecycle/test adapters exist; production delivery remains F09.'),
'T-07.03.01':('no_matching_artifact_found','package.json','Root lint delegates to empty per-package task set; no shared ESLint configuration found.'),
'T-07.03.02':('no_matching_artifact_found','package.json','Root format commands exist; no substantive shared Prettier task/config found.'),
'T-07.03.03':('no_matching_artifact_found','package.json','No Husky/lint-staged/commitlint setup found.'),
'T-07.03.04':('no_matching_artifact_found','README.md','No .editorconfig or .vscode workspace settings found.'),
'T-07.04.01':('partial','docs/operations/backup/config-restore-runbook.md','Some operational runbooks exist, not the complete incident runbook set.'),
'T-07.04.02':('existing_implementation_revalidate','docs/adr','Four ADR files exist; compare with the required initial decision list.'),
'T-07.04.03':('partial','README.md','Deployment instructions are distributed across files; complete/validate guide after F18.'),
'T-07.04.04':('no_matching_artifact_found','docs','No complete incident-response plan identified.'),
'T-07.05.01':('acceptance_gap','apps/api/src','Some provider flows separate calls from transactions; no repository-wide enforcement proof.'),
'T-07.05.02':('partial','apps/api/package.json','OpenAPI generation exists; generated TypeScript client plus CI drift check not established.'),
'T-07.05.03':('acceptance_gap','apps/api/src/app.module.ts','Verify real HTTP health exclusions and rate-limit/auth behavior; no completed end-to-end proof.'),
'T-07.05.04':('needs_document_review','architecture.md','Architecture exists; explicit module-extraction criteria/gates still need requirement comparison.')}
assert len(E)==58
SKIPROWS=[]
for k in SKIPS:
 status,path,note=E[k.split('#')[1]]
 SKIPROWS.append(dict(task_key=k,title=QM[k]['title'],current_assessment=status,evidence=path,note=note,skip_commit='c94278fd489c2a655eb6a60c5860c1ce0d4c18bd',direct_merged_prs=[p['number'] for p in PRS if k in (p['audit_keys'] or [])]))
(OUT/'skipped-tasks.json').write_text(json.dumps(SKIPROWS,indent=2,ensure_ascii=False)+'\n')
csvwrite(OUT/'skipped-tasks.csv',[{**r,'direct_merged_prs':','.join(map(str,r['direct_merged_prs']))} for r in SKIPROWS],list(SKIPROWS[0]))

# Exhaustive current-task register, retaining exact requirement extracts and provenance.
prkeys={k for p in PRS for k in (p['audit_keys'] or []) if k in QM}
claimed={k for k in STATE['build_completed_tasks'] if k in QM}
ALL=prkeys|claimed
MATRIX=[]
for q in Q:
 k=q['key']
 if k not in ALL:continue
 prs=[p for p in PRS if k in (p['audit_keys'] or [])]
 changed=sorted({f for p in prs for f in FILES.get(str(p['number']),[]) if not f.startswith('kanban/') and f!='AGENTS.md'})
 direct=[f['id'] for f in F if k in f['task_keys'] and f['id'] not in ['F02','F14','F19','F20','F22']]
 closure=[f['id'] for f in F if k in f['task_keys'] and f['id'] in ['F02','F14','F19','F20','F22']]
 if k in SKIPSET: assessment=next(r['current_assessment'] for r in SKIPROWS if r['task_key']==k)
 elif not prs:assessment='legacy_claim_requires_acceptance_evidence'
 elif direct:assessment='affected_by_identified_gap'
 else:assessment='merged_source_evidence_acceptance_retest_required'
 bound=requirement_record(q, ROOT)
 context=bound['story_context']
 MATRIX.append(dict(task_key=k,title=q['title'],requirement_file='kanban/epics/'+q['fname'],requirement_line=bound['requirement_line'],story_context=context,requirement_extract=bound['requirement_extract'],assessment=assessment,historically_skipped=k in SKIPSET,claimed_complete_in_state=k in claimed,merged_prs=[p['number'] for p in prs],merged_pr_urls=[p['html_url'] for p in prs],pr_changed_files_still_present=[f for f in changed if (ROOT/f).is_file()],historical_files_no_longer_present=[f for f in changed if not (ROOT/f).is_file()],repair_groups=direct,acceptance_groups=closure,review_limit='Static requirements/source/provenance review and available checks; not individually certified end-to-end. See fix-plan acceptance checks.'))
assert len(MATRIX)==322
(OUT/'task-review.json').write_text(json.dumps(dict(head=HEAD,scope='All 263 current PR-backed task keys plus 59 other current state completion claims',tasks=MATRIX),indent=2,ensure_ascii=False)+'\n')
csvwrite(OUT/'task-review.csv',[dict(task_key=r['task_key'],title=r['title'],assessment=r['assessment'],merged_prs=','.join(map(str,r['merged_prs'])),historically_skipped=r['historically_skipped'],repair_groups=','.join(r['repair_groups']),acceptance_groups=','.join(r['acceptance_groups']),requirement=r['requirement_file']+':'+str(r['requirement_line']),current_source_files=';'.join(r['pr_changed_files_still_present'])) for r in MATRIX],['task_key','title','assessment','merged_prs','historically_skipped','repair_groups','acceptance_groups','requirement','current_source_files'])
# Preserve unchecked/deferred PR claims as historical evidence; later source, not the old claim, decides closure.
DEF=[]
for p in PRS:
 excerpt=[l for l in (p['body'] or '').splitlines() if re.search(r'\[ \]|\[~\]|deferred|follow-up slice|not.*(?:built|included|implemented)',l,re.I)]
 if excerpt:DEF.append(dict(pr=p['number'],url=p['html_url'],task_keys=p['audit_keys'],historical_deferrals=excerpt,status='Historical statement; may have been closed by a later PR. Compare task register and current source.'))
(OUT/'pr-deferrals.json').write_text(json.dumps(DEF,indent=2,ensure_ascii=False)+'\n')
# Positional holes are separate from deliberate skips.
last=max(i for i,r in enumerate(Q) if r['key'] in prkeys)
GAPS=[dict(queue_position=i+1,task_key=r['key'],title=r['title'],requirement_file='kanban/epics/'+r['fname'],requirement_line=r['source_line'],classification='unrecorded_before_furthest_merged_task' if i<=last else 'later_unstarted_backlog') for i,r in enumerate(Q) if r['key'] not in ALL]
csvwrite(OUT/'unstarted-backlog.csv',GAPS,list(GAPS[0]))
HOLES=[r for r in GAPS if r['queue_position']<=last+1]
csvwrite(OUT/'queue-gaps.csv',HOLES,list(HOLES[0]))
(OUT/'queue-gaps.json').write_text(json.dumps(HOLES,indent=2,ensure_ascii=False)+'\n')
# Human-readable task register by epic.
pages=['# Task review register\n',f'Baseline `{HEAD}`. 322 current recorded tasks, including 263 with merged PRs. Every row links back to its requirement. These are review dispositions, not certification that all acceptance criteria passed. Full requirement text, story context and source-file provenance are in [task-review.json](task-review.json).\n']
for epic in dict.fromkeys(QM[r['task_key']]['fname'] for r in MATRIX):
 pages += ['## '+epic+'\n','| Task | Requirement | Merged PRs | Assessment | Repair / acceptance groups |\n|---|---|---|---|---|']
 for r in MATRIX:
  if not r['task_key'].startswith(epic+'#'):continue
  label=r['title'].replace('|','/').replace('\n',' ')
  prs=', '.join(f'[{n}](https://github.com/barghsadev/barghsa-core/pull/{n})' for n in r['merged_prs']) or 'No directly mapped PR'
  pages.append(f"| {r['task_key']} | [{label}]({ROOT/r['requirement_file']}:{r['requirement_line']}) | {prs} | {r['assessment']} | {', '.join(r['repair_groups']+r['acceptance_groups'])} |")
 pages.append('')
(OUT/'task-review.md').write_text('\n'.join(pages)+'\n')
# Repair plan with actions and concrete exit criteria.
plan=['# Repair plan\n',f'Baseline `{HEAD}`, reviewed 2026-09-05. This is a plan only. No implementation, queue, loop state, PR, or scheduler changes were made.\n',
'Fixes are grouped for planning. Split large groups into reviewable PRs tied to the qualified original task keys; F17 especially is not one implementation task. F02 and F22 are cross-cutting acceptance gates, not claims that every associated task has a separately proven defect.\n',
'## Execution order\n',
'1. F01: reconcile task records and prevent another wrong dispatch. Keep the feature loop paused through repair.\n2. F02-F06: production schema, sessions/CSRF, staff permissions, registration/OTP and verification.\n3. F07-F13, F18 and F23: profile/agent correctness, notifications, payment rules, dual approval and deployable/draining workers.\n4. F14-F17 and F20: finance regression closure, CRM/tickets/admin missing slices, localized and accessible UI.\n5. F19/F21/F22: enforce acceptance gates, consolidate proven duplicates, and sign off every recorded task. Establish relevant tests alongside each earlier repair.\n6. Reclassify historical skips and queue gaps. Build only the unmet remainder, in dependency order. Some skipped infrastructure is prerequisite repair work, especially migrations, CI and production worker wiring; do that when its dependent repair needs it.\n',
'## Exit rule before resuming feature work\n',
'Every P0/P1 finding is closed with evidence or explicitly dispositioned; all 263 PR-backed tasks and 59 legacy claims have truthful statuses; clean install, upgrade and real database/browser tests pass; no required transport silently skips delivery; all privileged/financial paths have real HTTP negative tests; remote state survives restart and cannot silently lose completed keys. Operational claims need actual execution evidence. Unknowns remain blocked/partial rather than being marked done.\n']
for f in F:
 plan+=['## '+f['id']+' '+f['title']+'\n',f"Priority {f['priority']}. Finding type: {f['kind']}.\n",f['problem']+'\n','Evidence: '+', '.join(link(e['path'],e['line']) for e in f['evidence'])+'.\n','Actions:\n']
 plan += ['- '+x for x in f['work']]
 plan += ['\nAcceptance checks:\n']+['- '+x for x in f['acceptance_checks']]
 plan += ['\nTask scope is enumerated in [findings.json](findings.json) and the per-task register.\n']
(OUT/'fix-plan.md').write_text('\n'.join(plan)+'\n')
# Full skipped register and complete positional-gap list.
sk=['# Skipped and unstarted tasks\n','## History-confirmed skips\n','Commit [c94278f](https://github.com/barghsadev/barghsa-core/commit/c94278fd489c2a655eb6a60c5860c1ce0d4c18bd) explicitly skipped these 58 infrastructure tasks and added them to build_completed_tasks. One later has a task-specific merged PR, #121. The other 57 have no directly mapped task PR, but several have substantial code from later work. Do not rebuild them from scratch.\n',
'“No matching artifact found” is a repository-search result, not proof that work never happened on another machine. “Existing implementation” still requires acceptance checks. The user asked not to inspect the other machine.\n',
'| Qualified task key | Requirement | Current assessment | Evidence and next action |\n|---|---|---|---|']
for r in SKIPROWS:
 sk.append(f"| {r['task_key']} | {r['title'].replace('|','/')} | {r['current_assessment']} | {link(r['evidence'])}: {r['note']} |")
sk += ['\n## Other completion claims needing reconciliation\n',
'- `01-platform-infrastructure.md#T-02.03.03`: clean/upgrade migration validation. Claimed in state without a directly mapped task PR; F02/F19 must establish acceptance.\n- `01-platform-infrastructure.md#T-02.03.04`: expand/migrate/contract documentation and PR checklist. Claimed in state without a directly mapped task PR; compare existing material with the full requirement.\n- Obsolete keys: `01-platform-infrastructure.md#T-05.04.05` and `02-auth-users-admin.md#T-05.06.01`. Preserve provenance and explicitly retire/map them. They are not current queue tasks.\n',
'## Partial merged tasks\n',
'Incomplete slices of merged tasks belong in the repair plan before new feature work. Confirmed examples are ownership-transfer completion, CRM list/filter UI, ticket UI, several administration screens, OTP/provider delivery and template test-send. See F05-F17 and [pr-deferrals.json](pr-deferrals.json). Historical deferrals closed by later PRs are not automatically reopened: legal form UI, invoice receipt rejection and invoice dual approval all received later work.\n',
'## Queue gaps before the furthest merged task\n',
f'Today\'s queue has {len(HOLES)} keys without a completion claim or directly mapped merged PR before position {last+1}, `{Q[last]["key"]}`. These are positional gaps. They are not proof of deliberate skip decisions; some requirements may have been added later, and incidental implementation must still be checked.\n',
'| Epic | Unrecorded earlier tasks |\n|---|---|']
for e,n in collections.Counter(r['task_key'].split('#')[0] for r in HOLES).items():sk.append(f'| {e} | {n} |')
sk += ['\nThe full list, including all task names and requirement locations, is [queue-gaps.csv](queue-gaps.csv). There are also 296 later unstarted tasks beyond that position; [unstarted-backlog.csv](unstarted-backlog.csv) contains all 1,033 unrecorded keys. Neither file is a ready-to-execute build queue. Reconcile incidental coverage, dependencies and newly added requirements first.\n',
'After repairs, first reconsider the 58 historical skips and the six unrecorded auth tasks, then core business and remaining finance/notification requirements. Schedule security/testing prerequisites alongside the features they protect, not after every product feature. The existing queue order alone is not a dependency graph.\n']
(OUT/'skipped-tasks.md').write_text('\n'.join(sk)+'\n')
# Copy earlier duplicate/reconciliation evidence and test logs for a self-contained packet.
shutil.copy('/tmp/barghsa-kanban-audit/audit.md',OUT/'loop-and-duplicates-audit.md')
shutil.copy('/tmp/barghsa-kanban-audit/completed-task-register.json',OUT/'merged-task-register.json')
shutil.copy('/tmp/barghsa-kanban-audit/merged-pr-inventory.csv',OUT/'merged-pr-inventory.csv')
for p in Path('/tmp').glob('barghsa-audit-*.log'):shutil.copy(p,OUT/p.name)
summary=f'''# Implemented-task audit

The recorded completion list is not a reliable statement that the built features are finished. The review found working components alongside critical wiring failures, incomplete user flows, and skipped tasks recorded as done.

Baseline: `{HEAD}`. Latest included merge is PR #303. All 301 merged PR records were reconciled. Open #304 is excluded from completion. The other machine and its cron were not inspected.

## Scope and limits

- 263 distinct current tasks have merged PR evidence: infrastructure 72, auth/admin 99, core business 4, finance 56, notifications 29, UI foundations 3.
- 59 additional current completion claims lack a directly mapped PR. Combined, 322 current task keys are in the review register. Two obsolete keys are tracked separately.
- Requirements were compared with current source paths, route/worker wiring and PR scope. The register retains task requirements, parent context, PRs and current source files. Review depth is strongest on shared runtime boundaries and high-risk workflows. It does not claim a line-by-line proof of every implementation or a passing end-to-end test for every row.
- No task is certified solely because its PR merged, its source exists, or type checking passed. Remaining acceptance work is explicit in F22.

## Most urgent findings

1. The production migration journal omits foundational and many later migrations. A clean production database is not established by the current journal.
2. Session guards expect parsed cookies that bootstrap does not install. A real HTTP reproduction of the guard ordering accepted a POST without a CSRF token.
3. Staff creation sets administrator authority for all staff, and its role-ID validator disagrees with the predefined role IDs.
4. OTP generation is not connected to external delivery. Registration still uses a placeholder TOS version. API-mode profile verification can mark a profile verified without calling a provider.
5. The worker registers only in-app notification transport. Retry deduplication, quiet-hour scheduling and legacy/new inbox integration have gaps.
6. Overdue-payment rules conflict with the state machine. Wallet and invoice bank-receipt paths apply different dual-approval controls.
7. Several “completed” tasks are API-only slices with required UI still absent. CRM shows a placeholder; ownership transfer has initiation but no completion.
8. Production compose omits the worker; the Docker image and shutdown tests do not cover the actual production paths consistently.

The [repair plan](fix-plan.md) contains 23 groups with evidence, concrete actions, task scope and acceptance checks. The groups include confirmed defects, incomplete required slices, requirements conflicts and explicit verification work. They are not 23 independently reproduced runtime bugs.

## Skipped work

There are 58 history-confirmed skips. One later has a directly mapped merged PR, but still needs acceptance repair. Many others have partial implementation from later features. [The skipped-task register](skipped-tasks.md) lists all 58 and the existing pieces to preserve.

There are also 737 unrecorded keys before the furthest merged task in today's queue, plus 296 later unstarted keys. These are listed separately to avoid confusing queue position with an intentional historical skip. Six earlier auth keys concern closure/export, staff/customer operating context, and the stricter staff-profile exception. F04 repairs permissions in already-built staff flows; it does not silently mark those separate context tasks done.

## Duplicate work

23 task keys have multiple merged PRs. Five Docker tasks were rebuilt after their completion entries disappeared. Fifteen wallet groups contain useful follow-up fixes. The remaining three groups are complementary legal-profile slices, bookkeeping, and a reverted/replaced invoice snapshot. Preserve the useful corrections. The concrete cleanup is the competing web server entry points plus task/provenance reconciliation. See [loop and duplicate evidence](loop-and-duplicates-audit.md).

## Verification performed

| Check | Result |
|---|---|
| Backlog validation | 1,355 tasks and 116 traceability entries pass the current checker |
| Type checking | 11/11 tasks pass; one cached |
| Build | 7/7 tasks pass; four cached |
| Shared tests | 620 tests in 44 files pass |
| Web tests | 107 tests in 15 files pass |
| Full root test suite | Blocked at PostgreSQL Testcontainers setup: no working container engine found; full API/DB/worker suite is not reported as passed |
| Bundle check | Passes configured limits; main entry 220.12 kB gzip exceeds the separate 150 KB auth requirement |
| Suppressed TypeScript errors | Pass |
| Loop protocol tests | 25 pass with BARGHSA_LOOP_BASE set to this checkout; default path caused two file-not-found errors before rerun |
| HTTP guard-order reproduction | Actual compiled CSRF guard plus route session guard accepts missing-CSRF POST, returns 201; Cookie header remains unparsed |
| React Doctor | 173 files scanned, score 45/100, 237 diagnostics; triage required, not 237 confirmed defects |

No product implementation, kanban queue/state, GitHub PR or scheduler changes were made. The build regenerated the tracked route tree; that audit-generated change was restored exactly to HEAD. All audit files are outside the repository.

## Files

- [Repair plan](fix-plan.md)
- [Readable task-by-task review](task-review.md)
- [Task register CSV](task-review.csv) and [JSON with requirements and source evidence](task-review.json)
- [History-confirmed skipped tasks](skipped-tasks.md), [CSV](skipped-tasks.csv), [JSON](skipped-tasks.json)
- [All 737 earlier queue gaps](queue-gaps.csv)
- [All 1,033 unrecorded current tasks](unstarted-backlog.csv)
- [Historical PR deferrals](pr-deferrals.json)
- [All merged PR evidence](merged-pr-evidence.json)
'''
(OUT/'README.md').write_text(summary)
print(json.dumps({'findings':len(F),'reviewed_current_keys':len(MATRIX),'merged_keys':len(prkeys),'historical_skips':len(SKIPROWS),'earlier_queue_gaps':len(HOLES),'unrecorded_tasks':len(GAPS),'head':HEAD},indent=2))
