# Electricity bill-data provider recovery

Canonical scope: the failure-handling portion of `03-core-business.md#T-03.05.01.04` and the electricity bill-data adapter portion of `01-platform-infrastructure.md#T-05.02.03`.

The optional hourly-consumption provider now opens its existing circuit breaker after three failed requests. Further estimate requests fail immediately for 30 seconds, then one successful probe restores access. The customer still has manual kWh entry while the provider is unavailable. Missing provider configuration remains a separate immediate fallback and does not trip the breaker.

Validation: the focused provider suite passes 5 tests, and the electricity-order HTTP integration suite passes 28 tests, including manual entry when bill data is unavailable. API build and typecheck, changed-file lint and formatting, and canonical backlog validation pass. Other external providers are outside this batch; it does not complete the cross-provider circuit-breaker task.
