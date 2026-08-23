# Barghsa Kanban Coverage Audit — Resolved

**Scope:** `README.md`, `architecture.md`, all seven files in `kanban/epics/`, `task-queue.json`, and `requirements-traceability.json`.

**Final verdict:** The previously identified structural, coverage, contradiction, and traceability issues have been resolved in the executable backlog.

## Verified resolution

- All epic work items use concrete `T-*` IDs.
- Global task identity is `<epic-file>#<task-id>`.
- `task-queue.json` is deterministically generated from every canonical epic task.
- The generated queue contains **1,355 tasks** across all seven epics.
- Original complexity values, including `XS` and `S`, are preserved.
- Epic 05 contributes 100 normalized tasks to the queue.
- All stale prose-only `Gap Remediation` sections were removed.
- Real source gaps were absorbed into normal executable tasks.
- Unsupported/invented remediation proposals were removed rather than implemented.
- The `.44` task typo and phantom `T-10.*` dependencies were fixed.
- SameSite policy has one security-owned task; feature epics reference it.
- The UI stack is pinned to shadcn/ui plus Base UI rather than interchangeable alternatives.
- Electricity green-rule persistence/service ownership is in Epic 03; Epic 02 owns the consuming admin UI.
- Source-backed work now includes analytics privacy/consent, safe global errors, API-client generation, external-call transaction guardrails, config/critical-file restore, account export/closure, staff/customer context separation, agreement versioning, authoritative financial review snapshots, async jobs/progress, placeholder re-extraction, cost reporting, authorization-denial audit, locale E2E, outbox replay, TanStack Query, and missing domain UI flows.

## Machine-enforced coverage

`requirements-traceability.json` contains **115 source-section entries** spanning every heading section of both authoritative source documents. Every entry is marked `covered` and maps to actual generated task keys in the owning epic files.

The validator checks:

- complete epic task extraction;
- unique task keys;
- titles and complexity declarations;
- resolvable task references;
- removal of legacy work-item IDs and remediation appendices;
- known invalid IDs/dependencies and stale status markers;
- source-line coverage and source-section ownership;
- freshness of both generated artifacts.

Run:

```bash
python3 kanban/scripts/build_backlog.py --write
python3 kanban/scripts/build_backlog.py --check
```

Current result:

```text
wrote 1355 tasks and 115 traceability entries
validated 1355 tasks and 115 traceability entries
```

## Operational safeguard

`AGENTS.md` and the cron orchestrator prompt now require `build_backlog.py --check` before selecting work. If validation fails, the loop blocks instead of executing a stale/incomplete queue.

The cron job remains paused until explicitly started.
