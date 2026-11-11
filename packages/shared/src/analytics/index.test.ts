import { expect, it, vi } from 'vitest';
import { createAnalytics, redactAnalyticsEvent } from './index.js';

it('projects only approved event dimensions and drops raw or unknown values', () => {
  expect(
    redactAnalyticsEvent({
      name: 'page_view',
      area: 'customer',
      email: 'secret@example.test',
      token: 'otp',
    })
  ).toEqual({ name: 'page_view', area: 'customer' });
  expect(redactAnalyticsEvent({ name: 'page_view', area: '/invoices/123' })).toBeNull();
  expect(
    redactAnalyticsEvent({ name: 'order_flow_start', service: 'electricity', rawText: 'private' })
  ).toEqual({ name: 'order_flow_start', service: 'electricity' });
  expect(redactAnalyticsEvent({ name: 'order_flow_start', service: 'unknown' })).toBeNull();
});

it('blocks all adapters without opt-in and redacts before both providers receive events', async () => {
  const selfHosted = vi.fn(),
    google = vi.fn();
  const analytics = createAnalytics([{ send: selfHosted }, { send: google }]);
  await analytics.track({ name: 'page_view', area: 'admin' });
  expect(selfHosted).not.toHaveBeenCalled();
  analytics.setConsent(true);
  await analytics.track({ name: 'page_view', area: 'admin', password: 'never-send' });
  expect(selfHosted).toHaveBeenCalledWith(
    { name: 'page_view', area: 'admin' },
    expect.any(Function)
  );
  expect(google).toHaveBeenCalledWith({ name: 'page_view', area: 'admin' }, expect.any(Function));
  analytics.setConsent(false);
  await analytics.track({ name: 'page_view', area: 'admin' });
  expect(selfHosted).toHaveBeenCalledTimes(1);
});

it('invalidates an event’s consent check after revocation and a new opt-in', async () => {
  const checks: (() => boolean)[] = [];
  const analytics = createAnalytics([
    {
      send: (_event, hasCurrentConsent) => {
        checks.push(hasCurrentConsent);
      },
    },
  ]);
  analytics.setConsent(true);
  await analytics.track({ name: 'page_view', area: 'admin' });
  expect(checks).toHaveLength(1);
  expect(checks[0]!()).toBe(true);
  analytics.setConsent(false);
  analytics.setConsent(true);
  expect(checks[0]!()).toBe(false);
});
