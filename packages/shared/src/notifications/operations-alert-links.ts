const repositoryRunbooks = 'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks';

const alertResources = {
  EmailProviderDegraded: ['barghsa-notifications', 'notification-outage'],
  SmsProviderDegraded: ['barghsa-notifications', 'notification-outage'],
  SmsProviderLowCredit: ['barghsa-notifications', 'notification-outage'],
  NotificationDeadLettersPending: ['barghsa-notifications', 'notification-outage'],
  NotificationDeadLettersAccumulating: ['barghsa-notifications', 'notification-outage'],
  NotificationOutboxBacklog: ['barghsa-notifications', 'notification-outage'],
  NotificationOutboxBacklogCritical: ['barghsa-notifications', 'notification-outage'],
  RefundObligationOverdue: ['barghsa-finance-safety', 'refund-backlog'],
  WalletReconciliationCritical: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  PaymentCallbackAnomaly: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  PaymentIdempotencyConflict: ['barghsa-finance-safety', 'payment-wallet-mismatch'],
  AiModelCircuitOpen: ['barghsa-ai-usage', 'ai-provider-outage'],
  WorkerUnavailable: ['barghsa-worker-health', 'notification-outage'],
} as const;

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
  label: 'notifications.operations.dashboard' | 'notifications.operations.runbook';
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
    links.unshift({
      label: 'notifications.operations.dashboard',
      href: `${origin}/d/${dashboard}`,
    });
  }
  return links;
}
