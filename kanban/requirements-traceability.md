# Requirements Traceability

This repository treats `README.md` and `architecture.md` as the authoritative product and architecture specifications.

The machine-readable ledger is `requirements-traceability.json`. It is generated from every source heading and maps each section to the concrete queued task keys in its owning domain epic files.

## Regenerate

```bash
python3 kanban/scripts/build_backlog.py --write
```

## Validate

```bash
python3 kanban/scripts/build_backlog.py --check
```

Validation fails when:

- an epic task has no ID, title, or complexity;
- task keys collide within a file;
- a task reference does not resolve;
- legacy non-`T-*` work-item IDs remain;
- a stale `Gap Remediation` section remains;
- known invalid IDs/dependencies remain;
- a source section has no owning epic tasks;
- any source line is outside a traced heading section;
- the generated queue or ledger is stale.

`<epic-file>#<task-id>` is the globally stable key. Bare `T-*` IDs are local to an epic file and must not be used as global identity.
