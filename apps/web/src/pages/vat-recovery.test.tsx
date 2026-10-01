import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminVatPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  vatRate,
  electricityVatRate,
  vatProduct,
  vatOverride,
} from '../test/vat-catalogue-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as (() => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
const clock = vi.hoisted(() => ({
  timezone: 'Asia/Tehran',
  status: 'ready' as 'ready' | 'error' | 'loading',
  retries: 0,
}));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({
    ...clock,
    retry: () => {
      clock.retries++;
    },
  }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
  }: {
    action: TeamAction;
    onSuccess: () => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    captured.close = onClose;
    captured.disabled = confirmationDisabled;
    return <div data-testid="confirmation">{action.title}</div>;
  },
}));
vi.mock('@barghsa/ui', async () => {
  const ui = await vi.importActual<typeof import('@barghsa/ui')>('@barghsa/ui');
  return {
    ...ui,
    DatePicker: ({ onChange, value }: { onChange: (value: Date) => void; value?: Date }) => (
      <button
        type="button"
        data-selected={value?.toISOString() ?? ''}
        onClick={() => onChange(new Date('2026-11-12T12:00:00Z'))}
      >
        Pick date
      </button>
    ),
  };
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  clock.timezone = 'Asia/Tehran';
  clock.status = 'ready';
  clock.retries = 0;
  captured.action = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
async function render() {
  await act(async () => root.render(<Page />));
}
async function click(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  await act(async () => node!.click());
}
async function fill(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  expect(node, selector).not.toBeNull();
  await act(async () => {
    const proto =
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function mock(read: (path: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: RequestInfo | URL) => read(String(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const base = '/api/admin/finance/vat';
function data(path: string) {
  return path.endsWith('/products')
    ? [vatProduct]
    : path.endsWith('/overrides')
      ? [vatOverride]
      : [vatRate, electricityVatRate];
}
it('rate history retry retains percentage/category and does not reread override or product resources', async () => {
  let fail = false;
  const reads = mock((path) => response(data(path), path === base && fail ? 503 : 200));
  await render();
  await click('Add rate');
  await fill('#vat-category', 'consultation');
  await fill('#vat-percent', '7.25');
  fail = true;
  await click('Refresh');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  await fill('#vat-percent', '8.5');
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save rate'
    )?.disabled
  ).toBe(true);
  const before = reads.mock.calls.filter(([path]) => path !== base).length;
  fail = false;
  await click('Retry rate history');
  expect(reads.mock.calls.filter(([path]) => path !== base)).toHaveLength(before);
  expect(host.querySelector<HTMLSelectElement>('#vat-category')!.value).toBe('consultation');
  await click('Save rate');
  expect(captured.action?.body).toEqual({ category: 'consultation', rateBasisPoints: 850 });
});
it('native valid fractional percentage remains accepted while invalid precision cannot submit', async () => {
  mock((path) => response(data(path)));
  await render();
  await click('Add rate');
  await fill('#vat-percent', '1.234');
  await click('Save rate');
  expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  await fill('#vat-percent', '.5');
  await click('Save rate');
  expect(captured.action?.body).toEqual({ category: 'electricity', rateBasisPoints: 50 });
});
it('override recovery preserves product/rate and a scheduled date/time without rereading rate history', async () => {
  let fail = false;
  const reads = mock((path) =>
    response(data(path), path.endsWith('/overrides') && fail ? 503 : 200)
  );
  await render();
  await click('Add product override');
  await fill('#vat-product', vatProduct.id);
  await fill('#vat-rate', vatRate.id);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click('Pick date');
  await fill('#vat-time', '10:15');
  fail = true;
  await click('Refresh');
  const before = reads.mock.calls.filter(([path]) => path === base).length;
  fail = false;
  await click('Retry product overrides');
  expect(reads.mock.calls.filter(([path]) => path === base)).toHaveLength(before);
  expect(host.querySelector<HTMLInputElement>('#vat-time')!.value).toBe('10:15');
  await click('Save rate');
  expect(captured.action?.body).toEqual({
    productId: vatProduct.id,
    vatConfigId: vatRate.id,
    effectiveFrom: '2026-11-12T06:45:00.000Z',
  });
});
it('product recovery retains choices while rate creation stays available through unrelated option failure', async () => {
  let fail = false;
  mock((path) => response(data(path), path.endsWith('/products') && fail ? 503 : 200));
  await render();
  await click('Add product override');
  await fill('#vat-product', vatProduct.id);
  await fill('#vat-rate', vatRate.id);
  fail = true;
  await click('Refresh');
  expect(host.querySelector<HTMLSelectElement>('#vat-product')!.value).toBe(vatProduct.id);
  fail = false;
  await click('Retry product choices');
  await click('Save rate');
  expect(captured.disabled).toBe(false);
  await act(async () => captured.close!());
  await click('Cancel');
  fail = true;
  await click('Refresh');
  await click('Add rate');
  await fill('#vat-percent', '8');
  await click('Save rate');
  expect(captured.disabled).toBe(false);
});
it('withdrawn product selections stay visible and invalidate frozen override confirmation', async () => {
  let removed = false;
  mock((path) => response(path.endsWith('/products') && removed ? [] : data(path)));
  await render();
  await click('Add product override');
  await fill('#vat-product', vatProduct.id);
  await fill('#vat-rate', vatRate.id);
  await click('Save rate');
  const old = captured.success!;
  removed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('#vat-product')!.value).toBe(vatProduct.id);
  expect(host.textContent).toContain('Choice no longer available');
  await act(async () => old());
  expect(host.querySelector('#vat-product')).not.toBeNull();
  expect(host.textContent).not.toContain('Changes saved.');
});
it.each(['', '/overrides'])(
  'changed financial resource %s invalidates the captured override without erasing its draft',
  async (suffix) => {
    let changed = false;
    mock((path) =>
      response(
        path === base + suffix && changed
          ? suffix
            ? [{ ...vatOverride, rateBasisPoints: 1000 }]
            : [{ ...vatRate, rateBasisPoints: 1000 }, electricityVatRate]
          : data(path)
      )
    );
    await render();
    await click('Add product override');
    await fill('#vat-product', vatProduct.id);
    await fill('#vat-rate', vatRate.id);
    await click('Save rate');
    changed = true;
    await click('Refresh');
    expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
    expect(host.querySelector('#vat-product')).not.toBeNull();
  }
);
it('new category rate confirmation detects a changed rate it would replace while retaining the draft', async () => {
  let changed = false;
  mock((path) =>
    response(
      path === base && changed
        ? [vatRate, { ...electricityVatRate, rateBasisPoints: 1000 }]
        : data(path)
    )
  );
  await render();
  await click('Add rate');
  await fill('#vat-percent', '8');
  await click('Save rate');
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#vat-percent')!.value).toBe('8');
});
it('display title changes and rate ordering keep a valid frozen override', async () => {
  let changed = false;
  mock((path) =>
    response(
      changed && path.endsWith('/products')
        ? [{ ...vatProduct, title: { en: 'Renamed kit' } }]
        : changed && path === base
          ? [electricityVatRate, vatRate]
          : data(path)
    )
  );
  await render();
  await click('Add product override');
  await fill('#vat-product', vatProduct.id);
  await fill('#vat-rate', vatRate.id);
  await click('Save rate');
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid="confirmation"]')).not.toBeNull();
  expect(captured.disabled).toBe(false);
});
it.each(['endRate', 'endOverride'] as const)(
  'an already ended %s closes obsolete editor and ignores older completion',
  async (kind) => {
    let ended = false;
    mock((path) =>
      response(
        ended && path === (kind === 'endRate' ? base : `${base}/overrides`)
          ? kind === 'endRate'
            ? [{ ...vatRate, effectiveUntil: '2026-10-01T00:00:00Z' }, electricityVatRate]
            : [{ ...vatOverride, effectiveUntil: '2026-10-01T00:00:00Z' }]
          : data(path)
      )
    );
    await render();
    await click(kind === 'endRate' ? 'End rate' : 'End override');
    await click('End rate');
    const old = captured.success!;
    ended = true;
    await click('Refresh');
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
    await act(async () => old());
    expect(host.textContent).not.toContain('Changes saved.');
  }
);
it('timezone retry retains drafts and only retries the timezone; changing the accepted zone requires choosing a date again', async () => {
  const reads = mock((path) => response(data(path)));
  await render();
  await click('Add rate');
  await fill('#vat-percent', '7.25');
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click('Pick date');
  await fill('#vat-time', '10:15');
  clock.status = 'error';
  await render();
  const before = reads.mock.calls.length;
  await click('Retry account timezone');
  expect(reads).toHaveBeenCalledTimes(before);
  clock.status = 'ready';
  await render();
  expect(host.querySelector('[data-selected]')!.getAttribute('data-selected')).not.toBe('');
  await click('Save rate');
  clock.timezone = 'UTC';
  await render();
  expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  expect(host.querySelector('[data-selected]')!.getAttribute('data-selected')).toBe('');
  expect(host.querySelector<HTMLInputElement>('#vat-percent')!.value).toBe('7.25');
  expect(host.querySelector<HTMLInputElement>('#vat-time')!.value).toBe('10:15');
  await click('Pick date');
  expect(host.textContent).not.toContain('Choose a valid date and time');
  await click('Save rate');
  expect(captured.action?.body).toMatchObject({ effectiveFrom: '2026-11-12T10:15:00.000Z' });
});
it('a denied product read clears all private work and wins a race against older financial reads', async () => {
  let deny = false;
  let resolve!: (value: Response) => void;
  mock((path) =>
    deny && path === base
      ? new Promise((r) => {
          resolve = r;
        })
      : response(data(path), deny && path.endsWith('/products') ? 401 : 200)
  );
  await render();
  await click('Add rate');
  await fill('#vat-percent', '8');
  deny = true;
  await click('Refresh');
  await act(async () => resolve(response(data(base))));
  expect(host.querySelector('table')).toBeNull();
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('permission to manage VAT');
});
it('cancelled save cannot erase a newer editor or report success', async () => {
  mock((path) => response(data(path)));
  await render();
  await click('Add rate');
  await fill('#vat-percent', '8');
  await click('Save rate');
  const old = captured.success!;
  await act(async () => captured.close!());
  await click('Cancel');
  await click('Add product override');
  await fill('#vat-product', vatProduct.id);
  await act(async () => old());
  expect(host.querySelector<HTMLSelectElement>('#vat-product')!.value).toBe(vatProduct.id);
  expect(host.textContent).not.toContain('Changes saved.');
});
it.each(['', '/overrides', '/products'])(
  'malformed %s retry retains accepted rows and refuses unsafe override saves',
  async (suffix) => {
    let malformed = false;
    mock((path) =>
      response(
        malformed && path === base + suffix
          ? [{ id: 'bad', effectiveFrom: 'not-a-date' }]
          : data(path)
      )
    );
    await render();
    await click('Add product override');
    await fill('#vat-product', vatProduct.id);
    await fill('#vat-rate', vatRate.id);
    malformed = true;
    await click('Refresh');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(host.querySelector<HTMLSelectElement>('#vat-product')!.value).toBe(vatProduct.id);
    await click('Save rate');
    expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  }
);
