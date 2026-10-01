import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StaffInvoiceReceiptList } from './StaffInvoiceReceiptList.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
const settings = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fa' }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => settings.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => `ACCOUNT:${value}` }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR` }),
}));
const receipts = [
  {
    receiptId: '11111111-1111-4111-8111-111111111111',
    invoiceId: '33333333-3333-4333-8333-333333333333',
    amount: '9007199254740993',
    bankName: 'Bank Mellat',
    state: 'Submitted',
    paymentDate: '2026-09-01',
    submittedAt: '2026-09-01T23:30:00Z',
  },
  {
    receiptId: '22222222-2222-4222-8222-222222222222',
    invoiceId: '44444444-4444-4444-8444-444444444444',
    amount: '450000',
    bankName: null,
    state: 'Confirmed',
    paymentDate: '2026-09-02',
    submittedAt: '2026-09-02T23:30:00Z',
  },
];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  settings.locale = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each(['en', 'fa'] as const)(
  'presents the same complete receipt metadata and exact selection in both views (%s)',
  async (locale) => {
    settings.locale = locale;
    const onOpen = vi.fn();
    for (const view of ['card', 'table'] as const) {
      await act(async () =>
        root.render(
          <StaffInvoiceReceiptList
            items={receipts}
            view={view}
            caption="Receipts"
            onOpen={onOpen}
          />
        )
      );
      for (const item of receipts) {
        expect(host.textContent).toContain(item.receiptId);
        expect(host.textContent).toContain(item.invoiceId);
        expect(host.textContent).toContain(`${item.amount} IRR`);
        expect(host.textContent).toContain(`ACCOUNT:${item.submittedAt}`);
        const date = host.querySelector(`time[datetime="${item.paymentDate}"]`);
        expect(date?.textContent).toBe(
          new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
            dateStyle: 'medium',
            timeZone: 'UTC',
          }).format(new Date(`${item.paymentDate}T00:00:00Z`))
        );
      }
      expect(host.textContent).toContain('Bank Mellat');
      expect(host.textContent).toContain('—');
      if (view === 'table') expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(8);
      else expect(host.querySelectorAll('li dl')).toHaveLength(2);
      await act(async () => host.querySelectorAll<HTMLButtonElement>('button')[1]!.click());
      expect(onOpen).toHaveBeenLastCalledWith(receipts[1]!.receiptId);
    }
  }
);
it.each([null, undefined, '', '2026-02-30', '2026-13-01', '2026-09-01T23:00:00Z', ' 2026-09-01'])(
  'does not turn invalid deposit metadata into an invented calendar day (%s)',
  async (value) => {
    await act(async () => root.render(<ReceiptDepositDate value={value} />));
    expect(host.textContent).toBe('—');
    expect(host.querySelector('time')).toBeNull();
  }
);
