# Redis loss

**Incident P2 for sustained fallback, escalating to P1 if database load degrades a major feature. Platform operations owns recovery.** Redis errors can increase PostgreSQL traffic and latency. PostgreSQL retains configuration, quota, session, financial and durable job authority.

1. Check Redis connectivity on the private network and compare PostgreSQL pool pressure and API latency with the prior baseline. For staging, use the documented protected Compose invocation with `ps redis`. Inspect health and TLS according to the environment's Redis configuration.
2. Verify core readiness and fail-safe behavior before replacing Redis. An authorized quota probe must still respect PostgreSQL history and current configuration changes must remain visible. A database outage must never become a successful rate-limit admission through Redis.
3. Restore the private Redis endpoint or provision the approved replacement with the pinned image and protected configuration. Leave durable PostgreSQL state intact. Let existing cache entries expire and be rebuilt through the ordinary version checks.
4. Verify the private Redis health check, recovered database pressure and unchanged quota and financial behavior on controlled fixtures. Compare API latency before and after recovery.

Escalate to the database operator if fallback exhausts PostgreSQL capacity or authoritative checks fail. Preserve telemetry and record the fallback duration and capacity findings. [Redis authority and fallback](../adr/002-redis-scope.md). [PostgreSQL monitoring](../operations/postgresql-monitoring.md). [Incident response](../operations/incident-response.md).
