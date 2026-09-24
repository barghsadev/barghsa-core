# Order-derived contract value snapshots

Canonical scope: further progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract amount shown during customer tracking.

New electricity and saving orders now copy their authoritative full quote total into the fixed commercial value of the initial contract version in the same transaction. A customer revision writes its recalculated quote total into the new immutable version. The electricity address-only correction preserves the existing value. The amount comes from the committed quote calculation, not from reading a linked invoice after the fact; staff and customer contract lists can display it through the existing published-version rules.

Historical versions are not rewritten. Solar construction contracts also do not derive their value from an initial invoice; `2026-09-24-solar-contract-values.md` adds explicit full-value entry for new solar contracts. A dedicated number and accepted-party snapshot are covered in their own batches.

Validation: electricity order integration tests compare the advanced bundle and quantity-revision version values with their reviewed quotes. Saving-order integration verifies the initial, address and equipment-revision values. Relevant suites, production build, typecheck, lint, formatting and backlog validation run before push.
