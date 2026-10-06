# Customer invoice-history ownership, October 6, 2026

Release `v0.1.27`. Manual direct-main batch.

## Canonical scope

Repairs invoice-list adoption under `07-ui-ux-design.md#T-07.15.01.05` (active-profile isolation) and `07-ui-ux-design.md#T-07.18.01.06` (list lifecycle/recovery). Retains the profile-scoped financial-history requirement of `04-invoices-wallet-contracts.md#T-04.3.02.03` and the existing correction/detail engine under `#T-04.1.05.04`. Broad requirements remain partial; existing business engines are not counted again.

## Built and reviewed

Customer invoice history reuses the shared account/profile/query-owned history reader. Current profile or history 401/403 withdraws every accepted page and the next cursor. Explicit recovery starts from page one with unpaid/status/search/date/exact amount criteria intact. Account/profile changes mask old rows immediately, discard old-profile cursors and fence late responses. Accepted missing profiles clear history; transient or malformed reads retain accepted same-scope pages and retry the exact cursor.

The invoice API selects the active profile from its authenticated server session. The reader's explicit `implicitProfile` option preserves that transport contract and is part of its cache scope; it sends no unsupported profile parameter and retains canonical empty/filter URLs. Electricity, saving and solar keep their existing explicit profile parameters. Presentations, invoice links, precision, dates, filter drafts and financial commands remain intact. The old public fetch helper remains compatible for existing consumers.

No API, database, dictionary, shared UI component, dependency, CI, budget or supervisor-state changes. Existing bilingual access text is reused.

## Validation

- The pre-change invoice test proves next-page 401/403 retains a private prior invoice; the profile-denial cases also fail because the original list does not verify profile reads. The external baseline preserves the failures.
- **32** distinct related source cases pass across seven actual files: invoice ownership/page/helper tests, shared reader/cursor, the three service-history pages and invoice service-period formatting. The requested `useHistoryFilterDraft.test.tsx` filter matched no existing file and is not claimed as a passing check.
- **48** distinct Chromium/mobile Safari cases pass, 24 per engine, with zero retries: four new bilingual invoice-ownership cases, twelve service-history ownership regressions, twenty-eight list recovery cases and four exact invoice-filter cases. They verify live profile switching, a held obsolete reply, current denial/recovery, transient retention, exact large amounts, unpaid/status/date/amount/search filters, page reset, axe and mobile bounds.
- Web build/types, root/focused lint, contract/suppression, strict SAST (1,802 files; no findings/errors; five fixtures), all 85 unchanged route budgets, formatting, backlog and diff checks pass. The unchanged compiled dictionary and 495 built assets are bound to the browser evidence.
- Two complete original Persian native-browser invoice captures are reviewed. The targeted final capture repeat adds no distinct case. Publication/deployment outcomes have separate external receipts.

Review verifies the shared option is included in ownership, defaults preserve the three existing services, the server session remains authoritative for invoices, obsolete reads cannot alter the current profile, denial does not automatically refetch, and financial filter text remains exact. Tests use real profile switching and applied filters. No financial guard changes, forced clicks, retries, skipped cases or raised budgets.

## Publication

After the clean committed release preflight and exact normal main-push readback, enqueue immediately with both reviewed captures. Continue the next coherent build without waiting for CI or deployment.

External evidence: `~/.local/state/barghsa-manual-batches/customer-invoice-history-scope/`.

## Deployment confirmation

`v0.1.27` completed at `2026-10-06T08:09:28.314705+00:00` with exact live commit `f4a6a9b9237f885560706c91fc2457fa95b3c1ba`; Persian note `80` and both images `81`, `82` are confirmed. External completion receipts record the actual outcome.
