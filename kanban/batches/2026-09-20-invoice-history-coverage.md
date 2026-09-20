# Invoice history coverage follow-up

Branch: `codex/invoice-history-coverage`.
Status: local implementation complete; independent review and CI pending.

## Trigger and scope

Main run [35510852358](https://github.com/barghsadev/barghsa-core/actions/runs/35510852358) passed unit/integration tests, full production browser checks and security after PR #308, but failed combined critical-source coverage. The API invoice activity/details group measured 87.5% lines / 78.87% branches; the frontend invoice group measured 91.39% / 83.2%. Required floors remain 90% / 85%.

This maintenance of `04-invoices-wallet-contracts.md#T-04.3.02.01` and `.03` adds meaningful test cases without changing product behavior. API cases cover serialized/malformed legacy metadata, exact bigint and legacy money representations, invalid dates, line ordering, incomplete correction families, missing viewed invoices and a mismatched session actor. Frontend cases cover invoice-list errors and receipt form validation, correction of invalid inputs, missing active profile, upload failure/retry, rejected submissions, trimmed notes, duplicate submissions and late profile responses after unmount.

## Validation

The invoice API group passes 42 tests with 94.37% line / 95.07% branch coverage. The four frontend files pass 25 tests with 100% line / 91.15% branch coverage from unit tests alone. The separately checked wallet refund group passes its 25 tests at 97.19% lines / 89.07% branches. Coverage commands explicitly enforce 90% lines / 85% branches; no thresholds are lowered. API and frontend typechecks, changed-file lint and formatting pass. `python3 scripts/check-changed-coverage.py --base e326bdbecf94ff37a69932500f6a720546f8830f --report /tmp/barghsa-history-closure-gate.json` passes all groups using the collected reports: combined invoice/refund API critical files cover 324/338 lines and 241/261 branches; frontend covers 150/150 lines and 103/113 branches. This verifies the original failed requirement rather than relying on a test-only diff producing an empty gate. Combined API coverage runs 67 tests; i18n coverage also passes 50 tests.

The external refund batch remains committed locally with 35 refund tests and 36 combined refund/template tests passing. It will be rebased and independently reviewed after this follow-up. Automatic scheduling and historical completion arrays are unchanged.
