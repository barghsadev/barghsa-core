import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { TicketQueueRecords, type Ticket } from './TicketQueueRecords.js';
import { supportTicket, supportPeople } from '../test/support-queue-fixtures.js';

let host: HTMLDivElement, root: Root;
const onSelect = vi.fn();
const ticket = { ...supportTicket, updatedAt: '2026-10-01T11:50:00Z' } as Ticket;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  onSelect.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render({
  view = 'table',
  locale = 'en',
  staff = false,
  items = [ticket],
  busy = false,
}: {
  view?: 'table' | 'card';
  locale?: 'en' | 'fa';
  staff?: boolean;
  items?: Ticket[];
  busy?: boolean;
} = {}) {
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <TicketQueueRecords
            items={items}
            view={view}
            locale={locale}
            staff={staff}
            busy={busy}
            selectedId={ticket.id}
            assignees={supportPeople}
            responseTargetHours={24}
            formatDate={(value) => `Account time: ${value}`}
            onSelect={onSelect}
          />
        }
      </QueryProvider>
    )
  );
}
for (const locale of ['en', 'fa'] as const) {
  for (const view of ['table', 'card'] as const) {
    it(`${locale}/${view}: shows escaped subject, localized state, priority, relative and exact time`, async () => {
      await render({
        locale,
        view,
        items: [{ ...ticket, subject: '<script>Question</script>', priority: 'high' }],
      });
      expect(host.querySelector('script')).toBeNull();
      expect(host.textContent).toContain('<script>Question</script>');
      expect(host.textContent).toContain(t('tickets.in_progress', locale));
      expect(host.textContent).toContain('P1');
      expect(host.textContent).toContain(t('tickets.high', locale));
      expect(host.textContent).toContain(
        new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en', { numeric: 'auto' }).format(
          -10,
          'minute'
        )
      );
      expect(host.textContent).toContain(`Account time: ${ticket.updatedAt}`);
      expect(host.querySelector('time')?.dateTime).toBe(ticket.updatedAt);
      expect(host.querySelector('[data-slot=ticket-queue-records]')?.getAttribute('dir')).toBe(
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      await act(async () => host.querySelector('button')!.click());
      expect(onSelect).toHaveBeenCalledWith(ticket.id);
      expect(host.querySelector('button')?.getAttribute('aria-current')).toBe('true');
      if (view === 'table') {
        expect(host.querySelector('caption')?.textContent).toBe(t('tickets.title', locale));
        expect(host.querySelectorAll('th[scope=col]')).toHaveLength(6);
      } else expect(host.querySelector('details')?.open).toBe(false);
    });
  }
}
for (const [priority, code] of [
  ['normal', 'P2'],
  ['low', 'P3'],
  ['unexpected', 'unexpected'],
]) {
  it(`keeps priority ${priority} distinguishable without guessing an unknown code`, async () => {
    await render({ items: [{ ...ticket, priority: priority! }] });
    expect(host.querySelector('bdi')?.textContent).toBe(code);
  });
}
it('shows just now for a recent past update and refreshes once a minute', async () => {
  await render({ items: [{ ...ticket, updatedAt: '2026-10-01T11:59:50Z' }] });
  expect(host.querySelector('time')?.textContent).toBe('Just now');
  await act(async () => vi.advanceTimersByTime(120000));
  expect(host.querySelector('time')?.textContent).toBe('2 minutes ago');
});
for (const updatedAt of ['2026-10-02T12:00:00Z', 'invalid']) {
  it(`falls back to the account formatter for ${updatedAt} without a false elapsed time`, async () => {
    await render({ staff: true, items: [{ ...ticket, updatedAt }] });
    expect(host.querySelector('time')?.textContent).toBe(`Account time: ${updatedAt}`);
    expect(host.textContent).not.toContain('Just now');
    expect(host.querySelector('time')?.hasAttribute('datetime')).toBe(updatedAt !== 'invalid');
  });
}
for (const view of ['table', 'card'] as const) {
  it(`${view}: exposes staff operational metadata only to staff`, async () => {
    await render({ view, staff: true });
    expect(host.textContent).toContain('customer');
    expect(host.textContent).toContain('Support agent');
    expect(host.textContent).toContain('Account time: 2026-10-02T11:50:00.000Z');
    await render({ view });
    expect(host.textContent).not.toContain('Support agent');
    expect(host.textContent).not.toContain('2026-10-02');
  });
  it(`${view}: keeps customer invoice links and unavailable record types safe`, async () => {
    const linked = { ...ticket, relatedEntityType: 'invoice', relatedEntityId: 'invoice/id' };
    await render({ view, items: [linked] });
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/invoices/invoice%2Fid');
    await render({ view, staff: true, items: [linked] });
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('Record view is unavailable.');
    await render({ view, items: [{ ...linked, relatedEntityType: 'order' }] });
    expect(host.querySelector('a')).toBeNull();
  });
}
it('keeps an opened card disclosure across layouts and prunes absent ticket IDs', async () => {
  await render({ view: 'card' });
  await act(async () => host.querySelector('summary')!.click());
  await render({ view: 'table' });
  await render({ view: 'card' });
  expect(host.querySelector('details')?.open).toBe(true);
  await render({ view: 'card', items: [] });
  await render({ view: 'card' });
  expect(host.querySelector('details')?.open).toBe(false);
});
it('disables opening a conversation during a mutation', async () => {
  await render({ busy: true });
  await act(async () => host.querySelector('button')!.click());
  expect(onSelect).not.toHaveBeenCalled();
});

