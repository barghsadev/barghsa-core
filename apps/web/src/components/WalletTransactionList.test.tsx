import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletTransactionList } from './WalletTransactionList.js';

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
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
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
async function render(profileId = 'profile-a', locale: 'en' | 'fa' = 'en') {
  await act(async () =>
    root.render(<WalletTransactionList profileId={profileId} locale={locale} />)
  );
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find((el) => el.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}

describe('WalletTransactionList', () => {
  it('shows exact signed amounts, references and localized states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await render();
    expect(host.textContent).toContain('Bank transfer');
    expect(host.textContent).toContain('+9,007,199,254,740,993');
    expect(host.textContent).toContain('Awaiting confirmation');
    expect(host.textContent).toContain('invoice-ref');
    expect(host.textContent).toContain('Sep 2, 2026');
    expect(host.querySelector('a[href^="/invoices/"]')).toBeNull();
    expect(button('Next page').disabled).toBe(true);
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
    host.querySelector<HTMLSelectElement>('[name=type]')!.value = 'payment';
    host.querySelector<HTMLInputElement>('[name=from]')!.value = '2026-09-01';
    host.querySelector<HTMLInputElement>('[name=to]')!.value = '2026-09-02';
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('type=payment');
    expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('cursor=');
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain('to=2026-09-02T23%3A59%3A59.999999Z');
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
    host.querySelector<HTMLSelectElement>('[name=state]')!.value = 'Completed';
    host.querySelector<HTMLSelectElement>('[name=sort]')!.value = 'asc';
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
