# Barghsa — Autonomous Development Loop Protocol

> **Builder model:** DeepSeek V4 Flash (via OpenRouter, delegate_task subagent)
> **Reviewer model:** DeepSeek V4 Flash (orchestrator self-review — no model switching)
> **Orchestrator:** Hermes cron job (does all state management + code review directly)

## How the Loop Works

```
┌─────────────────────────────────────────────────────┐
│  Orchestrator (cron job, runs every 15 min)         │
│  → Reads loop-state.json                            │
│  → All logic runs in ONE session (no model switch)   │
└──────────────────┬──────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    ▼                              ▼
┌──────────────┐          ┌──────────────────┐
│ STATE        │          │ STATE            │
│ idle         │          │ in_review        │
│              │          │ (PR exists)      │
│ Pick next    │          │                  │
│ task from    │          │ Orchestrator:    │
│ queue        │          │ 1. gh pr diff    │
│              │          │ 2. Review code   │
│ Dispatch     │          │ 3. Approve/merge │
│ Builder via  │          │    or request    │
│ delegate_task│          │    changes       │
│ (DS V4)      │          └────────┬─────────┘
└──────┬───────┘                   │
       │                    ┌──────┴──────┐
       ▼                    ▼             ▼
┌──────────────┐    ┌───────────┐  ┌──────────────┐
│ STATE        │    │ Approved  │  │ Changes      │
│ building     │    │ → merge   │  │ requested    │
│              │    │ → mark    │  │              │
│ Wait for     │    │   done    │  │ Set state    │
│ builder to   │    │ → pick    │  │ → fixing     │
│ push PR      │    │   next    │  │              │
└──────────────┘    └───────────┘  └──────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │ STATE        │
                                   │ fixing       │
                                   │              │
                                   │ Re-dispatch  │
                                   │ Builder to   │
                                   │ fix, loop    │
                                   │ back to      │
                                   │ in_review    │
                                   └──────────────┘
```

## State Machine

| State | Meaning | Next Action |
|-------|---------|-------------|
| `idle` | No active task | Pick next task from queue, dispatch Builder |
| `building` | Builder is implementing | Wait, check for new branch/PR |
| `in_review` | PR is open, awaiting review | Dispatch Reviewer |
| `fixing` | Reviewer requested changes | Dispatch Builder to fix |
| `merging` | Reviewer approved, merging | Merge PR, mark task done |

## Branch Naming Convention

```
feat/<task-id>--<kebab-case-description>
```

Examples:
- `feat/T-01.01.01--pnpm-workspace-setup`
- `feat/T-02.01.01--login-page-ui`

## Builder Agent Protocol

### When dispatched (state = idle or fixing):

1. **Read** `kanban/task-queue.json` to find the next pending task
2. **Read** the relevant epic file for full task details (epics/0X-*.md)
3. **Create branch** from latest `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feat/<task-id>--<short-name>
   ```
4. **Implement** the task — write code, DB migrations, tests, etc.
5. **Run tests** — at minimum:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test -- --changed          # affected tests
   pnpm build
   ```
6. **Commit and push**:
   ```bash
   git add -A
   git commit -m "feat(<scope>): <task-id> — <short description>"
   git push origin feat/<task-id>--<short-name>
   ```
7. **Create pull request** via `gh` CLI:
   ```bash
   gh pr create \
     --title "feat(<scope>): <task-id> — <short description>" \
     --body "Implements **<task-id>** from the kanban.

   ## What
   <implemented features>

   ## Checklist
   - [ ] Code implements all acceptance criteria
   - [ ] Tests pass (typecheck, lint, unit, integration)
   - [ ] Migration is backward-compatible (expand)
   - [ ] No debug endpoints, secrets, or TODOs remain
   - [ ] Relevant PR gate checks pass

   Closes #<will be created>"
   ```
8. **Update state** in `kanban/loop-state.json`:
   - Set `status` to `in_review`
   - Record `current_task_id`, `current_branch`, `current_pr_url`
   - Increment `loop_iteration`
   - Add entry to `status_history`

### When fixing review comments (state = fixing):

1. **Checkout** the existing branch
2. **Read** reviewer comments from the PR (via `gh pr view <url>`)
3. **Fix all issues** identified by reviewer
4. **Re-run tests**, **amend repo**:
   ```bash
   git add -A
   git commit -m "fix: address review comments"
   git push
   ```
5. **Comment** on the PR: `Addressed all review comments. Ready for re-review.`
6. **Update state** to `in_review`

## Orchestrator Protocol — Full Logic (covers both build and review)

The orchestrator does everything in one session. It reads `loop-state.json` and branches based on state:

```python
if state.status == "idle":
    # Pick next task from queue (not in completed list)
    # Read epic file for full task details
    # Dispatch Builder agent via delegate_task
    # Set status to "building"

elif state.status == "building":
    # Check if enough time has passed (last_updated > 5 min ago)
    # If so, check git for PR:
    #   gh pr list --head feat/<task-id>--*
    # If PR found, transition to in_review
    # If no branch yet, do nothing

elif state.status == "in_review":
    # ════════════════════════════════════
    # Self-review — no separate agent needed
    # ════════════════════════════════════
    # 1. Fetch PR diff:  gh pr diff <url>
    # 2. Fetch PR details: gh pr view <url> --json files,additions,deletions
    # 3. Review against these criteria:
    #    - Acceptance criteria met from epic/story description
    #    - No secrets, SQL injection, XSS, hardcoded credentials
    #    - Adequate test coverage
    #    - No dead code, proper error handling
    #    - i18n/l10n where needed
    #    - Backward-compatible migrations
    #    - Edge cases handled (error/loading/empty states)
    # 4. Decision:
    #    - APPROVE: gh pr review <url> --approve
    #              gh pr merge <url> --squash --delete-branch
    #              → add task to build_completed_tasks, status = "idle"
    #    - CHANGES: gh pr review <url> --request-changes --body "<issues>"
    #              → status = "fixing"
    # 5. Update loop-state.json

elif state.status == "fixing":
    # Builder will fix issues
    # Set status back to "idle" — the task will be picked up again
    # Increment fix_attempts in state history
    # If fix_attempts > 3: flag as "blocked" for manual intervention

elif state.status == "complete":
    # All tasks done — notify
    pass
```

## Task Selection Order

Follow the implementation order from `kanban/index.md`:

1. **Phase 0:** E-01 (Platform) → E-07 (UI/UX) → E-06 (Security)
2. **Phase 1:** E-02 (Auth/Users)
3. **Phase 2:** E-04 (Invoices/Wallet) → E-03 (Core Business)
4. **Phase 3:** E-05 (Notifications/Docs/AI)
5. **Phase 4:** E-06 advanced (Security hardening, Observability)

Within each epic, follow the task ordering in `task-queue.json`.
Tasks with complexity S or M should be preferred early; L and XL tasks may be split.

## Convention Reminders

- All commits use conventional commits format
- All code is TypeScript with strict mode
- All user-facing strings are in i18n dictionaries (Persian + English)
- All state changes are audited
- No temporary secrets, debug endpoints, or Console.log in committed code
- Migration files use expand/migrate/contract pattern
- PR description links to the kanban task

## Failure Recovery

- **If a subagent crashes/times out:** Orchestrator sets state back to `idle` and retries with a fresh agent
- **If tests fail persistently:** Builder comments on the PR with the failure and sets state to `blocked` — orchestrator notifies the user
- **If merge conflicts:** Builder rebases on latest main and resolves
- **If builder creates a broken PR (empty, wrong branch, etc.):** Reviewer rejects with reason, state goes back to idle