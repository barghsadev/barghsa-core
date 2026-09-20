# Kanban loop audit

Read-only repository audit, 2026-09-05. All 301 merged PR records retrieved from GitHub across four closed-PR API pages. Latest merge: #303. Open PR #304 was inspected separately and is not counted as merged. Repository and scheduler unchanged.

## Findings

### 1. Completion state was actually overwritten by product PRs

PR #92, commit 6c202b8a6ffd46d6e70acef10943ab66c7c043fa, removed all 13 infrastructure completion keys T-03.01.01 through T-03.03.04. PRs #94–98 then rebuilt the five Docker tasks previously delivered in #30–34. This is direct historical evidence, not a hypothesis about model task-ID confusion.

The state file is still tracked in git. Current instructions prohibit it in product PRs, and current handoff validation enforces that, but these protections were added after the historical damage. State is still stored inside the mutable builder checkout. Builders edit the whole file; the supervisor does not assert that the completion set is unchanged across a build. save_json writes directly rather than using an atomic replacement. These remain ways to lose or corrupt scheduling data.

[PR #92](https://github.com/barghsadev/barghsa-core/pull/92), [PR #94](https://github.com/barghsadev/barghsa-core/pull/94).

### 2. The current selector trusts stale state

kanban/scripts/loop-runner.py:141 selects the first queue key absent from build_completed_tasks. It does not reconcile merged PRs, inspect existing implementation, or discover an already-open PR before dispatch.

The inspected state is idle, last_updated 2026-09-01T21:38:11Z, and has 330 entries representing 308 distinct keys. GitHub merges continue through September 3. Sixteen merged task keys are missing. Calling the selector without running a tick returns 04-invoices-wallet-contracts.md#T-04.2.02.04, already merged in #267, #278, #286, #301. Open #304 uses that same task branch, so an idle build must first reconcile that active work.

The user confirmed that the cron and build process ran on another machine and requested that its location be ignored. The local snapshot is therefore not proof of the other machine's live state. It does demonstrate that status was not synchronized to this checkout. The user also reported that the orchestrator removes entries and does not commit/push status. Historical PR #92 confirms entry loss. The current protocol explicitly tells Cursor to keep runtime state uncommitted, and the supervisor contains no status commit/push operation. This is a durability gap in the protocol itself: another checkout cannot recover unpushed progress from Git.

### 3. Skipped tasks were marked completed

Commit c94278fd489c2a655eb6a60c5860c1ce0d4c18bd is explicitly titled "skip 58 deployment/DX tasks to E-07" and adds 58 keys to build_completed_tasks. One later has a matching PR, coverage enforcement #121. The other 57 still have no explicitly mapped task PR. Two migration tasks add two more current keys without a matching PR, giving 59 current legacy claims requiring audit. Parts may have been built through other work; absence of a task-specific PR is not proof of absent code.

Two stored keys do not exist in the current 1,355-task queue: 01-platform-infrastructure.md#T-05.04.05 and 02-auth-users-admin.md#T-05.06.01. These need explicit retirement/mapping, not silent treatment as completed current tasks.

### 4. Queue validation does not validate the task payload

build_backlog.py:295 compares only the multiset of keys and the row count. It ignores fname, id, title, complexity, source_line, and ordering. I changed the first row to the second task ID/title in a temporary queue while preserving its key; --check still returned 0. The builder and reviewer extract context using fname/id but approval binds to key, so this can certify the wrong task under the right-looking key. The actual current queue payload does match canonical data; this is a demonstrated guard gap, not observed current payload corruption.

### 5. Resume and handoff failures do not fail closed

select_or_resume_task at line 649 resumes any current_task_key, even with status idle and even if that key is already completed. A read-only reproduction resumed the first completed infrastructure task from such a state.

handle_cursor at line 699 records an invalid handoff as last_error but leaves the builder-supplied status and identity in place. On the next review tick, expected_task is reconstructed from that same state, rather than an immutable supervisor-owned assignment. A builder selecting another valid task/branch can therefore outlive the original mismatch check. The original assignment needs to remain durable until completion or explicit recovery.

## Completion reconciliation

301 merged PRs map to 263 distinct current task keys. This is a record of merged task work, not an assertion that every historical PR satisfied every acceptance criterion: older PRs explicitly describe partial slices, and some leave UI or integration work outstanding. The register preserves this distinction.

- 16 merged task keys absent from state.
- 22 redundant entries already in state.
- 59 current legacy completion claims without an explicitly mapped task PR.
- 2 obsolete state keys.

A blind union would produce 324 distinct stored keys, but would retain the 59 unverified claims and two obsolete keys. Replacing the live list with the 263 PR-backed keys would also be unsafe without classifying the deferred tasks and reconciling open #304. Use the supplied register to migrate these categories deliberately.

### Missing merged keys

| Task key | Merged PRs |
|---|---|
| 04-invoices-wallet-contracts.md#T-04.2.02.04 | [#267](https://github.com/barghsadev/barghsa-core/pull/267), [#278](https://github.com/barghsadev/barghsa-core/pull/278), [#286](https://github.com/barghsadev/barghsa-core/pull/286), [#301](https://github.com/barghsadev/barghsa-core/pull/301) |
| 04-invoices-wallet-contracts.md#T-04.2.02.05 | [#268](https://github.com/barghsadev/barghsa-core/pull/268), [#279](https://github.com/barghsadev/barghsa-core/pull/279), [#287](https://github.com/barghsadev/barghsa-core/pull/287), [#302](https://github.com/barghsadev/barghsa-core/pull/302) |
| 04-invoices-wallet-contracts.md#T-04.2.02.06 | [#269](https://github.com/barghsadev/barghsa-core/pull/269), [#280](https://github.com/barghsadev/barghsa-core/pull/280), [#288](https://github.com/barghsadev/barghsa-core/pull/288), [#303](https://github.com/barghsadev/barghsa-core/pull/303) |
| 04-invoices-wallet-contracts.md#T-04.2.02.07 | [#270](https://github.com/barghsadev/barghsa-core/pull/270), [#281](https://github.com/barghsadev/barghsa-core/pull/281), [#289](https://github.com/barghsadev/barghsa-core/pull/289) |
| 04-invoices-wallet-contracts.md#T-04.2.03.01 | [#271](https://github.com/barghsadev/barghsa-core/pull/271), [#290](https://github.com/barghsadev/barghsa-core/pull/290) |
| 04-invoices-wallet-contracts.md#T-04.2.03.02 | [#272](https://github.com/barghsadev/barghsa-core/pull/272), [#282](https://github.com/barghsadev/barghsa-core/pull/282), [#291](https://github.com/barghsadev/barghsa-core/pull/291) |
| 04-invoices-wallet-contracts.md#T-04.2.03.03 | [#273](https://github.com/barghsadev/barghsa-core/pull/273), [#283](https://github.com/barghsadev/barghsa-core/pull/283), [#292](https://github.com/barghsadev/barghsa-core/pull/292) |
| 04-invoices-wallet-contracts.md#T-04.2.03.04 | [#274](https://github.com/barghsadev/barghsa-core/pull/274), [#284](https://github.com/barghsadev/barghsa-core/pull/284), [#293](https://github.com/barghsadev/barghsa-core/pull/293) |
| 04-invoices-wallet-contracts.md#T-04.2.04.01 | [#275](https://github.com/barghsadev/barghsa-core/pull/275), [#285](https://github.com/barghsadev/barghsa-core/pull/285) |
| 04-invoices-wallet-contracts.md#T-04.2.04.02 | [#276](https://github.com/barghsadev/barghsa-core/pull/276), [#294](https://github.com/barghsadev/barghsa-core/pull/294) |
| 04-invoices-wallet-contracts.md#T-04.2.04.03 | [#277](https://github.com/barghsadev/barghsa-core/pull/277), [#295](https://github.com/barghsadev/barghsa-core/pull/295) |
| 04-invoices-wallet-contracts.md#T-04.3.01.01 | [#296](https://github.com/barghsadev/barghsa-core/pull/296) |
| 04-invoices-wallet-contracts.md#T-04.3.01.02 | [#297](https://github.com/barghsadev/barghsa-core/pull/297) |
| 04-invoices-wallet-contracts.md#T-04.3.01.03 | [#298](https://github.com/barghsadev/barghsa-core/pull/298) |
| 04-invoices-wallet-contracts.md#T-04.3.01.04 | [#299](https://github.com/barghsadev/barghsa-core/pull/299) |
| 04-invoices-wallet-contracts.md#T-04.3.01.05 | [#300](https://github.com/barghsadev/barghsa-core/pull/300) |

If preserving legacy exclusions while adding all 16 missing keys, the next unrecorded queue task becomes T-04.3.01.06, overpayment wallet credit. PR #298 already describes a distinct WalletService.credit idempotency key, so inspect existing coverage before treating that as fresh implementation. This demonstrates why multi-task coverage must be recorded explicitly.

## Repeated task work

23 task keys have more than one associated merged PR. Five infrastructure Docker tasks and 15 wallet tasks account for 20 groups of repeated implementation/follow-up work. Three other groups are a planned backend/frontend split, a bookkeeping PR, and a reverted/replaced implementation. Repeated keys alone do not mean duplicate runtime side effects.

| Task key | PRs | Classification |
|---|---|---|
| 01-platform-infrastructure.md#T-03.01.01 | [#30](https://github.com/barghsadev/barghsa-core/pull/30), [#94](https://github.com/barghsadev/barghsa-core/pull/94) | Docker task rebuilt after completion entries were lost |
| 01-platform-infrastructure.md#T-03.01.02 | [#31](https://github.com/barghsadev/barghsa-core/pull/31), [#95](https://github.com/barghsadev/barghsa-core/pull/95) | Docker task rebuilt after completion entries were lost |
| 01-platform-infrastructure.md#T-03.01.03 | [#32](https://github.com/barghsadev/barghsa-core/pull/32), [#96](https://github.com/barghsadev/barghsa-core/pull/96) | Docker task rebuilt after completion entries were lost |
| 01-platform-infrastructure.md#T-03.01.04 | [#33](https://github.com/barghsadev/barghsa-core/pull/33), [#97](https://github.com/barghsadev/barghsa-core/pull/97) | Docker task rebuilt after completion entries were lost |
| 01-platform-infrastructure.md#T-03.01.05 | [#34](https://github.com/barghsadev/barghsa-core/pull/34), [#98](https://github.com/barghsadev/barghsa-core/pull/98) | Docker task rebuilt after completion entries were lost |
| 02-auth-users-admin.md#T-03.02.03 | [#106](https://github.com/barghsadev/barghsa-core/pull/106), [#108](https://github.com/barghsadev/barghsa-core/pull/108) | Backend #106 and frontend #108 are complementary slices |
| 02-auth-users-admin.md#T-09.09.02 | [#201](https://github.com/barghsadev/barghsa-core/pull/201), [#202](https://github.com/barghsadev/barghsa-core/pull/202) | #202 is state bookkeeping only; #201 is implementation |
| 04-invoices-wallet-contracts.md#T-04.1.02.08 | [#231](https://github.com/barghsadev/barghsa-core/pull/231), [#232](https://github.com/barghsadev/barghsa-core/pull/232) | #231 was reverted by 812f396; #232 replaces it |
| 04-invoices-wallet-contracts.md#T-04.2.01.02 | [#149](https://github.com/barghsadev/barghsa-core/pull/149), [#251](https://github.com/barghsadev/barghsa-core/pull/251), [#260](https://github.com/barghsadev/barghsa-core/pull/260) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.01.03 | [#252](https://github.com/barghsadev/barghsa-core/pull/252), [#254](https://github.com/barghsadev/barghsa-core/pull/254), [#261](https://github.com/barghsadev/barghsa-core/pull/261) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.01.04 | [#253](https://github.com/barghsadev/barghsa-core/pull/253), [#262](https://github.com/barghsadev/barghsa-core/pull/262) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.01.05 | [#255](https://github.com/barghsadev/barghsa-core/pull/255), [#263](https://github.com/barghsadev/barghsa-core/pull/263) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.02.04 | [#267](https://github.com/barghsadev/barghsa-core/pull/267), [#278](https://github.com/barghsadev/barghsa-core/pull/278), [#286](https://github.com/barghsadev/barghsa-core/pull/286), [#301](https://github.com/barghsadev/barghsa-core/pull/301) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.02.05 | [#268](https://github.com/barghsadev/barghsa-core/pull/268), [#279](https://github.com/barghsadev/barghsa-core/pull/279), [#287](https://github.com/barghsadev/barghsa-core/pull/287), [#302](https://github.com/barghsadev/barghsa-core/pull/302) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.02.06 | [#269](https://github.com/barghsadev/barghsa-core/pull/269), [#280](https://github.com/barghsadev/barghsa-core/pull/280), [#288](https://github.com/barghsadev/barghsa-core/pull/288), [#303](https://github.com/barghsadev/barghsa-core/pull/303) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.02.07 | [#270](https://github.com/barghsadev/barghsa-core/pull/270), [#281](https://github.com/barghsadev/barghsa-core/pull/281), [#289](https://github.com/barghsadev/barghsa-core/pull/289) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.03.01 | [#271](https://github.com/barghsadev/barghsa-core/pull/271), [#290](https://github.com/barghsadev/barghsa-core/pull/290) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.03.02 | [#272](https://github.com/barghsadev/barghsa-core/pull/272), [#282](https://github.com/barghsadev/barghsa-core/pull/282), [#291](https://github.com/barghsadev/barghsa-core/pull/291) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.03.03 | [#273](https://github.com/barghsadev/barghsa-core/pull/273), [#283](https://github.com/barghsadev/barghsa-core/pull/283), [#292](https://github.com/barghsadev/barghsa-core/pull/292) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.03.04 | [#274](https://github.com/barghsadev/barghsa-core/pull/274), [#284](https://github.com/barghsadev/barghsa-core/pull/284), [#293](https://github.com/barghsadev/barghsa-core/pull/293) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.04.01 | [#275](https://github.com/barghsadev/barghsa-core/pull/275), [#285](https://github.com/barghsadev/barghsa-core/pull/285) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.04.02 | [#276](https://github.com/barghsadev/barghsa-core/pull/276), [#294](https://github.com/barghsadev/barghsa-core/pull/294) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |
| 04-invoices-wallet-contracts.md#T-04.2.04.03 | [#277](https://github.com/barghsadev/barghsa-core/pull/277), [#295](https://github.com/barghsadev/barghsa-core/pull/295) | Wallet foundation / follow-up fixes and repeated task dispatch; retain fixes, record coverage once |

### Concrete code cleanup required

PR #94 introduced apps/web/server.js and switched Dockerfile.web to it, while apps/web/server/index.js remained. apps/web/test/server.spec.ts:2 still imports the old server. The old server contains connection tracking and SIGTERM/SIGINT shutdown handling; the Docker runtime server does not. Consolidate onto one tested production entry point and restore graceful draining. This is a current regression from the duplicate build, not simply duplicate files.

Wallet follow-ups contain real fixes. For example, #261 restored posted_balance >= 0 after #256 removed that credit precondition; #254 rejects mismatched idempotency commands; #279 fixes lock ordering; #294 strengthens chargeback payload binding. Reverting these would remove useful corrections. Preserve them and test the final combined financial behavior. This audit did not run the full financial suite or claim every remaining wallet path is defect-free.

### Recommended repair order

1. Reconcile open #304 and merged history before starting another task. The former scheduler machine is outside this audit, as requested.
2. Keep durable task assignments/completion events outside builder branches, under a single supervisor writer. Use atomic writes and the shared lock for every state writer. Persist verified status by committing and pushing to a dedicated state branch or separate state repository, then verify the remote commit. Keep this independent of product PRs. Preserve pending synchronization on a push failure rather than silently continuing from unsynchronized state.
3. Reconcile GitHub merges into a task-to-PR ledger; keep deferred, partially built, completed, and retired identities separate. Preserve explicit multi-task coverage and regressions as linked follow-up work.
4. Enforce full canonical queue payloads and a validated schedule/dependency policy. Do not let the builder redefine the selected task.
5. Reject inconsistent resume states and block invalid handoffs; retain the originally selected task across ticks. Check that builder handoffs cannot drop completion records.
6. Consolidate the web server and test the actual container entry point. Retain wallet repairs; audit unresolved acceptance criteria separately.

## Validation performed

- Downloaded and classified every merged PR record, including title, body, branch, merge date, and merge SHA. Full inventory included as CSV.
- Compared current state and queue and examined historical state diffs.
- Current backlog check passed: 1,355 tasks, 116 traceability entries.
- Actual queue payload matches canonical parsed task data.
- Reproduced stale-state selection and completed-task resume without launching any worker.
- Reproduced acceptance of a mismatched task payload in a temporary queue.
- Inspected relevant merged diffs, current Docker entry point, old web server, and test import.
- Git working tree remained clean. No repository files, PRs, scheduler settings, or live runtime state were changed.

## Files

- completed-task-register.json: merged provenance, missing keys, unverified legacy claims, obsolete keys.
- merged-task-keys.json: 263 current task keys with explicitly associated merged PR work, ordered by queue.
- merged-pr-inventory.csv: all 301 merged PRs and mappings.

### Legacy current tasks needing evidence

| Task key | Title |
|---|---|
| 01-platform-infrastructure.md#T-02.03.03 | Create migration validation test (clean + upgrade path) |
| 01-platform-infrastructure.md#T-02.03.04 | Implement expand/migrate/contract documentation and PR checklist |
| 01-platform-infrastructure.md#T-05.01.01 | Create Ansible playbook or deploy script for pilot topology |
| 01-platform-infrastructure.md#T-05.01.02 | Create `docker-compose.prod.yml` for pilot single-VM deployment |
| 01-platform-infrastructure.md#T-05.01.03 | Document explicitly that single-server deployment has lower availability |
| 01-platform-infrastructure.md#T-05.02.01 | Design and document commercial HA topology |
| 01-platform-infrastructure.md#T-05.02.02 | Configure rolling/blue-green deployment automation for HA |
| 01-platform-infrastructure.md#T-05.02.03 | Implement circuit breaker for external providers |
| 01-platform-infrastructure.md#T-05.02.04 | Configure maintenance mode per capability, not whole-application |
| 01-platform-infrastructure.md#T-05.03.01 | Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent) |
| 01-platform-infrastructure.md#T-05.03.02 | Implement migration validation step (two environments) |
| 01-platform-infrastructure.md#T-05.03.03 | Implement OpenAPI generation and drift check |
| 01-platform-infrastructure.md#T-05.03.04 | Configure security scans in PR gate |
| 01-platform-infrastructure.md#T-05.04.01 | Create staging gate CI workflow |
| 01-platform-infrastructure.md#T-05.04.02 | Create production promotion workflow with canary/gradual rollout |
| 01-platform-infrastructure.md#T-05.04.03 | Implement post-deploy smoke tests and SLO comparison |
| 01-platform-infrastructure.md#T-05.04.04 | Create runbooks for rollback scenarios |
| 01-platform-infrastructure.md#T-05.05.01 | Create nightly CI schedule |
| 01-platform-infrastructure.md#T-05.05.02 | Create weekly load/performance regression test |
| 01-platform-infrastructure.md#T-05.05.03 | Create quarterly disaster-recovery and restore exercise |
| 01-platform-infrastructure.md#T-05.05.04 | Create quarterly access review and threat-model update |
| 01-platform-infrastructure.md#T-06.01.01 | Initialize `packages/shared` with tsconfig and dependencies |
| 01-platform-infrastructure.md#T-06.01.02 | Create username validation and normalization helpers |
| 01-platform-infrastructure.md#T-06.01.03 | Create password validation with strength meter logic |
| 01-platform-infrastructure.md#T-06.01.04 | Create stable error code enum with HTTP status mapping |
| 01-platform-infrastructure.md#T-06.01.05 | Create pagination helper schemas |
| 01-platform-infrastructure.md#T-06.02.01 | Initialize `packages/i18n` with message dictionary structure |
| 01-platform-infrastructure.md#T-06.02.02 | Create Jalali calendar date utilities |
| 01-platform-infrastructure.md#T-06.02.03 | Create timezone-aware date/time display utilities |
| 01-platform-infrastructure.md#T-06.02.04 | Create logic for RTL/LTR switching based on locale |
| 01-platform-infrastructure.md#T-06.02.05 | Localize number/currency formatting |
| 01-platform-infrastructure.md#T-06.03.01 | Initialize `packages/ui` with shadcn/ui and Base UI |
| 01-platform-infrastructure.md#T-06.03.02 | Create themed component set with RTL support |
| 01-platform-infrastructure.md#T-06.03.03 | Implement WCAG 2.2 AA accessibility in all shared components |
| 01-platform-infrastructure.md#T-06.03.04 | Create localized DatePicker component |
| 01-platform-infrastructure.md#T-06.03.05 | Implement theme system with admin overrides |
| 01-platform-infrastructure.md#T-06.03.06 | Create loading/empty/error state components |
| 01-platform-infrastructure.md#T-06.04.01 | Create privacy-safe analytics abstraction with consent gate and redaction |
| 01-platform-infrastructure.md#T-07.01.01 | Create `pnpm setup:dev` convenience script |
| 01-platform-infrastructure.md#T-07.01.02 | Configure dev-mode OTP bypass and console printing |
| 01-platform-infrastructure.md#T-07.01.03 | Create `pnpm db:push` script for dev schema synchronization |
| 01-platform-infrastructure.md#T-07.01.04 | Add environment indicator middleware |
| 01-platform-infrastructure.md#T-07.02.01 | Create versioned configuration store in PostgreSQL |
| 01-platform-infrastructure.md#T-07.02.02 | Create configuration validation framework |
| 01-platform-infrastructure.md#T-07.02.03 | Implement configuration rollback |
| 01-platform-infrastructure.md#T-07.02.04 | Create secrets encryption and masking service |
| 01-platform-infrastructure.md#T-07.02.05 | Implement provider configuration lifecycle with test-send |
| 01-platform-infrastructure.md#T-07.03.01 | Create shared ESLint configuration |
| 01-platform-infrastructure.md#T-07.03.02 | Configure Prettier with consistent formatting |
| 01-platform-infrastructure.md#T-07.03.03 | Set up Husky, lint-staged, and commitlint |
| 01-platform-infrastructure.md#T-07.03.04 | Create `.editorconfig` and `.vscode` workspace settings |
| 01-platform-infrastructure.md#T-07.04.01 | Create incident runbooks directory (`docs/runbooks/`) |
| 01-platform-infrastructure.md#T-07.04.02 | Create initial ADRs |
| 01-platform-infrastructure.md#T-07.04.03 | Create deployment guide |
| 01-platform-infrastructure.md#T-07.04.04 | Create incident response plan |
| 01-platform-infrastructure.md#T-07.05.01 | Enforce “no external call inside a database transaction” |
| 01-platform-infrastructure.md#T-07.05.02 | Generate and verify TypeScript API client contracts from OpenAPI |
| 01-platform-infrastructure.md#T-07.05.03 | Verify health-endpoint middleware exclusions |
| 01-platform-infrastructure.md#T-07.05.04 | Document and gate module extraction criteria |

### Duplicate entries in current state

- 01-platform-infrastructure.md#T-02.03.02: 2 entries
- 01-platform-infrastructure.md#T-02.04.01: 2 entries
- 01-platform-infrastructure.md#T-02.04.02: 2 entries
- 01-platform-infrastructure.md#T-02.04.03: 2 entries
- 01-platform-infrastructure.md#T-02.04.04: 2 entries
- 01-platform-infrastructure.md#T-02.04.05: 2 entries
- 01-platform-infrastructure.md#T-02.04.06: 2 entries
- 01-platform-infrastructure.md#T-03.01.01: 2 entries
- 01-platform-infrastructure.md#T-03.01.02: 2 entries
- 01-platform-infrastructure.md#T-03.01.03: 2 entries
- 01-platform-infrastructure.md#T-03.01.04: 2 entries
- 01-platform-infrastructure.md#T-03.01.05: 2 entries
- 01-platform-infrastructure.md#T-03.02.01: 2 entries
- 01-platform-infrastructure.md#T-03.02.02: 2 entries
- 01-platform-infrastructure.md#T-03.02.03: 2 entries
- 01-platform-infrastructure.md#T-03.02.04: 2 entries
- 01-platform-infrastructure.md#T-03.03.01: 2 entries
- 01-platform-infrastructure.md#T-03.03.02: 2 entries
- 01-platform-infrastructure.md#T-03.03.03: 2 entries
- 01-platform-infrastructure.md#T-03.03.04: 2 entries
- 01-platform-infrastructure.md#T-05.03.05: 2 entries
- 04-invoices-wallet-contracts.md#T-04.2.01.01: 2 entries
