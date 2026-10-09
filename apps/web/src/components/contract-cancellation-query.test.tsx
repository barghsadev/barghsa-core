import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { contractText } from '@barghsa/i18n/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ContractCancellationPanel } from './ContractCancellationPanel.js';
import { ContractCancellationRequestPanel } from './ContractCancellationRequestPanel.js';
import { ContractCancellationRequestQueue } from './ContractCancellationRequestQueue.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
const id = 'contract-1',
  versionId = 'version-1';
const status = (amount = '100') => ({
  state: 'Cancelled',
  canCancel: false,
  financialStatus: 'completed',
  returnedAmount: amount,
  refundAmount: amount,
  refunds: [],
});
const request = (reason = 'Current request') => ({
  id: 'request-1',
  contractId: id,
  versionId,
  reason,
  preferredDestination: 'wallet',
  status: 'Pending',
  resolutionReason: null,
  contractState: 'Accepted',
  stale: false,
});
let host: HTMLDivElement,
  root: Root,
  kind: string,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
const path = () =>
  kind === 'queue'
    ? '/api/admin/contract-cancellation-requests'
    : '/api/admin/contracts/' +
      id +
      (kind === 'status' ? '/cancellation-status' : '/cancellation-requests');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  signal = undefined;
  finish = undefined;
  let first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(path());
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('include');
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
      return Response.json(
        kind === 'queue'
          ? { requests: [], nextBefore: null }
          : kind === 'status'
            ? status()
            : { request: request() }
      );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present &&
            (kind === 'status' ? (
              <ContractCancellationPanel id={id} versionId={versionId} staff onChanged={() => {}} />
            ) : kind === 'queue' ? (
              <ContractCancellationRequestQueue />
            ) : (
              <ContractCancellationRequestPanel
                id={id}
                versionId={versionId}
                staff
                onChanged={() => {}}
                onReview={() => {}}
              />
            ))}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const name of ['status', 'request', 'queue'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'owns actual cancellation ' + name + ' JSON on %s without obsolete money, request or commands',
    async (change) => {
      kind = name;
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal!,
        oldFinish = finish!;
      expect(oldSignal.aborted).toBe(false);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'status'
            ? status('99900')
            : name === 'queue'
              ? { requests: [request('obsolete-private-request')], nextBefore: null }
              : { request: request('obsolete-private-request') }
        )
      );
      expect(host.textContent).not.toContain('obsolete-private-request');
      expect(host.textContent).not.toContain('99,900');
      if (change !== 'unmount')
        expect(host.textContent).toContain(
          name === 'status'
            ? '100 / 100'
            : name === 'request'
              ? 'Current request'
              : contractText('cancellationRequestQueueEmpty', 'en')
        );
      else expect(host.children).toHaveLength(0);
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
