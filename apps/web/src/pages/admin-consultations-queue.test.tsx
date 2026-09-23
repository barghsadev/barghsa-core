import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('keeps earlier consultation work visible after loading another queue page', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const row = (id: string) => ({
    id,
    profile_id: 'profile-1',
    profile_name: id,
    status: 'submitted',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_id: null,
    staff_team: null,
    submitted_at: '2026-09-23T10:00:00.000Z',
    priority: 'normal',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify(
          url.endsWith('/teams')
            ? { teams: [] }
            : new URL(url, 'http://localhost').searchParams.has('after')
              ? { requests: [row('older-work')], nextAfter: null }
              : { requests: [row('first-work')], nextAfter: 'first-work' }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminConsultationsPage />));
    expect(container.textContent).toContain('first-work');
    const more = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'More work'
    );
    expect(more).toBeDefined();
    await act(async () => more?.click());
    expect(container.textContent).toContain('first-work');
    expect(container.textContent).toContain('older-work');
    expect(calls.some((url) => url.includes('after=first-work'))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
