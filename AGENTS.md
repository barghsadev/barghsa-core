# Barghsa — Autonomous Development Loop Protocol

> **Builder model:** DeepSeek V4 Flash (via OpenRouter)
> **Reviewer model:** GPT-5.6 Sol (via OpenRouter)
> **Orchestrator:** Hermes cron job (this profile)

## How the Loop Works

```
┌─────────────────────────────────────────────────────────┐
│  Cron fires every 15 min                                │
│  → Reads loop-state.json                                │
│  → Decides action based on state                        │
└──────────────────┬──────────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    │                              │
    ▼                              ▼
┌──────────────┐          ┌──────────────────┐
│ STATE        │          │ STATE            │
│ idle         │          │ in_review        │
│              │          │ (PR open)        │
│ Pick next    │          │                  │
│ task from    │          │ Dispatch         │
│ queue        │          │ Reviewer Agent   │
│              │          │ → review MR      │
│ Dispatch     │          │ → approve/       │
│ Builder      │          │   request changes│
│ Agent        │          └────────┬─────────┘
└──────┬───────┘                   │
       │                    ┌──────┴──────┐
       ▼                    ▼             ▼
┌──────────────┐    ┌───────────┐  ┌──────────────┐
│ STATE        │    │ Reviewer  │  │ Reviewer     │
│ building     │    │ approved  │  │ requested    │
│              │    │ → merge   │  │ changes       │
│ Builder:     │    │ → mark    │  │              │
│ 1. Create    │    │   done    │  │ Set state    │
│    branch    │    │ → pick    │  │ → fixing     │
│ 2. Implement │    │   next    │  │ Dispatch     │
│ 3. Test      │    └───────────┘  │ Builder      │
│ 4. Push      │                   │ to fix       │
│ 5. Create PR │                   └──────────────┘
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

## Reviewer Agent Protocol

### When dispatched (state = in_review):

1. **Read** `kanban/loop-state.json` to get `current_pr_url`
2. **Fetch PR details**:
   ```bash
   gh pr view <pr-url> --json title,body,files,additions,deletions,comments
   gh pr diff
   ```
3. **Review code** against these criteria:
   - **Acceptance criteria met?** Check against the epic story description
   - **Security?** No secrets, SQL injection, XSS, hardcoded credentials
   - **Tests?** Adequate coverage for the change
   - **Quality?** No dead code, proper error handling, i18n/l10n where needed
   - **Conventions?** Follows monorepo conventions, proper types
   - **Migrations?** Backward-compatible (expand/migrate/contract)
   - **Edge cases?** Error states, loading states, empty states handled
4. **Decision:**
   - **Approve**: If all criteria pass
     ```bash
     gh pr review <pr-url> --approve --body "✅ Approved. <brief reason>"
     gh pr merge <pr-url> --squash --delete-branch
     ```
   - **Request changes**: If issues found
     ```bash
     gh pr review <pr-url> --request-changes --body "<detailed list of issues>"
     ```
5. **Update state**:
   - If **approved & merged**: set `status` to `idle`, mark task done in history, add to `build_completed_tasks`
   - If **changes requested**: set `status` to `fixing`

## Orchestrator (Cron Job) Protocol

The cron job runs periodically and reads `loop-state.json`:

```python
if state.status == "idle":
    # Pick next task from queue (not in completed list)
    # Dispatch Builder agent
elif state.status == "building":
    # Check if enough time has passed - if so, check git for PR
    # gh pr list --head <branch>
    # If PR found, transition to in_review
elif state.status == "in_review":
    # Dispatch Reviewer agent
elif state.status == "fixing":
    # Dispatch Builder agent (to fix)
elif state.status == "idle" and no more tasks:
    # ALL DONE — send completion notification
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