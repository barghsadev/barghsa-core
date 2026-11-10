---
name: Product or engineering change
about: Describe the change, its acceptance criteria and the evidence needed to close it.
---

## Scope

Link the qualified task in the release board. Describe the expected behavior,
affected roles and any known prerequisites.

## Acceptance criteria

List the behavior to verify and the evidence each criterion requires.

## Definition of done

Use the [full definition of done](https://github.com/barghsadev/barghsa-core/blob/main/README.md#definition-of-done).
Check each section after verifying its applicable criteria. Link evidence for the
reviewed commit and record outstanding criteria on the release board.

- [ ] Product and UX cover the required states, both locales and accessibility.
- [ ] Engineering covers existing callers, stored data, compatibility and failure recovery.
- [ ] Tests and quality checks cover the affected behavior and applicable release gates.
- [ ] Security and privacy checks cover authorization, sensitive data and affected trust boundaries.
- [ ] Operations and release evidence covers monitoring, rollback and staged verification where applicable.

Explain inapplicable criteria and link any approved exception record. Every change
must meet the requirements for financial correctness, authorization, auditability,
backup and recovery, and resolve credible Critical security issues.
