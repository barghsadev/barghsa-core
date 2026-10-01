import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t as appText } from '@barghsa/i18n/app';
import { StaffWalletReceiptList } from './StaffWalletReceiptList.js';
const settings = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fa' }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => settings.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => `ACCOUNT:${value}` }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: (value: string) => value }),
}));
const first = {
  transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  walletId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  amount: '9007199254740993',
  currency: 'IRR' as const,
  state: 'Pending',
  paymentDate: '2026-09-01',
  payerReference: 'TRK-first',
  bankName: 'بانک ملی',
  submittedAt: '2026-09-01T23:30:00.123456Z',
};
const second = {
  ...first,
  transactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  paymentDate: null,
  payerReference: null,
  bankName: null,
  dualApproval: { invoiceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
};
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
  'shows exact metadata and selected identity in both views (%s)',
  async (locale) => {
    settings.locale = locale;
    const onSelect = vi.fn();
    for (const view of ['card', 'table'] as const) {
      await act(async () =>
        root.render(
          <StaffWalletReceiptList
            items={[first, second]}
            view={view}
            selectedId={first.transactionId}
            disabled={false}
            onSelect={onSelect}
          />
        )
      );
      for (const value of [
        first.transactionId,
        second.transactionId,
        first.walletId,
        first.amount,
        first.payerReference,
        first.bankName,
        second.dualApproval.invoiceId,
        `ACCOUNT:${first.submittedAt}`,
        appText('wallet.history.state.Pending', locale),
      ])
        expect(host.textContent).toContain(value);
      expect(host.textContent).not.toContain('wallet.history.state.');
      expect(host.querySelector('time[datetime="2026-09-01"]')).not.toBeNull();
      expect(host.querySelector('time[datetime="2026-09-01"]')?.textContent).toBe(
        new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
          dateStyle: 'medium',
          calendar: locale === 'fa' ? 'persian' : 'gregory',
          timeZone: 'UTC',
        }).format(new Date('2026-09-01T00:00:00Z'))
      );
      expect(host.querySelectorAll('button[aria-current="true"]')).toHaveLength(1);
      if (view === 'table') expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(10);
      await act(async () => host.querySelectorAll<HTMLButtonElement>('button')[1]!.click());
      expect(onSelect).toHaveBeenLastCalledWith(second.transactionId);
    }
  }
);
it.each(['card', 'table'] as const)(
  'cannot select a different receipt during a frozen command (%s)',
  async (view) => {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        <StaffWalletReceiptList
          items={[first, second]}
          view={view}
          selectedId={first.transactionId}
          disabled
          onSelect={onSelect}
        />
      )
    );
    await act(async () => host.querySelectorAll<HTMLButtonElement>('button')[1]!.click());
    expect(onSelect).not.toHaveBeenCalled();
  }
);
