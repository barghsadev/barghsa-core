# Draft contract dates and invoice editing

Canonical tasks `04-invoices-wallet-contracts.md#T-04.5.02.01` and `04-invoices-wallet-contracts.md#T-04.5.01.04`, staff interface portion. Build on the end-of-term completion batch. Open this PR only after that batch merges and rebase onto its verified merge.

Allow staff to edit the current Draft or ChangesRequested version's service dates and initial invoice reference. Reuse the existing versioned, authorized, step-up protected mutation. Preserve the full content snapshot and unchanged timestamp precision. Require a change reason, validate dates in the saved account timezone, reject nonexistent local times and reversed intervals, and explain the new version and resubmission effects. Published and historical versions stay read-only. Keep bilingual labels, RTL and accessible controls.

Local implementation passes web typechecking and 30 focused component/date conversion tests. Production browser validation, actual combined coverage, lint/build checks, independent review and CI remain. This does not implement general contract content drafting, typed financial preview, cancellation, amendments or financial closure.
