import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tWalletReceipts as receiptText } from '@barghsa/i18n/wallet-receipts';
import { WalletTransactionList } from './WalletTransactionList.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { walletHistoryQueryOptions } from '../lib/wallet-history-query.js';

let currentLocale: 'en' | 'fa' = 'en';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => currentLocale }));

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    format: (value: string) =>
      new Intl.DateTimeFormat('en', {
        timeZone: 'Pacific/Kiritimati',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)),
    notice: null,
  }),
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  currentLocale = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const tx = {
  id: 'tx-1',
  type: 'topup',
  amount: '9007199254740993',
  state: 'Pending',
  refId: 'invoice-ref' as string | null,
  description: 'Bank transfer' as string | null,
  createdAt: '2026-09-01T12:00:00.123456Z',
};
const response = (transactions = [tx], nextCursor: string | null = null) => ({
  ok: true,
  json: async () => ({ transactions, nextCursor }),
});
async function render(
  profileId = 'profile-a',
  locale: 'en' | 'fa' = 'en',
  account = 'wallet-user',
  staff = false
) {
  currentLocale = locale;
  await act(async () =>
    root.render(
      <AccountUserProvider value={account}>
        <WalletTransactionList profileId={profileId} locale={locale} staff={staff} />
      </AccountUserProvider>
    )
  );
}
function button(text: string) {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

async function select(selector: string, value: string) {
  await act(async () => {
    const element = document.querySelector<HTMLSelectElement>(`[role=dialog] ${selector}`)!;
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('WalletTransactionList', () => {
  it('reads the staff endpoint, links staff invoices and separates saved view preferences', async () => {
    const invoice = '11111111-1111-7111-8111-111111111111';
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profileId: 'profile-a',
        transactions: [
          {
            ...tx,
            type: 'payment',
            state: 'Completed',
            amount: '-9007199254740993',
            refId: invoice,
          },
        ],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetcher);
    await render('profile-a', 'en', 'wallet-user', true);
    expect(fetcher.mock.calls[0]![0]).toBe(
      '/api/admin/reconciliation/wallets/profile-a/transactions?sort=desc&limit=25'
    );
    expect(
      host.querySelector(`a[href="/admin/invoices?invoiceId=${invoice}"]`)?.textContent
    ).toContain(invoice);
    expect(host.querySelector('a[href^="/invoices/"]')).toBeNull();
    expect(host.textContent).toContain('-9,007,199,254,740,993');
    await click('Table');
    expect(localStorage.getItem('barghsa.list-view:wallet-user:staff-wallet-transactions')).toBe(
      'table'
    );
    expect(
      localStorage.getItem('barghsa.list-view:wallet-user:customer-wallet-transactions')
    ).toBeNull();
  });
  it('rejects a staff response identifying a different profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ profileId: 'profile-b', transactions: [tx], nextCursor: null }),
      })
    );
    await render('profile-a', 'en', 'wallet-user', true);
    expect(host.textContent).not.toContain('Bank transfer');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  });
  it('discards a delayed customer page when switching to staff history for the same profile', async () => {
    let release!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profileId: 'profile-a',
          transactions: [{ ...tx, description: 'Staff history' }],
          nextCursor: null,
        }),
      });
    vi.stubGlobal('fetch', fetcher);
    await render();
    await render('profile-a', 'en', 'wallet-user', true);
    expect(host.textContent).toContain('Staff history');
    await act(async () => release(response([{ ...tx, description: 'Obsolete customer history' }])));
    expect(host.textContent).not.toContain('Obsolete customer history');
    expect(host.textContent).toContain('Staff history');
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it('switches views without reading another page and keeps cursor/retry scope', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([tx], 'page-two'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response([{ ...tx, description: 'Page two' }]));
    vi.stubGlobal('fetch', fetcher);
    await render();
    expect(host.querySelector('table')).toBeNull();
    await click('Table');
    expect(host.querySelector('table caption')?.textContent).toContain('Transaction history');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await click('Next page');
    const url = fetcher.mock.calls.at(-1)![0];
    await click('Cards');
    expect(host.textContent).toContain('Bank transfer');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await click('Try again');
    expect(fetcher.mock.calls.at(-1)![0]).toBe(url);
    expect(host.textContent).toContain('Page two');
    expect(localStorage.getItem('barghsa.list-view:wallet-user:customer-wallet-transactions')).toBe(
      'card'
    );
  });
  it('defaults to a table on desktop and isolates wallet preferences by account and history', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await render();
    expect(host.querySelector('table')).not.toBeNull();
    expect(localStorage.length).toBe(0);
    await click('Cards');
    await render('profile-a', 'en', 'another-user');
    expect(host.querySelector('table')).not.toBeNull();
    expect(localStorage.getItem('barghsa.list-view:wallet-user:customer-wallet-transactions')).toBe(
      'card'
    );
    expect(
      localStorage.getItem('barghsa.list-view:another-user:customer-wallet-transactions')
    ).toBeNull();
    expect(localStorage.getItem('barghsa.list-view:wallet-user:invoices')).toBeNull();
    await render('profile-a', 'en', 'wallet-user');
    expect(host.querySelector('table')).toBeNull();
  });
  it('shows exact signed amounts, references and localized states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await render();
    expect(host.textContent).toContain('Bank transfer');
    expect(host.textContent).toContain('+9,007,199,254,740,993');
    expect(host.textContent).toContain('Awaiting confirmation');
    expect(host.textContent).toContain('invoice-ref');
    expect(host.textContent).toContain('Sep 2, 2026');
    expect(host.querySelector('a[href^="/invoices/"]')).toBeNull();
    expect(button('Next page')).toBeUndefined();
  });
  it('links a wallet payment to its invoice and distinguishes settled debits', async () => {
    const invoiceId = '11111111-1111-7111-8111-111111111111';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response([
          {
            ...tx,
            type: 'payment',
            amount: '-25000',
            state: 'Completed',
            refId: invoiceId,
            description: null,
          },
        ])
      )
    );
    await render();
    expect(host.querySelector(`a[href="/invoices/${invoiceId}"]`)?.textContent).toContain(
      invoiceId
    );
    expect(host.querySelector('bdi.text-destructive')?.textContent).toContain('-25,000');
    expect(host.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(host.textContent).toContain('Completed');
  });
  it('paginates and resets the cursor when filters change', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response([tx], 'next-cursor')));
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Next page');
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('cursor=next-cursor');
    await click('Previous page');
    expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('cursor=');
    await click('Next page');
    await click('Filters');
    await select('[name=type]', 'payment');
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('cursor=');
    await click('Apply filters');
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('type=payment');
    expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('cursor=');
  });
  it('supports empty, failed and retry states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(response([]))
    );
    await render();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    await click('Try again');
    expect(host.textContent).toContain('No transactions match these filters.');
  });
  it('retains accepted rows on a page failure and retries the same cursor', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([tx], 'page-two'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response([{ ...tx, id: 'tx-2', description: 'Second page' }]));
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Next page');
    expect(host.textContent).toContain('Bank transfer');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    const failedUrl = fetcher.mock.calls.at(-1)![0];
    await click('Try again');
    expect(fetcher.mock.calls.at(-1)![0]).toBe(failedUrl);
    expect(host.textContent).toContain('Second page');
    expect(host.textContent).not.toContain('Bank transfer');
  });
  it.each([401, 403, 404])(
    'clears accepted private rows when authorization fails (%s)',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(response([tx], 'page-two'))
          .mockResolvedValueOnce({ ok: false, status })
      );
      await render();
      await click('Next page');
      expect(host.textContent).not.toContain('Bank transfer');
      expect(host.querySelector('[role=alert]')).not.toBeNull();
    }
  );
  it('resets a profile-bound cursor when the active profile changes', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([tx], 'page-two'));
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Next page');
    await render('profile-b');
    const url = String(fetcher.mock.calls.at(-1)![0]);
    expect(url).toContain('/wallet/profile-b/');
    expect(url).not.toContain('cursor=');
  });
  it('does not advance into a repeated continuation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([tx], 'same-page')));
    await render();
    await click('Next page');
    expect(button('Next page').disabled).toBe(true);
    expect(button('Previous page').disabled).toBe(false);
  });
  it('discards delayed results after a profile switch and renders Persian RTL', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response([]))
    );
    await render('profile-a', 'fa');
    expect(host.querySelector('[role=status]')).not.toBeNull();
    await render('profile-b', 'fa');
    expect(host.textContent).toContain('تراکنشی مطابق این فیلترها وجود ندارد.');
    await act(async () => finish(response()));
    expect(host.textContent).not.toContain('Bank transfer');
    expect(host.querySelector('section')!.getAttribute('dir')).toBe('rtl');
  });
  it('offers recovery for an invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await render();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  });
  it('shows debits without a positive sign or absent optional details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(response([{ ...tx, amount: '-25', refId: null, description: null }]))
    );
    await render();
    expect(host.textContent).toContain('-25');
    expect(host.textContent).not.toContain('+-25');
    expect(host.textContent).not.toContain('invoice-ref');
    expect(host.textContent).not.toContain('Bank transfer');
  });
  it('applies state and ascending sort without adding empty date filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Filters');
    await select('[name=state]', 'Completed');
    await select('select:not([name])', 'submitted_at:asc');
    await click('Apply filters');
    const url = String(fetcher.mock.calls.at(-1)![0]);
    expect(url).toContain('state=Completed');
    expect(url).toContain('sort=asc');
    expect(url).not.toContain('from=');
    expect(url).not.toContain('to=');
  });
  it('rejects a malformed continuation cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ transactions: [], nextCursor: 42 }) })
    );
    await render();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  });
  it('ignores a rejected request after switching profiles', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response([]))
    );
    await render('profile-a');
    await render('profile-b');
    await act(async () => reject(new Error('aborted')));
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.textContent).toContain('No transactions match these filters.');
  });
});

