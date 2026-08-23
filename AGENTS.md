# Barghsa — Autonomous Development Loop Protocol

> **Builder model:** DeepSeek V4 / Flash (Max) — via `delegate_task` subagent
> **Reviewer model:** GPT-5.6 Sol — invoked by orchestrator via OpenRouter API for code review
> **Orchestrator:** Hermes cron job — state management, dispatching, git operations

## How the Loop Works

```
┌──────────────────────────────────────────────────────────┐
│  Orchestrator (cron job, runs every 15 min)              │
│  → Reads loop-state.json                                 │
│  → Decides action based on state                         │
│  → Runs on DeepSeek V4 Flash (default session model)     │
└──────────────────┬───────────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    ▼                              ▼
┌──────────────┐          ┌──────────────────┐
│ STATE        │          │ STATE            │
│ idle         │          │ in_review        │
│              │          │ (PR open)        │
│ Pick next    │          │                  │
│ task from    │          │ Orchestrator:    │
│ queue        │          │ 1. gh pr diff    │
│              │          │ 2. Send diff to  │
│ Dispatch     │          │    GPT-5.6 Sol   │
│ Builder via  │          │    via API call  │
│ delegate_task│          │ 3. Apply review  │
│ (DS V4 Flash)│          │    decision via  │
│              │          │    gh CLI        │
└──────┬───────┘          └────────┬─────────┘
       │                    ┌──────┴──────┐
       ▼                    ▼             ▼
┌──────────────┐    ┌───────────┐  ┌──────────────┐
│ STATE        │    │ GPT-5.6   │  │ GPT-5.6 Sol │
│ building     │    │ Sol says  │  │ says changes │
│              │    │ ✅ Approve│  │ ❌ needed    │
│ Wait for     │    │ → merge   │  │              │
│ builder to   │    │ → mark    │  │ Set state    │
│ push PR      │    │   done    │  │ → fixing     │
│              │    │ → pick    │  │              │
│              │    │   next    │  └──────┬───────┘
└──────────────┘    └───────────┘         │
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

## Reviewer Agent Protocol (GPT-5.6 Sol)

The orchestrator invokes GPT-5.6 Sol via OpenRouter API when a PR needs review.

### When state = in_review:

The orchestrator does the following:

1. **Read** `kanban/loop-state.json` to get `current_pr_url`
2. **Fetch PR diff** and context:
   ```bash
   gh pr diff <pr-url> > /tmp/pr-diff.txt
   gh pr view <pr-url> --json title,body,files,additions,deletions
   ```
3. **Send to GPT-5.6 Sol** via OpenRouter API:
   ```bash
   REVIEW_RESPONSE=$(curl -s https://openrouter.ai/api/v1/chat/completions \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-5.6-sol",
       "messages": [
         {"role": "system", "content": "You are a code reviewer for the Barghsa energy platform project. Review the PR diff against these criteria and respond with ONLY valid JSON in this exact format, no other text:\n
   {
     \"decision\": \"approve\" | \"request_changes\",
     \"summary\": \"<one-line summary>\",
     \"issues\": [
       {
         \"severity\": \"critical\" | \"major\" | \"minor\",
         \"file\": \"<file-path>\",
         \"line\": <line-number>,
         \"description\": \"<whats-wrong>\",
         \"suggestion\": \"<how-to-fix>\"
       }
     ]
   }\n
   Criteria:
   - Acceptance criteria met from task description
   - No secrets, hardcoded credentials, SQL injection, XSS
   - Adequate test coverage for the change
   - Proper error handling (no uncaught rejections)
   - i18n/l10n where user-facing strings are involved
   - Backward-compatible database migrations (expand/migrate/contract)
   - No console.log in production code
   - Edge cases handled (error, loading, empty states)
   - Persistent valid input on error (forms don't clear on validation error)
   - No dead ends for users"},
         {"role": "user", "content": "Task: '$(cat /tmp/task-context.txt)'\n\nPR Title: <pr-title>\n\nDiff:\n$(cat /tmp/pr-diff.txt)"}
       ]
     }')
   ```
4. **Parse the JSON response** to get decision and issues
5. **Apply the review decision** via `gh` CLI:
   - **Approve**: `gh pr review <pr-url> --approve --body "✅ GPT-5.6 Sol approved. <summary>"`
     - Then: `gh pr merge <pr-url> --squash --delete-branch`
     - Update state: mark task done, set status to `idle`
   - **Request changes**: `gh pr review <pr-url> --request-changes --body "<issues from GPT-5.6 Sol>"`
     - Update state: set status to `fixing`
6. **Update** `kanban/loop-state.json` with new state

## Orchestrator Protocol — Full Logic

The orchestrator runs on DeepSeek V4 Flash (default cron model). It reads `loop-state.json` and branches based on state:

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
    # GPT-5.6 Sol does the review
    # ════════════════════════════════════
    # Follow Reviewer Agent Protocol above:
    # 1. gh pr diff <url> > /tmp/pr-diff.txt
    # 2. curl to OpenRouter with model=openai/gpt-5.6-sol
    # 3. Parse JSON response
    # 4. APPROVE: gh pr review + gh pr merge, mark done
    # 5. CHANGES: gh pr review --request-changes, set fixing

elif state.status == "fixing":
    # Builder will fix issues
    # Set status back to "idle" — the task will be re-picked
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