const recordId = '11111111-1111-4111-8111-111111111111';
const savingId = '22222222-2222-4222-8222-222222222222';
for (const staff of [false, true])
  for (const view of ['table', 'card'] as const)
    for (const locale of ['en', 'fa'] as const) {
      it(`${locale}/${view}/${staff ? 'staff' : 'customer'} opens resolved business records using their actual detail IDs`, async () => {
        const destinations = [
          [
            'contract',
            'contract',
            recordId,
            `${staff ? '/admin/contracts' : '/contracts'}?contractId=${recordId}`,
          ],
          [
            'invoice',
            'invoice',
            recordId,
            staff ? `/admin/invoices?invoiceId=${recordId}` : `/invoices/${recordId}`,
          ],
          [
            'order',
            'electricity_order',
            recordId,
            staff
              ? `/admin/electricity-orders?orderId=${recordId}`
              : `/electricity/orders/${recordId}`,
          ],
          [
            'order',
            'saving_order',
            savingId,
            staff ? `/admin/saving-orders?orderId=${savingId}` : `/savings/orders/${savingId}`,
          ],
        ] as const;
        for (const [relatedEntityType, destination, id, href] of destinations) {
          await render({
            staff,
            view,
            locale,
            items: [
              {
                ...ticket,
                relatedEntityType,
                relatedEntityId: recordId,
                relatedRecord: { sourceId: recordId, destination, id },
              },
            ],
          });
          expect(host.querySelector('a')?.getAttribute('href')).toBe(href);
          expect(host.querySelector('a bdi')?.textContent).toBe(recordId);
          expect(host.querySelector('a bdi')?.getAttribute('dir')).toBe('ltr');
        }
      });
    }
for (const relatedRecord of [
  null,
  { sourceId: savingId, destination: 'invoice', id: recordId },
  { sourceId: recordId, destination: 'invoice', id: 'javascript:alert(1)' },
  { sourceId: recordId, destination: 'contract', id: recordId },
  { sourceId: recordId, destination: 'unexpected', id: recordId },
] as const) {
  it(`does not turn unavailable or inconsistent metadata ${JSON.stringify(relatedRecord)} into a link`, async () => {
    await render({
      items: [
        {
          ...ticket,
          relatedEntityType: 'invoice',
          relatedEntityId: recordId,
          relatedRecord,
        } as Ticket,
      ],
    });
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('Record view is unavailable.');
  });
}

it('preserves an uppercase source reference while linking to the canonical destination UUID', async () => {
  const canonical = 'abcdefab-1111-4111-8111-111111111111';
  await render({
    items: [
      {
        ...ticket,
        relatedEntityType: 'contract',
        relatedEntityId: canonical.toUpperCase(),
        relatedRecord: {
          sourceId: canonical.toUpperCase(),
          destination: 'contract',
          id: canonical,
        },
      },
    ],
  });
  expect(host.querySelector('a')?.getAttribute('href')).toBe(`/contracts?contractId=${canonical}`);
  expect(host.querySelector('a bdi')?.textContent).toBe(canonical.toUpperCase());
});
