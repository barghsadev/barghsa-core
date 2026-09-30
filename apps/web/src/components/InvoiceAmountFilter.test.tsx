import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NumberFilter } from '@barghsa/ui';
import { parseNumberRange, type NumberRangeValue } from '@barghsa/shared/validation';

it('applies exact localized amounts, blocks invalid drafts, and restores navigation values', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    changed = vi.fn();
  const render = (value: NumberRangeValue = {}) =>
    root.render(
      <NumberFilter
        value={value}
        onChange={changed}
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
    );
  const type = async (index: number, value: string) =>
    act(async () => {
      const input = host.querySelectorAll('input')[index]!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((item) => item.textContent === text)!;
  try {
    await act(async () => render());
    await type(0, '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
    await type(1, '9007199254740992');
    expect(button('Apply').disabled).toBe(true);
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Invalid');
    expect(changed).not.toHaveBeenCalled();
    await type(1, '٩٢٢٣٣٧٢٠٣٦٨٥٤٧٧٥٨٠٧');
    await act(async () => button('Apply').click());
    expect(changed).toHaveBeenCalledWith({ min: '9007199254740993', max: '9223372036854775807' });
    await act(async () => render({ min: '0', max: '42' }));
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual(['0', '42']);
    await act(async () => button('Clear').click());
    expect(changed).toHaveBeenLastCalledWith({});
    expect([...host.querySelectorAll('input')].map((input) => input.value)).toEqual(['', '']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
