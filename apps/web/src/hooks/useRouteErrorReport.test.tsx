import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import reportEmergencyRouteError, { useRouteErrorReport } from './useRouteErrorReport.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0';
});

function BoundaryReference() {
  return <output>{useRouteErrorReport('ROUTE_RENDER_FAILED')}</output>;
}

it('uses one matching support reference and current CSRF token across repeated effects', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', transport);
  document.cookie = 'barghsa_csrf=fixture-route-csrf';
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <StrictMode>
          <BoundaryReference />
        </StrictMode>
      );
    });
    expect(transport).toHaveBeenCalledOnce();
    const [path, request] = transport.mock.calls[0]!;
    expect(path).toBe('/api/route-errors');
    expect(request).toMatchObject({
      method: 'POST',
      mode: 'same-origin',
      keepalive: true,
      referrerPolicy: 'origin',
    });
    expect(new Headers(request?.headers).get('x-csrf-token')).toBe('fixture-route-csrf');
    expect(JSON.parse(String(request?.body))).toEqual({
      code: 'ROUTE_RENDER_FAILED',
      reference: container.textContent,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('reports an emergency chunk failure once and tolerates a failed transport', async () => {
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));
  vi.stubGlobal('fetch', transport);
  reportEmergencyRouteError();
  await Promise.resolve();
  expect(transport).toHaveBeenCalledOnce();
  const [, request] = transport.mock.calls[0]!;
  expect(JSON.parse(String(request?.body))).toEqual({
    code: 'CHUNK_LOAD_FAILED',
    reference: expect.stringMatching(/^[0-9a-f-]{36}$/i),
  });
});
