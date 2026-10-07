import type { ProviderPool } from './provider-config.di';

/** One-hour delivery outcomes and the current channel backlog. */
export interface ProviderHealthMetrics {
  attemptCount: number;
  failureCount: number;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  queueDepth: number;
  oldestQueuedAt: Date | null;
  lastSuccessfulTestAt?: Date | null;
}

type MetricsRow = ProviderHealthMetrics & { providerId: string };

export async function readProviderHealthMetrics(
  db: Pick<ProviderPool, 'query'>,
  providerIds: string[],
  channel: 'email' | 'sms'
): Promise<Map<string, ProviderHealthMetrics>> {
  if (providerIds.length === 0) return new Map();
  const result = await db.query(
    `WITH attempts AS (
       SELECT provider_id,
         COUNT(*)::int AS "attemptCount",
         COUNT(*) FILTER (WHERE status IN ('failed','unknown'))::int AS "failureCount",
         ROUND(AVG(latency_ms))::int AS "averageLatencyMs",
         ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms))::int AS "p50LatencyMs",
         ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS "p95LatencyMs",
         ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms))::int AS "p99LatencyMs"
       FROM notification_delivery_log
       WHERE provider_id = ANY($1::uuid[])
         AND channel = $2
         AND created_at >= NOW() - INTERVAL '1 hour'
         AND status IN ('delivered','failed','unknown')
       GROUP BY provider_id
     ), successful_tests AS (
       SELECT data->>'providerId' AS provider_id, MAX(created_at) AS tested_at
       FROM audit_log
       CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event=$3 AND data->>'lastTestStatus'='passed'
         AND data->>'providerId'=ANY($1::text[])
       GROUP BY data->>'providerId'
     ), queue AS (
       SELECT COUNT(*)::int AS "queueDepth", MIN(created_at) AS "oldestQueuedAt"
       FROM notification_job
       WHERE channel = $2 AND status IN ('queued','retrying')
     )
     SELECT providers.id AS "providerId",
       COALESCE(attempts."attemptCount", 0) AS "attemptCount",
       COALESCE(attempts."failureCount", 0) AS "failureCount",
       attempts."averageLatencyMs", attempts."p50LatencyMs",
       attempts."p95LatencyMs", attempts."p99LatencyMs",
       queue."queueDepth", queue."oldestQueuedAt",
       successful_tests.tested_at AS "lastSuccessfulTestAt"
     FROM unnest($1::uuid[]) AS providers(id)
     LEFT JOIN attempts ON attempts.provider_id = providers.id
     LEFT JOIN successful_tests ON successful_tests.provider_id=providers.id::text
     CROSS JOIN queue`,
    [providerIds, channel, `${channel}_provider_tested`]
  );
  return new Map(
    (result.rows as MetricsRow[]).map(({ providerId, ...metrics }) => [providerId, metrics])
  );
}
