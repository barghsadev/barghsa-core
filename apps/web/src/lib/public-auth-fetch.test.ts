import { afterEach, expect, it, vi } from 'vitest';
import { publicAuthFetch } from './public-auth-fetch.js';
import { publicAuthResponse } from './public-auth-response.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const token = 'a'.repeat(64);
const init = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
  body: '{"username":"user@example.test"}',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('bootstraps then sends JSON with the returned token, preserving locale and abort signal', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ csrfToken: token }))
    .mockResolvedValueOnce(json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect((await publicAuthFetch('/api/auth/login', { ...init, signal })).status).toBe(200);
  expect(fetch.mock.calls[0]).toEqual([
    '/api/auth/csrf',
    { credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Accept-Language': 'en' } },
  ]);
  const sent = fetch.mock.calls[1]![1]!;
  expect(sent.headers.get('X-CSRF-Token')).toBe(token);
  expect(sent.headers.get('Content-Type')).toBe('application/json');
  expect(sent.body).toBe(init.body);
  expect(sent.signal).toBe(signal);
  expect(sent.credentials).toBe('same-origin');
});

it('retries exactly once only when the CSRF guard rejected a raced anonymous token', async () => {
  const newer = 'b'.repeat(64);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ csrfToken: token }))
    .mockResolvedValueOnce(json({ error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } }, 403))
    .mockResolvedValueOnce(json({ csrfToken: newer }))
    .mockResolvedValueOnce(json({ error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } }, 403));
  vi.stubGlobal('fetch', fetch);
  expect((await publicAuthFetch('/api/auth/register', init)).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls[3]![1]!.headers.get('X-CSRF-Token')).toBe(newer);
});

it.each([401, 403, 429, 500])(
  'does not replay auth work after an ordinary %i response',
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: token }))
      .mockResolvedValueOnce(json({ error: { code: 'OTHER' } }, status));
    vi.stubGlobal('fetch', fetch);
    expect((await publicAuthFetch('/api/auth/reset-password', init)).status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(2);
  }
);

it('returns bootstrap rate limits without sending credentials', async () => {
  const fetch = vi.fn().mockResolvedValue(json({ error: {} }, 429));
  vi.stubGlobal('fetch', fetch);
  expect((await publicAuthFetch('/api/auth/login', init)).status).toBe(429);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([null, {}, { csrfToken: 'invalid' }])(
  'rejects malformed bootstrap responses before auth',
  async (body) => {
    const fetch = vi.fn().mockResolvedValue(json(body));
    vi.stubGlobal('fetch', fetch);
    await expect(publicAuthFetch('/api/auth/login', init)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it('does not retry an aborted bootstrap or send credentials to an external endpoint', async () => {
  const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
  vi.stubGlobal('fetch', fetch);
  await expect(publicAuthFetch('/api/auth/login', init)).rejects.toMatchObject({
    name: 'AbortError',
  });
  await expect(publicAuthFetch('https://attacker.example/api/auth/login', init)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['bootstrap', 'receipt'] as const)(
  'bounds a stalled %s body and never sends another command',
  async (stage) => {
    vi.useFakeTimers();
    let finishBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      finishBody = resolve;
    });
    const stalled = json(null);
    const read = vi.spyOn(stalled, 'json').mockReturnValue(body);
    const fetch = vi.fn();
    if (stage === 'receipt') fetch.mockResolvedValueOnce(json({ csrfToken: token }));
    fetch.mockResolvedValueOnce(stalled);
    vi.stubGlobal('fetch', fetch);

    const request = publicAuthResponse('/api/auth/login', {
      ...init,
      signal: new AbortController().signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledOnce();
    const sent = stage === 'bootstrap' ? 1 : 2;
    expect(fetch).toHaveBeenCalledTimes(sent);
    await vi.advanceTimersByTimeAsync(15_001);
    await rejection;
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    finishBody(stage === 'bootstrap' ? { csrfToken: token } : { ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(sent);
  }
);
