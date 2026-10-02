# Backend navigation access, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.16.01.07`: backend-resolved customer/staff navigation, administrative permission destinations and individual/legal profile differences.
- `07-ui-ux-design.md#T-07.16.02.01`: permission-filtered groups shared by the sidebar, mobile tabs, More sheet, breadcrumbs and staff settings navigation.
- `07-ui-ux-design.md#T-07.16.02.02`: personal/company profile labels, individual Saving Plans and legal-team links authorized by current membership.
- `07-ui-ux-design.md#T-07.16.02.03`: backend permission filtering and reuse of configuration in authenticated route context. The literal independent session-long cache criterion remains open: configuration refreshes with the existing session-guard reads instead of retaining stale grants across navigation.

## Build and review

The existing private `/api/auth/user` response now includes a small versioned navigation configuration. Staff destinations follow current API read grants, administrator authority and operating context rather than role names. Customer destinations follow the accessible active profile, owner authority and additive Finance/Legal/Manager permissions. Revoked membership, an inaccessible explicit selection or an archived profile cannot borrow grants from another profile. No accessible profile returns only account-level destinations. The API exposes no private role or permission data in the configuration; its OpenAPI contract is generated and checked.

The frontend intersects backend paths with existing local destinations and bilingual labels. It rejects missing, malformed or cross-workspace configuration and never invents links from unknown paths. A localized refresh action restores verified navigation without changing the current page. Phone tabs distribute the available links across their actual column count; no empty bar or reserved footer appears when navigation is unavailable. Settings subsection navigation uses the same permitted groups.

Configuration arrives through the existing authentication guard request, without a second navigation fetch. Profile changes clear the old menu immediately, invalidate the route context and reject responses started under an earlier profile revision. Existing profile-change remounts continue to isolate page data, notification counts and drafts, including changes from another tab. Existing API authorization still governs direct URLs and every business command.

The added shell code exposed the staff contracts route's existing 500 KB budget boundary. Contract details now download only after selection in both the contract list and cancellation queue. A failed detail download offers Close and preserves the list and URL filters. The unchanged initial route budget passes at 443.31 KB; the new explicit detail interaction budget passes at 229.93 KB against 250 KB. All 68 earlier limits remain unchanged.

Review checks destination read guards, inaccessible profile behavior, fresh role changes, workspace binding, late response rejection, mobile widths, existing settings composition and Persian layouts. Browser fixtures now provide verified navigation. Notification fixtures supply the API's required cursor field and valid UUIDs while retaining stale-response and workspace-isolation assertions. The purchase-loading fixture uses the current draft/product endpoints and saved locale; its assertions distinguish eager electricity routes from the previously deferred saving/wallet routes and staff dashboard, and verify stable loading for savings, wallet and invoices. Review adds missing shared loading/error states to the deferred savings and wallet routes, preserving the header during held downloads. The Safari logout test waits for the authentication document before testing a subsequent protected navigation; the logout and redirect assertions remain intact.

## Validation

- Root build, all eleven TypeScript tasks, lint, formatting, generated contract and suppressed-error checks pass before publication.
- `pnpm --filter @barghsa/web test`: 210 files and 2,457 cases pass. A final affected run passes 54 cases, included in that suite count.
- `pnpm --filter @barghsa/i18n test`: all 67 dictionary cases pass.
- API tests pass 102 distinct cases across six files: 89 authentication/navigation/staff-permission cases and 13 operating/profile-context HTTP regressions. The new navigation coverage includes eight migrated real-HTTP cases and four projection cases.
- Production Chromium/mobile-Safari checks pass 78 navigation, profile-switch and consent scenarios, including backend grant changes, missing/cross-workspace recovery, both languages, Axe, mobile/tablet/desktop bounds, late responses, cross-tab changes and failed detail downloads. A further 118 distinct shell scenarios pass across final and targeted regression runs: account actions, settings saves, customer/staff entry, widgets, inbox isolation, ticket operations and guide flows. The twelve new navigation-access scenarios are repeated on the final production build. There are 196 distinct passing browser scenarios in total; failures, interrupted runs and repeats are excluded.
- All 69 route/interaction budgets pass. Strict Semgrep 1.176.1 scans 1,467 files with zero findings or errors; all five rule fixtures pass. Canonical backlog and diff checks pass. Logs use `/tmp/barghsa-navigation-access-*`.

No database migration or new business write operation is needed. Deploy the API configuration response with or before the frontend: an older API response intentionally shows unavailable navigation with refresh. The previous mobile-navigation main commit `0b2c7767c8dc1c981ac53929b77c91604f4a3a43` passes all five jobs in CI run `37000142446`; combined coverage remains a fast-mode exemption rather than measured coverage. Exact-commit CI is read back after this direct main push. Historical supervisor state, generated completion/event ledgers, scheduling and CI settings remain unchanged.
