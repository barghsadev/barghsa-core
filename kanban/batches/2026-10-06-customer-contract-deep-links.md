# Customer contract deep links, October 6, 2026

Release `v0.1.23`. Manual direct-main repair batch, no PR or supervisor-state changes.

## Scope and behavior

Repairs the existing customer contract list/detail composition under `07-ui-ux-design.md#T-07.18.03.01` and the electricity order contract link under `#T-07.18.03.04`, retaining the existing version/acceptance/document engines in `04-invoices-wallet-contracts.md`. This is regression repair, not a new completion count for those broad tasks.

Previously, the workspace captured `window.location.search` once when its local detail state initialized. During client navigation from an electricity order, that URL could still describe the old page, so the linked contract stayed closed. Later URL changes also could not control the local selection. The customer route now passes the validated contract ID and a selection callback through the existing page/workspace. Opening and closing update that URL while retaining other criteria. Reload and Back/Forward restore or close the intended detail, including contracts outside the current list.

The same existing selection owner supports both customer selection and the staff query controller, with staff queries taking precedence. Exact `null` means closed and cannot fall back to an older local selection. The existing accepted-selection/coordination guard freezes detail changes during protected commands, and current denial removes the routed selection with replacement. Actor/profile scope, server authorization, financial review, version/signature/document transactions and independent list reads retain their existing ownership.

No API, schema, dependency, dictionary, CI or budget change.

## Validation and review

- **84** source cases across five contract workspace/navigation/query/review/finance recovery files pass. The added regression verifies routed initial selection, an off-page selection change and explicit closure with one list read.
- **18 distinct** Chromium/mobile Safari cases pass, nine per engine, with zero retries: complete bilingual electricity order/address/payment/contract journeys, linked reload/close/Back/Forward, language persistence, contract acceptance and signed upload, staff publication and customer filter/pagination workflows. The ledger retains 12 unchanged contract/filter cases from the combined run and six final journey cases; two final Persian journey/capture cases also pass.
- Web build, workspace types, root and final focused lint, contract/suppression, strict SAST (1,798 files; zero findings/errors; five fixtures), all 85 unchanged bundle budgets, formatting, backlog and diff checks pass. Final source and 493 built assets retain the browser build hashes.
- One original Persian native-browser capture of the linked terms and acceptance controls is reviewed. It is focused on those controls; companion panels are not claimed as visually verified by this capture. Fixtures contain synthetic data.

Failed runs remain external. Old profile/address fixtures needed required status/default/null-name/timestamp fields; signature/activation endpoints needed present responses to avoid correct withdrawal on 404. A fixed-date draft toast overlapped the mobile address footer; the journey now dismisses that real notification before opening the address dialog. No forced clicks, retries, product authorization relaxation or weakened assertions are used. Existing optional companion-panel fixtures are outside this capture and repair scope.

Publication and exact deployment/Telegram outcomes remain separate external receipts. `v0.1.22` was pushed at `824075a5279d02e6d15e80b944fe85a132ae28e3` and queued with both reviewed Persian captures; its independent deployment outcome is not inferred from publication.

External evidence: `~/.local/state/barghsa-manual-batches/customer-contract-deep-links/`.
