# Barghsa Build Loop — Ownership-Separated Tick

The live loop is implemented by `kanban/scripts/loop-runner.py` and runs as a `no_agent=True` cron script.

## Ownership

- Cursor CLI + Grok 4.6 owns build/fix, validation, commits, pushes, meaningful PR creation/update, and the `in_review` handoff.
- Codex CLI + GPT Sol 5.6 owns the structured exact-HEAD review artifact.
- The deterministic supervisor selects, dispatches, verifies, and merges only from `approved` on a later tick.

## Non-negotiable gates

- Validate the generated backlog before every tick.
- One active task and one PR only.
- Cursor must create or edit the PR itself and write `## What`, `## Acceptance criteria`, `## Validation`, and `## Risks / limitations`.
- The supervisor never commits builder work or creates/edits the PR.
- Materialize and verify immutable base/head SHAs before Codex; review the SHA-pinned diff, never a mutable branch ref.
- Codex output must match `kanban/scripts/review-schema.json` and be bound to the current PR number and exact 40-character HEAD SHA.
- Persist a random nonce, post the review with marker `<!-- barghsa-codex-review:v1 -->`, and read it back from the authenticated GitHub actor.
- Bind approval to exact comment ID/URL/author, nonce, artifact SHA-256 digest, and HEAD before changing state.
- `in_review` can only transition to `approved` or `fixing`; it cannot merge.
- Merge only on a separate `approved` tick after re-fetching the PR, durable review binding, exact HEAD, mergeability, and at least one GitHub check with every entry explicitly `COMPLETED`/`SUCCESS`.
- Any new commit invalidates prior approval: clear all approval-binding fields and return to `in_review`.
- Merge with `--match-head-commit <reviewed-sha>`, then re-fetch both the merged PR and durable comment and revalidate the full binding before finalizing state.
- Keep `kanban/loop-state.json` local runtime state; it must not enter a product PR.
- Keep `/tmp/barghsa-loop-runner.lock` outside the repository.

See repository `AGENTS.md` for the full protocol and state contracts.
