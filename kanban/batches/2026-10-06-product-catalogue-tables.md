# Staff product catalogue tables, October 6, 2026

Release `v0.1.20`. Manual direct-main batch. No PR or supervisor-state change.

## Canonical scope

Domain adoption of `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04` and list-view work under `07-ui-ux-design.md#T-07.18.01.05`. The single staff catalogue serves consultation, electricity, hardware and saving-plan products. Existing engines under `03-core-business.md#T-03.01.02.04`, `#T-03.01.03.02` through `#T-03.01.03.05` and `#T-03.01.04.01` through `#T-03.01.04.06` are retained. Product search/status/sort/pagination requirements and global list adoption are separate incomplete criteria; this presentation change does not close whole tasks.

## Delivered and reviewed

All four catalogues reuse the shared desktop table/mobile card presentation, native row and column headers, sticky headers, localized row counts and named keyboard scrolling. Records retain the original localized title, status, exact price and authorized Edit action. Saved descriptions, applicable categories, immutable electricity system keys and consumption bounds are visible without opening each product. Unset prices retain the existing Not priced label. Missing descriptions/categories/bounds use the shared unavailable marker; a saved electricity maximum of zero is explicitly No upper limit. Published numeral preference applies to exact 18-digit IRR values, row counts and consumption bounds. Stored content is escaped and mixed-direction values isolated.

The one existing product editor, versioned price owner, inventory panel and saving agreement owner remain outside both presentations. Raw text, price fields and a captured password survive viewport changes without duplicate reads or commands. Existing category URL behavior, keyboard tabs, exact receipts, field errors, permission/step-up, configuration dependencies and uncertain-create protections remain. A transient list failure retains the accepted records and independent editor; Edit still opens an independently verified detail resource. Current access denial clears private product/price work and both list presentations.

No API, migration, dependency, permission, CI, budget or historical state changes. Unchanged backend suites are not repeated.

## Validation

- **214** related source/dictionary cases pass: 102 product, price, catalogue, agreement and inventory source cases across seven files, plus 112 dictionary cases across 44 files.
- **90 distinct** related Chromium/mobile Safari cases have passing evidence, **45 per engine**, with zero retries. The verified ledger retains 72 passing unchanged baseline cases, adds the two targeted Chromium launch recoveries and all 16 final new table cases. Coverage includes all four product types, both languages, light/dark treatments, opposite published numerals, exact 18-digit prices, unpriced/archived records, escaped content, saved descriptions/categories/limits, desktop/mobile parity, native headers, scoped Axe, bounds, 44px actions, raw editor/price/password retention, single owners, no duplicate reads/commands, retry and denial. Existing price scheduling, delayed/unavailable validation, exact receipts, agreements, activation and inventory recovery remain checked.
- Web production build, workspace types with 11 successful tasks, root/focused lint, contract/suppression checks, strict SAST with 1,796 files and zero findings/errors, five scanner fixtures and all 85 unchanged bundle budgets pass. The catalogue route is 449.94 KB gzip against its unchanged 500 KB budget.
- Two full original Persian mobile captures are reviewed: electricity in light mode and saving plans in dark mode. Synthetic fixtures are used; no private records or credentials appear. Product source and all 493 build assets match the browser snapshot hashes. Five unchanged browser modules and the final new module are bound in the external receipt.
- Changed-file formatting, canonical queue validation and diff checks pass before commit.

Initial failures remain in external evidence. The new ownership test is corrected to inspect the retained DOM while the existing modal hides background controls from the accessibility tree. It preserves the original independent-editor behavior after list failure and uses the actual shared Persian cancellation label. A local dictionary build mismatch requires a web rebuild after the dictionary compiles; the obsolete run is stopped and excluded. Two final-matrix cases time out during Chromium launch, before application execution. A known Persian selector failure prompts a graceful matrix interruption; passing unchanged cases are retained and all affected or unrun cases receive fresh evidence. No production guards, accessibility rules, retries or budgets are relaxed.

Publication preflight, exact remote SHA, immutable queued captures and healthy deployment/Telegram outcomes are separate external receipts.

## Preceding release

`v0.1.19` completed at `2026-10-05T22:05:36.789912+00:00`, with healthy exact live commit `58a8a1d0aa5c40e7d2a6b2b299e596e947987671`. Persian Telegram note `58` and reviewed screenshots `59`, `60` are confirmed; its report and external completion receipt record that result.

External evidence: `~/.local/state/barghsa-manual-batches/product-catalogue-tables/`.

## Deployment outcome

`v0.1.20` completed at `2026-10-05T22:30:36.531424+00:00`, with healthy exact live commit `0e2d02cc2aae76b855fbd5fa6b18e4bdf68bc32e`. Persian Telegram note `61` and reviewed screenshots `62`, `63` are confirmed. External receipt: `~/.local/state/barghsa-manual-batches/product-catalogue-tables/release-completed.json`.
