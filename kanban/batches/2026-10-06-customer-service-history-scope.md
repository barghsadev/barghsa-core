# Customer service-history ownership, October 6, 2026

Release `v0.1.26`. Manual direct-main batch.

## Canonical scope

Repairs domain adoption of `07-ui-ux-design.md#T-07.15.01.05` (profile isolation) and `07-ui-ux-design.md#T-07.18.01.06` (list lifecycle/recovery), including electricity history under `03-core-business.md#T-03.07.04.01`. Saving and solar histories reuse the same ownership boundary. These global requirements remain partial; existing domain engines are not counted again.

## Built and reviewed

Electricity orders, saving orders and solar requests now share a customer-history reader. Accepted pages belong to the current account, existing profile-context revision, endpoint and applied criteria. Account/profile changes immediately mask the old pages; obsolete success and denial responses cannot alter a newer scope. A changed profile discovered during pagination discards the previous profile's cursor before reading the new profile. An accepted missing profile clears all accumulated pages.

Current profile/history 401 or 403 responses withdraw every accepted page and pagination cursor. The bilingual access message offers explicit recovery from the first page with the selected filters. Transient and malformed reads retain accepted same-scope pages and retry the exact failed cursor. Scoped cursor clear/reset actions and guarded obsolete pagination callbacks preserve existing history callers. Presentation, filter URLs, view preferences, exact amounts, account dates, business actions and financial-command engines remain intact.

Source review covers response freshness before and after body parsing, current-profile revision checks before React rerenders, withdrawal without automatic refetch, first-page recovery and same-profile transient retention. No API, database, shared UI component, dependency, CI, budget or supervisor-state changes.

## Validation

- **141** distinct source/dictionary cases pass: 29 cases in six actual history/view files and 112 dictionary cases. The requested `useHistoryFilterDraft.test.tsx` filter matched no existing file and is not claimed as a passing test.
- **56** distinct final-build history browser cases pass, 28 per engine, with zero retries: 12 new bilingual electricity/saving/solar cases and 44 existing history recovery/view cases. New cases exercise transient retention, current denial, explicit recovery, a real live profile switch, a held obsolete reply, preserved numeric search/status criteria, axe and mobile bounds.
- **10** distinct broader electricity/saving/solar journey cases have passing evidence, five per engine, covering order review, payment, contract activation, saving approval/fulfillment, solar upload/postal review, address setup/return and exact contract/invoice issuance. Total browser coverage is **66 distinct cases**, 33 per engine. The case ledger retains four passing cases from one stopped run and two address cases from another; failed/interrupted cases are excluded and replaced by final passing targeted results. Stopped suites are not reported as wholly green.
- Web/i18n build and web types, root/focused lint, contract/suppression, strict SAST (1,801 files; no findings/errors; five fixtures), all 85 unchanged route budgets, formatting, backlog and diff checks pass.
- Two complete original Persian native-browser captures are reviewed: history withdrawn after denial and the new profile's restored history with selected filters. External evidence binds source, compiled dictionary, 495 unchanged built assets and reviewed capture hashes. The final capture-only repeat adds no distinct case.

The baseline next-page denial visibly retained a private old row; the external failing regression proves that defect before the product edits. Existing browser fixtures/selectors were reconciled with current contracts: contract pagination selects its exact Next action; the electricity journey selects the financial product table; saving review fixtures carry identical source/review snapshots and the exact approval receipt. Solar address setup carries the current profile summary and complete saved-address timestamps and verifies the dialog closes after receipt acceptance. Solar issuance reuses the current review-schema fixture and the actual HTTP 200 receipt contract. These changes retain the production guards and business assertions. No forced clicks, test retries, skipped scenarios or raised budgets.

## Prior deployment confirmation

`v0.1.25` completed at `2026-10-06T06:47:24.832982+00:00`, with exact healthy live commit `88f1d067834ce6be061131a62a27c371415ed0e1`; Persian Telegram note `75` and captures `76`, `77` are confirmed. Its report and external completion receipt record the actual result, including recovery from unavailable Docker.

## Publication

Publication and deployment results are separate external receipts. After a clean committed preflight and exact normal main-push readback, enqueue this release immediately with both reviewed captures. Continue the next coherent build without waiting for CI or deployment.

External evidence: `~/.local/state/barghsa-manual-batches/customer-service-history-scope/`.

## Deployment confirmation

`v0.1.26` completed at `2026-10-06T08:04:27.481479+00:00` with exact live commit `84a551d371ce8911a6a25300db948417b057d4bf`. Persian note `78` and restored-profile image `79` are confirmed. The other image remains unknown; the completed job retains an optional-image warning. No automatic replay. External completion/failure receipts record the actual outcome.
