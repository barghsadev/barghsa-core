import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import { feeSource, firstWork } from '../test/consultation-fee-fixtures.js';
import type * as SchemaModule from '../lib/consultation-fee-form-schemas.js';
const lazy = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: false }));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../lib/consultation-fee-form-schemas.js', async (importOriginal) => {
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
it('keeps the authoritative invalid fee error after native touched blurs and duplicate submit share a held schema import', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  lazy.gate = new Promise<void>((resolve) => (release = resolve));
  const source = feeSource();
  const posts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        throw new Error('Invalid draft must not preview');
      }
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) return Response.json({ teams: [] });
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
    await vi.waitFor(() => expect(container.querySelector('#consultation-fee')).not.toBeNull());
    const fee = container.querySelector<HTMLInputElement>('#consultation-fee')!;
    const scope = container.querySelector<HTMLTextAreaElement>('#consultation-scope')!;
    const deliverables = container.querySelector<HTMLTextAreaElement>(
      '#consultation-deliverables'
    )!;
    const deadline = container.querySelector<HTMLInputElement>('#consultation-valid-until')!;
    await act(async () => {
      fee.focus();
      fill(fee, '0');
      scope.focus();
    });
    await vi.waitFor(() => expect(lazy.started).toBe(true));
    await act(async () => {
      fill(scope, ' Changed scope ');
      deliverables.focus();
    });
    await act(async () => {
      fill(deliverables, ' Changed report ');
      deadline.focus();
      fill(deadline, '2030-03-01T12:17');
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid=consultation-fee-form] button[type=submit]'
        )!
        .focus();
    });
    const form = container.querySelector<HTMLFormElement>('[data-testid=consultation-fee-form]')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => release());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement?.id).toBe('consultation-fee');
    });
    // Settle every native blur resolver too; later stale valid results must not erase this submit error.
    await act(async () => {});
    expect(fee.value).toBe('0');
    expect(fee.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#consultation-fee-message')?.textContent).toContain(
      'Enter a positive whole IRR'
    );
    expect(fee.getAttribute('aria-describedby')).toContain('consultation-fee-message');
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
