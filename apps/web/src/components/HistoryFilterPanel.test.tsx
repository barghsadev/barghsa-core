import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NumberFilter, TextFilter } from '@barghsa/ui';
import { parseNumberRange } from '@barghsa/shared/validation';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import { removeHistoryFilter } from '../lib/history-filter-state.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    number: (value: number) => String(value),
    money: (value: string) => BigInt(value).toString() + ' IRR',
  }),
}));

it('counts applied fields and clears unapplied drafts without a delayed search returning', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const searchChanged = vi.fn();
  function Harness() {
    const [active, setActive] = useState(true);
    return (
      <HistoryFilterPanel
        query={{ q: '' }}
        statuses={active ? ['Accepted', 'Active'] : []}
        dateRange={
          active ? { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } : {}
        }
        amountRange={active ? { min: '0' } : {}}
        onClear={() => setActive(false)}
      >
        <TextFilter value="" onChange={searchChanged} label="Search" />
        <NumberFilter
          value={{}}
          onChange={vi.fn()}
          parseRange={parseNumberRange}
          labels={{
            label: 'Amount',
            min: 'Minimum',
            max: 'Maximum',
            apply: 'Apply',
            clear: 'Clear',
            invalid: 'Invalid',
          }}
        />
      </HistoryFilterPanel>
    );
  }
  const type = async (index: number, text: string) =>
    act(async () => {
      const input = host.querySelectorAll('input')[index]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const clear = () =>
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Clear all filters'
    );
  try {
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('[data-slot="badge"]')?.textContent).toBe('3');
    await type(0, 'pending search');
    await type(1, '123');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-expanded]')!.click());
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual([
      'pending search',
      '123',
      '',
    ]);
    await act(async () => clear()!.click());
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(searchChanged).not.toHaveBeenCalled();
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual(['', '', '']);
    expect(clear()).toBeUndefined();
    expect(document.activeElement).toBe(host.querySelector('[aria-expanded]'));
    expect(host.querySelector('[data-slot="badge"]')).toBeNull();
    expect(host.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('removes one status and range while preserving other filters, draft edits and exact amount text', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let current!: {
    q: string;
    statuses: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    min?: string | undefined;
    max?: string | undefined;
    sort: string;
    state: string;
    contractId: string;
  };
  function Harness() {
    const [search, setSearch] = useState({
      q: 'original',
      statuses: 'Accepted,Active' as string | undefined,
      from: '2026-09-01T00:00:00.000Z' as string | undefined,
      to: '2026-10-01T00:00:00.000Z' as string | undefined,
      min: '9007199254740993' as string | undefined,
      max: undefined as string | undefined,
      sort: 'created_at:asc',
      state: 'Active',
      contractId: 'contract',
    });
    current = search;
    return (
      <HistoryFilterPanel
        query={{ q: search.q }}
        statuses={search.statuses?.split(',') ?? []}
        dateRange={{ from: search.from, to: search.to }}
        amountRange={{ min: search.min, max: search.max }}
        statusOptions={[
          { value: 'Accepted', label: 'Accepted' },
          { value: 'Active', label: 'Active' },
        ]}
        onClear={vi.fn()}
        onRemoveFilter={(key, value) =>
          setSearch((previous) => {
            const next = removeHistoryFilter(previous, key, value);
            return { ...next, q: next.q ?? '' };
          })
        }
      >
        <TextFilter
          value={search.q}
          onChange={(q) => setSearch((previous) => ({ ...previous, q }))}
          label="Search"
        />
        <NumberFilter
          value={{ min: search.min, max: search.max }}
          onChange={vi.fn()}
          parseRange={parseNumberRange}
          labels={{
            label: 'Amount',
            min: 'Minimum',
            max: 'Maximum',
            apply: 'Apply',
            clear: 'Clear',
            invalid: 'Invalid',
          }}
        />
      </HistoryFilterPanel>
    );
  }
  const type = async (index: number, text: string) =>
    act(async () => {
      const input = host.querySelectorAll('input')[index]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const chip = (prefix: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('ul button')].find((button) =>
      button.textContent?.startsWith(prefix)
    )!;
  try {
    await act(async () => root.render(<Harness />));
    expect(chip('Total amount').textContent).toContain('9007199254740993');
    expect(chip('Filter by submission').textContent).toContain('From 2026-09-01T00:00:00.000Z');
    expect(chip('Filter by submission').textContent).toContain('Before 2026-10-01T00:00:00.000Z');
    await type(0, 'pending search');
    await type(2, '123');
    await act(async () => chip('Accepted').click());
    expect(current.statuses).toBe('Active');
    expect(document.activeElement).toBe(host.querySelector('[aria-expanded]'));
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual([
      'pending search',
      '9007199254740993',
      '123',
    ]);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(current.q).toBe('pending search');
    await act(async () => chip('Filter by submission').click());
    expect(current.from).toBeUndefined();
    expect(current.to).toBeUndefined();
    expect(current.min).toBe('9007199254740993');
    expect(current.statuses).toBe('Active');
    expect(host.querySelectorAll('input')[2]!.value).toBe('123');
    await act(async () => chip('Total amount').click());
    expect(current.min).toBeUndefined();
    expect(current.max).toBeUndefined();
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual([
      'pending search',
      '',
      '',
    ]);
    expect(current.sort).toBe('created_at:asc');
    expect(current.state).toBe('Active');
    expect(current.contractId).toBe('contract');
    await act(async () => chip('Search:').click());
    expect(current.q).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
