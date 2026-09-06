# Barghsa — Cursor Build / Codex Review Loop

> **Builder and PR author:** Cursor CLI `agent -p` using `cursor-grok-4.6-high`
>
> **Reviewer:** Codex CLI `codex exec` using `gpt-5.6-sol`
>
> **Supervisor:** `kanban/scripts/loop-runner.py` via a `no_agent=True` Hermes cron job
>
> **Scheduler:** Hermes cron job `9fb7cbc7cc61` (keep paused until the protocol is verified)

## Goal

Process one kanban task at a time while keeping build, review, and merge authority separate:

1. Cursor builds, validates, commits, pushes, authors a meaningful PR, and writes a separate external builder handoff.
2. On a later tick, Codex reviews the committed PR HEAD and produces a strict structured review posted and read back from the PR.
3. On another later tick, the deterministic supervisor verifies the durable approval, exact HEAD SHA, checks, and mergeability before merging.

A reviewer tick never merges. Any new commit invalidates the previous approval.

## Canonical files

- `kanban/task-queue.json` — ordered generated queue
- `kanban/queue-priority.json` — explicit task promotions applied to canonical epic order; validate both order and every generated field
- `kanban/loop-state.json` — historical snapshot, never used for dispatch
- `$BARGHSA_LOOP_STATE_DIR/state.json` — supervisor-owned cache of the dedicated `kanban-state` remote branch
- `$BARGHSA_LOOP_STATE_DIR/builder-handoff.json` — builder-owned result, bound to the supervisor assignment
- `kanban/STATE-PROTOCOL.md` — persistence, reconciliation and recovery procedure
- `kanban/epics/<file>` — canonical task context and acceptance criteria
- `kanban/requirements-traceability.json` — generated coverage ledger
- `kanban/scripts/build_backlog.py` — queue/ledger generator and validator
- `kanban/scripts/loop-runner.py` — deterministic supervisor
- `kanban/scripts/review-schema.json` — Codex review output contract
- `kanban/scripts/test_loop_runner.py` — protocol safety tests

Before every tick:

```bash
python3 kanban/scripts/build_backlog.py --check
```

A validation failure sets the loop to `blocked`. Never work from a stale queue.

## Stable task identity

Task IDs repeat across epic files. Always use `<fname>#<id>`, for example:

```text
04-invoices-wallet-contracts.md#T-04.1.02.08
```

## State machine and ownership

| State       | Owner      | Permitted action                                             | Next state                  |
| ----------- | ---------- | ------------------------------------------------------------ | --------------------------- |
| `idle`      | Supervisor | Reconcile PRs, persist immutable assignment, dispatch Cursor | `building`                  |
| `building`  | Cursor     | Implement, test, commit, push, author/update PR              | `in_review`                 |
| `in_review` | Codex      | Review exact PR HEAD and post structured artifact            | `approved` or `fixing`      |
| `fixing`    | Cursor     | Fix same PR, rerun checks, push, invalidate old review       | `in_review`                 |
| `approved`  | Supervisor | Re-read approval and enforce merge gates                     | `idle` after verified merge |
| `blocked`   | Human      | Resolve manual blocker                                       | explicit recovery           |
| `complete`  | None       | Queue exhausted                                              | terminal                    |

Only one active task and one loop-owned PR may exist. Every supervisor transition must be committed, pushed to the dedicated state branch, and read back before proceeding. The builder cannot change the selected identity or completion/event history. State defaults to `~/.local/state/barghsa-loop`; configure `BARGHSA_LOOP_STATE_DIR` outside the product checkout.

## Cursor contract: full build transaction

The supervisor launches Cursor with the exact task block and required branch. Cursor owns all build-side actions:

1. Reconcile git and GitHub. For a new task, create the required branch from current `origin/main`; for fixes, resume the same branch and PR.
2. Read the supervisor assignment. Do not edit supervisor state. Write the separate handoff path named in the prompt, including its `assignment_id`.
3. Implement only the selected task and directly required scaffolding.
4. Run task-specific checks and every relevant available package/root check. Do not claim unavailable checks passed.
5. Commit implementation with a meaningful conventional commit message.
6. Push the branch.
7. Create a draft PR with `gh pr create`, or update the existing PR with `gh pr edit`. Cursor must write the PR title and body itself.
8. The PR body must include:

```markdown
## What

- concrete implementation summary

## Acceptance criteria

- [x] criterion actually verified
- [ ] criterion not verified, with reason

## Validation

- `exact command` — pass/fail/not available

## Risks / limitations

- known limits, or `None`
```

9. Mark the PR ready only after applicable validation passes.
10. Read the PR back and record its number, URL, branch, exact 40-character HEAD SHA, and validation results.
11. Set `status` to `in_review`; clear `review`, `reviewed_head_sha`, `review_comment_id`, `review_comment_url`, `review_comment_author`, `review_artifact_sha256`, and `review_nonce`; and leave truthful `last_error`.
12. Do not stage or commit the historical `kanban/loop-state.json`, external state or handoff in the product PR. Stage implementation paths explicitly rather than using an indiscriminate `git add -A`.
13. Do not return success until the pushed PR and state handoff have been read back and agree.

