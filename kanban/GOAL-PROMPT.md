# Codex release goal

This is a reusable goal prompt. Execute it only when the user activates the goal. It does not restart the retired Hermes loop.

## Prompt

Bring Barghsa's planned pre-production releases through v0.9.0 to accepted, deployed and announced staging milestones, with all four services ready for the first production launch. Work autonomously in coherent batches. Optimize for completed, working business flows and avoid repeated investigation, testing and reviews. Follow the operating rules below until the goal is achieved, the user pauses it, a budget limit stops it, or no meaningful authorized progress remains.

### Authority and release selection

Work in `/Users/majid/www/barghsa/barghsa-core`. Read `AGENTS.md`, `kanban/README.md`, `kanban/WORKFLOW.md` and `kanban/RELEASES.md` once, then reuse that context unless they change. `kanban/board.json` is the only mutable task/release ledger. Use codebase-memory for structural discovery and prefix shell commands with `rtk`. Use GitHub CLI, not computer use, for GitHub.

Validate the board and inspect Git status, remote main and pending release jobs. Preserve existing edits. Resume unfinished relevant work before creating a replacement. Do not restore the old task queue, scheduler, audit dispatcher or continuation diaries.

Read only a compact summary of the board's release records. Resume publication or receipt reconciliation for an accepted release before inventing a new release. For implementation, select the earliest unaccepted planned milestone in dependency order. Never reopen a completed release without a demonstrated regression. While its staging worker runs, prepare the next milestone without falsely marking the previous deployment complete.

Find tasks with:

```sh
rtk proxy python3 kanban/scripts/board.py check
rtk proxy python3 kanban/scripts/board.py next
rtk proxy python3 kanban/scripts/board.py list --release <version>
rtk proxy python3 kanban/scripts/board.py show '<qualified-task-key>'
rtk proxy python3 kanban/scripts/board.py evidence <relevant-batch-id>
```

Do not load the full board, old reports or repository into context. Read selected tasks, their story criteria, dependencies and relevant evidence. Skip accepted `done` and explicitly approved `superseded` work. For `verify`, inspect current code and changed evidence first. Existing code may already satisfy the requirement. Renew acceptance together for tasks sharing the same implementation; build only a demonstrated missing criterion. Do not repeat a broad audit before each release.

### Implement and review batches

Choose a coherent feature or customer/staff journey, normally grouping several related tasks. Batch size is flexible; keep risky money or migration work bounded. Pull necessary dependencies forward. One blocked task must not stop independent work on the same milestone or useful preparation for a later one.

Before editing, choose the smallest implementation and a short relevant test plan. Reuse existing engines, helpers and installed dependencies. Preserve financial calculations, authorization, profile isolation, idempotency, concurrency, audit, migrations, rollback, error recovery, Persian/English and accessibility. Finish the selected outcome before expanding scope.

Build the batch, then review its complete diff once. Fix findings and pass the related checks. Do not launch another Codex/Cursor review loop, create PRs or delegate agents without explicit authorization. Do not add speculative abstractions, refactors, tests that mirror implementation, or unrelated polishing.

### Keep testing proportional

Each release must check the behavior it changes. Prefer exact existing test files and affected callers. Verify selected files exist and actual cases ran; a zero-test success is not acceptance.

- Documents or board metadata: validate the board, links and formatting. Do not build the application or run browser suites for prose edits.
- UI changes: changed component/hook tests, affected journeys, web typecheck and changed-file lint. Check relevant language, RTL, mobile and keyboard behavior. Build once when production-browser evidence or release assets are needed.
- API/domain changes: changed unit/service tests and relevant HTTP/database integration boundaries. Run affected package checks. Check OpenAPI only when its contract changes.
- Schema/migrations: relevant migration, constraint and transaction checks, snapshot validation and affected consumers.
- Shared packages: test affected consumers, including money/auth paths where applicable. Shared changes can justify broader checks.
- Release tooling: its focused notifier/queue tests. No unrelated product/browser regression run.

At a release boundary, run the deduplicated set of relevant changed-feature tests and milestone acceptance journeys against the final sources. Reuse passing evidence only when its tested sources, tests, fixtures, configuration, dependencies and required compiled outputs still match. Rerun checks invalidated by subsequent edits. Do not rerun unchanged passing checks just because a commit, handoff or release boundary occurred.

Repository-wide tests, full browser matrices and full coverage runs are for a demonstrated cross-cutting change, an explicit acceptance gate, or the final launch rehearsal. They are not a default for every batch or minor release. Preserve existing coverage floors, numeric budgets and critical assertions; this policy changes check scope and cadence, not correctness requirements.

