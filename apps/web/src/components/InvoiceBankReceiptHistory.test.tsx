import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvoiceBankReceiptHistory } from './InvoiceBankReceiptHistory.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { invoiceReceiptQueryOptions } from '../lib/finance-list-query.js';

const first = '11111111-1111-7111-8111-111111111111';
const older = '22222222-2222-7222-8222-222222222222';
const stamp = '2026-09-01T00:00:00.123456Z';
const row = (receiptId: string) => ({
  receiptId,
  invoiceId: first,
  amount: '9007199254740993',
  state: 'Confirmed',
  bankName: 'Bank Mellat',
  paymentDate: '2026-09-01',
  submittedAt: stamp,
});
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    number: (value: number) => String(value),
    money: (value: string) => value,
  }),
}));
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
const render = (revision = 0) =>
  act(async () => root.render(<InvoiceBankReceiptHistory revision={revision} onOpen={vi.fn()} />));
const click = (label: string) =>
  act(async () =>
    (
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === label
      ) as HTMLButtonElement
    ).click()
  );

it('retains accepted rows during a failed page and retries its exact microsecond cursor before going back', async () => {
  let fail = true;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const more = String(input).includes('beforeAt=');
    if (more && fail) return new Response(null, { status: 503 });
    return new Response(
      JSON.stringify({
        items: [row(more ? older : first)],
        nextCursor: more ? null : { beforeAt: stamp, beforeId: first },
      })
    );
  });
  vi.stubGlobal('fetch', fetcher);
  await render();
  await click('Next page');
  const failed = fetcher.mock.calls.at(-1)![0];
  expect(host.textContent).toContain(first);
  expect(host.querySelector('nav')).toBeNull();
  fail = false;
  await click('Retry');
  expect(fetcher.mock.calls.at(-1)![0]).toBe(failed);
  expect(new URL(String(failed), 'https://example.test').searchParams.get('beforeAt')).toBe(stamp);
  expect(host.textContent).toContain(older);
  expect(host.querySelectorAll('nav button')[1]?.hasAttribute('disabled')).toBe(true);
  await click('Previous page');
  expect(host.textContent).not.toContain(older);
  expect(String(fetcher.mock.calls.at(-1)![0])).not.toContain('beforeAt=');
});

it('reapplying an unchanged invoice filter retries the first page instead of leaving an empty loading state', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ items: [row(first)], nextCursor: null }))
  );
  vi.stubGlobal('fetch', fetcher);
  await render();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain(first);
  expect(host.querySelector('[data-slot="list-content"]')?.getAttribute('aria-busy')).toBeNull();
});

it.each([401, 403])(
  'discards rows after denied refresh and does not resurrect them during a failed retry (%s)',
  async (deniedStatus) => {
    let status = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        status === 200
          ? new Response(JSON.stringify({ items: [row(first)], nextCursor: null }))
          : new Response(null, { status })
      )
    );
    await render();
    expect(host.textContent).toContain(first);
    status = deniedStatus;
    await render(1);
    expect(host.textContent).not.toContain(first);
    status = 503;
    await render(2);
    expect(host.textContent).not.toContain(first);
    expect(host.textContent).toContain('Could not load receipt history.');
  }
);

it('aborts an old cursor read and hides the previous criteria while rejecting its late response', async () => {
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let change!: (value: Record<string, unknown>) => void;
  let oldSignal: AbortSignal | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const params = new URL(String(input), 'https://example.test').searchParams;
    if (params.has('beforeAt')) {
      oldSignal = init?.signal ?? undefined;
      return delayed;
    }
    if (params.get('q') === 'new')
      return new Response(JSON.stringify({ items: [row(older)], nextCursor: null }));
    return new Response(
      JSON.stringify({ items: [row(first)], nextCursor: { beforeAt: stamp, beforeId: first } })
    );
  });
  vi.stubGlobal('fetch', fetcher);
  function Harness() {
    const [raw, setRaw] = useState<Record<string, unknown>>({ receipt_q: 'old' });
    change = setRaw;
    const binding = useListQuery(invoiceReceiptQueryOptions, raw, (update) => setRaw(update));
    return <InvoiceBankReceiptHistory revision={0} onOpen={vi.fn()} binding={binding} />;
  }
  await act(async () => root.render(<Harness />));
  await click('Next page');
  await act(async () => change({ receipt_q: 'new' }));
  expect(oldSignal?.aborted).toBe(true);
  expect(host.textContent).toContain(older);
  await act(async () =>
    finish(new Response(JSON.stringify({ items: [row(first)], nextCursor: null })))
  );
  expect(
    [...host.querySelectorAll('[data-slot="list-content"] bdi')].filter(
      (node) => node.textContent === first
    )
  ).toHaveLength(1);
  expect(host.querySelector('[data-slot="list-content"]')!.textContent).toContain(older);
});
it('does not refetch reviewed history when only another list namespace changes', async () => {
  let change!: (value: Record<string, unknown>) => void;
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ items: [row(first)], nextCursor: null }))
  );
  vi.stubGlobal('fetch', fetcher);
  function Harness() {
    const [raw, setRaw] = useState<Record<string, unknown>>({ receipt_q: 'bank' });
    change = setRaw;
    const binding = useListQuery(invoiceReceiptQueryOptions, raw, (update) => setRaw(update));
    return <InvoiceBankReceiptHistory revision={0} onOpen={vi.fn()} binding={binding} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => change({ receipt_q: 'bank', queue_q: 'different', state: 'Paid' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
