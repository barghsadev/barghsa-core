import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityQuoteErrorNotice } from './ElectricityQuoteErrorNotice.js';

it('shows a direct support path and explicitly retries the unavailable quote', async () => {
  document.documentElement.lang = 'en';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const retry = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ElectricityQuoteErrorNotice
          message="Ordering is temporarily unavailable."
          onRetry={retry}
        />
      )
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Ordering is temporarily unavailable.'
    );
    const link = container.querySelector('a[href="/support"]');
    expect(link?.textContent).toBe('Contact support');
    const button = container.querySelector('button');
    expect(button?.type).toBe('button');
    await act(async () => button?.click());
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
