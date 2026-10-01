import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminGiftCodesPage.js';
import { giftCode } from '../test/gift-code-fixtures.js';
import {
  giftCodeBasis,
  isGiftCode,
  isGiftCodePage,
  isGiftCodeStats,
  matchesGiftReceipt,
} from '../lib/gift-code-catalogue.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'Asia/Tehran', retry: vi.fn() }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String, percent: String }),
}));
let host: HTMLDivElement, root: Root;
const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const stats = (index = 0) => ({ code: giftCode(index), perProfile: [], recentRedemptions: [] });
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
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (n) => n.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function fill(value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>('#gift-value')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(dialog = false) {
  await act(async () =>
    document
      .querySelector(dialog ? '[role=dialog] form' : 'form[aria-label="Gift-code settings"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function render(read: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(read(String(path), init))
  );
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<Page />));
  return fetchMock;
}
it.each([
  null,
  {},
  [],
  { ...giftCode(), discountValue: 'bad' },
  { ...giftCode(), usage: { consumed: -1, released: 0, totalDiscountIrr: '0' } },
  { ...giftCode(), validUntil: '2025-01-01T00:00:00Z' },
  { ...giftCode(), restoreOnCancel: false, restoreAfterPayment: true },
  { ...giftCode(), profileIds: ['bad'] },
  { ...giftCode(), categories: ['unknown'] },
  { ...giftCode(), updatedAt: 'invalid' },
])('rejects invalid code DTO %j', (v) => expect(isGiftCode(v)).toBe(false));
it('validates page bounds, unique codes and detail ownership', () => {
  expect(isGiftCode(giftCode())).toBe(true);
  expect(isGiftCodePage([giftCode(), giftCode()])).toBe(false);
  expect(isGiftCodePage(Array.from({ length: 51 }, (_, i) => giftCode(i)))).toBe(false);
  expect(isGiftCodeStats(stats())).toBe(true);
  expect(isGiftCodeStats({ ...stats(), recentRedemptions: [{}] })).toBe(false);
});
it('receipts normalize codes, preserve exact proposals and reject wrong IDs', () => {
  expect(
    matchesGiftReceipt(giftCode(), { code: ' code00 ', discountValue: '1000' }, giftCode().id)
  ).toBe(true);
  expect(matchesGiftReceipt(giftCode(), { discountValue: '999' }, null)).toBe(false);
  expect(matchesGiftReceipt(giftCode(), { status: 'inactive' }, null)).toBe(false);
  expect(matchesGiftReceipt(giftCode(1), {}, giftCode().id)).toBe(false);
  expect(
    giftCodeBasis({ ...giftCode(), usage: { consumed: 99, released: 0, totalDiscountIrr: '0' } })
  ).toBe(giftCodeBasis(giftCode()));
});
it('retains codes and local editor fields after independent read failures', async () => {
  let failList = false,
    failStats = false;
  const requests = await render((path) =>
    path.includes('/stats')
      ? reply(stats(), failStats ? 503 : 200)
      : reply([giftCode()], failList ? 503 : 200)
  );
  await click('Edit');
  await fill('2222');
  failStats = true;
  await click('Refresh code statistics');
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('2222');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false); // filter remains available
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (n) => n.textContent === 'Save code'
    )!.disabled
  ).toBe(true);
  failStats = false;
  await click('Retry');
  failList = true;
  await click('Refresh codes');
  expect(host.textContent).toContain('CODE00');
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('2222');
  failList = false;
  await click('Refresh codes');
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('2222');
  expect(
    requests.mock.calls.filter(([path]) => String(path).includes('/stats')).length
  ).toBeGreaterThan(1);
});
it('retries the exact next cursor without dropping loaded rows or duplicating overlap', async () => {
  let failed = true;
  const requests = await render((path) =>
    path.includes('before=')
      ? reply(failed ? {} : [giftCode(49), giftCode(50)], failed ? 503 : 200)
      : reply(Array.from({ length: 50 }, (_, i) => giftCode(i)))
  );
  await click('Load more codes');
  expect(host.textContent).toContain('CODE00');
  failed = false;
  await click('Load more codes');
  expect(host.querySelectorAll('button[aria-label="Edit CODE49"]')).toHaveLength(1);
  expect(host.textContent).toContain('CODE50');
  const urls = requests.mock.calls.map(([p]) => String(p)).filter((p) => p.includes('before='));
  expect(urls[0]).toBe(urls[1]);
});
it.each([401, 403])(
  'detail denial %i clears private work and delayed list cannot restore it',
  async (status) => {
    let resolve!: (value: Response) => void,
      delayed = false,
      denied = false;
    await render((path) =>
      path.includes('/stats')
        ? reply(stats(), denied ? status : 200)
        : delayed
          ? new Promise((done) => {
              resolve = done;
            })
          : reply([giftCode()])
    );
    await click('Edit');
    await fill('2222');
    delayed = true;
    await click('Refresh codes');
    denied = true;
    await click('Refresh code statistics');
    expect(host.querySelector('#gift-value')).toBeNull();
    expect(host.textContent).not.toContain('CODE00');
    await act(async () => resolve(reply([giftCode()])));
    expect(host.textContent).not.toContain('CODE00');
    delayed = false;
    denied = false;
    await click('Refresh codes');
    expect(host.textContent).toContain('CODE00');
  }
);
it('fresh settings invalidate confirmation, retain draft and require reset', async () => {
  let changed = false;
  await render((path) =>
    path.includes('/stats')
      ? reply({
          ...stats(),
          code: changed
            ? { ...giftCode(), discountValue: '3000', updatedAt: '2026-10-01T00:00:00Z' }
            : giftCode(),
        })
      : reply([
          changed
            ? { ...giftCode(), discountValue: '3000', updatedAt: '2026-10-01T00:00:00Z' }
            : giftCode(),
        ])
  );
  await click('Edit');
  await fill('2222');
  await submit();
  changed = true;
  await click('Refresh codes', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('2222');
  await click('Reset to saved settings');
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('3000');
});
it('malformed command acknowledgement keeps the editor and never reports saved', async () => {
  await render((path, init) =>
    init?.method ? reply({}) : path.includes('/stats') ? reply(stats()) : reply([giftCode()])
  );
  await click('Edit');
  await fill('2222');
  await submit();
  await submit(true);
  expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Changes saved.');
  expect(host.querySelector<HTMLInputElement>('#gift-value')!.value).toBe('2222');
});
it.each([401, 403])('command denial %i clears all private state', async (status) => {
  await render((path, init) =>
    init?.method
      ? reply({}, status)
      : path.includes('/stats')
        ? reply(stats())
        : reply([giftCode()])
  );
  await click('Edit');
  await submit();
  await submit(true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).not.toContain('CODE00');
  expect(host.querySelector('#gift-code')).toBeNull();
});
it('late command completion cannot supersede an accepted denial', async () => {
  let resolve!: (v: Response) => void,
    denied = false;
  await render((path, init) =>
    init?.method
      ? new Promise((done) => {
          resolve = done;
        })
      : path.includes('/stats')
        ? reply(stats(), denied ? 403 : 200)
        : reply([giftCode()])
  );
  await click('Edit');
  await fill('2222');
  await submit();
  await submit(true);
  denied = true;
  await click('Refresh codes', true);
  await act(async () => resolve(reply({ ...giftCode(), discountValue: '2222' })));
  expect(host.textContent).not.toContain('Changes saved.');
  expect(host.querySelector('#gift-code')).toBeNull();
});

it('repeated cursors fail without creating an endless page loop', async () => {
  const first = Array.from({ length: 50 }, (_, i) => giftCode(i));
  await render(() => reply(first));
  await click('Load more codes');
  expect(host.querySelector('[role=alert]')!.textContent).toContain('Could not load more');
  expect(host.querySelectorAll('button[aria-label^="Edit CODE"]')).toHaveLength(50);
});
it('old filter pages cannot mix into a replaced catalogue', async () => {
  let resolve!: (v: Response) => void;
  await render((path) =>
    path.includes('before=')
      ? new Promise((done) => {
          resolve = done;
        })
      : path.includes('status=inactive')
        ? reply([{ ...giftCode(99), status: 'inactive' }])
        : reply(Array.from({ length: 50 }, (_, i) => giftCode(i)))
  );
  await click('Load more codes');
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('#gift-status-filter')!;
    select.value = 'inactive';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    host
      .querySelector('form[aria-label="Gift-code filters"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // Submit after the controlled filter has rendered its new value.
  await act(async () =>
    host
      .querySelector('form[aria-label="Gift-code filters"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await act(async () => resolve(reply([giftCode(50)])));
  expect(host.textContent).toContain('CODE99');
  expect(host.textContent).not.toContain('CODE50');
});
it('toggle receipt must match the reviewed status and code', async () => {
  const row = giftCode();
  await render((_path, init) =>
    init?.method ? reply({ ...row, status: 'inactive' }) : reply([row])
  );
  await click('Deactivate');
  await submit(true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('Changes saved.');
});
it('profile-option denial withdraws the whole editor', async () => {
  await render((path) => (path.includes('/profiles') ? reply({}, 403) : reply([giftCode()])));
  await click('Add code');
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('#gift-eligibility')!;
    select.value = 'profile';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('#gift-code')).toBeNull();
  expect(host.textContent).not.toContain('CODE00');
});
it('a receipt can publish before failed authoritative refresh without retaining an old draft', async () => {
  let fail = false;
  await render((path, init) => {
    if (init?.method) {
      fail = true;
      return reply({ ...giftCode(), discountValue: '2222' });
    }
    return path.includes('/stats') ? reply(stats()) : reply([giftCode()], fail ? 503 : 200);
  });
  await click('Edit');
  await fill('2222');
  await submit();
  await submit(true);
  expect(host.querySelector('#gift-code')).toBeNull();
  expect(host.textContent).toContain('Changes saved.');
  expect(host.textContent).toContain('2222');
  expect(
    host.querySelector<HTMLButtonElement>('button[aria-label="Deactivate CODE00"]')!.disabled
  ).toBe(true);
});
