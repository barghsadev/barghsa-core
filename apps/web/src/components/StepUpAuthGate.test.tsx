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
