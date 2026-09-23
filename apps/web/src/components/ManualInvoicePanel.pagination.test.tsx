import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualInvoiceForm } from './ManualInvoicePanel.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('keeps the selected customer while loading more manual-invoice profiles', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  let olderAttempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const older = new URL(url, 'http://localhost').searchParams.has('before');
      if (older && olderAttempts++ === 0) return new Response('{}', { status: 503 });
      return new Response(
        JSON.stringify({
          items: [
            {
              id: older ? 'older-profile' : 'first-profile',
              title: older ? 'Older customer' : 'First customer',
              profileType: 'INDIVIDUAL',
            },
          ],
          nextBefore: older ? null : 'first-profile',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ManualInvoiceForm />));
    const select = container.querySelector<HTMLSelectElement>('#manual-profile')!;
    expect(select.textContent).toContain('First customer');
    await act(async () => {
      select.value = 'first-profile';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const more = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'More customers'
    );
    expect(more).toBeDefined();
    await act(async () => more?.click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => more?.click());
    expect(select.textContent).toContain('First customer');
    expect(select.textContent).toContain('Older customer');
    expect(select.value).toBe('first-profile');
    expect(calls).toContain('/api/admin/invoices/manual/profiles?search=&before=first-profile');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
