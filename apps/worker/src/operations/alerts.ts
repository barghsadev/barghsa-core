import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { operationsDashboardOrigin } from '@barghsa/shared/notifications';
import { enqueueOutbox } from '../notifications/outbox-writer.js';
import { costCategories, isCostCategory } from './monthly-costs.js';

const labels: Record<string, string> = {
  EmailProviderDegraded: 'اختلال ارسال ایمیل / Email delivery unavailable',
  SmsProviderDegraded: 'اختلال ارسال پیامک / SMS delivery unavailable',
  SmsProviderLowCredit: 'اعتبار پیامک پایین است / SMS credit is low',
  SmsProviderCreditReview: 'اعتبار پیامک نیازمند بررسی است / SMS credit needs review',
  ClamAvSignaturesStale:
    'امضاهای ضدبدافزار قدیمی یا تأییدنشده‌اند / ClamAV signatures are overdue or unverified',
  StorageLifecycleNeedsReview:
    'خطای نگهداری فایل‌ها نیازمند بررسی است / Storage lifecycle failure needs review',
  NotificationDeadLettersPending:
    'اعلان‌های ناموفق نیازمند بررسی هستند / Notification failures need triage',
  NotificationDeadLettersAccumulating:
    'تعداد اعلان‌های ناموفق افزایش یافته است / Notification failures are accumulating',
  NotificationOutboxBacklog:
    'پردازش اعلان‌ها با تأخیر روبه‌رو است / Notification processing is delayed',
  NotificationOutboxBacklogCritical:
    'تأخیر پردازش اعلان‌ها بحرانی است / Notification processing is critically delayed',
  RefundObligationOverdue: 'تعهد بازپرداخت معوق است / Mandatory refund is overdue',
  WalletReconciliationCritical: 'مغایرت بحرانی کیف پول / Critical wallet reconciliation mismatch',
  WalletReconciliationReview:
    'مغایرت تطبیق نیازمند بررسی است / Reconciliation mismatch needs review',
  PaymentCallbackAnomaly: 'ناهنجاری در پاسخ درگاه پرداخت / Payment callback anomaly',
  PaymentIdempotencyConflict: 'مغایرت در تلاش دوباره پرداخت / Payment retry data mismatch',
  AiModelCircuitOpen: 'مدل هوش مصنوعی در دسترس نیست / AI model unavailable',
  WorkerUnavailable: 'پردازشگر پس‌زمینه در دسترس نیست / Background worker unavailable',
  ApplicationDatabasePoolSaturated:
    'اشباع ظرفیت اتصال پایگاه داده / Application database pool saturated',
  CriticalApiRouteErrors: 'افزایش خطا در مسیر حیاتی / Elevated critical API route errors',
  AuthenticationFailuresElevated:
    'افزایش پایدار رد درخواست‌های ورود / Sustained sign-in rejections',
  JourneyErrorBudgetFastBurn: 'افت سریع دسترس‌پذیری خدمت / Rapid loss of service availability',
  JourneyErrorBudgetSlowBurn:
    'افت پایدار دسترس‌پذیری خدمت / Sustained loss of service availability',
  SyntheticProbeFailed: 'بررسی آزمایشی ناموفق است / Synthetic check failed',
  SyntheticProbeUnavailable: 'گزارش بررسی آزمایشی در دسترس نیست / Synthetic reporting unavailable',
  PublicTlsCertificateExpiring:
    'گواهی HTTPS رو به انقضا است / Public HTTPS certificate is expiring',
  PostgresBackupFailed: 'پشتیبان‌گیری پایگاه داده ناموفق است / Database backup failed',
  PostgresBackupStale: 'پشتیبان تأییدشده اخیر در دسترس نیست / No recent verified database backup',
  PostgresBackupMonitoringUnavailable:
    'گزارش پشتیبان‌گیری در دسترس نیست / Database backup monitoring unavailable',
  MonthlyCostBudgetVariance: 'انحراف هزینه ماهانه از بودجه / Monthly cost budget variance',
};
const journeyNames: Record<string, string> = {
  electricity: 'برق / Electricity',
  saving: 'صرفه‌جویی / Energy saving',
  solar: 'خورشیدی / Solar',
  consultation: 'مشاوره / Consultation',
};
const syntheticCheckNames: Record<string, string> = {
  ...journeyNames,
  liveness: 'زنده بودن / Liveness',
  readiness: 'آمادگی / Readiness',
  login: 'ورود / Sign-in',
  account: 'حساب آزمایشی / Test account',
  logout: 'خروج / Sign-out',
};
const criticalApiRoutes = new Set([
  'GET /api/electricity/orders',
  'GET /api/electricity/orders/:orderId',
  'GET /api/saving/orders',
  'GET /api/saving/orders/:id',
  'GET /api/solar/requests',
  'GET /api/solar/requests/:id',
  'GET /api/consultations/requests',
  'GET /api/consultations/requests/:id',
  'GET /api/invoices',
  'GET /api/wallet/:profileId',
  'POST /api/electricity/orders/simple',
  'POST /api/electricity/orders/advanced',
  'POST /api/saving/orders',
  'POST /api/solar/requests',
  'POST /api/consultations/requests',
  'POST /api/consultations/requests/:id/accept',
  'POST /api/invoices/:invoiceId/wallet-payment',
  'POST /api/wallet/:profileId/top-ups',
  'POST /api/wallet/top-ups/callback',
]);
const criticalAlerts = new Set([
  'NotificationDeadLettersAccumulating',
  'NotificationOutboxBacklogCritical',
  'WalletReconciliationCritical',
  'PaymentCallbackAnomaly',
  'PaymentIdempotencyConflict',
  'AuthenticationFailuresElevated',
  'WorkerUnavailable',
  'JourneyErrorBudgetFastBurn',
  'SyntheticProbeFailed',
  'SyntheticProbeUnavailable',
  'PostgresBackupFailed',
  'PostgresBackupStale',
  'PostgresBackupMonitoringUnavailable',
]);
type AlertPriority = 'P1' | 'P2' | 'P3';

