# AI model connection tests

Apply production migration 0115 before deploying this API/worker pair. The model administration test button now queues a version-bound request. The worker makes the provider call; the API waits without holding a database connection, then checks current authority and model version before committing the result and audit entry.

Both processes need access to the same database. Configure the same AI_MODEL_ENCRYPTION_KEY in API and worker. The worker uses AI_MODEL_BASE_URL_ALLOWLIST and AI_MODEL_TEST_TIMEOUT_MS, default 15 seconds with a maximum of 60 seconds. A private provider host requires an explicit allow-list entry. The socket validates the actual DNS answers, preserves the original TLS host, refuses redirects, and caps responses at 64 KiB. Returned previews/errors are redacted and bounded.

AI_MODEL_TEST_WAIT_MS controls how long the API waits, default 75 seconds and bounded to 1–90 seconds. Set the reverse proxy request/read timeout above that budget. The UI shows its existing pending confirmation state during the wait. If no worker completes the job before the deadline, the API returns AI_MODEL_TEST_EXPIRED with HTTP 504 and cancels outstanding work. It does not mark the model reachable. Worker requests use the remaining job/lease budget as their timeout.

Each worker polls once per second and processes one request at a time. Multiple worker processes can claim independently. A lease lasts 70 seconds and can be recovered once after interruption, within the original job deadline. A repeated probe can incur a second provider request after an ambiguous crash. The lease token prevents the former worker from storing a late result. Expired requests and exhausted leases are not retried. Worker draining includes its active model test.

Queue rows store the model reference, tuple version, actor and safe outcome. They do not copy API tokens. Completed, failed and cancelled rows expire after one day while the worker runs. Model deletion leaves a null job reference; stale/deleted models and revoked authority cannot produce a persisted model success. The API still checks authority and version when receiving the worker result. A worker database failure appears under AI model connection tests in the failed-jobs screen.

Local checks use disposable databases and fake provider endpoints. No production provider connection, reverse proxy deployment or encryption-key rotation was performed. Legacy plaintext model tokens remain readable for compatibility and require separate controlled replacement; newly entered tokens are encrypted.
