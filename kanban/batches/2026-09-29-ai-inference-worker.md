# Dedicated AI inference process

Task context: `05-notifications-documents-ai.md#T-05.23.01`.

Agent chat still applies the existing queue, monthly budget, circuit breaker, redaction and audit in the API, then sends the bounded prompt to a separate internal HTTP process for provider I/O. The request carries a model ID and expected non-secret model configuration. The AI process re-reads the model, refuses a changed configuration, decrypts its stored provider token, validates the completion and returns the answer plus token usage. It never accepts a provider token in the HTTP body. A shared internal secret authenticates completion requests; missing worker configuration or an unreachable worker fails closed with a localized 503 and does not count as a provider circuit failure.

Production Compose runs `ai-inference` as a separate container with its own health check and no published port. The single-container deployment launches it as a separate process. `/api/ai/health` reports worker availability and saturation while `/api/health/ready` remains independent of AI availability. A worker restart cannot restart the API container in Compose; the single-container supervisor restarts its container if any required child exits.

The API still owns budget transactions and its process-local FIFO admission queue. The worker independently caps active provider calls at 10 by default and rejects excess calls. Cross-replica FIFO coordination and moving budget accounting into the AI process remain capacity follow-ups.

Validation: worker HTTP/authentication and saturation tests, API client tests, customer and staff chat HTTP tests, deployment configuration and root checks before push.
