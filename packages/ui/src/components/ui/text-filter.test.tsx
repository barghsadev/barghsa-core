import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TextFilter } from './text-filter';

it('debounces typing once, synchronizes navigation, and cancels work after unmount', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  const render = (value: string) =>
    root.render(<TextFilter value={value} onChange={changed} label="Search" />);
  const type = async (text: string) =>
    act(async () => {
      const input = host.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  try {
    await act(async () => render(''));
    expect(host.querySelector('input')!.labels?.[0]?.textContent).toBe('Search');
    await type('a');
    await act(async () => vi.advanceTimersByTime(200));
    await type('abc');
    await act(async () => vi.advanceTimersByTime(299));
    expect(changed).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(changed.mock.calls).toEqual([['abc']]);
    await type('stale');
    await act(async () => render('restored'));
    expect(host.querySelector('input')!.value).toBe('restored');
    await act(async () => vi.advanceTimersByTime(300));
    expect(changed).toHaveBeenCalledTimes(1);
    await type('unfinished');
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTime(300));
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
