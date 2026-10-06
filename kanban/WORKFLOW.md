# Development and release process

This process replaces the serial Cursor/PR loop, audit dispatch and per-batch releases. Use GitHub CLI. Push reviewed work directly to `main`; do not create PRs. Keep the legacy scheduler disabled and leave its external runtime state untouched.

## Read before working

1. Read `AGENTS.md`, this process, `RELEASES.md` and the next batch in `board.json`.
2. Run `python3 kanban/scripts/board.py check`. A stale or invalid board blocks selection.
3. Check Git status and remote main with `gh`. Preserve unrelated edits and the recorded pending consultation patch.
4. Read selected tasks' requirements, current evidence, remaining criteria and dependencies. Use qualified keys. Task IDs repeat across epic files.

`board.json` is the sole mutable ledger. Never maintain completion in a second queue, audit JSON, diary, chat summary or epic checkbox. Historical entries are evidence, not instructions.

## Task states

| State | Meaning |
| --- | --- |
| `verify` | Current acceptance is uncertain. Inspect existing code and evidence before building. |
| `todo` | Concrete new build, verification or external work. |
| `in_progress` | Selected work has started, including preserved unfinished changes. |
| `partial` | Some criteria are accepted; exact remaining criteria must be reconciled with later fixes. |
| `blocked` | A named policy, access or external prerequisite prevents completion. Record the blocker. |
| `done` | Every effective criterion has current acceptance evidence and passing applicable checks. No remaining criteria. |
| `superseded` | An explicit approved requirement change or duplicate resolution names the retained implementation or replacement. |

Preserve earlier approvals as history. Renew affected acceptance when source bindings changed. A broad build, batch mention, merged PR, shared component or existing file cannot certify a whole task. Missing documentation does not prove code is absent. Do not use `superseded` to hide missing work.

## Work in batches

Select a small group producing one coherent outcome for the next release. Record qualified keys, expected behavior and required checks in the board. Include necessary dependencies. Pull a later-assigned dependency into the earlier milestone when its complete acceptance is needed there. Domain grouping cannot permit a broken earlier journey.

Use codebase-memory and source checks to inspect current code. Reuse existing engines and matching validation. For `verify`, first record the exact disposition: complete, missing criterion, changed evidence, approved exception or external blocker. Build only a demonstrated gap. Renew shared evidence together instead of rebuilding each task.

Implement and review the complete batch diff. Run related tests and applicable package checks. Money, authorization, ownership, idempotency, concurrency, migrations and retry changes need real failure-boundary checks. UI retains Persian/English, RTL, accessibility and appropriate production-browser evidence. Preserve coverage floors, numeric budgets and financial assertions. Record stopped/failing runs truthfully; never claim an entire stopped suite passed.

Update affected states, remaining criteria, dependencies and evidence. Bind passing checks and reviewed captures to final source bytes. Store complete execution logs outside the checkout. Mark `done` only after full effective acceptance. Validate the board and regenerate `BOARD.md`.

Explicitly stage reviewed implementation and board changes, verify the staged diff, commit conventionally, normally push main and read back its exact remote SHA with `gh`. Never force-push. Hosted CI runs independently. Investigate failures, but do not wait for hosted CI to deploy this test environment. Continue the next batch. Do not increment versions, deploy or announce each batch.

## Finish a release

Run `python3 kanban/scripts/board.py ready --release <version>` to list the unresolved count. Accept all assigned launch-required tasks and prerequisite releases. Pass the milestone goal and its gates on the final candidate. Review and run combined acceptance once at this boundary. Fix critical/major issues before acceptance. Record exact checks and source bindings; a prose approval or CLI exit code alone is insufficient.

Set root `package.json` SemVer at the release boundary. Write Persian `releases/<version>.md` notes beginning with `برقسا نسخه <version>` and concrete Markdown bullets. Use PATCH for a necessary compatible hotfix, MINOR for a capability milestone and MAJOR for the production launch or an incompatible public contract. Never reuse a published version. Login, emitted release metadata and Telegram show the same version.

Commit and push the accepted release, verify its exact remote SHA, then enqueue the detached staging worker immediately. Do not wait for CI. The worker uses an immutable checkout, runs `./deploy/staging/deploy.sh`, verifies health and exact live version/commit, and then announces success. Development continues during deployment. Staging releases are serialized.

```sh
python3 deploy/staging/release-queue.py enqueue --commit <full-sha> --screenshot <reviewed-original.png>
python3 deploy/staging/release-queue.py status
```

Record acceptance, push, staging health, Telegram receipt and production promotion separately in the release record. Enqueue is not completed deployment. Diagnose failed jobs before explicit retry. An observation timeout does not authorize restarting a healthy worker. A deployment failure does not freeze independent building.

## Telegram

Use @barghsa_dev_bot and Barghsa Release Radar `-1004467450624`, with the existing private configuration or `.env` token. Never expose credentials in chat, Git or notes.

Publish one Persian summary and at most one grouped image album per release. A captioned album may combine them. Include version, concrete changes, staging link and commit. Attach useful reviewed screenshots of the actual release. Use one photo or an album of up to ten representative photos. [Telegram limits an album to ten items](https://core.telegram.org/bots/api#sendmediagroup); link a gallery for extras instead of creating more posts. Treat the album as one grouped channel update. Never post each screenshot separately.

Do not attach stale captures or expose customer data. Confirm returned message/album receipts against the channel and release. Store receipts externally. Unknown delivery must not retry automatically; inspect the channel first. Optional image failure can record a warning after a confirmed main announcement without blocking later releases. It cannot claim unconfirmed delivery.

## Launch and handoff

Staging deploys independently of hosted CI. Production needs complete candidate acceptance, operational evidence and explicit owner authorization. All four services must be ready. Do not silently reduce launch scope or waive provider, legal, backup or security prerequisites.

Handoffs name the current release, next batch, accepted work, remaining criteria and blockers from the board. No continuation diary is needed. Update the launch forecast when accepted work or external readiness changes.
