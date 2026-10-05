# Product catalogue search and pagination, October 6, 2026

Release `v0.1.21`. Manual direct-main batch, no PR or supervisor-state changes.

## Canonical scope

The remaining search/status/sort/pagination capability in `03-core-business.md#T-03.01.03.02`, using the established `/api/admin/catalogue/products` endpoint. All four staff product categories share this list. URL and native filter adoption advances `07-ui-ux-design.md#T-07.18.02.04` and `#T-07.10.01.02`. Broader product and global list tasks remain partial; generated queues and historical completion state are unchanged.

## Delivered and reviewed

The API accepts bounded shared criteria, rejects malformed controls before querying and preserves the complete type-only array contract used by hardware selectors and other existing clients. Paged reads return arrays plus `X-Has-Next-Page`, determined by one bounded lookahead row. They fetch at most 101 rows and aggregate only the displayed page. Search matches Persian/English titles and system keys, treating wildcard/backslash characters literally through bound parameters. Status is exact. Creation/title/effective-price sorts use trusted column/direction choices, deterministic ID ties and null prices last. Effective versioned prices remain exact PostgreSQL bigint values. Read permissions and mutation/receipt/audit engines are retained. OpenAPI now documents the filters, bounds and next-page header.

Native bilingual filters validate before Apply/Enter. Unapplied text does not fetch or change the URL; applied criteria, page size and page survive reload and Back/Forward. Changing criteria resets the page. Clearing filters retains the product category. The server owns order and page boundaries; tables/cards retain their common presentation. Existing complete-array responses without a pagination header use the conservative full-page next-page hint. Current paged API responses always provide the verified exact flag.

One independently loaded editor survives page/filter changes when its product is absent from the visible subset. The old complete-list removal inference is retained only for standalone complete-list consumers. Current filtered pages cannot be used as deletion evidence. Same-query failures retain accepted rows and independent draft work. Obsolete denied responses are ignored; current denial clears private business owners and disables the remaining public list criteria. Delayed filter validation is bound to its mounted scope and current operation eligibility.

No migration, dependency, budget, CI or permission-model changes.

## Validation

- **319** distinct related API/shared/source/dictionary cases pass: 89 catalogue API/service/HTTP/saving-catalogue cases, 15 shared query cases, 103 web catalogue/form/query cases and 112 dictionary cases. The final authenticated HTTP file passes all 29 cases. Real disposable PostgreSQL/HTTP checks verify literal bilingual search, future/current price versions, exact large prices, null-last order, both page boundaries, status and denied reads. Shared distribution checks cover all 27 ESM/CommonJS/export cases.
- **98 distinct** related Chromium/mobile Safari cases have passing evidence, **49 per engine**, including eight new query cases and zero retries. The final combined run verifies all 98 cases against the final clear-handler build. Earlier failures and retained-case proofs remain in external evidence. It covers raw draft retention, applied criteria, URL/page restoration, exact terminal boundaries, linked validation, stale-response rejection, retry/denial, all four catalogues and existing pricing, agreement and inventory workflows.
- Web and API builds, workspace types with 11 successful tasks, root/focused lint, contract/suppression checks, strict SAST with 1,798 files and zero findings/errors, five scanner fixtures and all 85 unchanged budgets pass. The catalogue route is 452.77 KB gzip against the unchanged 500 KB limit.
- Two full original Persian light/dark mobile screenshots are reviewed. Fixtures are synthetic and contain no credentials/private records. Current browser assets and production UI/shared source retain their final build hashes; final metadata/tests are separately bound. Changed-file formatting, canonical queue validation and diff checks pass before commit.

Initial failures remain preserved. A shared-output race between concurrent typecheck and API-fixture builds is repaired by serializing dependent builds. Strict checks catch unknown HTTP JSON test types. Browser checks find and fix the actual complete-list deletion inference when moving to bounded pages. Eight old denial assertions are scoped to private owners because the new disabled criteria form remains; the disabled native search control is checked instead of applying the control-only matcher to a fieldset. Review also fixes clearing an unapplied-only draft when the applied URL is already at its defaults; all eight new cases exercise that path. Captures are refreshed to show filters and complete records. No guards, accessibility rules or budgets are relaxed.

Publication, exact remote SHA, immutable queued captures and deployment/Telegram outcomes are separate receipts.

## Preceding release

`v0.1.20` completed at `2026-10-05T22:30:36.531424+00:00`, with healthy exact live commit `0e2d02cc2aae76b855fbd5fa6b18e4bdf68bc32e`. Persian Telegram note `61` and reviewed screenshots `62`, `63` are confirmed. Its report and external receipt record completion.

External evidence: `~/.local/state/barghsa-manual-batches/product-catalogue-query/`.
