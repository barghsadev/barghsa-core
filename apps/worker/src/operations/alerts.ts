import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { enqueueOutbox } from '../notifications/outbox-writer.js';

const labels: Record<string, string> = {
  EmailProviderDegraded: 'اختلال ارسال ایمیل / Email delivery unavailable',
  SmsProviderLowCredit: 'اعتبار پیامک پایین است / SMS credit is low',
  NotificationDeadLettersPending:
    'اعلان‌های ناموفق نیازمند بررسی هستند / Notification failures need triage',
  NotificationDeadLettersAccumulating:
    'تعداد اعلان‌های ناموفق افزایش یافته است / Notification failures are accumulating',
  AiModelCircuitOpen: 'مدل هوش مصنوعی در دسترس نیست / AI model unavailable',
  WorkerUnavailable: 'پردازشگر پس‌زمینه در دسترس نیست / Background worker unavailable',
};
type Alert = {
  name: string;
  fingerprint: string;
  status: 'firing' | 'resolved';
  startsAt: string;
  environment: string;
  database: string;
  severity: 'warning' | 'critical';
  priority: 'P2' | null;
};

export function parseOperationsAlerts(
  value: unknown,
  environment: string,
  database: string
): Alert[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('alerts' in value) ||
    !Array.isArray(value.alerts) ||
    value.alerts.length < 1 ||
    value.alerts.length > 50
  )
    throw new Error('Invalid alert envelope');
  return value.alerts.map((a: unknown) => {
    if (!a || typeof a !== 'object') throw new Error('Invalid alert');
    const item = a as Record<string, unknown>;
    const source = item.labels as Record<string, unknown> | undefined;
    if (
      !source ||
      typeof source.alertname !== 'string' ||
      !Object.hasOwn(labels, source.alertname) ||
      source.environment !== environment ||
      source.database !== database ||
      source.severity !==
        (source.alertname === 'NotificationDeadLettersAccumulating' ||
        source.alertname === 'WorkerUnavailable'
          ? 'critical'
          : 'warning') ||
      (source.alertname === 'SmsProviderLowCredit' && source.priority !== 'P2') ||
      (item.status !== 'firing' && item.status !== 'resolved') ||
      typeof item.fingerprint !== 'string' ||
      !/^[a-f0-9]{16,128}$/.test(item.fingerprint) ||
      typeof item.startsAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(item.startsAt) ||
      !Number.isFinite(Date.parse(item.startsAt)) ||
      Date.parse(item.startsAt) > Date.now() + 60000
    )
      throw new Error('Invalid alert scope or identity');
    return {
      name: source.alertname,
      fingerprint: item.fingerprint,
      status: item.status,
      startsAt: new Date(item.startsAt).toISOString(),
      environment,
      database,
      severity: source.severity as 'warning' | 'critical',
      priority: source.alertname === 'SmsProviderLowCredit' ? 'P2' : null,
    };
  });
}

/** Receipt and admin delivery intents commit together. Repeats preserve the original audience. */
export async function publishOperationsAlerts(pool: Pool, alerts: Alert[]) {
  const client = await pool.connect();
  const receipts: { id: string; inserted: boolean }[] = [];
  try {
    await client.query('BEGIN');
    for (const alert of alerts) {
      const id = createHash('sha256')
        .update(
          JSON.stringify([
            alert.environment,
            alert.database,
            alert.name,
            alert.fingerprint,
            alert.startsAt,
            alert.status,
          ])
        )
        .digest('hex');
      const receipt = await client.query(
        `INSERT INTO operations_alert_receipts(id,alert_name,fingerprint,environment,database,status,starts_at,severity,priority)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [
          id,
          alert.name,
          alert.fingerprint,
          alert.environment,
          alert.database,
          alert.status,
          alert.startsAt,
          alert.severity,
          alert.priority,
        ]
      );
      if (!receipt.rowCount) {
        const saved = await client.query(
          `SELECT id FROM operations_alert_receipts WHERE id=$1 AND alert_name=$2 AND fingerprint=$3
           AND environment=$4 AND database=$5 AND status=$6 AND starts_at=$7::timestamptz
           AND severity=$8 AND priority IS NOT DISTINCT FROM $9::text`,
          [
            id,
            alert.name,
            alert.fingerprint,
            alert.environment,
            alert.database,
            alert.status,
            alert.startsAt,
            alert.severity,
            alert.priority,
          ]
        );
        if (saved.rowCount !== 1) throw new Error('Operations alert receipt was not stored');
        receipts.push({ id, inserted: false });
        continue;
      }
      const admins = await client.query<{
        user_id: string;
      }>('SELECT user_id FROM public.lock_operations_alert_admins()');
      if (!admins.rowCount) throw new Error('Operations alert requires an active administrator');
      const data = {
        alertReceiptId: id,
        alertStatus: alert.status,
        priority: alert.priority,
        details: `${labels[alert.name]}: ${alert.status === 'firing' ? 'هشدار مشاهده شد / Firing' : 'رفع هشدار مشاهده شد / Resolved'}`,
        eta:
          alert.status === 'resolved'
            ? 'بازیابی مشاهده شد / Recovery observed'
            : 'هنوز مشخص نیست / Not yet estimated',
      };
      const outage = ['EmailProviderDegraded', 'AiModelCircuitOpen', 'WorkerUnavailable'].includes(
        alert.name
      );
      const eventKey = outage ? 'system.service_outage' : 'admin.operations_alert';
      const channels = outage ? (['in_app', 'email'] as const) : (['in_app'] as const);
      for (const admin of admins.rows) {
        const saved = await enqueueOutbox(client, {
          profileId: null,
          userId: admin.user_id,
          eventKey,
          payload: data,
          channels: [...channels],
          idempotencyKey: `${eventKey}:${id}:${admin.user_id}`,
        });
        if (!saved.inserted || !saved.outboxId)
          throw new Error('Operations alert occurrence conflicts with saved delivery');
        const jobs = await client.query(
          'SELECT channel FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
          [saved.outboxId]
        );
        if (
          jobs.rowCount !== channels.length ||
          jobs.rows
            .map((j) => j.channel)
            .sort()
            .join(',') !== [...channels].sort().join(',')
        )
          throw new Error('Operations alert delivery intents were not stored');
      }
      receipts.push({ id, inserted: true });
    }
    await client.query('COMMIT');
    return receipts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Private Alertmanager endpoint, bearer authenticated and independent of browser sessions. */
export async function receiveOperationsAlerts(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool
): Promise<void> {
  const secret = process.env['OPS_ALERT_WEBHOOK_SECRET'] ?? '';
  const environment = process.env['OPS_ALERT_ENVIRONMENT'] ?? '';
  const database = process.env['OPS_ALERT_DATABASE'] ?? '';
  if (secret.length < 32 || !environment || !database) {
    res.writeHead(503);
    res.end();
    return;
  }
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const actual = createHash('sha256')
    .update(req.headers.authorization ?? '')
    .digest();
  if (!timingSafeEqual(expected, actual) || req.headers.origin || req.headers.cookie) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    res.writeHead(415);
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 131072) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  let alerts: Alert[];
  try {
    alerts = parseOperationsAlerts(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
      environment,
      database
    );
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    const receipts = await publishOperationsAlerts(pool, alerts);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ receipts }));
  } catch {
    res.writeHead(503);
    res.end();
  }
}
