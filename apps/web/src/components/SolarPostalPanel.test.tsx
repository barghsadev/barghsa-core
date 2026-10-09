import { QueryComponentProvider } from '../test/query-provider.js';
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
          send_date: postalStatus === 'shipped' ? '2026-01-02' : null,
          receipt_image_id: null,
          staff_notes: null,
        },
      });
    return response({ documents: [], nextBefore: null });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {<SolarPostalPanel requestId={requestId} profileId={profileId} />}
      </QueryComponentProvider>
    )
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
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => url.includes('/postal/shipment'))).toBe(true)
    );
  });
  expect(container.textContent).toContain('Shipped, awaiting staff confirmation');
  expect(container.querySelector('form')).toBeNull();
});

it('shows recorded arrival information with a safe tracking link and copy recovery', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      response(
        url.includes('/postal')
          ? {
              requestStatus: 'waiting_for_postal_submission',
              guidance,
              postal: {
                status: 'shipped',
                courier: 'Parcel Co',
                tracking_number: 'TRACK-123',
                send_date: '2026-01-02',
                receipt_image_id: null,
                staff_notes: null,
                estimated_arrival_date: '2026-01-05',
                tracking_url: 'https://courier.example.org/parcel',
                tracking_note: 'Courier estimate; originals are not confirmed.',
                tracking_recorded_at: null,
              },
            }
          : { documents: [], nextBefore: null }
      )
    )
  );
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {<SolarPostalPanel requestId={requestId} profileId={profileId} />}
      </QueryComponentProvider>
    )
  );
  expect(container.textContent).toContain('5 January 2026');
  expect(container.textContent).toContain('2 January 2026');
  expect(container.textContent).toContain('Courier estimate; originals are not confirmed.');
  const link = container.querySelector('a')!;
  expect(link.href).toBe('https://courier.example.org/parcel');
  expect(link.rel).toBe('noopener noreferrer');
  expect(container.querySelector('form')).toBeNull();
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Copy tracking number')!
      .click()
  );
  expect(container.textContent).toContain('Could not copy.');
});
it('hides old estimates on route changes and fetch denial, then reloads current details', async () => {
  let deny = false;
  let pendingResolve: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!url.includes('/postal')) return response({ documents: [], nextBefore: null });
      if (url.includes('new-request') && !deny)
        return new Promise<Response>((resolve) => {
          pendingResolve = resolve;
        });
      if (deny) return new Response('{}', { status: 403 });
      return response({
        requestStatus: 'waiting_for_postal_submission',
        guidance,
        postal: {
          status: 'shipped',
          courier: 'Parcel Co',
          tracking_number: 'OLD-TRACK',
          send_date: '2026-01-02',
          receipt_image_id: null,
          staff_notes: null,
          estimated_arrival_date: '2026-01-05',
          tracking_url: 'javascript:alert(1)',
          tracking_note: 'Old estimate',
        },
      });
    })
  );
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {<SolarPostalPanel requestId={requestId} profileId={profileId} />}
      </QueryComponentProvider>
    )
  );
  expect(container.textContent).toContain('Old estimate');
  expect(container.querySelector('a')).toBeNull();
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {<SolarPostalPanel requestId="new-request" profileId={profileId} />}
      </QueryComponentProvider>
    )
  );
  expect(container.textContent).not.toContain('Old estimate');
  await act(async () => pendingResolve!(new Response('{}', { status: 403 })));
  expect(container.textContent).toContain('Could not load postal details.');
  expect(container.textContent).not.toContain('OLD-TRACK');
  deny = true;
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Reload shipment tracking')!
      .click()
  );
  expect(container.textContent).not.toContain('OLD-TRACK');
  deny = false;
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {<SolarPostalPanel requestId={requestId} profileId={profileId} />}
      </QueryComponentProvider>
    )
  );
  expect(container.textContent).toContain('Old estimate');
  expect(container.textContent).not.toContain('Could not load postal details.');
});