it.each(['en', 'fa'] as const)(
  'offers inline bank receipt details with recorded and missing event times (%s)',
  async (locale) => {
    const bankReceipt = {
      paymentDate: '2026-09-01',
      payerReference: 'TRK-123',
      bankName: 'بانک ملی',
      customerNote: '<script>untrusted note</script>',
      rejectionReason: 'Please provide the deposit reference',
      timeline: {
        events: [
          { state: 'submitted', occurredAt: tx.createdAt },
          { state: 'approval_requested', occurredAt: null },
          { state: 'rejected', occurredAt: '2026-09-02T12:00:00Z' },
        ],
        awaiting: null,
      },
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [{ ...tx, state: 'Rejected', bankReceipt }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetcher);
    await render('profile-a', locale);
    const word = (key: string) => receiptText(`wallet.receipt.${key}`, locale);
    expect(host.querySelector('summary')?.textContent).toBe(word('details'));
    const details = host.querySelector('details')!;
    expect(details.open).toBe(false);
    details.open = true;
    expect(details.textContent).toContain('TRK-123');
    expect(details.textContent).toContain('بانک ملی');
    expect(details.textContent).toContain(tx.id);
    expect(details.textContent).toContain(word('unknownTime'));
    expect(details.textContent).toContain(word('rejected'));
    expect(details.textContent).toContain('Please provide the deposit reference');
    expect(details.querySelector('script')).toBeNull();
    expect(details.querySelector('time[datetime="2026-09-01"]')?.textContent).toBe(
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
        calendar: locale === 'fa' ? 'persian' : 'gregory',
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date('2026-09-01T00:00:00Z'))
    );
    const timeline = details.querySelector(`section[aria-label="${word('timeline')}"]`)!;
    expect(timeline.getAttribute('dir')).toBe(locale === 'fa' ? 'rtl' : 'ltr');
    expect(timeline.querySelectorAll('li')).toHaveLength(3);
    expect(timeline.querySelectorAll('time')).toHaveLength(2);
    expect(timeline.querySelector('time')?.textContent).toContain('Sep 2, 2026');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);

it('distinguishes a pending second review from an applied payment', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transactions: [
          {
            ...tx,
            bankReceipt: {
              paymentDate: null,
              payerReference: null,
              bankName: null,
              customerNote: null,
              rejectionReason: null,
              timeline: {
                events: [
                  { state: 'submitted', occurredAt: tx.createdAt },
                  { state: 'approval_requested', occurredAt: null },
                ],
                awaiting: 'second_approval',
              },
            },
          },
        ],
        nextCursor: null,
      }),
    })
  );
  await render();
  expect(host.textContent).toContain('Awaiting a second reviewer. No funds have been applied yet.');
  expect(host.querySelector('details')?.textContent).not.toContain('Receipt confirmed');
});

