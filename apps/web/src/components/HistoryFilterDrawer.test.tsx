import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DateRangeFilter, NumberFilter, TextFilter } from '@barghsa/ui';
import { parseNumberRange } from '@barghsa/shared/validation';
import { refreshProfileContext } from '../lib/profile-context.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));

it.each([false, true])(
  'applies valid fields once, preserves exact dates and resets on Cancel, navigation and profile change (dates disabled: %s)',
  async (disabled) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const applied = vi.fn();
    const dateRange = { from: '2026-09-01T10:45:00.123Z', to: '2026-09-05T12:10:00.456Z' };
    let navigate!: () => void;
    function Harness() {
      const [selection, setSelection] = useState<HistoryFilterSelection<{ q: string }>>({
        query: { q: 'original' },
        statuses: [],
        dateRange,
        amountRange: {},
      });
      navigate = () => setSelection({ ...selection, statuses: ['Accepted'] });
      const filters = useHistoryFilterDraft(selection, (value) => {
        applied(value);
        setSelection(value);
      });
      return (
        <HistoryFilterPanel
          {...selection}
          onClear={() =>
            setSelection({ query: { q: '' }, statuses: [], dateRange, amountRange: {} })
          }
          onOpen={filters.begin}
          onApply={filters.apply}
        >
          <TextFilter
            value={filters.draft.query.q}
            onChange={(q) => filters.setQuery({ q })}
            label="Search"
          />
          <DateRangeFilter
            value={filters.draft.dateRange}
            onChange={filters.setDateRange}
            locale="en"
            timezone="Asia/Tehran"
            disabled={disabled}
            labels={{
              label: 'Dates',
              preset: 'Preset',
              today: 'Today',
              last7: 'Last week',
              thisMonth: 'This month',
              lastMonth: 'Last month',
              custom: 'Custom',
              start: 'Start',
              end: 'End',
              apply: 'Apply dates',
              clear: 'Clear dates',
              invalid: 'Invalid dates',
            }}
          />
          <NumberFilter
            value={filters.draft.amountRange ?? {}}
            onChange={filters.setAmountRange}
            parseRange={parseNumberRange}
            labels={{
              label: 'Amount',
              min: 'Minimum',
              max: 'Maximum',
              apply: 'Apply amount',
              clear: 'Clear amount',
              invalid: 'Invalid amount',
            }}
          />
        </HistoryFilterPanel>
      );
    }
    const button = (name: string) =>
      [...document.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === name || b.textContent === name
      )!;
    const type = async (index: number, value: string) =>
      act(async () => {
        const input = document.querySelectorAll('input')[index]!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const click = async (name: string) => act(async () => button(name).click());
    try {
      await act(async () => root.render(<Harness />));
      await click('Filters');
      await type(0, ' latest ');
      await type(1, '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
      await type(2, '1');
      await click('Apply filters');
      expect(applied).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Invalid amount');
      await type(2, '9223372036854775807');
      await click('Apply filters');
      expect(applied).toHaveBeenCalledExactlyOnceWith({
        query: { q: 'latest' },
        statuses: [],
        dateRange,
        amountRange: { min: '9007199254740993', max: '9223372036854775807' },
      });
      await click('Filters');
      await type(0, 'discard');
      await click('Cancel');
      await click('Filters');
      expect(document.querySelector('input')?.value).toBe('latest');
      await type(0, 'stale draft');
      await act(async () => navigate());
      expect(document.querySelector('input')?.value).toBe('latest');
      await type(0, 'old profile draft');
      await act(async () => refreshProfileContext());
      expect(document.querySelector('input')?.value).toBe('latest');
      await click('Apply filters');
      expect(applied).toHaveBeenLastCalledWith({
        query: { q: 'latest' },
        statuses: ['Accepted'],
        dateRange,
        amountRange: { min: '9007199254740993', max: '9223372036854775807' },
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  }
);
