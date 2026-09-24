import {
  createAnalytics,
  type AnalyticsAdapter,
  type AnalyticsEvent,
} from '@barghsa/shared/analytics';
import { withCsrf } from './csrf.js';

const selfHosted: AnalyticsAdapter = {
  async send(event) {
    await fetch('/api/user/analytics/events', {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(event),
      keepalive: true,
    });
  },
};

/** The host may install gtag after consent; this adapter never loads Google code itself. */
const google: AnalyticsAdapter = {
  send(event: AnalyticsEvent) {
    const gtag = (window as typeof window & { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag === 'function') {
      gtag(
        'event',
        event.name,
        'area' in event ? { area: event.area } : { service: event.service }
      );
    }
  },
};

export function createBrowserAnalytics() {
  return createAnalytics([selfHosted, google]);
}
