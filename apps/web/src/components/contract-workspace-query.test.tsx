import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { contractText } from '@barghsa/i18n/contracts';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ContractsWorkspace } from './ContractsWorkspace.js';
import { ContractRefundQueue } from './ContractRefundQueue.js';
import { ContractActivationRules } from './ContractActivationRules.js';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/contracts">{children}</a>,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
let host: HTMLDivElement,
  root: Root,
  kind: string,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
const path = () =>
  kind === 'list'
    ? '/api/contracts'
    : kind === 'refund'
      ? '/api/admin/wallet-refunds/contract-obligations'
      : '/api/admin/contract-activation-rules';
const current = () =>
  kind === 'list'
    ? { contracts: [], nextBefore: null }
    : kind === 'refund'
      ? { obligations: [], nextBefore: null }
      : { rules: [], canEdit: false };
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
      expect(new URL(String(input), 'http://local').pathname).toBe(path());
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
      return Response.json(current());
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'account-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present &&
            (kind === 'list' ? (
              <ContractsWorkspace />
            ) : kind === 'refund' ? (
              <ContractRefundQueue />
            ) : (
              <ContractActivationRules />
            ))}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const name of ['list', 'refund', 'rules'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'owns full actual ' + name + ' body on %s without private rows or stale edit grants',
    async (change) => {
      kind = name;
      await render();
      if (name === 'rules')
        await act(async () =>
          Array.from(host.querySelectorAll('button'))
            .find((b) => b.textContent === contractText('activationRules', 'en'))!
            .click()
        );
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal!,
        oldFinish = finish!;
      expect(oldSignal.aborted).toBe(false);
      const reads = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(reads);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'account-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      const obsolete =
        name === 'list'
          ? {
              contracts: [
                {
                  id: 'contract-1',
                  serviceType: 'electricity',
                  state: 'Active',
                  versionNumber: 1,
                  versionId: 'version-1',
                  profileTitle: 'obsolete-private-list',
                  profileType: 'LEGAL',
                },
              ],
              nextBefore: null,
            }
          : name === 'refund'
            ? {
                obligations: [
                  {
                    id: 'refund-1',
                    contractId: 'contract-1',
                    invoiceId: 'invoice-1',
                    amount: '99900',
                    destination: 'external_bank',
                    state: 'Approved',
                    bankReference: null,
                    nextAttemptAt: null,
                    exhausted: false,
                    orderId: null,
                  },
                ],
                nextBefore: null,
              }
            : {
                rules: [
                  {
                    serviceType: 'electricity',
                    revision: 1,
                    signatureRequired: false,
                    paymentRequired: true,
                    serviceStartRequired: false,
                  },
                ],
                canEdit: true,
              };
      await act(async () => oldFinish(obsolete));
      expect(host.textContent).not.toContain('obsolete-private-list');
      expect(host.textContent).not.toContain('99900');
      expect(host.textContent).not.toContain('99,900');
      expect(host.querySelector('input[type=checkbox]')).toBeNull();
      if (change !== 'unmount')
        expect(host.textContent).toContain(
          contractText(
            name === 'list'
              ? 'empty'
              : name === 'refund'
                ? 'cancellationQueueEmpty'
                : 'activationRulesReadOnly',
            'en'
          )
        );
      else expect(host.children).toHaveLength(0);
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
