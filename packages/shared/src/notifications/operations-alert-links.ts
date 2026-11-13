const repositoryRunbooks = 'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks';

const alertResources = {
  EmailProviderDegraded: ['barghsa-notifications', 'notification-outage'],
  SmsProviderDegraded: ['barghsa-notifications', 'notification-outage'],
  SmsProviderLowCredit: ['barghsa-notifications', 'notification-outage'],
  SmsProviderCreditReview: ['barghsa-notifications', 'notification-outage'],
  StorageLifecycleNeedsReview: ['barghsa-storage-uploads', 'storage-outage'],
  NotificationDeadLettersPending: ['barghsa-notifications', 'notification-outage'],
  NotificationDeadLettersAccumulating: ['barghsa-notifications', 'notification-outage'],
  NotificationOutboxBacklog: ['barghsa-notifications', 'notification-outage'],
  NotificationOutboxBacklogCritical: ['barghsa-notifications', 'notification-outage'],
  RefundObligationOverdue: ['barghsa-finance-safety', 'refund-backlog'],
  WalletReconciliationCritical: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  WalletReconciliationReview: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  PaymentCallbackAnomaly: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  PaymentIdempotencyConflict: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  AiModelCircuitOpen: ['barghsa-ai-usage', 'ai-provider-outage'],
  WorkerUnavailable: ['barghsa-worker-health', 'notification-outage'],
  ApplicationDatabasePoolSaturated: ['barghsa-postgresql', 'api-pressure'],
  CriticalApiRouteErrors: ['barghsa-api-health', 'api-pressure'],
  AuthenticationFailuresElevated: ['barghsa-authentication-security', 'api-pressure'],
  JourneyErrorBudgetFastBurn: ['barghsa-executive-slo', 'journey-availability'],
  JourneyErrorBudgetSlowBurn: ['barghsa-executive-slo', 'journey-availability'],
  SyntheticProbeFailed: ['barghsa-executive-slo', 'journey-availability'],
  SyntheticProbeUnavailable: ['barghsa-executive-slo', 'journey-availability'],
  PublicTlsCertificateExpiring: ['barghsa-executive-slo', 'journey-availability'],
  PostgresBackupFailed: ['barghsa-postgresql', 'postgresql-backup'],
  PostgresBackupStale: ['barghsa-postgresql', 'postgresql-backup'],
  PostgresBackupMonitoringUnavailable: ['barghsa-postgresql', 'postgresql-backup'],
  PostgresMetricsCollectionFailed: ['barghsa-postgresql', 'api-pressure'],
  PostgresCacheHitRatioLow: ['barghsa-postgresql', 'api-pressure'],
  PostgresConnectionSaturationHigh: ['barghsa-postgresql', 'api-pressure'],
  PostgresActiveConnectionsHigh: ['barghsa-postgresql', 'api-pressure'],
  PostgresIdleInTransaction: ['barghsa-postgresql', 'api-pressure'],
  PostgresLockContention: ['barghsa-postgresql', 'api-pressure'],
  PostgresLongRunningQueries: ['barghsa-postgresql', 'api-pressure'],
  PostgresDeadlocksDetected: ['barghsa-postgresql', 'api-pressure'],
  PostgresReplicationLagHigh: ['barghsa-postgresql', 'database-failover'],
  MonthlyCostBudgetVariance: ['barghsa-monthly-costs', 'monthly-cost-monitoring'],
} as const;

const availabilityBudgetAlerts = new Set([
  'EmailProviderDegraded',
  'SmsProviderDegraded',
  'AiModelCircuitOpen',
  'NotificationOutboxBacklog',
  'NotificationOutboxBacklogCritical',
  'RefundObligationOverdue',
  'WalletReconciliationCritical',
  'CriticalApiRouteErrors',
]);

export function operationsDashboardOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\s\\]/.test(value))
    return null;
  try {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return url.protocol === 'https:' || (loopback && url.protocol === 'http:') ? url.origin : null;
  } catch {
    return null;
  }
}

type OperationsLink = {
  label:
    | 'notifications.operations.dashboard'
    | 'notifications.operations.runbook'
    | 'notifications.operations.availabilityBudget';
  href: string;
};

export function operationsAlertLinks(
  event: string,
  data: Record<string, unknown>
): OperationsLink[] {
  if (event !== 'system.service_outage' && event !== 'admin.operations_alert') return [];
  const name = data.operationsAlertName;
  if (typeof name !== 'string' || !Object.hasOwn(alertResources, name)) return [];
  const [dashboard, runbook] = alertResources[name as keyof typeof alertResources];
  const origin = operationsDashboardOrigin(data.operationsDashboardOrigin);
  const links: OperationsLink[] = [
    { label: 'notifications.operations.runbook', href: `${repositoryRunbooks}/${runbook}.md` },
  ];
  if (origin) {
    if (availabilityBudgetAlerts.has(name)) {
      links.unshift({
        label: 'notifications.operations.availabilityBudget',
        href: `${origin}/d/barghsa-executive-slo`,
      });
    }
    links.unshift({
      label: 'notifications.operations.dashboard',
      href: `${origin}/d/${dashboard}`,
    });
  }
  return links;
}
