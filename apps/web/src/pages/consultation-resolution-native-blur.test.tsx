import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { tConsultation } from '@barghsa/i18n/consultation';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import { resolutionSource, firstWork } from '../test/consultation-resolution-fixtures.js';
import type * as SchemaModule from '../lib/consultation-form-schemas.js';
const lazy = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: false }));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../lib/consultation-form-schemas.js', async (importOriginal) => {
  lazy.started = true;
  await lazy.gate;
  return importOriginal<typeof SchemaModule>();
});
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
it('retains the paid1000 linked error after native reason blur starts an ordinary2000 resolver before duplicate paid submit shares its held schema', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  lazy.gate = new Promise<void>((done) => (release = done));
  const source = resolutionSource();
  const posts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        throw new Error('Invalid paid reason must not preview');
      }
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) return Response.json({ teams: [{ name: 'Operations' }] });
      if (url.includes('/requests?')) return Response.json({ requests: [source], nextAfter: null });
      if (url.endsWith(`/requests/${firstWork}`))
        return Response.json({ request: source, history: [] });
      throw new Error(`Unexpected fixture ${url}`);
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          {
            <AccountUserProvider value="reviewer">
              <AdminConsultationsPage />
            </AccountUserProvider>
          }
        </QueryComponentProvider>
      )
    );
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) => item.textContent?.includes('First buyer'))!
        .click()
    );
    await vi.waitFor(() => expect(container.querySelector('#consultation-reason')).not.toBeNull());
    const reason = container.querySelector<HTMLTextAreaElement>('#consultation-reason')!;
    const team = container.querySelector<HTMLSelectElement>('#consultation-team')!;
    await act(async () => {
      reason.focus();
      fill(reason, 'x'.repeat(1001));
      team.focus();
    });
    await vi.waitFor(() => expect(lazy.started).toBe(true));
    const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === tConsultation('cancel', 'en')
    )!;
    await act(async () => {
      cancel.click();
      cancel.click();
    });
    await act(async () => release());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement?.id).toBe('consultation-reason');
    });
    await act(async () => {});
    expect(reason.value).toBe('x'.repeat(1001));
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(reason.getAttribute('aria-describedby')).toContain('consultation-reason-message');
    expect(container.querySelector('#consultation-reason-message')?.textContent).toContain(
      tConsultation('paidReasonInvalid1000', 'en')
    );
    expect(posts).toEqual([]);
    expect(document.querySelector('[role=dialog]')).toBeNull();
  } finally {
    release();
    lazy.gate = null;
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    document.documentElement.lang = 'fa';
  }
});
