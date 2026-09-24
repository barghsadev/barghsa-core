import type { ProviderPool } from './provider-config.di';

export interface ProviderAlertEvent {
  kind:
    'circuit_open' | 'circuit_recovered' | 'permanent_failure' | 'low_credit' | 'credit_recovered';
  createdAt: Date;
}

type AlertRow = ProviderAlertEvent & { providerId: string };

/** Recent per-provider events; permanent rejections come from immutable attempt history. */
export async function readProviderAlertHistory(
  db: Pick<ProviderPool, 'query'>,
  providerIds: string[],
  channel: 'email' | 'sms'
): Promise<Map<string, ProviderAlertEvent[]>> {
  if (!providerIds.length) return new Map();
  const result = await db.query(
    `WITH events AS (
       SELECT provider_id,kind,created_at FROM provider_health_events
       WHERE provider_id = ANY($1::uuid[]) AND channel=$2
         AND created_at >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT provider_id,'permanent_failure'::text AS kind,created_at
       FROM notification_delivery_log
       WHERE provider_id = ANY($1::uuid[]) AND channel=$2
         AND status='failed' AND error_category='permanent'
         AND created_at >= NOW()-INTERVAL '30 days'
     ), ranked AS (
       SELECT provider_id,kind,created_at,
         row_number() OVER (PARTITION BY provider_id ORDER BY created_at DESC) AS position
       FROM events
     )
     SELECT provider_id AS "providerId",kind,created_at AS "createdAt"
     FROM ranked WHERE position <= 5 ORDER BY provider_id,created_at DESC`,
    [providerIds, channel]
  );
  const grouped = new Map<string, ProviderAlertEvent[]>();
  for (const { providerId, ...event } of result.rows as AlertRow[]) {
    const events = grouped.get(providerId) ?? [];
    events.push(event);
    grouped.set(providerId, events);
  }
  return grouped;
}
