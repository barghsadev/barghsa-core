import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperatingContextSwitch } from './OperatingContextSwitch.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  document.cookie = 'barghsa_csrf=context-test-token; path=/';
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
  vi.unstubAllGlobals();
});

it('shows the current mode and submits a deliberate credential rotation', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ isStaff: true, operatingContext: 'staff', canSwitchContext: true })
      )
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () =>
    root.render(
      <QueryProvider>{<OperatingContextSwitch area="admin" locale="en" />}</QueryProvider>
    )
  );
  expect(container.textContent).toContain('Staff mode');
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Switch to customer"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
  expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/sessions/context');
  const request = fetchMock.mock.calls[1]![1] as RequestInit;
  expect(request.method).toBe('POST');
  expect(new Headers(request.headers).get('X-CSRF-Token')).toBe('context-test-token');
  expect(JSON.parse(String(request.body))).toEqual({ context: 'customer' });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not switch mode');
});

it('keeps the context visible without offering staff authority to a customer', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ isStaff: false, operatingContext: 'customer', canSwitchContext: false })
        )
      )
  );
  await act(async () =>
    root.render(
      <QueryProvider>{<OperatingContextSwitch area="dashboard" locale="en" />}</QueryProvider>
    )
  );
  expect(container.textContent).toContain('Customer mode');
  expect(container.querySelector('[aria-label="Switch to staff"]')).toBeNull();
});

it('uses an already validated account result instead of issuing a duplicate identity read', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <OperatingContextSwitch
            area="admin"
            locale="en"
            session={{ isStaff: true, operatingContext: 'staff', canSwitchContext: true }}
          />
        }
      </QueryProvider>
    )
  );
  expect(container.querySelector('[aria-label="Switch to customer"]')).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
