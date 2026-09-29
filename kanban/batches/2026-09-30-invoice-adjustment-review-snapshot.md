# Paid-invoice adjustment financial review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.01`–`.04` for staff-issued adjustments to invoices with confirmed payment. The wider cross-command financial review tasks remain partial.

Finance staff now preview the current issued invoice, line values, paid and remaining amounts, signed adjustment, reason, and current second-approval requirement before submission. The preview is scoped to the invoice and profile and carries an exact hash. The adjustment endpoint requires that hash and rechecks the invoice and approval rule under transaction locks. Changed invoice values or rules reject stale confirmation without creating an adjustment. A retry with the same idempotency key is bound to the confirmed review rather than recalculating a new command. Immediate issuance and issuance after second approval retain the confirmed review in an audit record.

The staff UI presents this preview in a bilingual accessible confirmation dialog before the existing step-up, issue, pending-approval, and safe-retry flow. The adjustment remains a separate linked invoice; the original issued lines are not edited. The preview describes the current invoice and proposed adjustment, not a guarantee of the final due date if issuance occurs later after second approval.

Validation: focused invoice-corrections HTTP integration, Chromium correction journeys, API/web typechecks, lint, build and OpenAPI contract checks. See the batch commit and CI run for final results.
