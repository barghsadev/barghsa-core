# Barghsa Build Loop — One Tick

Advance the Barghsa build/review loop by one useful, bounded step.

The working directory and full protocol come from this repository's `AGENTS.md`. First run `python3 kanban/scripts/build_backlog.py --check`; if it fails, set state to `blocked` with the exact validator error and stop. Then read `AGENTS.md`, `kanban/loop-state.json`, and `kanban/task-queue.json`, and reconcile the state with git and GitHub before acting.

Requirements:

- Follow the state machine in `AGENTS.md` exactly.
- Use `<fname>#<id>` as the task key; never treat a bare task ID as globally unique.
- Keep one active task/PR at a time.
- If state is `idle`, select the next task and start implementing it in this run; do not stop at a task brief.
- Continue the current branch/PR when state is `building`, `in_review`, or `fixing`.
- For review, invoke `openai/gpt-5.6-sol` through `hermes chat --query-file ... --provider openrouter`; do not construct raw curl JSON.
- Never merge without a valid reviewer approval and passing available required checks.
- Preserve the current state on transient errors. Use `blocked` only when manual intervention is genuinely required.
- Update `kanban/loop-state.json` after every state transition and before the run ends.
- Do not ask questions; report a concise action/result or blocker.

A cron run has a bounded runtime. Make one concrete unit of progress and leave truthful, resumable state for the next tick.
