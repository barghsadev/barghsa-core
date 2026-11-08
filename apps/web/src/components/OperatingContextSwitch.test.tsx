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
  vi.useRealTimers();
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
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector('[aria-label="Switch to customer"]')).not.toBeNull();
  });
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

it('holds a workspace switch for a fresh check when the receipt body stalls', async () => {
  vi.useFakeTimers();
  let release!: (value: unknown) => void;
  const pendingBody = new Promise((resolve) => {
    release = resolve;
  });
  const json = vi.fn(() => pendingBody);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () =>
    root.render(
      <QueryProvider>
        <OperatingContextSwitch
          area="admin"
          locale="en"
          session={{ isStaff: true, operatingContext: 'staff', canSwitchContext: true }}
        />
      </QueryProvider>
    )
  );
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Switch to customer"]')!;
  await act(async () => button.click());
  expect(json).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(15_001));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'could not be confirmed'
  );
  expect(container.textContent).toContain('Check current mode');
  await act(async () => release({ operatingContext: 'customer' }));
  expect(button.disabled).toBe(true);
  expect(container.textContent).toContain('Staff mode');
  expect(fetchMock).toHaveBeenCalledOnce();
});