const alertPriorities = new Map<string, AlertPriority>([
  ['SmsProviderLowCredit', 'P2'],
  ['SmsProviderCreditReview', 'P3'],
  ['ClamAvSignaturesStale', 'P2'],
  ['StorageLifecycleNeedsReview', 'P3'],
  ['NotificationOutboxBacklog', 'P2'],
  ['NotificationOutboxBacklogCritical', 'P1'],
  ['RefundObligationOverdue', 'P2'],
  ['WalletReconciliationCritical', 'P1'],
  ['WalletReconciliationReview', 'P3'],
  ['PaymentCallbackAnomaly', 'P1'],
  ['PaymentIdempotencyConflict', 'P1'],
  ['ApplicationDatabasePoolSaturated', 'P2'],
  ['CriticalApiRouteErrors', 'P2'],
  ['AuthenticationFailuresElevated', 'P1'],
  ['JourneyErrorBudgetFastBurn', 'P1'],
  ['JourneyErrorBudgetSlowBurn', 'P2'],
  ['SyntheticProbeFailed', 'P1'],
  ['SyntheticProbeUnavailable', 'P1'],
  ['PublicTlsCertificateExpiring', 'P3'],
  ['PostgresBackupFailed', 'P1'],
  ['PostgresBackupStale', 'P1'],
  ['PostgresBackupMonitoringUnavailable', 'P1'],
  ['MonthlyCostBudgetVariance', 'P3'],
]);
type Alert = {
  name: string;
  fingerprint: string;
  status: 'firing' | 'resolved';
  startsAt: string;
  environment: string;
  database: string;
  severity: 'warning' | 'critical';
  priority: AlertPriority | null;
  service?: string;
  syntheticCheck?: string;
  criticalApiRoute?: string;
  costCategory?: keyof typeof costCategories;
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
    const name = source?.alertname;
    const priority = typeof name === 'string' ? (alertPriorities.get(name) ?? null) : null;
    const journeyBurn =
      name === 'JourneyErrorBudgetFastBurn' || name === 'JourneyErrorBudgetSlowBurn';
    const service = journeyBurn ? source?.service : undefined;
    const syntheticCheck = name === 'SyntheticProbeFailed' ? source?.check : undefined;
    const costCategory = name === 'MonthlyCostBudgetVariance' ? source?.category : undefined;
    const criticalApiRoute =
      name === 'CriticalApiRouteErrors' &&
      typeof source?.method === 'string' &&
      typeof source.route === 'string'
        ? `${source.method} ${source.route}`
        : undefined;
    if (
      !source ||
      typeof name !== 'string' ||
      !Object.hasOwn(labels, name) ||
      source.environment !== environment ||
      source.database !== database ||
      source.severity !== (criticalAlerts.has(name) ? 'critical' : 'warning') ||
      (priority !== null && source.priority !== priority) ||
      (journeyBurn &&
        (typeof service !== 'string' ||
          !Object.hasOwn(journeyNames, service) ||
          (source.availability_tier !== 'pilot' && source.availability_tier !== 'commercial') ||
          source.window !== (name === 'JourneyErrorBudgetFastBurn' ? '1h' : '24h'))) ||
      (name === 'SyntheticProbeFailed' &&
        (typeof syntheticCheck !== 'string' ||
          !Object.hasOwn(syntheticCheckNames, syntheticCheck))) ||
      (name === 'MonthlyCostBudgetVariance' && !isCostCategory(costCategory)) ||
      (name === 'CriticalApiRouteErrors' &&
        (!criticalApiRoute ||
          !criticalApiRoutes.has(criticalApiRoute) ||
          (source.availability_tier !== 'pilot' && source.availability_tier !== 'commercial'))) ||
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
      name,
      fingerprint: item.fingerprint,
      status: item.status,
      startsAt: new Date(item.startsAt).toISOString(),
      environment,
      database,
      severity: source.severity as 'warning' | 'critical',
      priority,
      ...(typeof service === 'string' ? { service } : {}),
      ...(typeof syntheticCheck === 'string' ? { syntheticCheck } : {}),
      ...(criticalApiRoute ? { criticalApiRoute } : {}),
      ...(isCostCategory(costCategory) ? { costCategory } : {}),
    };
  });
}

