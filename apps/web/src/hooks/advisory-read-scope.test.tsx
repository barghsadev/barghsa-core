import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { useTimezone } from './useTimezone.js';
import { useMaintenance, type MaintenanceCapability } from './useMaintenance.js';
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
function mountRoot() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
}
for (const value of [{}, { timezone: '' }, { timezone: 'invalid-zone' }]) {
  it(`invalid timezone remains unavailable until an explicit validated retry: ${JSON.stringify(value)}`, async () => {
    mountRoot();
    let zone!: ReturnType<typeof useTimezone>;
    const requests = vi
      .fn()
      .mockResolvedValueOnce(Response.json(value))
      .mockResolvedValueOnce(Response.json({ timezone: 'Asia/Tokyo' }));
    vi.stubGlobal('fetch', requests);
    function Probe() {
      zone = useTimezone();
      return null;
    }
    await act(async () =>
      root!.render(
        <QueryProvider>
          <Probe />
        </QueryProvider>
      )
    );
    expect(zone.status).toBe('error');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await act(async () => {});
    expect(requests).toHaveBeenCalledTimes(1);
    await act(async () => zone.retry());
    expect(zone.status).toBe('ready');
    expect(zone.timezone).toBe('Asia/Tokyo');
    expect(requests.mock.calls.map(([path]) => path)).toEqual(
      Array(2).fill('/api/user/settings/timezone')
    );
  });
}
it('timezone readers share initial data while keeping retries independent and failed refreshes unavailable', async () => {
  mountRoot();
  const zones: ReturnType<typeof useTimezone>[] = [];
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ timezone: 'Asia/Tokyo' }))
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ timezone: 'Europe/Istanbul' }));
  vi.stubGlobal('fetch', requests);
  function Probe({ index }: { index: number }) {
    zones[index] = useTimezone();
    return null;
  }
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="account">
          <Probe index={0} />
          <Probe index={1} />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  expect(requests).toHaveBeenCalledTimes(1);
  await act(async () => zones[0]!.retry());
  expect(zones[0]!.status).toBe('error');
  expect(zones[0]!.timezone).toBe('Asia/Tokyo');
  expect(zones[1]!.status).toBe('ready');
  await act(async () => zones[1]!.retry());
  expect(requests).toHaveBeenCalledTimes(3);
  expect(zones[1]!.timezone).toBe('Europe/Istanbul');
  expect(zones[0]!.status).toBe('error');
});
it('timezone account changes withdraw a previous preference and cancel delayed old reads', async () => {
  mountRoot();
  let zone!: ReturnType<typeof useTimezone>;
  let old!: (r: Response) => void, next!: (r: Response) => void;
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ timezone: 'Asia/Tokyo' }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          old = r;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          next = r;
        })
    );
  vi.stubGlobal('fetch', requests);
  function Probe() {
    zone = useTimezone();
    return null;
  }
  const render = (account: string) =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Probe />
        </AccountUserProvider>
      </QueryProvider>
    );
  await act(async () => render('a'));
  await act(async () => zone.retry());
  const signal = requests.mock.calls[1]![1].signal as AbortSignal;
  await act(async () => render('b'));
  expect(signal.aborted).toBe(true);
  expect(zone.status).toBe('loading');
  expect(zone.timezone).toBe('Asia/Tehran');
  await act(async () => old(Response.json({ timezone: 'Asia/Tokyo' })));
  expect(zone.status).toBe('loading');
  await act(async () => next(Response.json({ timezone: 'Europe/Istanbul' })));
  expect(zone.status).toBe('ready');
  expect(zone.timezone).toBe('Europe/Istanbul');
});
it('maintenance capability changes discard other notices, cancel stale reads and return freshly', async () => {
  mountRoot();
  let setting!: ReturnType<typeof useMaintenance>;
  let old!: (r: Response) => void;
  const active = {
    capability: 'electricity_checkout',
    active: true,
    reason: null,
    estimatedUntil: null,
  };
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ capabilities: [active] }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          old = r;
        })
    )
    .mockResolvedValueOnce(Response.json({ capabilities: [{ ...active, active: false }] }));
  vi.stubGlobal('fetch', requests);
  function Probe({ capability }: { capability: MaintenanceCapability }) {
    setting = useMaintenance(capability);
    return null;
  }
  const render = (capability: MaintenanceCapability) =>
    root!.render(
      <QueryProvider>
        <Probe capability={capability} />
      </QueryProvider>
    );
  await act(async () => render('electricity_checkout'));
  expect(setting?.active).toBe(true);
  await act(async () => render('saving_orders'));
  expect(setting).toBeNull();
  const signal = requests.mock.calls[1]![1].signal as AbortSignal;
  await act(async () => render('electricity_checkout'));
  expect(signal.aborted).toBe(true);
  expect(setting?.active).toBe(false);
  await act(async () =>
    old(Response.json({ capabilities: [{ ...active, capability: 'saving_orders' }] }))
  );
  expect(setting?.capability).toBe('electricity_checkout');
  expect(setting?.active).toBe(false);
  expect(requests).toHaveBeenCalledTimes(3);
});
it('shared pending maintenance reads remain manual and cancel only after the last observer', async () => {
  mountRoot();
  const requests = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    () => new Promise(() => {})
  );
  vi.stubGlobal('fetch', requests);
  function Probe() {
    useMaintenance('wallet_topup');
    return null;
  }
  const render = (count: number) =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="account">
          {Array.from({ length: count }, (_, i) => (
            <Probe key={i} />
          ))}
        </AccountUserProvider>
      </QueryProvider>
    );
  await act(async () => render(2));
  expect(requests).toHaveBeenCalledTimes(1);
  const signal = requests.mock.calls[0]![1].signal as AbortSignal;
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await act(async () => {});
  expect(requests).toHaveBeenCalledTimes(1);
  await act(async () => render(1));
  expect(signal.aborted).toBe(false);
  await act(async () => render(0));
  expect(signal.aborted).toBe(true);
});
