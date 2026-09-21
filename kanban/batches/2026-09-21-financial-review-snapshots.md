# Financial review snapshots

Branch: `codex/financial-review-snapshots`, based on verified PR331 merge `abe6f4cf113ab04d67df6c937ba319a128dff5df`.

This batch starts the shared financial-review work in `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`. It introduces the common snapshot contract and binds customer invoice wallet payment to the exact reviewed values. It must preserve atomic settlement, active-profile authorization, step-up verification and safe idempotent retries.

The review must show authoritative invoice calculations and payment context, use exact monetary strings, reject changed confirmation values before moving funds, and persist the confirmed snapshot with the committed payment. Both cached and durable-ledger replay must verify the original confirmation without requiring the already-paid invoice to match its former unpaid state. The UI will use the existing shared `FinancialReviewSummary`.

This is a partial implementation of the four canonical tasks. Order submission, bank confirmation, contract acceptance/signature, refunds and adjustments remain open until their own snapshot bindings and display-to-commit tests exist. Do not mark the whole tasks complete after the wallet integration.

Status: implementation built. The customer review includes active profile, issued invoice lines, quantities, exact unit prices, discounts, VAT, dates, wallet balances and published contract prerequisites. Internal drafts remain private. Profile/invoice/wallet locks keep the reviewed facts stable through settlement. Both cached and durable-ledger retries validate the stored pre-payment review. Legacy invoices with no stored breakdown disclose that absence instead of inventing VAT or discounts.

The bilingual confirmation displays the captured shared summary, supports keyboard scrolling and preserves its exact hash and request key across retries. Changed review values require a new confirmation, even when the remaining amount is unchanged. Old open tabs must reload to supply the newly required hash. No database migration is needed; the existing immutable ledger metadata stores the full confirmation.

Validation:

- 96 API tests pass, including non-zero VAT, inconsistent breakdown rejection, stale profile/date/balance checks, private versus published contract conditions and both replay paths.
- 40 browser cases pass across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari. They cover English/Persian, light/dark, safe retries, changed conditions with unchanged amount, malformed reviews, legacy invoices and keyboard scrolling. Persian desktop/mobile screenshots were inspected.
- 987 shared Vitest tests pass. The focused parser suite has 10 cases; the focused display suite has 2 cases covering taxable and exempt lines.
- API/web types, scoped lint, OpenAPI snapshot checking, production build and 44 bundle budgets pass.
- Focused API coverage collection passes all 96 tests but fails the whole-package floor because it selects only five files. It is not a full API coverage pass. Changed-source coverage passes the original thresholds after exercising the public parser export, ownership dialog, corrupted cache, derived balance and debit-error rollback paths. Independent review and PR CI remain required.
- Local semgrep is unavailable; the required CI scanner remains a merge gate.

No supervisor state is changed.

Previous batch: [PR331](https://github.com/barghsadev/barghsa-core/pull/331) merged contract draft authoring after [exact-head approval](https://github.com/barghsadev/barghsa-core/pull/331#issuecomment-5756860520) and all five checks in [run35572440369](https://github.com/barghsadev/barghsa-core/actions/runs/35572440369). Its final changed-source coverage passes the original thresholds. Full main runs35572387200 at PR330 and35573972967 at PR331 both passed all five jobs.

Independent review of the implementation found that the dialog mounted a second account-time loader and could confirm before its dates resolved. The panel now owns one formatter for both summaries, disables confirmation while it is unavailable and renders its retry notice inside the dialog. A browser regression proves initial failure, no additional dialog read, failure after opening, guarded form submission and successful recovery. All 18 Chromium/mobile Chrome cases pass after this fix. Final review and CI are pending.

Verified outcome: [PR332](https://github.com/barghsadev/barghsa-core/pull/332) merged as `f665d50535040e3c45699cc14aafaa2367a71bad`. Final reviewed HEAD `50f5dda56723311aea0a3693e556d5896019c69a` received [approval](https://github.com/barghsadev/barghsa-core/pull/332#issuecomment-5757687909), all five checks passed in [run35578648191](https://github.com/barghsadev/barghsa-core/actions/runs/35578648191), and changed-source coverage passed without threshold changes. Final browser validation is 45 wallet cases across all five projects plus two Chromium ownership-dialog cases. This supersedes earlier pending statuses. Broader cross-command tasks remain partial.
