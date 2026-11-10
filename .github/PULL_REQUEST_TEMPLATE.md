## What

Describe the problem and resulting behavior.

## Acceptance criteria

List the required behavior and identify any unmet criterion and its reason.

## Validation

List the exact checks run and their results. Identify unavailable checks.

## Definition of done

Check each applicable item after review and link the evidence for the reviewed
commit. Explain inapplicable items and record unresolved criteria on the task
board. Link any approved [exception record](../docs/security/security-verification.md#definition-of-done-exception).

### Product and UX

- [ ] The change meets the agreed task scope and acceptance criteria.
- [ ] Normal, loading, empty, invalid and recovery states work where applicable.
- [ ] Persian and English copy, RTL, numbers, dates and money render correctly.
- [ ] Labels, keyboard order, focus and error announcements work in affected flows.
- [ ] Affected desktop and mobile layouts preserve the user's inputs and actions.

### Engineering completeness

- [ ] Existing callers and stored data retain their supported behavior.
- [ ] Inputs, state transitions and errors are checked at the appropriate boundary.
- [ ] Concurrent requests, retries and partial failures preserve consistent state.
- [ ] Financial writes are atomic and retain their idempotency and audit records.
- [ ] API and database changes preserve rollout compatibility with the previous release.

#### Database changes

- Phase: none / expand / migrate / contract. Explain the phase for each schema or data change.
- Compatibility: explain how current and previous application versions behave during rollout.
- Data migration: explain batching, retries, validation and completion evidence where applicable.
- Destructive changes: link verified backup/restore proof and the earlier expansion/data-migration PR. Put the contract phase in a separate follow-up PR after old writers are retired and data migration is verified.
- Archive data before removal where retention rules require it; state the archive location and access/retention controls without including private data or secrets.

Follow [the migration procedure](../docs/development/database-migrations.md).

### Tests and quality

- [ ] The reviewed diff is bound to the exact source and test receipts.
- [ ] Targeted unit and integration checks cover changed behavior and affected callers.
- [ ] Relevant browser checks exercise the affected locale, keyboard and device flows.
- [ ] Migration checks cover existing data, failure recovery and rollout compatibility.
- [ ] Applicable lint, type, build, coverage and performance gates pass.

### Security and privacy

- [ ] Authorization and profile isolation hold on both allowed and denied paths.
- [ ] Sensitive data stays out of client responses, operational logs and test artifacts.
- [ ] Input validation, CSRF and external request restrictions remain effective.
- [ ] Dependency, image, secret and license checks cover the proposed release scope.
- [ ] Update the [threat model](../docs/threat-model.md) when this change affects a trust boundary, sensitive data, a provider, permissions, or a financial flow. Link the updated threats or record why the model remains accurate.

### Operations and release

- [ ] The task board identifies the reviewed source and every outstanding criterion.
- [ ] The deployment and rollback steps account for data and configuration compatibility.
- [ ] Health checks, alert routing and recovery procedures cover affected operations.
- [ ] Release evidence includes the applicable provider, backup and restore receipts.
- [ ] The release commit, staging health and Telegram delivery receipts match the accepted milestone when applicable.
- [ ] Production deployment has the owner's explicit approval for the version, commit and target.

## Risks and limitations

Record known limits, operational prerequisites and rollback steps, or write `None`.
