# Staff review of corrected electricity orders

Canonical scope: `03-core-business.md#T-03.07.02.05` and the resubmission transition in `T-03.07.01.01`.

The staff order detail now presents the latest correction beside the previous contract version. Reviewers see their change request, the customer's response, and before/after period, product quantities, total kWh, amount, delivery address, and invoice reference before deciding. Current quote settings come from the active contract version. New customer resubmissions preserve the previous delivery address in that version so even the first correction is reviewable.

The customer correction-flow test now waits for its lazy form to load, resolving the timing failure seen in the previous batch's CI run.

Validation: real PostgreSQL tests cover address-only, simple priced, and advanced product-mix revisions; the staff page test covers the comparison. API/web typechecks, changed-file lint, formatting, build, OpenAPI, and kanban validation pass. The route-budget check retains the four existing failures (Login, Register, Password recovery, Electricity ordering).
