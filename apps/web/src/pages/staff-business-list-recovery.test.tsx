import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import Electricity from './AdminElectricityOrdersPage.js';
import Saving from './AdminSavingOrdersPage.js';
import { AdminConsultationsPage as Consultation } from './AdminConsultationsPage.js';
import {
  firstWork,
  olderWork,
  workProfile,
  electricityWork,
  savingWork,
  consultationWork,
} from '../test/staff-business-fixtures.js';

vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderComments.js', () => ({
  SavingOrderComments: () => null,
  ElectricityOrderComments: () => null,
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  window.history.replaceState(null, '', '/');
});
const cases = [
  {
    name: 'electricity',
    Page: Electricity,
    base: '/api/staff/electricity/orders',
    row: electricityWork,
    key: 'orders',
    more: 'More orders',
    draft: '#electricity-review-reason',
  },
  {
    name: 'saving',
    Page: Saving,
    base: '/api/staff/saving/orders',
    row: savingWork,
    key: 'orders',
    more: 'More orders',
    draft: '#saving-staff-note',
  },
  {
    name: 'consultation',
    Page: Consultation,
    base: '/api/admin/consultations/requests',
    row: consultationWork,
    key: 'requests',
    more: 'More work',
    draft: '#consultation-reason',
  },
];
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(Page: ComponentType) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  return {
    container,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
function button(container: ParentNode, label: string) {
  const found = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label)
  );
  expect(found, label).toBeDefined();
  return found!;
}
for (const { name, Page, base, row, key, more, draft } of cases) {
  it(`${name}: repeats a failed cursor without reloading detail or losing the staff draft`, async () => {
    let status = 503,
      detailReads = 0;
    const queries: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
        if (url.endsWith('/teams')) return Response.json({ teams: [] });
        if (url.endsWith(`/${firstWork}`)) {
          detailReads++;
          return Response.json(name === 'consultation' ? { request: row(), history: [] } : row());
        }
        queries.push(url);
        if (new URL(url, 'http://localhost').searchParams.has('after') && status !== 200)
          return new Response('{}', { status });
        return Response.json({
          [key]: [
            row(new URL(url, 'http://localhost').searchParams.has('after') ? olderWork : firstWork),
          ],
          nextAfter: new URL(url, 'http://localhost').searchParams.has('after')
            ? olderWork
            : firstWork,
        });
      })
    );
    const { container, close } = await mount(Page);
    try {
      await act(async () => button(container, 'First buyer').click());
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(draft)!;
      expect(input).not.toBeNull();
      await act(async () => fill(input, 'Preserve this draft'));
      await act(async () => button(container, more).click());
      const content = container.querySelector('[data-slot="list-content"]')!;
      expect(content.textContent).toContain('First buyer');
      const failed = queries.at(-1);
      expect(failed).toContain(base);
      const reads = detailReads;
      status = 200;
      await act(async () =>
        button(content, name === 'consultation' ? 'Try again' : 'Retry').click()
      );
      expect(content.textContent).toContain('Older buyer');
      expect(queries.at(-1)).toBe(failed);
      expect(detailReads).toBe(reads);
      expect(input.value).toBe('Preserve this draft');
      status = 403;
      await act(async () => button(container, more).click());
      expect(content.querySelector('button')).toBeNull();
      expect(container.querySelector(draft)).toBeNull();
      expect(container.textContent).not.toContain('First buyer');
    } finally {
      await close();
    }
  });
  it(`${name}: detail failure leaves the queue usable and detail retry does not fetch the queue`, async () => {
    let fail = true,
      listReads = 0,
      detailReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
        if (url.endsWith('/teams')) return Response.json({ teams: [] });
        if (url.endsWith(`/${firstWork}`)) {
          detailReads++;
          return fail
            ? new Response('{}', { status: 503 })
            : Response.json(name === 'consultation' ? { request: row(), history: [] } : row());
        }
        listReads++;
        return Response.json({ [key]: [row()], nextAfter: firstWork });
      })
    );
    const { container, close } = await mount(Page);
    try {
      await act(async () => button(container, 'First buyer').click());
      const content = container.querySelector('[data-slot="list-content"]')!;
      expect(content.querySelector('[role="alert"]')).toBeNull();
      expect(content.textContent).toContain('First buyer');
      const reads = listReads;
      fail = false;
      await act(async () =>
        button(container, name === 'consultation' ? 'Try again' : 'Retry').click()
      );
      expect(container.querySelector(draft)).not.toBeNull();
      expect(detailReads).toBe(2);
      expect(listReads).toBe(reads);
    } finally {
      await close();
    }
  });
}
it('consultation team recovery is independent of the queue and selected detail', async () => {
  let fail = true,
    teamReads = 0,
    listReads = 0,
    detailReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) {
        teamReads++;
        return fail
          ? new Response('{}', { status: 503 })
          : Response.json({ teams: [{ name: 'Operations' }] });
      }
      if (url.endsWith(`/${firstWork}`)) {
        detailReads++;
        return Response.json({ request: consultationWork(), history: [] });
      }
      listReads++;
      return Response.json({ requests: [consultationWork()], nextAfter: null });
    })
  );
  const { container, close } = await mount(Consultation);
  try {
    expect(container.textContent).toContain('Could not load consultation teams');
    await act(async () => button(container, 'First buyer').click());
    const reads = [listReads, detailReads];
    fail = false;
    await act(async () => button(container, 'Try again').click());
    expect(teamReads).toBe(2);
    expect([listReads, detailReads]).toEqual(reads);
    expect(container.textContent).toContain('Operations');
    expect(container.textContent).not.toContain('Could not load consultation teams');
  } finally {
    await close();
  }
});
it('discards a delayed consultation fee review after selecting another request', async () => {
  let finish: ((response: Response) => void) | undefined;
  let review: unknown;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) return Response.json({ teams: [] });
      if (url.endsWith('/fee-review')) {
        const input = JSON.parse(String(init?.body));
        review = {
          schemaVersion: 1,
          scope: {
            action: 'consultation.fee-offer',
            profileId: workProfile,
            resourceId: firstWork,
          },
          data: {
            serviceTitle: consultationWork().product_snapshot.title,
            profileName: 'First buyer',
            scope: input.scope,
            deliverables: input.deliverables,
            fee: input.fee,
            validUntil: input.validUntil,
            reason: null,
            previousInvoice: null,
            outcome: 'issue_invoice',
          },
          hash: 'a'.repeat(64),
        };
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      if (url.endsWith(`/${firstWork}`) || url.endsWith(`/${olderWork}`))
        return Response.json({
          request: consultationWork(url.endsWith(`/${firstWork}`) ? firstWork : olderWork),
          history: [],
        });
      return Response.json({
        requests: [consultationWork(), consultationWork(olderWork)],
        nextAfter: null,
      });
    })
  );
  const { container, close } = await mount(Consultation);
  try {
    await act(async () => button(container, 'First buyer').click());
    await act(async () => button(container, 'Issue fee offer and invoice').click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(finish).toBeDefined();
    });
    await act(async () => button(container, 'Older buyer').click());
    await act(async () => finish!(Response.json(review)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Older buyer');
    expect(button(container, 'Issue fee offer and invoice').disabled).toBe(false);
  } finally {
    await close();
  }
});
