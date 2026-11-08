import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StepUpAuthGate } from './StepUpAuthGate.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
let host: HTMLDivElement, root: Root;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const challenge = () => ({
  challengeId: '00000000-0000-4000-8000-000000000001',
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  channel: 'email',
});
beforeEach(() => {
  document.documentElement.lang = 'en';
  document.cookie = 'barghsa_csrf=old-proof';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.cookie = 'barghsa_csrf=;max-age=0';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === text
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function fill(code = '۱۲۳۴۵۶') {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
it('sends only on request and continues a captured action with freshly rotated CSRF after valid OTP proof', async () => {
  const saved = vi.fn().mockResolvedValue(undefined),
    close = vi.fn(),
    action: TeamAction = {
      title: 'Change provider',
      description: 'Saved settings',
      path: '/api/admin/sms-providers/provider',
      method: 'PUT',
      body: { label: 'Captured draft' },
      requiresOtp: true,
    };
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).endsWith('/send')) return reply(challenge());
    if (String(input).endsWith('/verify')) {
      document.cookie = 'barghsa_csrf=new-proof';
      return reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() });
    }
    return reply({ id: 'provider' });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<TeamActionDialog action={action} onClose={close} onSuccess={saved} />)
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.querySelector('input[type=password]')).toBeNull();
  await click('Send verification code');
  await fill();
  await submit();
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
    challengeId: challenge().challengeId,
    code: '123456',
  });
  expect(new Headers(fetcher.mock.calls[2]![1]!.headers).get('X-CSRF-Token')).toBe('new-proof');
  expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string)).toEqual({
    label: 'Captured draft',
  });
  expect(saved).toHaveBeenCalledWith({ id: 'provider' });
  expect(close).toHaveBeenCalledTimes(1);
});
it('keeps the challenge after a wrong OTP and never continues malformed verification responses', async () => {
  const verified = vi.fn().mockResolvedValue(undefined);
  let response = reply({ error: { code: 'AUTH:OTP_INVALID' } }, 401);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/send') ? reply(challenge()) : response
    )
  );
  await act(async () => root.render(<StepUpAuthGate onVerified={verified} />));
  await click('Send verification code');
  await fill();
  await submit();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('not verified');
  expect(verified).not.toHaveBeenCalled();
  response = reply({ verified: true });
  await fill();
  await submit();
  expect(verified).not.toHaveBeenCalled();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('unavailable');
});

for (const stalled of ['send headers', 'verify body'] as const)
  it(`requires a fresh code after stalled ${stalled} and ignores the late reply`, async () => {
    vi.useFakeTimers();
    const verified = vi.fn().mockResolvedValue(undefined);
    const original = challenge();
    const fresh = { ...original, challengeId: '00000000-0000-4000-8000-000000000002' };
    const proof = { verified: true, stepUpVerifiedAt: new Date().toISOString() };
    let sends = 0;
    let late!: () => void;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/send')) {
        if (++sends > 1) return reply(fresh);
        if (stalled === 'send headers')
          return new Promise<Response>((resolve) => {
            late = () => resolve(reply(original));
          });
        return reply(original);
      }
      const body = JSON.parse(String(init?.body));
      if (body.challengeId === fresh.challengeId) return reply(proof);
      expect(body).toEqual({ challengeId: original.challengeId, code: '123456' });
      const response = reply(null);
      vi.spyOn(response, 'json').mockImplementation(
        () => new Promise((resolve) => (late = () => resolve(proof)))
      );
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<StepUpAuthGate onVerified={verified} />));
    await click('Send verification code');
    if (stalled === 'verify body') {
      await fill();
      await submit();
    }

    const calls = fetcher.mock.calls.length;
    const signal = fetcher.mock.lastCall?.[1]?.signal;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(document.querySelector('[role=alert]')?.textContent).toContain('unavailable');
    expect(document.querySelector('input')).toBeNull();

    await act(async () => late());
    expect(document.querySelector('input')).toBeNull();
    expect(verified).not.toHaveBeenCalled();
    await click('Send verification code');
    await fill();
    await submit();
    expect(fetcher).toHaveBeenCalledTimes(calls + 2);
    expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({
      challengeId: fresh.challengeId,
      code: '123456',
    });
    expect(verified).toHaveBeenCalledTimes(1);
  });

for (const source of ['response body', 'Retry-After'] as const)
  it(`honors a resend limit from the ${source} without discarding a valid challenge`, async () => {
    vi.useFakeTimers();
    const verified = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(challenge()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(source === 'response body' ? { retryAfterMs: 2000 } : {}), {
          status: 429,
          headers: { 'Retry-After': source === 'response body' ? '60' : '2' },
        })
      )
      .mockResolvedValueOnce(reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<StepUpAuthGate onVerified={verified} />));
    await click('Send verification code');
    await fill();
    await click('Send a new code');
    await submit();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await submit();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(verified).toHaveBeenCalledTimes(1);
  });

it('retires the previous challenge after an unconfirmed resend response', async () => {
  const verified = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(challenge()))
    .mockResolvedValueOnce(reply({}, 503));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<StepUpAuthGate onVerified={verified} />));
  await click('Send verification code');
  await click('Send a new code');
  expect(document.querySelector('input')).toBeNull();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(verified).not.toHaveBeenCalled();
});

for (const boundary of ['disabled', 'unmounted'] as const)
  it(`ignores a pending verification after ${boundary}`, async () => {
    const verified = vi.fn().mockResolvedValue(undefined);
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/send')
          ? reply(challenge())
          : new Promise<Response>((resolve) => {
              finish = resolve;
            })
      )
    );
    await act(async () => root.render(<StepUpAuthGate onVerified={verified} />));
    await click('Send verification code');
    await fill();
    await submit();
    await act(async () =>
      root.render(
        boundary === 'disabled' ? <StepUpAuthGate disabled onVerified={verified} /> : null
      )
    );
    await act(async () =>
      finish(reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() }))
    );
    expect(verified).not.toHaveBeenCalled();
  });
it('clears code and challenge on revoked-session denial', async () => {
  const verified = vi.fn(),
    denied = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/send')
        ? reply(challenge())
        : reply({ error: { code: 'AUTH:UNAUTHENTICATED' } }, 401)
    )
  );
  await act(async () => root.render(<StepUpAuthGate onVerified={verified} onDenied={denied} />));
  await click('Send verification code');
  await fill();
  await submit();
  expect(denied).toHaveBeenCalledWith(401);
  expect(document.querySelector('input')).toBeNull();
  expect(verified).not.toHaveBeenCalled();
});
