# Durable loop state

The product checkout's `kanban/loop-state.json` is a historical snapshot. The supervisor no longer trusts it for dispatch. Runtime data lives outside the checkout, by default in `~/.local/state/barghsa-loop`. Set `BARGHSA_LOOP_STATE_DIR` to choose another directory.

The authoritative snapshot is `state.json` on origin's dedicated `kanban-state` branch. A separate bare object repository creates state commits without using the product index or switching branches. Each save checks the previous remote revision, pushes with an exact revision lease, and reads back the new revision. Failed persistence prevents further dispatch. Every tick first recovers the remote snapshot; a second checkout can recover without the first machine's files.

## Initial reconciliation

Run `python3 kanban/scripts/reconcile_loop.py` to regenerate `audit/reconciled-loop-state.json` from the audit evidence. This records 263 merged task identities, retains all PR provenance, and separates historical skips and unverified completion claims. No task is certified as acceptance verified by this import. The snapshot remains blocked.

After checking the evidence against current GitHub state, an operator can bootstrap the dedicated remote branch using `python3 kanban/scripts/reconcile_loop.py --publish`. This command refuses to overwrite an existing remote state branch. Bootstrap does not enable the scheduler or clear the acceptance blocker. The repair run has not published this branch or changed the other machine's scheduler.

Do not copy the old completion array into a live state. Do not mark a partial or skipped task completed merely to advance selection. Finish the audit acceptance work, record its evidence, and resolve open loop-owned PRs before explicit recovery.

## Assignment and handoff

The supervisor persists a random assignment ID, qualified task key, canonical requirement digest and branch before invoking Cursor. It owns task state and event history. The builder receives the exact path for `builder-handoff.json`, writes only the permitted result fields, and includes the assignment ID. Invalid output leaves the original task in `building` or `fixing`; it cannot become a review identity.

Resuming a completed task or an idle state with an active identity is rejected. Changed task requirements require explicit recovery. Before each builder dispatch, the supervisor reads every GitHub PR page. An existing loop-owned PR or a possible prior merge blocks conflicting work for reconciliation. Ambiguous legacy task IDs are never used to infer completion.

Three unsuccessful fix rounds block further fixes. The first request for changes starts round one; a request for changes after round three blocks the next dispatch.

## Events and recovery

Task events distinguish `partial`, `merged`, `acceptance_verified`, `deferred`, `blocked` and `retired`. Historical events cannot be removed or rewritten. Ordinary state saves cannot remove completed identities. An incorrect historical completion needs a reviewed reconciliation/correction procedure; editing the completion array is rejected.

The initial repair has not implemented a general correction/recovery command. Keep state blocked until that procedure and acceptance closure are reviewed. This is intentional: an ad hoc edit must not silently restart old work.

The existing exact-HEAD Codex review, durable comment binding, later merge tick and post-merge verification remain mandatory. PRs cannot include historical or external runtime state.
