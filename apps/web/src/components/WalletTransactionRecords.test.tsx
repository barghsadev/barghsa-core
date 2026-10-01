import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { tWalletReceipts as receiptText } from '@barghsa/i18n/wallet-receipts';
import { WalletTransactionRecords, type WalletTransaction } from './WalletTransactionRecords.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const invoice = '11111111-1111-4111-8111-111111111111';
const items: WalletTransaction[] = [
  {
    id: 'receipt-original',
    type: 'topup',
    amount: '9007199254740993',
    state: 'Rejected',
    refId: null,
    description: '<script>public note</script>',
    createdAt: '2026-09-01T12:00:00.123456Z',
    bankReceipt: {
      paymentDate: '2026-09-01',
      bankName: 'بانک ملی',
      payerReference: 'TRK_%',
      customerNote: null,
      rejectionReason: 'Readable receipt needed',
      timeline: {
        events: [{ state: 'submitted', occurredAt: '2026-09-01T12:00:00.123456Z' }],
        awaiting: null,
      },
    },
  },
  {
    id: 'payment',
    type: 'payment',
    amount: '-9007199254740993',
    state: 'Completed',
    refId: invoice,
    description: null,
    createdAt: '2026-09-02T00:00:00.000001Z',
  },
  {
    id: 'credit',
    type: 'topup',
    amount: '9007199254740993',
    state: 'Completed',
    refId: null,
    description: null,
    createdAt: '2026-09-02T00:00:00.000002Z',
  },
];
async function render(view: 'table' | 'card', locale: 'en' | 'fa' = 'en', rows = items) {
  await act(async () =>
    root.render(
      <WalletTransactionRecords
        items={rows}
        view={view}
        profileId="profile"
        locale={locale}
        formatTime={(value) => String(value)}
      />
    )
  );
}
it.each(['table', 'card'] as const)(
  'exposes identical exact public metadata and invoice links in %s view',
  async (view) => {
    await render(view);
    expect(host.textContent).toContain('+9,007,199,254,740,993');
    expect(host.querySelector('bdi.text-destructive')?.textContent).toContain(
      '-9,007,199,254,740,993'
    );
    expect(host.querySelector('bdi.text-success')?.textContent).toContain('+9,007,199,254,740,993');
    expect(host.textContent).toContain('بانک ملی');
    expect(host.textContent).toContain('TRK_%');
    expect(host.textContent).toContain('receipt-original');
    expect(host.querySelector(`a[href="/invoices/${invoice}"]`)?.textContent).toContain(
      'View invoice'
    );
    expect(host.querySelectorAll('[data-slot=wallet-receipt-details]')).toHaveLength(1);
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(
      host.querySelector('[data-slot=badge][data-variant=destructive]')?.textContent
    ).toContain('Rejected');
    if (view === 'table') {
      expect(host.querySelectorAll('th[scope=col]')).toHaveLength(11);
      expect(host.querySelector('caption')?.textContent).toBe('Transaction history · Table');
    } else
      expect(host.querySelector('ol')?.getAttribute('aria-label')).toBe(
        'Transaction history · Cards'
      );
  }
);
it.each(['table', 'card'] as const)(
  'preserves the recorded date and Persian labels in %s view',
  async (view) => {
    await render(view, 'fa');
    expect(host.textContent).toContain(t('wallet.history.type.payment', 'fa'));
    expect(host.textContent).toContain(receiptText('wallet.receipt.paymentDate', 'fa'));
    expect(host.querySelector('time[datetime="2026-09-01"]')?.textContent).toBe(
      new Intl.DateTimeFormat('fa-IR', {
        calendar: 'persian',
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date('2026-09-01T00:00:00Z'))
    );
    expect(host.textContent).toContain(
      new Intl.NumberFormat('fa-IR').format(BigInt('9007199254740993'))
    );
  }
);
it('retains an opened receipt disclosure across layouts without loading a preview', async () => {
  await render('card');
  await act(async () => {
    const details = host.querySelector<HTMLDetailsElement>('[data-slot=wallet-receipt-details]')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await render('table');
  expect(host.querySelector<HTMLDetailsElement>('[data-slot=wallet-receipt-details]')!.open).toBe(
    true
  );
  expect(host.querySelector('img')).toBeNull();
  await render('card');
  expect(host.querySelector<HTMLDetailsElement>('[data-slot=wallet-receipt-details]')!.open).toBe(
    true
  );
});
it('discards absent receipt disclosure state when another page is accepted', async () => {
  await render('card');
  await act(async () => {
    const details = host.querySelector<HTMLDetailsElement>('[data-slot=wallet-receipt-details]')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await render('table', 'en', items.slice(1));
  expect(host.querySelector('[data-slot=wallet-receipt-details]')).toBeNull();
  await render('card');
  expect(host.querySelector<HTMLDetailsElement>('[data-slot=wallet-receipt-details]')!.open).toBe(
    false
  );
});

for (const view of ['table', 'card'] as const) {
  it.each([
    ['Pending', 'review'],
    ['Pending', 'second_approval'],
    ['Released', null],
    ['Rejected', null],
  ] as const)(
    'describes receipt %s (%s) without claiming a posted credit in ' + view,
    async (state, awaiting) => {
      const original = items[0]!;
      const row = {
        ...original,
        state,
        bankReceipt: {
          ...original.bankReceipt!,
          timeline: { events: original.bankReceipt!.timeline.events, awaiting },
        },
      };
      await render(view, 'en', [row]);
      expect(host.textContent).not.toContain('Money added to your wallet.');
      if (state === 'Pending')
        expect(host.textContent).toContain(
          receiptText(`wallet.receipt.awaiting.${awaiting}`, 'en')
        );
      if (state === 'Released') {
        expect(host.querySelector('[data-slot=badge]')?.textContent).toBe('Receipt confirmed');
        expect(host.textContent).not.toContain('Funds released');
      }
      if (state === 'Rejected')
        expect(host.textContent).toContain('This request was not accepted.');
    }
  );
  it('describes a failed payment without claiming invoice settlement in ' + view, async () => {
    await render(view, 'en', [{ ...items[1]!, state: 'Failed' }]);
    expect(host.textContent).toContain(t('invoices.activity.description.Failed', 'en'));
    expect(host.textContent).not.toContain(t('wallet.history.description.payment', 'en'));
  });
}
