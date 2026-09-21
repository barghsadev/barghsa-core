# Contract draft authoring

Local branch: `codex/contract-draft-authoring`, rebased onto verified PR330 squash merge `331cbc005351e6f58f29fa1ee71dac93072546f1`. No supervisor state is changed.

This batch makes the existing staff draft creation and immutable draft-edit APIs usable from the contract workspace. It supports the versioning requirement in `04-invoices-wallet-contracts.md#T-04.5.02.01` and the contract workspace pattern in `07-ui-ux-design.md#T-07.18.03.01`. It does not claim to finish every requirement of either task.

Staff can search active profiles by name, page eligible orders for the selected profile, enter a title and terms, and confirm a draft after password verification. Draft and ChangesRequested contracts expose an editor for the current version. The captured mutation includes the exact expected version and an idempotency key. Imported fields, exact monetary strings and unchanged text are preserved; structured title/text fields cannot be overwritten by the plain-text editor. Existing service-date editing remains separate. Saving requested changes uses the existing server resubmission behavior.

The lookup requires contract-writing permission and returns only profile labels or eligible order references. It excludes archived profiles and cancelled orders and uses bounded cursor pages. Creation still revalidates profile/order/service identity on the server. Contract publication, customer acceptance, signatures and activation remain separate guarded commands.

Validation:

- Contract HTTP, review and activation suites:58 tests pass, including lookup permissions, field minimization, literal search, malformed input, pagination and order ownership boundaries.
- Draft editor, workspace and service-context suites:23 tests pass, including bilingual creation, captured confirmation, imported-field preservation, oversized UTF-8 rejection, selection resets and lookup recovery. All53 dictionary tests pass.
- API/web types, scoped lint, production build,44 bundle budgets, OpenAPI snapshot checking and backlog validation pass.
- All10 create/edit browser cases pass across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari in English/light and Persian/dark. They verify strict accessibility after proven scroll clipping, password re-entry, identical idempotent retries, automatic display of the created contract, preservation of imported values and read-only historical versions. Persian desktop and mobile screenshots were inspected.
- Pre-rebase changed-source coverage passes the unchanged critical90% line/85% branch floors: API53/54 lines and21/23 branches; web236/245 lines and285/309 branches; dictionaries3/3 lines and6/6 branches. Final rebased-head coverage remains a merge gate.
- Focused API coverage collection repeats58 passing cases but fails the whole-package floor because only three test files are selected. This is not a full API coverage pass. Local static scanning is unavailable because `semgrep` is absent; the required PR scanner must pass in CI.

Before merge: verify final-head changed-source coverage, obtain independent exact-head approval and pass all PR checks.

Remaining contract work includes template generation, authoritative financial review snapshots across financial commands, and post-acceptance amendments with renewed acceptance/signatures. This editor does not substitute plain text for those workflows or claim generic draft content is an authoritative price calculation.

Final outcome: PR331 merged as `abe6f4cf113ab04d67df6c937ba319a128dff5df` after exact-head approval and all five checks in run35572440369. Clean-head coverage at `1cda10995e6341b48f498d3c801b88a43813784e` passes: API53/54 lines and21/23 branches; web236/245 lines and285/309 branches; dictionaries5/5 lines and9/10 branches. The broader template, financial-review and amendment requirements remain open.
