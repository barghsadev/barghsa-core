import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnedInvoiceReview } from './useOwnedInvoiceReview.js';
const targets = [
  '/api/admin/invoices/manual/review',
  '/api/admin/invoices/invoice-1/corrections/review',
  '/api/admin/invoices/bank-receipts/receipt-1/confirm/review',
] as const;
const body = JSON.stringify({ profileId: 'profile-1', lines: [], amount: '250000' });
const headers = { 'Content-Type': 'application/json', 'x-csrf-token': 'review-csrf' };
let host: HTMLDivElement, root: Root, signal: AbortSignal, finish: (value: unknown) => void;
let first: boolean;
function Probe({ target, actor, revision }: { target: string; actor: string; revision: number }) {
  const read = useOwnedInvoiceReview(actor, revision);
  const [shown, setShown] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setShown('');
    void read(target, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
      signal: controller.signal,
    })
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
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      expect(init?.body).toBe(body);
      expect(init?.headers).toEqual(headers);
      expect(init?.method).toBe('POST');
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
    'owns full ' + target + ' bytes through %s replacement',
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
it.each([
  '/api/admin/invoices/manual',
  '/api/admin/invoices/invoice-1/corrections',
  '/api/admin/invoices/bank-receipts/receipt-1/confirm',
])('refuses command %s without dispatch', async (target) => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Probe target={target} actor="staff-one" revision={0} />
      </QueryComponentProvider>
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toBe('');
});
