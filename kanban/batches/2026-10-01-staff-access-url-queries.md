# Staff directory and role comparison URL queries, October 1, 2026

## Kanban scope

This batch extends `07-ui-ux-design.md#T-07.18.02.04` across staff directory pages and the role comparison module. Other legacy filters and unfinished domain criteria remain open; global URL serialization remains partial. No supervisor assignment or completion history changes.

## Behavior and review

Staff directory links restore the existing 25-row API page through reload and Back/Forward. The first page removes the default parameter; normalization retains the shared maximum of 1,000,000 pages. This is a UI page bound, not an API offset cap. Failed navigation retains accepted rows, creation fields and valid role edits while retrying the exact failed query. Successful replacement validates existing edits against the accepted staff row. Permission denial clears private work.

Page changes close obsolete confirmations and access/history dialogs. Every immutable staff command proposal captures its originating offset. Generation, offset and action-identity guards prevent late callbacks from publishing false success, clearing newer drafts or starting obsolete reads. Creation, passwords, role-edit reasons and permission lookup drafts stay local.

Role comparison links restore the selected public module through reload and Back/Forward without another API read when the selector changes. Syntax validation rejects malformed module values; the selector only applies modules present in the accepted catalogue. All-modules selection removes the parameter. Existing read-only role permissions, effective-permission lookup and independent catalogue recovery remain.

Review fixes duplicate Staff users landmarks by giving the table a separate Persian/English accessible label. Existing role recovery browser cases now use the authenticated CRM shell fixture. No API, database, dependency, CI, scheduler or supervisor change is included.

## Validation

All 423 affected web cases across four files and all 53 dictionary cases across seven files pass. The full web suite is not rerun for this batch. All 54 distinct production browser scenarios pass across Chromium and mobile Safari: 16 new URL flows, 16 existing staff inspection/comparison flows, 14 role catalogue/lookup recovery flows and eight directory recovery flows. The first browser run exposed the duplicate landmark; the final run passes after the localized label fix. Assertions and Axe coverage remain intact.

Both languages and actual themes, reload, Back/Forward, exact-query retry, local draft retention/exclusion, stale confirmation rejection, permission denial, scoped Axe and mobile bounds are verified. Persian mobile directory and role comparison rendering is inspected in both themes.

All seven root build tasks, all 11 package type checks, root lint plus final affected-file lint, formatting, contract, suppression and all 64 final release budgets pass. Strict security passes five rule fixtures and scans 1,370 files with zero findings or errors. Backlog and diff checks pass before publication.

## Publication and CI

The preceding gift catalogue commit is `ee8b8223ef78ef0c1cdec783bf79540fcfc21599`. [CI run 36889409306](https://github.com/barghsadev/barghsa-core/actions/runs/36889409306) passes all five gates under existing temporary fast mode. Combined coverage remains an exemption, with no measured coverage.

This batch is published directly to main after local validation. Publication verifies local/remote SHA, clean worktree and exact-commit CI registration; new CI remains pending at publication. No PR, handoff, historical loop-state or scheduler change is included.