Build required shared outputs once before consumers. Do not run a build that rewrites outputs while tests consume them. Parallelize independent checks only when outputs, databases, fixtures and resources cannot conflict. Use the existing production-browser runner from the repository root. Use `BARGHSA_TEST_PREBUILT=1` only with a verified matching build. Collect reviewed screenshots during the same relevant browser run rather than starting another suite just for images.

Diagnose a failed or stalled check before retrying. Do not repeatedly run the same command without a new hypothesis or change. Rerun the failure and affected scope, not every successful suite. Record failures, unavailable checks and distinct passing cases truthfully. A confirmed correctness failure blocks acceptance of the affected work; unrelated work can continue.

Record command durations in the existing external check receipts. Use those measurements to remove duplicate builds and repeated test setup, scope selectors correctly and reuse valid outputs. Fix a demonstrated test-infrastructure bottleneck once. Do not create a separate benchmarking project or weaken fixture isolation and assertions to improve timing.

### Push and record progress

Update only affected task states, exact remaining criteria, dependencies and source-bound evidence in the board. `done` requires complete effective acceptance; neither a batch mention nor a broad green build is sufficient. Keep execution logs outside the checkout, not in another status tracker. Regenerate `BOARD.md` and validate it.

Explicitly stage reviewed paths, commit conventionally, normally push directly to `main`, and read back its exact SHA using `gh`. Never force-push. Continue the next batch without waiting for hosted CI, refreshing Actions pages or repeatedly polling checks. Investigate relevant CI failures when encountered, but do not use CI completion as a staging-deployment prerequisite. Do not disable checks, delete tests or waive criteria to speed up a green result.

### Release, deploy and notify

Batches are not releases. Accept the milestone's effective task criteria and business gates, using `board.py ready --release <version>` as an unresolved-task query. That command alone cannot certify business gates.

Prepare the planned SemVer, Persian `releases/<version>.md` notes, and reviewed matching captures at the release boundary. The root version must appear on login, emitted metadata and Telegram. Do not publish the preserved former v0.1.30 batch separately; finish its work inside the next planned milestone.

Commit/push the accepted release, verify the exact remote SHA, then immediately enqueue:

```sh
rtk proxy python3 deploy/staging/release-queue.py enqueue --commit <full-sha> --screenshot <reviewed-original.png>
```

The detached worker runs `./deploy/staging/deploy.sh` from an immutable checkout, verifies health and exact live metadata, and sends the release update. Staging has no real users. Do not wait for hosted CI or deployment before continuing independent building. Use the existing queue, not a new scheduler or deployment agent.

Use @barghsa_dev_bot and Barghsa Release Radar `-1004467450624`, with existing private secrets. Send one Persian summary and at most one grouped photo album per release. Include version, concrete changes, staging link and commit. Attach one photo or up to ten representative reviewed images in one album; link a gallery for extras. Never post each screenshot separately or expose secrets/customer data.

Prefer the configured private Telegram secret file. If needed, the local `.env` contains `TELEGRAM_BOT_TOKEN`; do not print it or put it in command arguments, notes or Git.

Check durable jobs and receipts at useful boundaries, not in a polling loop. Record acceptance, push, staging and Telegram confirmation separately. Enqueue is not deployment success. Diagnose failed jobs before explicit retries. Never blindly resend an unknown Telegram result. A pending deployment or optional-image warning does not freeze development. Before declaring the final goal achieved, reconcile all required release receipts.

### Finish line and blockers

Success requires all planned pre-production milestone criteria accepted, required related tests passing, exact staging deployments and Persian release confirmations recorded, and an accepted v0.9.0 candidate with electricity, saving, solar and consultation ready for launch. Provide the concrete production-promotion package and remaining owner action. Do not deploy production without explicit owner authorization or claim launch readiness while required external evidence is missing.

For unresolved policy or external prerequisites, record the exact blocker, recommend a concrete decision, request only missing information and continue independent authorized work. Do not repeatedly ask the same unanswered question, fabricate approval, or mark blocked work done. If no meaningful authorized work remains, report what was completed, the precise blocker and what would unlock progress. A budget limit or pause is not completion.

Keep progress updates brief: current milestone/batch, concrete accepted work, related test results and any real blocker. Update the board's next batch and launch forecast from demonstrated progress. Favor useful implementation over repeated planning, large logs, status polling and commentary.
