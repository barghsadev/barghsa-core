import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { WalletPaymentReview, WalletPaymentReviewData } from '@barghsa/shared/finance';
import { WalletInvoicePaymentPanel } from './WalletInvoicePaymentPanel.js';
import { SavingStaffOperationForm } from './SavingStaffOperationForm.js';
import { SavingHardwareCommandForm } from './SavingHardwareCommandForm.js';
import type { SavingHardwareOwner, SavingHardwareDraftCache } from '../lib/saving-hardware-form.js';
import {
  savingOperationOrder,
  savingDecisionReview,
} from '../test/saving-staff-operation-fixtures.js';
import {
  savingHardwareOrder,
  savingHardwareReview,
  savingPendingUpgrade,
  savingCancellationReview,
} from '../test/saving-hardware-form-fixtures.js';
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
const invoiceId = '11111111-1111-7111-8111-111111111111',
  profileId = '22222222-2222-7222-8222-222222222222',
  transactionId = '33333333-3333-7333-8333-333333333333';
function financialReview(
  targetInvoiceId: string,
  amount: string,
  balance: string,
  paid = '0',
  ruleRevision = 1
): WalletPaymentReview {
  const remaining = (BigInt(amount) - BigInt(paid)).toString();
  const data: WalletPaymentReviewData = {
    currency: 'IRR',
    profile: { id: profileId, title: 'Customer profile', type: 'LEGAL' },
    invoice: {
      id: targetInvoiceId,
      state: paid === amount ? 'Paid' : 'Unpaid',
      orderId: null,
      serviceType: 'electricity',
      issuedAt: '2026-09-01T10:00:00.000Z',
      payableFrom: '2026-09-01T10:00:00.000Z',
      dueAt: '2026-09-25T09:00:00.000Z',
      totalAmount: amount,
      paidAmount: paid,
      remainingAmount: remaining,
    },
    lines: [
      {
        id: transactionId,
        description: 'Electricity',
        quantity: 1,
        unitPrice: amount,
        discount: '0',
        subtotal: amount,
        vatRate: 0,
        vatAmount: '0',
        taxable: false,
      },
    ],
    totals: { subtotal: amount, discount: '0', vat: '0' },
    payment: {
      source: 'wallet',
      availableBefore: balance,
      availableAfter: (BigInt(balance) - BigInt(remaining)).toString(),
    },
    contracts: [
      {
        id: profileId,
        versionId: transactionId,
        state: 'Accepted',
        serviceType: 'electricity',
        ruleRevision,
        signatureRequired: false,
        paymentRequired: true,
        initialInvoice: true,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        cancellationRefund: 'full_wallet',
      },
    ],
    cancellation: 'separate_review_required',
  };
  return {
    schemaVersion: 1,
    scope: { action: 'invoice.wallet-payment', profileId, resourceId: targetInvoiceId },
    data,
    hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}

type Kind = 'wallet' | 'decision' | 'hardware' | 'cancellation';
let host: HTMLDivElement,
  root: Root,
  kind: Kind,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  first: boolean;
function quote(id = invoiceId, amount = '100000') {
  return {
    invoiceId: id,
    profileId,
    remainingAmount: amount,
    availableBalance: '9007199254999999',
    canPay: true,
    review: financialReview(id, amount, '9007199254999999'),
  };
}
function Forms() {
  const owner = useRef<SavingHardwareOwner | null>(null),
    scope = useRef('scope-one'),
    base = useRef('base-one'),
    cache = useRef(new Map<string, SavingHardwareDraftCache>()),
    [draft, onDraft] = useState({ note: '', handover: '' });
  return kind === 'decision' ? (
    <SavingStaffOperationForm
      order={savingOperationOrder()}
      draft={draft}
      onDraft={onDraft}
      owner={owner}
      scope="scope-one"
      currentScope={scope}
      notify={() => {}}
      onPending={() => {}}
      onSuccess={() => {}}
      onWithdraw={() => {}}
      prerequisites={() => []}
      summary={(r) => <p>{r.value.hash}</p>}
    />
  ) : (
    <SavingHardwareCommandForm
      order={savingHardwareOrder()}
      {...(kind === 'cancellation' ? { upgrade: savingPendingUpgrade() } : {})}
      owner={owner}
      scope="scope-one"
      currentScope={scope}
      draftCache={cache}
      baseScope="base-one"
      currentBaseScope={base}
      blocked={() => false}
      notify={() => {}}
      onPending={() => {}}
      onSuccess={() => {}}
      onWithdraw={() => {}}
    />
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.cookie = 'barghsa_csrf=review-live; path=/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method).toBe(kind === 'wallet' ? undefined : 'POST');
      expect(init?.credentials).toBe(kind === 'wallet' ? undefined : 'include');
      if (kind !== 'wallet') {
        expect(new Headers(init?.headers).get('x-csrf-token')).toBe('review-live');
        expect(init?.body).toEqual(expect.any(String));
        expect(path).toMatch(
          /(?:financial-review|amend-hardware-review|cancel-hardware-upgrade-review)$/
        );
      } else {
        expect(init?.body).toBeUndefined();
        expect(path).toMatch(/\/wallet-payment$/);
      }
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
      const reason =
        kind === 'wallet' ? '' : (JSON.parse(String(init?.body)) as { reason?: string }).reason;
      return Response.json(
        kind === 'wallet'
          ? quote(path.split('/')[3])
          : kind === 'decision'
            ? savingDecisionReview(savingOperationOrder(), 'approve')
            : kind === 'hardware'
              ? savingHardwareReview(reason)
              : savingCancellationReview(reason)
      );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one', id = invoiceId) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present &&
            (kind === 'wallet' ? (
              <WalletInvoicePaymentPanel
                invoiceId={id}
                eligible
                onRefreshDetails={async () => {}}
              />
            ) : (
              <Forms />
            ))}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function prepare() {
  if (kind === 'decision') {
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="saving-staff-operation-form"] button'
    )!;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
  } else {
    const input = host.querySelector<HTMLInputElement>('form input')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Captured reason'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  }
}
for (const target of ['decision', 'hardware', 'cancellation'] as const)
  it.each(['unmount', 'actor', 'profile-context'])(
    `aborts actual ${target} valid review JSON on %s without a financial command`,
    async (change) => {
      kind = target;
      await render();
      await prepare();
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
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          target === 'decision'
            ? savingDecisionReview(savingOperationOrder(), 'approve')
            : target === 'hardware'
              ? savingHardwareReview('Captured reason')
              : savingCancellationReview('Captured reason')
        )
      );
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      if (change !== 'unmount') {
        await prepare();
        await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
        expect(fetch).toHaveBeenCalledTimes(2);
      }
      expect(vi.mocked(fetch).mock.calls.every(([p]) => String(p).endsWith('review'))).toBe(true);
    }
  );
it.each(['unmount', 'actor', 'profile-context', 'invoice'])(
  'aborts a complete wallet quote on %s without restoring obsolete money or paying',
  async (change) => {
    kind = 'wallet';
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
    else if (change === 'actor') await render(true, 'staff-two');
    else if (change === 'profile-context') await act(async () => refreshProfileContext());
    else await render(true, 'staff-one', transactionId);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => oldFinish(quote(invoiceId, '9007199254740993')));
    expect(host.textContent).not.toContain('9007199254740993');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    if (change !== 'unmount') expect(host.textContent).toContain('100000');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
      true
    );
  }
);