The supervisor never commits implementation, pushes a builder branch, creates/edits a PR, writes its description, marks it ready, or repairs a failed Cursor handoff.

## Builder handoff verification

Before Codex can run, the supervisor requires:

- handoff is exactly `in_review` and has the persisted assignment ID;
- PR is open and not draft;
- state PR number/URL/branch match GitHub;
- `current_head_sha` equals the current PR `headRefOid`;
- PR body is meaningful and contains required sections;
- PR does not include `kanban/loop-state.json`;
- `validation_results` is non-empty and contains no failure.

An invalid handoff cannot reach review or merge.

## Codex contract: exact-HEAD structured review

Codex runs through its own CLI and OpenAI subscription:

```bash
codex exec - \
  -m gpt-5.6-sol \
  -C /Users/majid/barghsa-core \
  -s read-only \
  --ephemeral \
  --output-schema kanban/scripts/review-schema.json \
  --output-last-message /tmp/review.json
```

Before Codex starts, the supervisor fetches the advertised `main` and `refs/pull/<number>/head` refs, verifies they resolve to GitHub's reported immutable base/head SHAs, and instructs Codex to review `<base-sha>...<head-sha>`. Its response must match:

```json
{
  "schema_version": 1,
  "task_key": "04-invoices-wallet-contracts.md#T-04.1.02.08",
  "pr_number": 123,
  "reviewed_head_sha": "40-character git SHA",
  "decision": "approve",
  "summary": "one line",
  "issues": [
    {
      "severity": "critical",
      "file": "path",
      "line": 1,
      "description": "problem",
      "suggestion": "specific fix"
    }
  ]
}
```

Allowed decisions are `approve` and `request_changes`; severities are `critical`, `major`, and `minor`.

- `approve` cannot contain critical/major issues.
- `request_changes` must contain at least one critical/major issue.
- Task key, PR number, and reviewed HEAD SHA must match reality.
- No prose or keyword heuristics determine approval.

Before posting, the supervisor persists a random nonce. It posts the JSON with marker `<!-- barghsa-codex-review:v1 -->` plus that nonce, then reads it back through GitHub’s issue-comments API. The artifact is accepted only from the currently authenticated `gh` actor and is bound in state to the exact comment ID, URL, author, artifact SHA-256 digest, task, PR, nonce, and reviewed HEAD. Only then does state change to `approved` or `fixing`.

## Fix cycle

For `fixing`, Cursor stays on the same PR and consumes the verified Codex artifact. It fixes every critical/major issue, reruns checks, commits, pushes, updates the PR body, and records the new PR HEAD.

Every fix push must clear old review fields before returning to `in_review`. Three unsuccessful fix rounds set the loop to `blocked`.

## Merge gates: separate later tick

The `in_review` tick never merges. A later `approved` tick requires all of the following:

- state is exactly `approved`;
- PR is open, not draft, and `MERGEABLE`;
- selected durable review comment has the expected marker and valid JSON;
- review decision is exactly `approve`;
- review task key and PR number match state;
- `reviewed_head_sha`, state `reviewed_head_sha`, and current PR HEAD are identical;
- no critical or major issue exists;
- at least one GitHub check exists and every rollup entry has `status=COMPLETED` and `conclusion=SUCCESS`; null, skipped, neutral, stale, pending, or failed checks block merge.

Then the supervisor may squash-merge using `gh pr merge --match-head-commit <reviewed-head-sha>` so GitHub atomically refuses a changed HEAD. After GitHub reports `MERGED`, it re-fetches both the PR and durable comment, revalidates the merged HEAD plus exact comment ID/URL/author/artifact digest binding, and only then appends the task key to `build_completed_tasks` and returns to `idle`. A missing, deleted, or edited post-merge comment blocks state finalization. If HEAD changed before merge, it clears every approval-binding field and returns to `in_review`.

## Failure rules

- Preserve resumable state on Cursor, Codex, GitHub, or network failures.
- Never infer success from CLI exit code alone; read external artifacts back.
- Never merge from `in_review` or `fixing`.
- Never use keyword matching to interpret a review.
- Never force-push `main`, bypass failed checks, expose secrets, or mark completion before a verified merge.
- Keep the OS advisory lock outside the repository (`/tmp/barghsa-loop-runner.lock`) and hold its open descriptor for the full tick so it cannot race or enter a PR.
- Keep status history bounded to 100 transitions.

## Project conventions

- Conventional commits; strict TypeScript where applicable.
- Persian and English dictionaries for user-facing strings.
- RTL and accessibility are acceptance requirements.
- Audit state changes and use expand/migrate/contract for migrations.
- No committed secrets, debug endpoints, or production `console.log` residue.
