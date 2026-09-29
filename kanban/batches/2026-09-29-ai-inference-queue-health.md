# AI inference queue and health

Task context: `05-notifications-documents-ai.md#T-05.23.03` and `05-notifications-documents-ai.md#T-05.23.04`.

Agent completions enter a FIFO gate before budget transactions or provider work. Each API process admits at most 10 concurrent requests by default, waits up to 30 seconds, and holds at most 100 pending requests; all three bounds are configurable. Queue expiry or overflow returns a localized, retryable `AI_INFERENCE_BUSY` response without starting a provider call. The pending wait holds no database connection. The gate covers every configured model and both customer and staff agent chat paths.

`GET /api/ai/health` gives authorized AI-model staff the queue depth, saturation and per-model circuit status. Prometheus exports active requests, queue depth, saturation and rejections. Core `/api/health/ready` does not depend on AI queue or model health. Queue counters currently describe one API process; the dedicated inference worker and cross-process capacity coordination remain `T-05.23.01`.

This batch also adds the missing `updated_at` trigger for `ai_model_budgets` in a follow-up migration. The prior migration was already published, so it remains immutable.

Validation: focused queue, metrics, admin HTTP, customer chat and database-foundation tests; root build, typecheck, lint, formatting, contract, database snapshot and backlog checks before push.