it.each([401, 403])('recovers a denied wallet history from page one (%s)', async (status) => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([tx], 'denied-page'))
    .mockResolvedValueOnce({ ok: false, status })
    .mockResolvedValueOnce(response([{ ...tx, description: 'Restored history' }]));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Next page');
  expect(host.textContent).not.toContain('Bank transfer');
  expect(host.querySelector('nav[aria-label="History pages"]')).toBeNull();
  await click('Try again');
  expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('cursor=');
  expect(host.textContent).toContain('Restored history');
});

it.each(['success', 'denial'] as const)(
  'fences a late wallet %s after an account change',
  async (kind) => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([tx], 'older-page'))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(response([{ ...tx, description: 'New account history' }]));
    vi.stubGlobal('fetch', fetcher);
    await render();
    await click('Next page');
    await render('profile-a', 'en', 'new-account');
    expect(host.textContent).not.toContain('Bank transfer');
    await act(async () => finish(kind === 'success' ? response() : { ok: false, status: 403 }));
    expect(host.textContent).toContain('New account history');
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('cursor=');
  }
);

it('fences a denial when profile context changes before the next render', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response([tx], 'older-page'))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(response([{ ...tx, description: 'Current profile history' }]))
  );
  await render();
  await click('Next page');
  await act(async () => {
    refreshProfileContext();
    finish({ ok: false, status: 403 });
  });
  expect(host.textContent).not.toContain('Bank transfer');
  expect(host.textContent).toContain('Current profile history');
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it.each(['denial', 'account'] as const)(
  'waits for asynchronous cursor reset before reading after %s',
  async (kind) => {
    let finishNavigation!: () => void;
    function RouteHistory({ account, locale = 'en' }: { account: string; locale?: 'en' | 'fa' }) {
      const [raw, setRaw] = useState<Record<string, unknown>>({
        history_cursor: 'denied-page',
        history_q: 'saved',
      });
      const binding = useListQuery(walletHistoryQueryOptions, raw, (update) => {
        finishNavigation = () => setRaw(update);
      });
      return (
        <AccountUserProvider value={account}>
          <WalletTransactionList profileId="profile-a" locale={locale} binding={binding} />
        </AccountUserProvider>
      );
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(kind === 'denial' ? { ok: false, status: 403 } : response())
      .mockResolvedValue(response([{ ...tx, description: 'Restored history' }]));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<RouteHistory account="old-account" />));
    if (kind === 'denial') await click('Try again');
    else {
      await act(async () => root.render(<RouteHistory account="new-account" />));
      await act(async () => root.render(<RouteHistory account="new-account" locale="fa" />));
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Bank transfer');
    await act(async () => finishNavigation());
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetcher.mock.calls.at(-1)![0]), 'http://localhost');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.get('q')).toBe('saved');
    expect(host.textContent).toContain('Restored history');
  }
);
