# Electricity price-adjustment history, October 6, 2026

Release `v0.1.25`. Manual direct-main batch, no PR or supervisor-state changes.

## Canonical scope

Domain shared-table adoption under `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`. Retains the existing price-adjustment engines under `03-core-business.md#T-03.08.02.01` through `#T-03.08.02.04`. Existing customer disclosure remains intact. These global tasks remain partial; no new completion count is assigned to existing business engines.

## Built and reviewed

Staff price-adjustment history now uses the shared named desktop table and mobile cards. Published, finalized and cancelled records expose public identity, exact signed percentage, charge/credit outcome, old/new future-period price, net change, reason, contractual basis, account-zone effective/end and lifecycle dates, and adjustment invoice status/reference. Missing invoices remain explicit. Monetary strings and whole percentages retain BigInt precision; only the bounded 0–99 basis-point remainder enters the fractional formatter. Published numeral preferences apply to history and financial reviews.

Every status has a read-only saved-calculation dialog with original invoice/contract/profile/version identities, translated component source, basis, old/new/delta amounts and eligible delivery periods. Component invoice identities use explicit LTR isolation in both languages. Keyboard actions and 44-pixel controls work in both presentations; closing after resizing focuses the currently visible action. The responsive adapter preserves the original DTO object identity required by existing authorization guards. Protected proposal/finalize/cancel ownership, bodies, calculation hashes, step-up, idempotency and receipts retain their engines. Read-only views create no financial command, preserve accepted history on transient reads, withdraw on current denial, and stay closed after recovery.

No API, database, shared-component, dependency, CI, budget or supervisor-state changes.

## Validation

- **185** distinct related source/dictionary cases pass: 73 across seven price/form/history/recovery/navigation/parser files, and 112 dictionary cases.
- **24** Chromium/mobile Safari cases pass on the final reviewed build, 12 per engine, with zero retries. Eight new bilingual light/dark history cases verify values above JavaScript's safe-integer range, account dates, safe text, status-specific controls, invoice references, read-only component disclosure, LTR identities, axe, mobile bounds, keyboard focus after resizing, the exact finalization body/hash, transient reads, current denial and recovery. Sixteen existing cases retain proposal/publish/cancel/finalize retries, customer disclosure, URL navigation and scoped draft/review recovery.
- Web/i18n build and types, root/focused lint, contract/suppression, strict SAST (1,798 files; zero findings/errors; five fixtures), all 85 unchanged bundle budgets, formatting, backlog and diff checks pass.
- Two original Persian native-browser captures are reviewed: a mobile finalized-credit card in light mode and the complete saved calculation in dark mode. Fixtures are synthetic. External evidence binds final source/dependency hashes, 494 built assets and the actual passing browser report. Publication/deployment receipts remain separate.

Failures remain external. Validation caught stale compiled translations, a formatting type mismatch, and duplicate IDs between the mounted responsive presentations. Product fixes rebuild the translation dependency, preserve exact formatting and restore focus through a visible-action lookup. Existing invoice browser selectors now identify the visible presentation. Modal refresh tests explicitly inspect the inert background without bypassing financial guards. No test retries, forced clicks, weakened command assertions or budget changes.

## Deployment confirmation

`v0.1.25` completed at `2026-10-06T06:47:24.832982+00:00`, with exact healthy live commit `88f1d067834ce6be061131a62a27c371415ed0e1`; Persian Telegram note `75` and captures `76`, `77` are confirmed. Docker was initially unavailable after the host interruption. The existing Docker Desktop was started and verified before retrying that exact failed release. External failure, publication and completion receipts preserve the real outcomes and frozen capture hashes.

## Prior deployment confirmation

`v0.1.24` completed at `2026-10-05T23:59:50.517470+00:00`, with exact healthy live commit `48c3c826c328ece20dbcd2aeecd1fdc0e5b8b45e`; Persian Telegram note `72` and captures `73`, `74` are confirmed. Its report and external completion receipt record the actual result.

External evidence: `~/.local/state/barghsa-manual-batches/electricity-price-history/`.
