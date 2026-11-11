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
  const site = `${window.location.origin}/`;
  expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
    area: 'customer',
    page_location: site,
    page_referrer: site,
    page_title: 'Barghsa',
    ignore_referrer: true,
  });
  analytics.setConsent(false);
  await analytics.track({ name: 'page_view', area: 'customer' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(gtag).toHaveBeenCalledTimes(1);
});

it('requires current first-party acceptance before forwarding to Google', async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  const gtag = vi.fn();
  vi.stubGlobal('fetch', request);
  (window as typeof window & { gtag?: typeof gtag }).gtag = gtag;
  const analytics = createBrowserAnalytics();
  analytics.setConsent(true);
  await analytics.track({ name: 'catalogue_view', service: 'solar' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(gtag).not.toHaveBeenCalled();

  let resolveResponse!: (response: Response) => void;
  request.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    })
  );
  const pending = analytics.track({ name: 'catalogue_view', service: 'solar' });
  expect(request).toHaveBeenCalledTimes(2);
  analytics.setConsent(false);
  analytics.setConsent(true);
  resolveResponse(new Response(null, { status: 204 }));
  await pending;
  expect(gtag).not.toHaveBeenCalled();
});
