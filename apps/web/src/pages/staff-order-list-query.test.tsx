import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import Electricity from './AdminElectricityOrdersPage.js';
import Saving from './AdminSavingOrdersPage.js';
import { useListQuery, writeListQuery } from '../hooks/useListQuery.js';
import {
  electricityOrdersSearch,
  electricityQueueOptions,
  savingOrdersSearch,
  savingQueueOptions,
} from '../lib/staff-order-list-query.js';
import {
  firstWork,
  olderWork,
  electricityWork,
  savingWork,
} from '../test/staff-business-fixtures.js';

vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderComments.js', () => ({
  SavingOrderComments: () => null,
  ElectricityOrderComments: () => null,
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: String,
    number: String,
    irrDigits: String,
    numberStyle: 'western',
  }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: () => <div role="dialog" />,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
const cases = [
  {
    Page: Electricity,
    name: 'electricity',
    base: '/api/staff/electricity/orders',
    row: electricityWork,
    options: electricityQueueOptions,
    parse: electricityOrdersSearch,
    key: 'view',
    other: 'conversations',
    draft: '#electricity-review-reason',
    approve: 'Approve order',
  },
  {
    Page: Saving,
    name: 'saving',
    base: '/api/staff/saving/orders',
    row: savingWork,
    options: savingQueueOptions,
    parse: savingOrdersSearch,
    key: 'lane',
    other: 'fulfillment',
    draft: '#saving-staff-note',
    approve: 'Approve request',
  },
];
function button(container: ParentNode, word: string) {
  const found = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === word
  );
  expect(found, word).toBeDefined();
  return found!;
}
for (const item of cases) {
  async function mount(initial: Record<string, unknown> = {}) {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let move!: (raw: Record<string, unknown>) => void;
    let current: Record<string, unknown> = {};
    function Harness() {
      const [raw, setRaw] = useState(initial);
      move = setRaw;
      current = raw;
      const queue = useListQuery(item.options, item.parse(raw), (update) =>
        setRaw((value) => item.parse(update(value)))
      );
      return (
        <item.Page
          queries={{
            queue,
            selected:
              typeof item.parse(raw).orderId === 'string' ? String(item.parse(raw).orderId) : null,
            select: (id) => setRaw((value) => ({ ...value, orderId: id ?? undefined })),
            changeLane: (value) =>
              setRaw((raw) => ({
                ...writeListQuery(raw, item.options, { filters: { [item.key]: value } }),
                orderId: undefined,
              })),
          }}
        />
      );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    return {
      container,
      move: async (value: Record<string, unknown>) => act(async () => move(value)),
      current: () => current,
      close: async () => {
        await act(async () => root.unmount());
        container.remove();
      },
    };
  }
  it(`${item.name}: restores order and queue links without cross-page rows or cross-order drafts`, async () => {
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
        reads.push(url);
        if (
          new URL(url, 'http://localhost').pathname.endsWith(firstWork) ||
          new URL(url, 'http://localhost').pathname.endsWith(olderWork)
        )
          return Response.json(
            item.row(
              new URL(url, 'http://localhost').pathname.endsWith(firstWork) ? firstWork : olderWork
            )
          );
        const paged = new URL(url, 'http://localhost').searchParams.has('after');
        return Response.json({
          orders: [item.row(paged ? olderWork : firstWork)],
          nextAfter: paged ? olderWork : firstWork,
        });
      })
    );
    const mounted = await mount({ orderId: firstWork });
    try {
      const { container } = mounted;
      const input = container.querySelector<HTMLInputElement>(item.draft)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(
          input,
          'Private draft'
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const details = reads.filter((url) =>
        new URL(url, 'http://localhost').pathname.endsWith(firstWork)
      ).length;
      await act(async () => button(container, 'More orders').click());
      expect(mounted.current().cursor).toBe(firstWork);
      const content = container.querySelector('[data-slot="list-content"]')!;
      expect(content.textContent).toContain('Older buyer');
      expect(content.textContent).toContain('First buyer');
      expect(container.querySelector<HTMLInputElement>(item.draft)!.value).toBe('Private draft');
      expect(
        reads.filter((url) => new URL(url, 'http://localhost').pathname.endsWith(firstWork))
      ).toHaveLength(details);
      await act(async () => button(container, 'Previous page').click());
      expect(content.textContent).not.toContain('Older buyer');
      await mounted.move({ orderId: olderWork, cursor: firstWork, [item.key]: item.other });
      expect(content.textContent).not.toContain('First buyer');
      expect(container.querySelector<HTMLInputElement>(item.draft)!.value).toBe('');
      expect(reads.at(-1)).toContain(olderWork);
    } finally {
      await mounted.close();
    }
  });
  it(`${item.name}: discards a delayed financial review after restoring another order`, async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
        if (url.endsWith('/financial-review') || url.endsWith('/review'))
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        if (
          new URL(url, 'http://localhost').pathname.endsWith(firstWork) ||
          new URL(url, 'http://localhost').pathname.endsWith(olderWork)
        )
          return Response.json(
            item.row(
              new URL(url, 'http://localhost').pathname.endsWith(firstWork) ? firstWork : olderWork
            )
          );
        return Response.json({ orders: [item.row(), item.row(olderWork)], nextAfter: null });
      })
    );
    const mounted = await mount({ orderId: firstWork });
    try {
      await act(async () => button(mounted.container, item.approve).click());
      await vi.waitFor(() => expect(finish).toBeDefined());
      await mounted.move({ orderId: olderWork });
      await act(async () => finish(Response.json({})));
      expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
      expect(button(mounted.container, item.approve).disabled).toBe(false);
      expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await mounted.close();
    }
  });
  it.each([401, 403])(
    `${item.name}: clears private rows, selection and drafts on %s`,
    async (status) => {
      let denied = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
          if (new URL(url, 'http://localhost').pathname.endsWith(firstWork))
            return Response.json(item.row());
          if (denied) return new Response('{}', { status });
          return Response.json({ orders: [item.row()], nextAfter: firstWork });
        })
      );
      const mounted = await mount({ orderId: firstWork });
      try {
        expect(mounted.container.querySelector(item.draft)).not.toBeNull();
        denied = true;
        await act(async () => button(mounted.container, 'More orders').click());
        expect(mounted.container.textContent).not.toContain('First buyer');
        expect(mounted.container.querySelector(item.draft)).toBeNull();
        expect(mounted.current().orderId).toBeUndefined();
        expect(mounted.container.querySelector('nav[aria-label="History pages"]')).toBeNull();
      } finally {
        await mounted.close();
      }
    }
  );
}
