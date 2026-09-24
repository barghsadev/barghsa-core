import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserAnalytics } from './analytics-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as typeof window & { gtag?: unknown }).gtag;
});

it('sends neither provider before consent and shares only fixed dimensions after opt-in', async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const gtag = vi.fn();
  vi.stubGlobal('fetch', request);
  (window as typeof window & { gtag?: typeof gtag }).gtag = gtag;
  const analytics = createBrowserAnalytics();
  await analytics.track({ name: 'page_view', area: 'customer' });
  expect(request).not.toHaveBeenCalled();
  expect(gtag).not.toHaveBeenCalled();
  analytics.setConsent(true);
  await analytics.track({ name: 'page_view', area: 'customer', token: 'secret' });
  expect(JSON.parse(String(request.mock.calls[0]![1].body))).toEqual({
    name: 'page_view',
    area: 'customer',
  });
  expect(gtag).toHaveBeenCalledWith('event', 'page_view', { area: 'customer' });
  analytics.setConsent(false);
  await analytics.track({ name: 'page_view', area: 'customer' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(gtag).toHaveBeenCalledTimes(1);
});
