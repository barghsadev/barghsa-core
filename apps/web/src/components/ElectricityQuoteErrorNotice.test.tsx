import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ElectricityQuoteErrorNotice } from './ElectricityQuoteErrorNotice.js';

it('shows a direct support path with the unavailable message', async () => {
  document.documentElement.lang = 'en';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityQuoteErrorNotice message="Ordering is temporarily unavailable." />)
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Ordering is temporarily unavailable.'
    );
    const link = container.querySelector('a[href="/support"]');
    expect(link?.textContent).toBe('Contact support');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
