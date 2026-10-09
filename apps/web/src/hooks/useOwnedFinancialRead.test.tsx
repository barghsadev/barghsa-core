import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnedFinancialRead } from './useOwnedFinancialRead.js';
const targets = [
  '/api/invoices/invoice-one/wallet-payment',
  '/api/admin/consultations/requests/request-one/fee-review',
  '/api/admin/consultations/requests/request-one/paid-fee-review',
  '/api/admin/consultations/requests/request-one/paid-resolution-review',
  '/api/wallet/profile-one/top-ups/review',
  '/api/wallet/profile-one/bank-receipt-top-ups/review',
  '/api/saving/orders/order-one/change-quote',
  '/api/staff/saving/orders/order-one/financial-review',
  '/api/staff/saving/orders/order-one/amend-hardware-review',
  '/api/staff/saving/orders/order-one/cancel-hardware-upgrade-review',
  '/api/staff/saving/orders/order-one/stages/product_delivery/complete/review',
  '/api/staff/saving/orders/order-one/stages/product_delivery/skip/review',
  '/api/admin/solar/requests/request-one/create-contract/review',
];
const headers = { 'Content-Type': 'application/json', 'x-csrf-token': 'original-csrf' };
const body = JSON.stringify({
  reason: 'Captured review reason',
  amount: '9007199254740993',
  versionId: 'captured-version',
});
let host: HTMLDivElement,
  root: Root,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  first: boolean,
  call: ReturnType<typeof useOwnedFinancialRead>;
function Probe({
  path,
  actor,
  revision,
  scope,
  profile = 'profile-one',
}: {
  path: string;
  actor: string;
  revision: number;
  scope: string;
  profile?: string;
}) {
  const read = useOwnedFinancialRead(actor, revision, scope, profile),
    [shown, setShown] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setShown('');
    void read(
      path,
      {
        signal: controller.signal,
        ...(path.startsWith('/api/invoices/')
          ? {}
          : { method: 'POST', credentials: 'include', headers, body }),
      },
      !path.startsWith('/api/invoices/')
    )
      .then(async (packet) => {
        const data = (await packet.json()) as { text: string };
        if (!controller.signal.aborted) setShown(data.text);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [read, path]);
  return <p>{shown}</p>;
}
function Capture() {
  call = useOwnedFinancialRead('account-one', 0, 'review');
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const wallet = String(input).startsWith('/api/invoices/');
      expect(init?.method).toBe(wallet ? undefined : 'POST');
      expect(init?.credentials).toBe(wallet ? undefined : 'include');
      expect(init?.headers).toEqual(wallet ? undefined : headers);
      expect(init?.body).toBe(wallet ? undefined : body);
      if (first) {
        first = false;
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
      return Response.json({ text: 'Current review' });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
for (const path of targets)
  it.each(['unmount', 'actor', 'revision', 'source', 'profile'])(
    `owns complete financial ${path} JSON through %s`,
    async (change) => {
      const render = async (
        present = true,
        actor = 'account-one',
        revision = 0,
        scope = 'original-source',
        profile = 'profile-one'
      ) =>
        act(async () =>
          root.render(
            <QueryComponentProvider>
              {present && (
                <Probe
                  path={path}
                  actor={actor}
                  revision={revision}
                  scope={scope}
                  profile={profile}
                />
              )}
            </QueryComponentProvider>
          )
        );
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal,
        oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'account-two');
      else if (change === 'revision') await render(true, 'account-one', 1);
      else if (change === 'source') await render(true, 'account-one', 0, 'replacement-source');
      else await render(true, 'account-one', 0, 'original-source', 'profile-two');
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish({ text: 'obsolete-private-review' }));
      expect(host.textContent).not.toContain('obsolete-private');
      if (change !== 'unmount') expect(host.textContent).toContain('Current review');
    }
  );
it.each([
  ['/api/invoices/invoice-one/wallet-payment', 'POST'],
  ['/api/admin/consultations/requests/request-one/fee', 'POST'],
  ['/api/admin/consultations/requests/request-one/paid-fee', 'POST'],
  ['/api/admin/consultations/requests/request-one/paid-cancel', 'POST'],
  ['/api/wallet/profile-one/top-ups', 'POST'],
  ['/api/wallet/profile-one/bank-receipt-top-ups', 'POST'],
  ['/api/saving/orders/order-one/change', 'POST'],
  ['/api/staff/saving/orders/order-one/approve', 'POST'],
  ['/api/staff/saving/orders/order-one/amend-hardware', 'POST'],
  ['/api/staff/saving/orders/order-one/cancel-hardware-upgrade', 'POST'],
  ['/api/staff/saving/orders/order-one/stages/product_delivery/complete', 'POST'],
  ['/api/admin/solar/requests/request-one/create-contract', 'POST'],
  ['/api/staff/saving/orders/order-one/financial-review', 'GET'],
])('refuses financial command or wrong method %s %s', async (path, method) => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Capture />
      </QueryComponentProvider>
    )
  );
  await expect(call(path!, { method }, true)).rejects.toThrow('Invalid financial read');
  expect(fetch).not.toHaveBeenCalled();
});
it.each([401, 403, 404])(
  'preserves saving denial before error JSON for status %s',
  async (status) => {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <Capture />
        </QueryComponentProvider>
      )
    );
    const json = vi.fn(async () => ({ text: 'private denied bytes' }));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status, json } as unknown as Response);
    const result = (await call(
      '/api/staff/saving/orders/order-one/financial-review',
      { method: 'POST', headers, body },
      true
    )) as {
      status: number;
    };
    expect(result.status).toBe(status);
    expect(json).not.toHaveBeenCalled();
  }
);
it('preserves solar error JSON and tolerates malformed preview JSON', async () => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Capture />
      </QueryComponentProvider>
    )
  );
  const json = vi.fn(async () => {
    throw Error('Invalid JSON');
  });
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json } as unknown as Response);
  const packet = (await call(
    '/api/admin/solar/requests/request-one/create-contract/review',
    { method: 'POST', headers, body },
    true
  )) as {
    json: () => Promise<unknown>;
  };
  expect(await packet.json()).toBeNull();
  expect(json).toHaveBeenCalledOnce();
});
it('preserves strict wallet success JSON and refuses GET bodies', async () => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Capture />
      </QueryComponentProvider>
    )
  );
  const json = vi.fn(async () => {
    throw Error('Invalid JSON');
  });
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json } as unknown as Response);
  await expect(call(targets[0]!, {}, false)).rejects.toThrow('Invalid JSON');
  expect(json).toHaveBeenCalledOnce();
  vi.mocked(fetch).mockClear();
  await expect(call(targets[0]!, { body: '' }, false)).rejects.toThrow('Invalid financial read');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  '/api/wallet/profile-one/top-ups/review',
  '/api/wallet/profile-one/bank-receipt-top-ups/review',
])('retains the native empty-object JSON fallback for %s', async (path) => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Capture />
      </QueryComponentProvider>
    )
  );
  const json = vi.fn(async () => {
    throw Error('Invalid JSON');
  });
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json } as unknown as Response);
  const packet = await call(path, { method: 'POST', headers, body }, true, {});
  expect(await packet.json()).toEqual({});
  expect(json).toHaveBeenCalledOnce();
});
