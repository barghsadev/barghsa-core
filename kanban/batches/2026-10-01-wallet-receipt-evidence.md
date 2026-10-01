# Customer wallet receipt evidence

Date: October 1, 2026. Manual batch, published directly to main under the user's instruction.

## Task scope

- `07-ui-ux-design.md#T-07.18.03.03`: extend the existing customer receipt detail pattern to wallet receipt evidence. Broader receipt search/sort and staff list requirements remain partial.
- `04-invoices-wallet-contracts.md#T-04.3.02.03` and `04-invoices-wallet-contracts.md#T-04.2.02.03`: let customers reopen the sealed evidence from the original wallet top-up intent, including pending, confirmed and rejected receipts.

## Delivered

Wallet receipt details now offer a lazy private preview with retry and an original-file link. The existing invoice receipt component and bounded image/PDF renderer are shared. Invoice selection behavior and its URLs remain compatible. Preview requests begin only when the preview disclosure is opened, and receipt/profile/page changes discard the old image. The original link opens separately with no referrer. Both languages use the existing receipt dictionary and fit the established light/dark presentation.

New authenticated preview and attachment endpoints require the current wallet-view grant, active profile and an original bank-receipt top-up in that wallet. Authorization runs before storage access and is retained through the final live-session check. Completed credit rows and other transaction types/channels cannot expose receipt evidence. The endpoint prefers the durable sealed attachment column; legacy metadata is usable only when its storage record is immutable. Removed/mutable evidence is unavailable. MIME comes from the immutable record. Missing legacy MIME disables inline preview while retaining original access where the sealed object is available.

Inline previews serve PNG bytes from the same origin with private/no-store and nosniff headers. The existing renderer limits source reads to 15 MiB, image decoding to 25 million pixels, dimensions to 640, and PDF processing to ten seconds; cached response reads are capped at 5 MiB. Wallet derivatives have a separate namespace with the existing source-key hash/day cache policy. Original links redirect to a five-minute signed URL. No CSP changes, public storage keys, ledger mutations or financial review changes are introduced.

The OpenAPI contract describes both new endpoints and the curated optional receipt details/timeline already returned by wallet history, including missing event times and a nullable current-review state.

## Validation and review

- 88 distinct affected unit/integration cases have passing evidence: API 44 and web 44. Repeated cases are not counted again.
- API: the existing customer-wallet access/history and document renderer suites pass 23 cases. The final `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/wallet/customer-wallet-receipt-http.integration.test.ts` passes all 21 new real PostgreSQL/MinIO cases. PNG/JPEG/WebP and multi-page PDF bytes, cached derivatives, original bytes and five-minute signing, private headers, sealed-column priority, foreign/changed/archived profiles, removed grants, expired sessions, malformed IDs, credit exclusion, legacy metadata, missing MIME, corrupt/missing sources and oversized cached reads are verified. PDF checks run without a skip.
- Web: receipt preview and transaction history suites supply 16 passing cases; invoice detail and bank-receipt page suites add 28. Tests cover lazy loading, encoded scope, localized descriptions, unavailable/retry and existing invoice selection.
- Production browsers: the existing invoice-detail suite passes four bilingual scenarios in Chromium/mobile Safari. The final `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/wallet-receipt-timeline.spec.ts --project=chromium --project=mobile-safari` passes eight wallet scenarios. Both languages/themes, keyboard opening, failed-preview retry, no eager reads, exact metadata/times, original-file popup and native redirect, no referrer, page/filter scope, Axe/contrast and mobile bounds are verified. Persian dark-mode mobile rendering was inspected.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, affected final-test lint, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors`, `pnpm check:bundle` pass. All 65 size limits remain unchanged; wallet 253.85 KB / 300 KB and electricity ordering 246.63 KB / 255 KB.
- Strict security passes five rule fixtures and scans 1,395 files with zero findings/errors. Backlog validation retains 1,355 tasks and 116 traceability entries; diff whitespace passes.
- Review checked authority before storage access, final session verification, original-versus-credit identity, sealed keys and immutable MIME/status, current profile isolation, bounded derivatives, private binary headers, signed originals, shared invoice compatibility, URL encoding, lazy loading/recovery and public contract consistency. Initial failures were test assumptions: a UUID-inferred helper was too narrow, the global cache interceptor adds stronger private-cache flags, nested disclosures need direct-summary selectors, and redirected requests/302 mocks do not behave consistently across browser engines. The final fixture uses a small local server for native redirects; checks retain the full original-file flow. Initial failed invocations are not reported as passing.

## Publication and remaining work

This batch is committed and pushed directly to main. Local/origin/GitHub SHA, clean tree and exact-commit CI registration are read back. Remote CI remains pending at publication; no remote success is claimed. Historical supervisor state, handoffs and completion ledgers are unchanged, as are existing CI fast mode and coverage exemption.

Customer wallet receipt metadata, verification timeline and evidence access are now present. Broader receipt search/sort and other unfinished product requirements remain open. Broad history/list parents are not marked complete by this batch.
