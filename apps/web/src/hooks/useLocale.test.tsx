import { expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useLocale } from './useLocale.js';

function Language() {
  return <output>{useLocale()}</output>;
}
it('updates mounted consumers on a language change and normalizes regional locales', async () => {
  const original = document.documentElement.lang;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    document.documentElement.lang = 'fa-IR';
    await act(async () => {
      root.render(<Language />);
    });
    expect(container.textContent).toBe('fa');
    await act(async () => {
      document.documentElement.lang = 'en-US';
    });
    expect(container.textContent).toBe('en');
    await act(async () => {
      document.documentElement.lang = 'unsupported';
    });
    expect(container.textContent).toBe('fa');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.lang = original;
  }
});
