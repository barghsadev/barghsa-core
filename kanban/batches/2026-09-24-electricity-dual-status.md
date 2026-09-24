# Electricity commercial and financial status pair

Canonical scope: `07-ui-ux-design.md#T-07.27.01.04` and `07-ui-ux-design.md#T-07.18.03.04`.

The electricity order detail now places its commercial progress and financial progress together near the top, with separate labels and status badges. The staff order detail uses the same shared component. Both retain their existing workflow actions and financial facts without repeating the financial status lower on the page. No state or payment logic changes.

Validation: shared component and customer/staff page tests check both labeled values. The Chromium simple-order journey checks that the pair changes from awaiting review/unpaid to approved/paid after the wallet payment. Workspace build, typecheck, lint, formatting, and backlog validation run before push; GitHub CI runs on the pushed commit.
