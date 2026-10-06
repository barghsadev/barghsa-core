# Planning reconciliation, October 6, 2026

The original loop's completion list, audit acceptance, repair progress and later batch reports recorded different populations and dates. They could not be combined into a trustworthy percentage by adding counts or trusting a merged PR.

## What is preserved

- All **1,355 original qualified task identities**, titles, complexity, task requirements and shared story context.
- All **322 historical audit assessments**, including source hashes, checks, limitations and the 219 earlier approvals, 54 partial claims and 49 deferrals.
- Scope and validation records from **497 later batch reports**, mapped where a concrete qualified task can be identified. A task mention does not become full acceptance.
- Approved decisions, six unresolved owner questions, recorded deferred improvements and exact unfinished consultation work.
- The seven original requirement epics, product/architecture requirements, current technical/operational guides and runtime-referenced migration inputs.
- Seventeen new release/readiness tasks and seven milestones, with an all-four-service production launch.

The board binds requirements to source hashes, retains every original key and uses qualified identities to avoid collisions. Its validator rejects lost or duplicate originals, altered requirements, stale accepted source bindings, missing evidence, dependency cycles and stale generated views.

## How completion is classified

The historical audit accepted 219 tasks. At reconciliation, only 11 of those records had all saved source bindings unchanged. Changed bindings do not mean the implementation regressed. They mean the old approval alone cannot certify current acceptance. Those tasks are `verify`, with earlier evidence preserved. Renewal should inspect the changed scope and reuse matching checks together.

An earlier partial assessment retains its exact limitations. Later batches are linked so an agent does not mistake an old statement such as "contract module absent" for the current situation. A task with no specific recorded review is `verify`, not "unimplemented". This includes many security, testing and UI criteria already reflected in shared code.

Only a demonstrated missing criterion becomes build work. Only complete current acceptance becomes `done`. Explicit approved manual identity verification supersedes the standalone real automatic-provider integration requirement; its absence does not block launch. Other unresolved exceptions remain pending.

The generated board reports acceptance states and build evidence separately. It intentionally does not claim a current admin/customer build percentage. Such a number needs current route-level acceptance, not a count of differently sized tickets or repeated fixes.

## Cleanup and recovery

Removed **3,447 obsolete files**, including 3,443 tracked files, about 70.8 MB of old queues, status snapshots, execution logs, superseded audit plans, duplicate diaries, per-batch reports and retired dispatcher machinery. Current task scope and useful evidence are consolidated in `board.json`; unique operational preflights moved to `docs/operations/preflight/`.

The removed tracked originals remain recoverable at immutable Git revision `fcd7678ba742fbbaa7cd0907471f3f2aec86bb82`. For example:

```sh
git show fcd7678ba742fbbaa7cd0907471f3f2aec86bb82:audit/acceptance-closure.json
git show fcd7678ba742fbbaa7cd0907471f3f2aec86bb82:kanban/batches/<historical-report>.md
```

A complete pre-cleanup copy, including modified/untracked planning files, is saved outside the checkout at `~/.local/state/barghsa-kanban-reconciliation-2026-10-06/original-planning-files.tar.gz`. Its SHA-256 and removal-manifest binding are in the board. Historical Git references are provenance and do not dispatch work. Do not restore the old tracker as a second active ledger.

`audit/` retains four inputs used by current tests or immutable migrations. Provider runbooks remain at their existing linked URLs. ADRs, source requirements and current operating instructions remain. An obsolete standalone Hermes profile-settings plan was also removed after preserving its hash and recovery copy. No external scheduler/runtime state was modified; the legacy loop must remain disabled.

## Unfinished work and release boundary

The consultation-history changes formerly prepared for v0.1.30 remain uncommitted and unreleased. Their 40 source and 30 distinct browser passes and two reviewed Persian captures are preserved. The board binds the exact local sources and explains the stopped-run/final-targeted browser evidence.

`pending/consultation-history.patch.gz` preserves the source, new tests and former version/notes for another checkout. The owner checkout already contains the patch. Elsewhere, decompress with `gzip -dc kanban/pending/consultation-history.patch.gz`, use `git apply --check` before applying and compare the recorded source hashes. Do not apply twice. Remove the recovery patch when the actual reviewed source is committed; prepare final version/notes only when v0.2.0 is accepted.

This planning cleanup is committed separately from those application edits. It is not a product release and does not enqueue deployment or send Telegram posts. The last confirmed staging release remains v0.1.29. Future milestones use the new grouped-announcement and independent-deployment process.
