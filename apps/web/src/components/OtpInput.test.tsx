import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { OtpInput, type OtpInputHandle } from './OtpInput.js';
let host: HTMLDivElement, root: Root;
const done = vi.fn(),
  clear = vi.fn(),
  ref = createRef<OtpInputHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  done.mockReset();
  clear.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(disabled = false, error: string | null = null) {
  await act(async () =>
    root.render(
      <OtpInput
        ref={ref}
        locale="en"
        disabled={disabled}
        error={error}
        onComplete={done}
        onClearError={clear}
      />
    )
  );
}
const inputs = () => Array.from(host.querySelectorAll('input'));
async function type(index: number, value: string) {
  await act(async () => {
    const input = inputs()[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function paste(value: string) {
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => value } });
    inputs()[0]!.dispatchEvent(event);
  });
}
it('supports wraparound arrows and backspace without completing a code', async () => {
  await render();
  for (const [index, key, shift, target] of [
    [0, 'ArrowLeft', false, 5],
    [5, 'ArrowRight', false, 0],
    [2, 'ArrowLeft', false, 1],
    [2, 'ArrowRight', false, 3],
    [2, 'Backspace', false, 1],
  ] as const) {
    await act(async () =>
      inputs()[index]!.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true })
      )
    );
    expect(document.activeElement).toBe(inputs()[target]);
  }
  for (const key of ['ArrowUp', 'ArrowDown']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => inputs()[0]!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  }
  expect(done).not.toHaveBeenCalled();
});
it('rejects nonnumeric edits, advances partial autofill, and normalizes both localized alphabets', async () => {
  await render(false, 'Invalid code');
  await type(0, 'x');
  expect(inputs()[0]!.value).toBe('');
  expect(clear).not.toHaveBeenCalled();
  await type(0, '۱۲');
  expect(
    inputs()
      .map((i) => i.value)
      .join('')
  ).toBe('12');
  expect(document.activeElement).toBe(inputs()[2]);
  await type(2, '٣٤٥٦');
  expect(done).toHaveBeenCalledWith('123456');
  expect(clear).toHaveBeenCalledTimes(2);
  await act(async () => ref.current!.reset());
  expect(inputs().every((i) => i.value === '')).toBe(true);
  expect(document.activeElement).toBe(inputs()[0]);
});
it('ignores an empty paste and retains a partial code without submitting', async () => {
  await render(false, 'Invalid code');
  await paste('letters');
  expect(done).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  await paste('۱۲ ٣');
  expect(
    inputs()
      .map((i) => i.value)
      .join('')
  ).toBe('123');
  expect(document.activeElement).toBe(inputs()[3]);
  expect(done).not.toHaveBeenCalled();
  await paste('۴۵۶۷۸۹0');
  expect(done).toHaveBeenCalledWith('456789');
});
it('keeps reset disabled and ends its error animation', async () => {
  vi.useFakeTimers();
  await render(true, 'Invalid code');
  expect(inputs().every((i) => i.disabled)).toBe(true);
  expect(host.querySelector('.animate-shake')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(500));
  expect(host.querySelector('.animate-shake')).toBeNull();
  await act(async () => ref.current!.reset());
  expect(host.contains(document.activeElement)).toBe(false);
});
