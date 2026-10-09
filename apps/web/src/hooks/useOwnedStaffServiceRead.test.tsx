import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnedStaffServiceRead } from './useOwnedStaffServiceRead.js';
const targets = [
  [
    'invoices',
    'list',
    '/api/admin/invoices/bank-receipts?q=bank&beforeAt=cursor-1&beforeId=receipt-1',
  ],
  ['invoices', 'detail', '/api/admin/invoices/bank-receipts/receipt-1'],
  ['invoices', 'detail', '/api/admin/invoices/bank-receipts/receipt-1/allocation'],
  ['profiles', 'list', '/api/admin/invoices/manual/profiles?search=customer&before=cursor-1'],
  ['invoices', 'detail', '/api/admin/invoices/invoice-1/corrections'],
  ['solar', 'list', '/api/admin/solar/postal-queue?lane=needs_staff&before=cursor-1'],
  ['catalogue', 'detail', '/api/admin/solar/postal-guidance'],
  ['orders', 'list', '/api/staff/electricity/increase-requests?status=pending&before=cursor-1'],
  ['contracts', 'detail', '/api/staff/electricity/contracts/contract-1/price-adjustments'],
  ['orders', 'list', '/api/staff/electricity/orders'],
  ['orders', 'detail', '/api/staff/electricity/orders/record-1'],
  ['catalogue', 'detail', '/api/admin/consultations/teams'],
  ['consultations', 'list', '/api/admin/consultations/requests?assignment=all'],
  ['consultations', 'detail', '/api/admin/consultations/requests/record-1'],
  ['solar', 'list', '/api/admin/solar/document-review-queue?before=cursor-1'],
  ['solar', 'list', '/api/admin/solar/requests'],
  ['solar', 'detail', '/api/admin/solar/requests/record-1/documents'],
  ['catalogue', 'detail', '/api/admin/solar/document-guidance'],
  ['solar', 'list', '/api/admin/solar/construction?q=solar'],
  ['solar', 'detail', '/api/admin/solar/construction/record-1'],
] as const;
let host: HTMLDivElement, root: Root, signal: AbortSignal, finish: (value: unknown) => void;
let first: boolean;
function Probe({
  target,
  actor,
  revision,
}: {
  target: readonly [
    Parameters<ReturnType<typeof useOwnedStaffServiceRead>>[0],
    'list' | 'detail',
    string,
  ];
  actor: string;
  revision: number;
}) {
  const read = useOwnedStaffServiceRead(actor, revision);
  const [shown, setShown] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setShown('');
    void read(target[0], target[1], target[2], controller.signal)
      .then(async (packet) => {
        const value = (await packet.json()) as { text: string };
        if (!controller.signal.aborted) setShown(value.text);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [read, target]);
  return <p>{shown}</p>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      expect(init?.body).toBeUndefined();
      expect(init?.method).toBeUndefined();
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
      return Response.json({ text: 'Current response' });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
for (const target of targets)
  it.each(['unmount', 'actor', 'revision'])(
    'owns full ' + target[2] + ' bytes through %s replacement',
    async (change) => {
      const render = async (actor = 'staff-one', revision = 0, present = true) =>
        act(async () =>
          root.render(
            <QueryComponentProvider>
              {present && <Probe target={target} actor={actor} revision={revision} />}
            </QueryComponentProvider>
          )
        );
      await render();
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render('staff-one', 0, false);
      else if (change === 'actor') await render('staff-two');
      else await render('staff-one', 1);
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish({ text: 'Private obsolete response' }));
      expect(host.textContent).not.toContain('Private obsolete response');
      if (change !== 'unmount') expect(host.textContent).toContain('Current response');
    }
  );
it('refuses an action endpoint without dispatching it', async () => {
  const invalid = ['orders', 'detail', '/api/staff/electricity/orders/record-1/review'] as const;
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Probe target={invalid} actor="staff-one" revision={0} />
      </QueryComponentProvider>
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toBe('');
});
