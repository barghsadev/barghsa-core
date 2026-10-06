import { afterEach, describe, expect, it, vi } from 'vitest';
import { commercialFetch } from './commercial-fetch.js';

afterEach(() => vi.restoreAllMocks());

describe('commercial terms denial', () => {
  it('signals a same-origin terms denial and preserves its original body', async () => {
    const body = { error: { code: 'AUTHZ:TOS_ACCEPTANCE_REQUIRED', message: 'Review terms' } };
    const response = new Response(JSON.stringify(body), { status: 403 });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const init = { method: 'POST', body: 'draft data' };
    const result = await commercialFetch('/api/orders', init);
    expect(result).toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/orders', init);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0].type).toBe('barghsa:tos-required');
    expect(await result.json()).toEqual(body);
  });

  it.each([
    ['/api/orders', 403, { error: { code: 'AUTHZ:FORBIDDEN' } }],
    ['/api/orders', 403, {}],
    ['/api/orders', 200, { error: { code: 'AUTHZ:TOS_ACCEPTANCE_REQUIRED' } }],
    [
      'https://uploads.example/api/orders',
      403,
      { error: { code: 'AUTHZ:TOS_ACCEPTANCE_REQUIRED' } },
    ],
    ['/records', 403, { error: { code: 'AUTHZ:TOS_ACCEPTANCE_REQUIRED' } }],
  ])('leaves unrelated responses unchanged (%s, %s)', async (url, status, body) => {
    const response = new Response(JSON.stringify(body), { status });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(await commercialFetch(url)).toBe(response);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(body);
  });

  it('preserves a non-JSON denial without emitting an event', async () => {
    const response = new Response('gateway denial', { status: 403 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(await commercialFetch('/api/orders')).toBe(response);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await response.text()).toBe('gateway denial');
  });
});
