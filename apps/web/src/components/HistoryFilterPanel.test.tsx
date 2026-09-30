import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NumberFilter, TextFilter } from '@barghsa/ui';
import { parseNumberRange } from '@barghsa/shared/validation';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
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
