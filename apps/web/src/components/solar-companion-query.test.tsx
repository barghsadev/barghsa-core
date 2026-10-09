import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SolarPostalPanel } from './SolarPostalPanel.js';
import { SolarPostalTrackingEditor } from './SolarPostalTrackingEditor.js';
import { SolarContractForm } from './SolarContractForm.js';
import {
  contractOptions,
  solarRequestId as requestId,
  solarProfileId as profileId,
} from '../test/solar-contract-fixtures.js';

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'UTC',
    format: (value: string) => value,
    notice: null,
  }),
}));
let host: HTMLDivElement, root: Root;
let owner: string, held: boolean, signal: AbortSignal, finish: (value: unknown) => void;
let writes: unknown[];
const saved = vi.fn(),
  denied = vi.fn();
const postal = () => ({
  requestStatus: 'waiting_for_postal_submission',
  guidance: {
    fa: 'راهنما',
    en: 'Current guidance',
    destinationAddress: 'Office',
    contactDetails: 'Contact',
    originals: [],
  },
  postal: {
    status: 'waiting_for_shipment',
    courier: null,
    tracking_number: null,
    send_date: null,
    receipt_image_id: null,
    staff_notes: null,
  },
});
const tracking = () => ({
  requestId,
  profileId,
  requestStatus: 'waiting_for_postal_submission',
  postalStatus: 'shipped',
  courier: 'Current courier',
  trackingNumber: 'CURRENT-PARCEL',
  sendDate: '2026-01-02',
  receiptImageId: null,
  estimatedArrivalDate: null,
  trackingUrl: null,
  note: null,
  revision: 0,
  recordedAt: null,
  canEdit: true,
});
const fresh = (kind: string) =>
  kind === 'postal'
    ? postal()
    : kind === 'images'
      ? { documents: [], nextBefore: null }
      : kind === 'tracking'
        ? tracking()
        : contractOptions;
const matches = (kind: string, url: string) =>
  kind === 'images'
    ? url.startsWith('/api/documents?')
    : kind === 'postal' || kind === 'confirmation'
      ? url.endsWith('/postal') && !url.includes('/admin/')
      : kind === 'tracking'
        ? url.endsWith('/postal/tracking')
        : kind === 'contract'
          ? url.endsWith('/contract-options')
          : false;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  writes = [];
  saved.mockReset();
  denied.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({ status: 'shipped' });
      }
      if (matches(owner, url) && !held && (owner !== 'confirmation' || writes.length)) {
        held = true;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      if (url.startsWith('/api/documents?')) return Response.json(fresh('images'));
      if (url.endsWith('/postal/tracking')) return Response.json(tracking());
      if (url.endsWith('/contract-options')) return Response.json(contractOptions);
      if (url.endsWith('/postal')) return Response.json(postal());
      throw new Error(`Unexpected ${url}`);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(kind: string | null, actor = 'actor-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {kind === 'tracking' ? (
            <SolarPostalTrackingEditor requestId={requestId} onSaved={saved} onDenied={denied} />
          ) : kind === 'contract' ? (
            <SolarContractForm
              requestId={requestId}
              profileId={profileId}
              onCreated={saved}
              onDenied={denied}
            />
          ) : kind ? (
            <SolarPostalPanel requestId={requestId} profileId={profileId} />
          ) : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const kind of ['postal', 'images', 'tracking', 'contract']) {
  it.each(['unmount', 'actor', 'profile-context'])(
    'cancels ' + kind + ' bytes on %s and refuses old private values',
    async (change) => {
      owner = kind;
      await render(kind);
      expect(held).toBe(true);
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      const count = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => matches(kind, String(url))).length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => matches(kind, String(url)))
      ).toHaveLength(count);
      if (change === 'unmount') await render(null);
      else if (change === 'actor') await render(kind, 'replacement-actor');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      const oldValue =
        kind === 'postal'
          ? { ...postal(), guidance: { ...postal().guidance, en: 'Private obsolete' } }
          : kind === 'images'
            ? {
                documents: [
                  {
                    id: 'old-private-image',
                    state: 'Available',
                    uploadedByType: 'customer',
                    originalName: 'Private obsolete',
                  },
                ],
                nextBefore: null,
              }
            : kind === 'tracking'
              ? { ...tracking(), note: 'Private obsolete' }
              : {
                  ...contractOptions,
                  templates: contractOptions.templates.map((template) => ({
                    ...template,
                    name: 'Private obsolete',
                  })),
                };
      await act(async () => oldFinish(oldValue));
      expect(host.textContent).not.toContain('Private obsolete');
      expect(writes).toHaveLength(0);
      expect(saved).not.toHaveBeenCalled();
      expect(denied).not.toHaveBeenCalled();
    }
  );
}
it('cancels post-shipment confirmation bytes without submitting the recorded shipment again', async () => {
  owner = 'confirmation';
  await render('postal');
  for (const [id, value] of [
    ['solar-postal-courier', 'Parcel Co'],
    ['solar-postal-tracking-number', 'TRACK'],
    ['solar-postal-send-date', '2026-01-02'],
  ]) {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('#' + id)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(() => expect(held).toBe(true));
  expect(writes).toHaveLength(1);
  expect(signal.aborted).toBe(false);
  await render(null);
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({
      ...postal(),
      postal: {
        ...postal().postal,
        status: 'shipped',
        courier: 'Parcel Co',
        tracking_number: 'TRACK',
        send_date: '2026-01-02',
      },
    })
  );
  expect(writes).toHaveLength(1);
  expect(host.textContent).toBe('');
  expect(saved).not.toHaveBeenCalled();
});
