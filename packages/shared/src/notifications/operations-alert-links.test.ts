import { describe, expect, it } from 'vitest';
import { operationsAlertLinks } from './operations-alert-links.js';

const origin = 'https://monitoring.example.test';
const budget = {
  label: 'notifications.operations.availabilityBudget',
  href: `${origin}/d/barghsa-executive-slo`,
};

describe('operations alert budget links', () => {
  it.each([
    ['system.service_outage', 'EmailProviderDegraded', 'barghsa-notifications'],
    ['system.service_outage', 'SmsProviderDegraded', 'barghsa-notifications'],
    ['system.service_outage', 'AiModelCircuitOpen', 'barghsa-ai-usage'],
    ['admin.operations_alert', 'NotificationOutboxBacklog', 'barghsa-notifications'],
    ['admin.operations_alert', 'NotificationOutboxBacklogCritical', 'barghsa-notifications'],
    ['admin.operations_alert', 'RefundObligationOverdue', 'barghsa-finance-safety'],
    ['admin.operations_alert', 'WalletReconciliationCritical', 'barghsa-finance-safety'],
  ])('adds the budget to %s %s', (event, name, dashboard) => {
    const links = operationsAlertLinks(event, {
      operationsAlertName: name,
      operationsDashboardOrigin: origin,
      slo_dashboard_uid: 'untrusted',
    });
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({
      label: 'notifications.operations.dashboard',
      href: `${origin}/d/${dashboard}`,
    });
    expect(links[1]).toEqual(budget);
    expect(links[2]?.label).toBe('notifications.operations.runbook');
  });

  it('uses only the trusted origin and the allowed operations event and name', () => {
    const alert = {
      operationsAlertName: 'RefundObligationOverdue',
      operationsDashboardOrigin: 'https://monitoring.example.test/untrusted',
    };
    expect(operationsAlertLinks('admin.operations_alert', alert)).toEqual([
      {
        label: 'notifications.operations.runbook',
        href: 'https://github.com/barghsadev/barghsa-core/blob/main/docs/runbooks/refund-backlog.md',
      },
    ]);
    expect(
      operationsAlertLinks('order.submitted', { ...alert, operationsDashboardOrigin: origin })
    ).toEqual([]);
    expect(
      operationsAlertLinks('admin.operations_alert', {
        operationsAlertName: 'PaymentIdempotencyConflict',
        operationsDashboardOrigin: origin,
        slo_dashboard_uid: 'barghsa-executive-slo',
      }).some((link) => link.label === budget.label)
    ).toBe(false);
  });
});
