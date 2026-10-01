# Product and AI catalogue category URLs, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` across product type, knowledge-base/group and AI policy/group catalogue categories. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial. Selected entries, editors, retrieval questions, member choices, priorities, passwords and unsaved configuration remain local. No supervisor assignment or completion history changes.

## Behavior and review

Direct links select the existing catalogue API scope. Reload and Back/Forward restore the category; selecting the default removes its URL parameter. Allowlists reject malformed values and categories belonging to another catalogue. Route adapters use the shared list-query hook. A category change mounts a fresh catalogue scope, aborts obsolete reads and disposes of the previous editor, detail work and confirmation. Existing standalone consumers retain local category switching. Manual category navigation restores focus to the selected control, including RTL product-tab keyboard navigation.

AI route changes avoid refreshing the old catalogue before it is discarded. Review also fixes a product navigation race: the accepted view remains usable while controlled navigation is pending, so immediately cancelled history navigation cannot leave it loading indefinitely. A deterministic regression verifies that the old view and draft remain usable without another API read until navigation commits. Existing independent list/detail/choice retry, accepted data, draft recovery and permission-denial behavior remain.

## CI dependency repair

The preceding staff-access commit `8a7c9a77e878b0acad4baca14e75a2cc9b1a36d6` has a failed [CI run 36890690734](https://github.com/barghsadev/barghsa-core/actions/runs/36890690734). Tests, static security and Git-history secret scanning pass. Integrity fails on one critical dependency advisory; downstream combined coverage also fails. The previous commit is not green.

The downloaded dependency audit identifies API development dependency `@swc/cli > piscina@4.9.3`. [GHSA-67c8-pqhq-4rmx](https://github.com/advisories/GHSA-67c8-pqhq-4rmx), added to the GitHub advisory database today, lists 4.9.4 as the compatible patched release. A narrowly scoped override updates only that dependency and its lockfile resolution. Frozen installation and dependency-path readback confirm 4.9.4, and the rebuilt API validates the build-tool compatibility. The equivalent CI report gate passes with zero high and zero critical advisories. One low and six moderate advisories remain; raw `pnpm audit` still exits nonzero for these, and they are not misreported as a clean audit. No CI gate or exemption changes.

## Validation

All 437 affected web cases across four files pass, including 24 category-normalization cases and the new cancelled-navigation regression. The full web suite and unchanged dictionary suite are not rerun. All 56 distinct production browser scenarios have passing evidence across Chromium and mobile Safari: the final release run passes 24 new category URL flows and 16 product recovery flows; 16 unchanged knowledge/policy recovery flows pass in the preceding run. Repeated and failed scenarios are not added to the total. Initial test setup used table locators for card lists; the corrected run also exposed the product navigation race fixed above. Both languages and actual themes, reload, Back/Forward, exact-query retry, local draft retention/exclusion, pending confirmation disposal, RTL keyboard focus, permission denial, scoped Axe and mobile bounds are verified. Persian mobile rendering is inspected for all three catalogues in both themes.

All seven root build tasks, all 11 package type checks, root lint, formatting, contract, suppression and all 64 final release budgets pass. Strict security passes five rule fixtures and scans 1,371 files with zero findings or errors. Backlog and diff checks pass before publication.

## Publication

This batch is published directly to main after local validation. Publication verifies local/remote SHA, clean worktree and exact-commit CI registration; new CI remains pending at publication. No PR, handoff, historical loop-state or scheduler change is included. Existing temporary fast mode remains; its combined-coverage exemption supplies no measured coverage.
