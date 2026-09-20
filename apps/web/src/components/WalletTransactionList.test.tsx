import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletTransactionList } from './WalletTransactionList.js';

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
  refId: 'invoice-ref',
  description: 'Bank transfer',
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
    expect(button('Next page').disabled).toBe(true);
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
});
