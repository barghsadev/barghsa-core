# Contract draft authoring

Local branch: `codex/contract-draft-authoring`, started from PR330 head `a9cb854892437a5b529590bf4c03ccfa56d59cce` while its Linux browser validation runs. Rebase onto its verified squash merge before opening this batch's PR. No supervisor state is changed.

This batch makes the existing staff draft creation and immutable draft-edit APIs usable from the contract workspace. It supports the versioning requirement in `04-invoices-wallet-contracts.md#T-04.5.02.01` and the contract workspace pattern in `07-ui-ux-design.md#T-07.18.03.01`. It does not claim to finish every requirement of either task.

Staff can search active profiles by name, page eligible orders for the selected profile, enter a title and terms, and confirm a draft after password verification. Draft and ChangesRequested contracts expose an editor for the current version. The captured mutation includes the exact expected version and an idempotency key. Imported fields, exact monetary strings and unchanged text are preserved; structured title/text fields cannot be overwritten by the plain-text editor. Existing service-date editing remains separate. Saving requested changes uses the existing server resubmission behavior.

The lookup requires contract-writing permission and returns only profile labels or eligible order references. It excludes archived profiles and cancelled orders and uses bounded cursor pages. Creation still revalidates profile/order/service identity on the server. Contract publication, customer acceptance, signatures and activation remain separate guarded commands.

Validation so far:

- Contract HTTP, review and activation suites: 58 tests pass, including lookup permissions, field minimization, literal search, malformed input, pagination and order ownership boundaries.
- Draft editor, workspace and service-context suites: 23 tests pass, including bilingual creation, captured confirmation, imported-field preservation, oversized UTF-8 rejection, selection resets and lookup recovery.
- API/web type checking, scoped lint, production build and 44 bundle budgets pass.
- Browser create/edit and accessibility checks are in progress. The first scan encountered scroll-clipped text and now uses the established geometry proof plus strict rescan. The first retry scenario omitted re-entering the password cleared by the existing confirmation dialog; the fixture now follows that real interaction.

Browser follow-up: all4 create/edit flows pass in Chromium and mobile Chrome across English/light and Persian/dark. They verify strict accessibility after proven scroll clipping, password re-entry, identical idempotent retries, automatic display of the created contract, preservation of imported values and read-only historical versions. Persian desktop and mobile screenshots were inspected. The OpenAPI snapshot is updated and its checker passes; all53 dictionary tests pass.

Coverage collection repeats the58 passing API cases. Its whole-package floor fails because only three files are selected; this is not claimed as a full API coverage pass. The generated measurements will feed the separate required changed-source gate. The local static scan is unavailable because `semgrep` is absent from PATH; the PR's required scanner must pass in CI.

Before merge: verify changed-source coverage on a clean commit, obtain independent exact-head approval and pass all PR checks.

Remaining contract work includes template generation, authoritative financial review snapshots across financial commands, and post-acceptance amendments with renewed acceptance/signatures. This editor does not substitute plain text for those workflows or claim generic draft content is an authoritative price calculation.
