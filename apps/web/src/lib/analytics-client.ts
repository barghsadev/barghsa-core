import { createAnalytics, type AnalyticsEvent } from '@barghsa/shared/analytics';
import { withCsrf } from './csrf.js';

async function sendSelfHosted(event: AnalyticsEvent): Promise<boolean> {
  const response = await fetch('/api/user/analytics/events', {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(event),
    keepalive: true,
  });
  return response.status === 204;
}

/** The host may install gtag after consent; this adapter never loads Google code itself. */
function sendGoogle(event: AnalyticsEvent) {
  const gtag = (window as typeof window & { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  const site = `${window.location.origin}/`;
  gtag('event', event.name, {
    ...('area' in event ? { area: event.area } : { service: event.service }),
    page_location: site,
    page_referrer: site,
    page_title: 'Barghsa',
    ignore_referrer: true,
  });
}

export function createBrowserAnalytics() {
  return createAnalytics([
    {
      async send(event, hasCurrentConsent) {
        if ((await sendSelfHosted(event)) && hasCurrentConsent()) sendGoogle(event);
      },
    },
  ]);
}
