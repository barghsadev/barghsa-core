# Wallet reconciliation monitoring

The worker exposes the number of reconciliation cases awaiting or under investigation and the number of known wallets with current critical drift. The existing periodic scanner discovers new wallet mismatches. Each scrape rechecks the ledger for wallets with an open or investigating mismatch, using a single PostgreSQL snapshot. This detects worsening drift even when the case was initially recorded below the critical threshold.

The P1 alert uses the existing critical severity boundary of 1,000,000,000 IRR. Either the absolute posted or reserved difference can reach that boundary. PostgreSQL compares exact amounts. The exported gauge and private administrator intent omit wallet identifiers and amounts. Use the authorized finance workspace to inspect the case. [Payment and wallet recovery](../runbooks/payment-wallet-mismatch.md).

The alert resolves after the observed critical drift clears. The finance case remains available for its separate audited resolution. Verify the worker scrape, firing and recovery under the configured production-equivalent scope. Confirm the approved paging destination separately. [Incident response](incident-response.md).

When the reconciliation scan fails for one wallet, the worker records a fixed message and the wallet's opaque ID, then proceeds with the rest of the batch. A whole-scan failure records a fixed message in the worker log and background jobs queue. Use the authorized finance workspace and the failure time to investigate. Raw database messages can contain payment references or amounts.
