# Barghsa — Autonomous Build and Review Loop

> **Builder/orchestrator:** `deepseek/deepseek-v4-flash` on OpenRouter
>
> **Reviewer:** `openai/gpt-5.6-sol` on OpenRouter
>
> **Scheduler:** paused Hermes cron job `d09ad66fea0b`

## Goal

Process one small kanban task at a time:

1. select the next task;
2. build it on a dedicated branch;
3. run the repository's available checks;
4. open a pull request;
5. review it with GPT-5.6 Sol;
6. fix blocking findings or squash-merge it;
7. continue with the next task.

Keep only one active task and one open loop-owned PR at a time.

## Files

- `kanban/task-queue.json` — ordered task queue
- `kanban/loop-state.json` — durable state
- `kanban/epics/<file>` — full task context and acceptance criteria
- `kanban/index.md` — phase ordering

## Stable Task Keys

Task IDs repeat between epic files, so bare IDs are not unique. Everywhere the loop stores or compares a task, use:

```text
<fname>#<id>
```

Example:

```text
01-platform-infrastructure.md#T-01.01.01
```

`build_completed_tasks` stores these keys. Branch names also include the epic number:

```text
feat/e01-t-01-01-01--pnpm-workspace
```

## State Machine

| State | Meaning | Next action |
|---|---|---|
| `idle` | No active task | Select and start the next task |
| `building` | Builder owns the current task | Continue implementation or recover the existing branch/PR |
| `in_review` | PR is ready | Run automated checks, then GPT-5.6 Sol review |
| `fixing` | Review found blocking issues | Fix the same PR and return to review |
| `blocked` | Manual intervention is needed | Stop; do not select another task |
| `complete` | Queue exhausted | Stop |

`current_task_key`, `current_task_id`, `current_task_file`, `current_branch`, and `current_pr_url` must describe the same task. Update state after every transition.

## Orchestrator Procedure

### 1. Reconcile reality first

Before acting, inspect:

```bash
git status --short --branch
gh pr list --state open --json number,title,headRefName,isDraft,url
```

- If the recorded PR exists, trust GitHub and resume it.
- If the recorded branch exists but no PR exists, resume that branch.
- If state says `idle` but a loop-owned PR is open, recover that PR instead of starting another task.
- Never reset an active task merely because no branch appeared within a few minutes. A cron tick is short; implementation may take longer.

### 2. Select a task (`idle`)

Pick the first queue entry whose `<fname>#<id>` is not in `build_completed_tasks`.

Read its exact task block from `kanban/epics/<fname>` including notes, dependencies, and acceptance criteria. If a required dependency is visibly absent, set `blocked` with a concise reason instead of guessing.

Set the current task fields, create its branch from current `origin/main`, set `status` to `building`, and implement the task in the same run. Do not stop after merely writing a task brief.

Prefer S/M tasks. Split L/XL work into a reviewable prerequisite slice when necessary; do not create oversized PRs.

### 3. Build (`building`)

Use the current branch. Implement only the selected task and directly required scaffolding. Do not modify product requirements, the queue, or unrelated epic documents.

Tests are progressive because early foundation tasks may not yet define every root script:

1. run the checks explicitly required by the task;
2. run each relevant root script that currently exists (`typecheck`, `lint`, `test`, `build`);
3. record exact commands and outcomes in the PR body;
4. never claim an unavailable check passed.

Commit and push with a conventional message, then open a **draft PR**. When implementation and available checks are ready, mark it ready and set state to `in_review`.

PR body:

```markdown
Implements `<task-key>`.

## What
- concise change summary

## Acceptance criteria
- [x] criterion actually verified
- [ ] criterion not yet verified (explain why)

## Validation
- `command` — pass/fail/not available
```

Do not include a fake `Closes #...` reference.

### 4. Review (`in_review`)

First read the task context, PR metadata, changed files, diff, and check status. Do not merge a draft PR, a PR with merge conflicts, or a PR whose available required checks fail.

Invoke the reviewer through Hermes so credentials stay in the configured provider path:

```bash
hermes chat \
  --query-file /tmp/barghsa-review-prompt.txt \
  --model openai/gpt-5.6-sol \
  --provider openrouter \
  --reasoning high \
  --max-turns 1 \
  --quiet
```

Build `/tmp/barghsa-review-prompt.txt` safely as a file; do not interpolate a diff into shell JSON. Ask for exactly:

```json
{
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

Allowed decisions: `approve`, `request_changes`. Allowed severities: `critical`, `major`, `minor`. Parse the final non-empty JSON line. If parsing fails, retry once with a shorter prompt; then set `blocked` rather than merging without a valid review.

The review must check:

- selected task acceptance criteria and dependencies;
- correctness and edge cases;
- security and secret exposure;
- adequate tests for changed behavior;
- error handling;
- i18n/RTL/accessibility for user-facing work;
- backward-compatible migrations;
- no unrelated scope or debug residue.

`critical` or `major` findings require changes. Minor findings may be left as follow-up only when the reviewer still returns `approve`.

Post the review summary and issue list as a normal PR comment. The repository owner cannot submit a formal approval/request-changes review on their own PR, so comments are the durable review record.

### 5. Fix (`fixing`)

Stay on the same task, branch, and PR. Fix all critical/major findings, rerun relevant checks, push a new commit, and return to `in_review`.

Increment `fix_attempts`. After three unsuccessful review rounds, set `blocked` with the remaining findings. Do not re-enter `idle` and do not create a new branch.

### 6. Merge

Merge only when all are true:

- the PR is not draft and is mergeable;
- available required checks pass;
- reviewer decision is `approve`;
- no critical/major issue remains.

Then:

```bash
gh pr merge <url> --squash --delete-branch
```

Verify the PR reports `MERGED`. Only then append `current_task_key` to `build_completed_tasks`, clear current task fields, reset `fix_attempts`, and return to `idle`.

## Failure Rules

- Transient provider/GitHub/network failure: keep the current state and record the error; retry on the next tick.
- Ambiguous, destructive, credential, payment, or production operation: set `blocked` for manual review.
- Never force-push `main`, bypass failing checks, expose secrets, or merge on an invalid/missing reviewer response.
- Never mark a task completed before the PR is verified merged.
- Keep `status_history` bounded to the latest 100 transitions.

## Project Conventions

- Conventional commits; strict TypeScript when TypeScript exists.
- Persian and English dictionaries for user-facing strings.
- RTL and accessibility are part of acceptance, not optional polish.
- Audit state changes and use expand/migrate/contract for migrations.
- No committed secrets, debug endpoints, or production `console.log` residue.
