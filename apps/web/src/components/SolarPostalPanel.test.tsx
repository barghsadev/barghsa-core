import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SolarPostalPanel } from './SolarPostalPanel.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
const requestId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const guidance = {
  fa: 'مدارک را بفرستید.',
  en: 'Send the originals.',
  destinationAddress: 'Main office',
  contactDetails: '555-0100',
  originals: [{ fa: 'سند', en: 'Deed' }],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function response(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 });
}

it('shows postal instructions and records a shipment, then locks the form while shipped', async () => {
  let postalStatus = 'waiting_for_shipment';
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/postal/shipment')) {
      expect(options?.method).toBe('POST');
      expect(JSON.parse(options?.body as string)).toMatchObject({
        courier: 'Parcel Co',
        trackingNumber: 'TRACK-123',
        sendDate: '2026-01-02',
      });
      postalStatus = 'shipped';
      return response({ status: 'shipped' });
    }
    if (url.includes('/postal'))
      return response({
        requestStatus: 'waiting_for_postal_submission',
        guidance,
        postal: {
          status: postalStatus,
          courier: postalStatus === 'shipped' ? 'Parcel Co' : null,
          tracking_number: postalStatus === 'shipped' ? 'TRACK-123' : null,
          send_date: postalStatus === 'shipped' ? '2026-01-02T00:00:00Z' : null,
          receipt_image_id: null,
          staff_notes: null,
        },
      });
    return response({ documents: [], nextBefore: null });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<SolarPostalPanel requestId={requestId} profileId={profileId} />)
  );
  expect(container.textContent).toContain('Send the originals.');
  expect(container.textContent).toContain('Main office');
  expect(container.textContent).toContain('Deed');
  const inputs = container.querySelectorAll<HTMLInputElement>('input');
  for (const [input, value] of [
    [inputs[0], 'Parcel Co'],
    [inputs[1], 'TRACK-123'],
    [inputs[2], '2026-01-02'],
  ] as const) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(fetcher.mock.calls.some(([url]) => url.includes('/postal/shipment'))).toBe(true);
  expect(container.textContent).toContain('Shipped, awaiting staff confirmation');
  expect(container.querySelector('form')).toBeNull();
});
