# Unpaid-invoice replacement financial review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff cancel-and-replace corrections before confirmed payment. Other financial commands in the cross-command review tasks remain open.

Finance staff now preview the current invoice, proposed replacement lines, exact calculated subtotal/VAT/total, reason, and current due-date rule. The preview carries a hash scoped to the original invoice and profile. Submission rechecks that hash while holding the original invoice and applicable electricity-contract locks, before cancelling or issuing anything. Changed invoice values or due-date rules reject stale confirmation. The original is cancelled and the linked replacement is issued in one transaction; the confirmed review is retained in the audit log. Same-key retries return the existing result without issuing another invoice.

The bilingual confirmation view includes the source and replacement figures. The due date itself is determined at issuance; the review binds the rule and shows the number of days, not a fabricated fixed date.

The batch also repairs CI failures found after the prior paid-adjustment push: older web boundary fixtures now follow its review step, the paid-cancellation refund test supplies the required review hash, and `undici` 7.x/8.x resolve to patched transitive versions. Local dependency audit reports zero high or critical advisories.

Validation: focused correction and replacement API suites, web boundary tests, Chromium correction journeys, shared/API/web builds and typechecks, OpenAPI contract, lint, formatting, route budgets, dependency audit, and canonical backlog check. See the batch commit and CI run for final results.
