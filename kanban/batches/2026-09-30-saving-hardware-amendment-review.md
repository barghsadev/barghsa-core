# Saving hardware amendment financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (paid saving hardware amendment portion). Other cross-command review actions remain partial.

Before staff changes equipment on a paid saving order, the API now previews the current and replacement equipment, locked price and VAT basis, revised order total, exact additional charge or credit, stock availability, contract and invoice, address, agreement, and reason. The mutation recalculates the same review under write locks and requires its hash; stale prices, stock, balances, or contract state reject confirmation. The confirmed review and hash are retained in the audit for immediate swaps and additional-charge requests.

The bilingual staff dialog displays the financial outcome and agreement before step-up and submission. Selecting another order invalidates an in-flight preview. The API integration suite covers equal-price, higher-price and cheaper swaps, missing and stale hashes, stock changes, audit persistence, and idempotent replay. The staff page test covers preview-to-confirmation submission; the Chromium saving journey, API/web typechecks and builds, OpenAPI, route budgets, root lint and formatting, and backlog validator are batch checks.
