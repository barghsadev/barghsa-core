import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SolarContractForm } from './SolarContractForm.js';
import {
  contractOptions,
  contractReview,
  solarRequestId,
  solarProfileId,
} from '../test/solar-contract-fixtures.js';
import type { SolarContractBody } from '../lib/solar-contract-form.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String, percent: String }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({ summary }: { summary?: ReactNode }) => <div role="dialog">{summary}</div>,
}));
let host: HTMLDivElement,
  root: Root,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  body: SolarContractBody,
  first: boolean;
const created = vi.fn(),
  denied = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.cookie = 'barghsa_csrf=review-live; path=/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  created.mockReset();
  denied.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/review')) {
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe('review-live');
        const value = JSON.parse(String(init?.body)) as SolarContractBody;
        if (first) {
          first = false;
          body = value;
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
        const review = contractReview(value);
        return Response.json({
          ...review,
          data: { ...review.data, requestId: path.split('/')[5] },
        });
      }
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      if (path.endsWith('/contract-options')) return Response.json(contractOptions);
      expect(path).toBe('/api/wallet/' + solarProfileId);
      return Response.json({
        balance: '1000000',
        currency: 'IRR',
        onlineTopUpLimit: 0,
        configVersion: 1,
      });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one', request = solarRequestId) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present && (
            <SolarContractForm
              requestId={request}
              profileId={solarProfileId}
              onCreated={created}
              onDenied={denied}
            />
          )}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function valid() {
  await vi.waitFor(() => expect(host.querySelector('#solar-contract-source')).not.toBeNull());
  for (const [id, value] of [
    ['source', 'template:' + contractOptions.templates[0]!.version_id],
    ['title', 'Solar agreement'],
    ['text', 'Build the station.'],
    ['reason', 'Initial draft'],
    ['value-kind', 'fixed'],
    ['fixed-amount', '900000'],
    ['line-0-description', 'Deposit'],
    ['line-0-unit-price', '100000'],
  ]) {
    const field = host.querySelector('#solar-contract-' + id) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    expect(field, id).not.toBeNull();
    const proto =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
      field.dispatchEvent(
        new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
      );
    });
  }
}
async function submit() {
  await act(async () =>
    host
      .querySelector('[data-testid="solar-contract-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
it.each(['unmount', 'actor', 'profile-context', 'request'])(
  'cancels the actual solar preview full JSON on %s without creating a contract',
  async (change) => {
    await render();
    await valid();
    await submit();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal,
      oldFinish = finish,
      oldBody = body;
    expect(oldSignal.aborted).toBe(false);
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(count);
    if (change === 'unmount') await render(false);
    else if (change === 'actor') await render(true, 'staff-two');
    else if (change === 'profile-context') await act(async () => refreshProfileContext());
    else await render(true, 'staff-one', solarProfileId);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => oldFinish(contractReview(oldBody)));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(created).not.toHaveBeenCalled();
    expect(denied).not.toHaveBeenCalled();
    if (change !== 'unmount') {
      await valid();
      await submit();
      await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
    }
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === 'POST')
        .every(([path]) => String(path).endsWith('/review'))
    ).toBe(true);
    expect(created).not.toHaveBeenCalled();
  }
);
