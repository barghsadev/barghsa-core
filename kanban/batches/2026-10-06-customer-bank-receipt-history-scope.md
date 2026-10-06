# Customer bank-receipt history ownership, October 6, 2026

Release `v0.1.29`. Manual direct-main batch.

## Canonical scope

Repairs the active-profile and full-state bank-receipt list under `04-invoices-wallet-contracts.md#T-04.3.02.03`, with domain adoption of `07-ui-ux-design.md#T-07.15.01.05` and `#T-07.18.01.06`. Existing receipt upload/detail/review/payment engines and labels under `04-invoices-wallet-contracts.md#T-04.3.02.04` remain intact. Broad requirements remain partial; existing engines are not counted again.

## Built and reviewed

The native compound-cursor history now includes the account in its profile/filter scope. It verifies the current profile before each first/more read, masks old scope data immediately, and rejects stale success/denial before and after response parsing. An accepted missing profile clears every retained page. A changed profile discovered during pagination clears old data before reading its first page and discards the previous profile's cursor.

Current profile/history 401/403 withdraws all accepted receipts and pagination. Explicit recovery starts from the first page with status/search/sort/date/exact amount filters intact. Transient and malformed reads retain accepted same-scope receipts and retry the exact failed cursor. The original server-session profile selection, `beforeAt` microseconds and `beforeId` strings remain unchanged. A synchronous action generation retires obsolete pagination/retry callbacks and prevents overlapping more-page reads. Successful empty/new-profile reads reach the ready state and accept only their new cursor.

Existing desktop table/mobile cards, published number preference, deposit-date/calendar policy, account-zone submission dates, detail anchors, private previews and verification timeline remain intact. No API, database, dictionary, shared UI component, dependency, CI, budget or supervisor-state changes. Existing bilingual access text is reused.

## Validation

- The external pre-change regression proves private receipts survive next-page 401/403; profile-denial cases also fail because the old reader never verifies profile reads.
- **21** distinct source cases pass in three actual files: twelve native receipt cases, four profile/resource denial cases and five invoice transport/helper cases. Coverage includes account/profile changes, stale success/denial before rerender, unannounced/missing profiles, no perpetual loading, the new profile's subsequent cursor, malformed-profile retention, exact ascending cursor/filter retries and linked detail identity.
- **36** distinct Chromium/mobile Safari cases pass on the final build, 18 per engine, with zero retries: four new bilingual receipt-ownership cases, sixteen other service/invoice ownership regressions, eight receipt filter/navigation/view cases, four receipt transient-recovery cases and four linked private preview/metadata/timeline cases. Two complete original Persian native captures are reviewed; fixtures are synthetic and image pixels were not edited.
- Web build/types, root/focused lint, contract/suppression, strict SAST (1,803 files; no findings/errors; five fixtures), all 85 unchanged bundle budgets, formatting, backlog and diff checks pass. The unchanged compiled dictionary and 495 final assets are bound externally.

Review found a missing ready-state transition after an unannounced profile change. The added failing regression exposed both perpetual empty loading and disabled subsequent pagination; the product fix and final source checks prove recovery. Original failures remain external. Native profile/cursor ownership is retained without replacing the compound cursor or altering financial guards. No retries, forced clicks, skipped related scenarios or increased budgets.

The v0.1.26/v0.1.27 reports now identify the unavailable test filter correctly from their exact committed trees: `useHistoryFilterDraft.test.tsx` did not exist, while `useListView.test.tsx` and `invoice-service-period.test.ts` did. Case totals are unchanged; original execution/binding/publication receipts remain intact and the correction proof is separate.

## Prior deployment confirmations

`v0.1.26` completed at `2026-10-06T08:04:27.481479+00:00` with verified live commit `84a551d371ce8911a6a25300db948417b057d4bf`, note `78` and restored-profile image `79`. Its other image remains unknown; the completed job truthfully carries the optional-image warning. No unknown image was automatically replayed.

`v0.1.27` completed at `2026-10-06T08:09:28.314705+00:00` with verified live commit `f4a6a9b9237f885560706c91fc2457fa95b3c1ba`; Persian note `80` and both images `81`, `82` are confirmed. External completion receipts bind the actual outcomes.

## Publication

After clean committed preflight and exact normal main-push readback, enqueue immediately with reviewed original Persian captures. Continue the next coherent build without waiting for CI or deployment. Publication/deployment results remain separate external receipts.

External evidence: `~/.local/state/barghsa-manual-batches/customer-bank-receipt-history-scope/`.
