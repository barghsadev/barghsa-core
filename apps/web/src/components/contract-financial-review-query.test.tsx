import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import type { TeamActionDialog, TeamAction } from './TeamActionDialog.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String, percent: String }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => (
    <div>
      {props.summary}
      <button disabled={props.confirmationDisabled}>Confirm</button>
    </div>
  ),
}));
const contractId = '11111111-1111-7111-8111-111111111111';
const versionId = '22222222-2222-7222-8222-222222222222';
const profileId = '33333333-3333-7333-8333-333333333333';
function review(): ContractFinancialReview {
  return {
    schemaVersion: 1,
    scope: { action: 'contract.acceptance', profileId, resourceId: contractId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId,
        versionNumber: 2,
        serviceType: 'electricity',
        state: 'AwaitingCustomerAcceptance',
        publishedAt: '2026-09-21T09:00:00.000Z',
        content: { title: 'Electricity supply', terms: ['Published terms'] },
      },
      activation: {
        ruleRevision: 3,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: true,
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature: null,
    },
  };
}

const action: TeamAction = {
  title: 'Accept',
  description: 'Review',
  method: 'POST',
  path: '/api/contracts/' + contractId + '/accept',
  body: { expectedVersionId: versionId, idempotencyKey: 'intent-key' },
};
let host: HTMLDivElement,
  root: Root,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
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
      expect(String(input)).toBe(
        '/api/contracts/' + contractId + '/acceptance-review?versionId=' + versionId
      );
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
      return Response.json(review());
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
          {present && (
            <ContractFinancialReviewDialog
              action={action}
              profileId={profileId}
              contractId={contractId}
              time={{
                status: 'ready',
                timezone: 'UTC',
                retry: () => {},
                format: String,
                notice: null,
              }}
              onClose={() => {}}
              onSuccess={async () => {}}
            />
          )}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
it.each(['unmount', 'actor', 'profile-context'])(
  'retires held acceptance JSON on %s before enabling financial confirmation',
  async (change) => {
    await render();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal!,
      oldFinish = finish!;
    expect(oldSignal.aborted).toBe(false);
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    if (change === 'unmount') await render(false);
    else if (change === 'actor') await render(true, 'account-two');
    else await act(async () => refreshProfileContext());
    expect(oldSignal.aborted).toBe(true);
    const obsolete = review();
    obsolete.data.profile.title = 'obsolete-private-review';
    await act(async () => oldFinish(obsolete));
    await act(async () => vi.dynamicImportSettled());
    expect(host.textContent).not.toContain('obsolete-private-review');
    if (change !== 'unmount') {
      expect(host.textContent).toContain('Customer');
      expect(host.querySelector('button')!.disabled).toBe(false);
    } else expect(host.children).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
      true
    );
  }
);