/** Receipt and admin delivery intents commit together. Repeats preserve the original audience. */
export async function publishOperationsAlerts(pool: Pool, alerts: Alert[]) {
  const dashboardOrigin = operationsDashboardOrigin(process.env['OPS_ALERT_DASHBOARD_ORIGIN']);
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
      const subject =
        alert.criticalApiRoute ??
        (alert.costCategory ? costCategories[alert.costCategory] : undefined) ??
        (alert.service
          ? journeyNames[alert.service]
          : alert.syntheticCheck && syntheticCheckNames[alert.syntheticCheck]);
      const data = {
        alertReceiptId: id,
        alertStatus: alert.status,
        operationsAlertName: alert.name,
        operationsDashboardOrigin: dashboardOrigin,
        priority: alert.priority,
        details: `${labels[alert.name]}${subject ? ` (${subject})` : ''}: ${alert.status === 'firing' ? 'هشدار مشاهده شد / Firing' : 'رفع هشدار مشاهده شد / Resolved'}`,
        eta:
          alert.status === 'resolved'
            ? 'بازیابی مشاهده شد / Recovery observed'
            : 'هنوز مشخص نیست / Not yet estimated',
      };
      const outage = [
        'EmailProviderDegraded',
        'SmsProviderDegraded',
        'AiModelCircuitOpen',
        'WorkerUnavailable',
      ].includes(alert.name);
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
