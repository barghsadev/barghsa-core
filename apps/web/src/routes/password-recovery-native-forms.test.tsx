import { QueryProvider } from '../test/query-provider.js';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Route } from './forgot-password.js';
import { Route as ActivationRoute } from './activate.js';
import { passwordRecoveryText as copy } from '@barghsa/i18n/password-recovery-forms';
import { t } from '@barghsa/i18n/auth';
import { t as recoveryText } from '@barghsa/i18n/recovery';
import RecoveryContactForm from '../components/RecoveryContactForm.js';
const navigation = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ navigate: navigation }),
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock('../components/AuthLayout.js', () => ({
  AuthLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ numberStyle: 'locale', number: (v: number) => String(v) }),
}));
vi.mock('../lib/public-auth-fetch.js', () => ({
  publicAuthFetch: (path: string, init: RequestInit) => fetch(path, init),
}));
vi.mock('../lib/toast-api.js', () => ({ toast: { success: vi.fn() } }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  navigation.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.lang = 'fa';
  window.history.replaceState(null, '', '/');
});
const id = '00000000-0000-4000-8000-000000000001';
const grant = () => ({
  verified: true,
  challengeId: id,
  resetToken: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const state = {
    writes: [] as { path: string; body: Record<string, string>; language: string | null }[],
    override: undefined as undefined | ((path: string) => Promise<Response> | Response),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      state.writes.push({
        path,
        body: JSON.parse(String(init.body)),
        language: new Headers(init.headers).get('Accept-Language'),
      });
      if (state.override) return state.override(path);
      return Response.json(
        path.endsWith('forgot-password')
          ? {
              challengeId: id,
              sent: true,
              message: 'If an account exists, a verification code has been queued.',
            }
          : path.endsWith('/verify')
            ? grant()
            : { message: 'Your password has been reset. Please log in with your new password.' }
      );
    })
  );
  return state;
}
async function mount(route: typeof Route | typeof ActivationRoute = Route) {
  const Page = route.options.component as ComponentType;
  await act(async () => root.render(<QueryProvider>{<Page />}</QueryProvider>));
}
async function fill(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.dynamicImportSettled();
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
async function request() {
  await fill('#username', ' Recovery@Example.test ');
  await submit();
}
async function verify() {
  await fill('#recovery-code', '123456');
}
async function resetValues() {
  await fill('#new-password', ' Raw synthetic value 12A ');
  await fill('#confirm-password', ' Raw synthetic value 12A ');
}
it('validates destination before I/O with native linked errors and first-invalid focus', async () => {
  const state = fixture();
  await mount();
  await fill('#username', 'not valid');
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.textContent).toContain(copy('usernameInvalid', 'en'));
  const input = host.querySelector('#username')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
});
it('normalizes the wire while preserving raw destination through a rejected request', async () => {
  const state = fixture();
  await mount();
  state.override = () => Response.json({ message: 'private recipient detail' }, { status: 400 });
  await request();
  expect(state.writes[0]!.body).toEqual({ username: 'recovery@example.test' });
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' Recovery@Example.test ');
  expect(host.textContent).not.toContain('private recipient detail');
});
it('preserves a rejected OTP and reflects a cleared digit before native verification', async () => {
  const state = fixture();
  await mount();
  await request();
  state.override = () => Response.json({ error: 'AUTH:OTP:INVALID' }, { status: 401 });
  await verify();
  expect(host.querySelector<HTMLInputElement>('#recovery-code')!.value).toBe('1');
  expect(host.querySelector('#recovery-code')!.getAttribute('aria-describedby')).toBe(
    'recovery-code-error'
  );
  await fill('#recovery-code', '');
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.textContent).toContain(copy('codeInvalid', 'en'));
});
it('accepts only a challenge-bound grant and sends the raw confirmed password in a separate reset', async () => {
  const state = fixture();
  await mount();
  await request();
  await verify();
  await resetValues();
  await submit();
  expect(state.writes.map((v) => v.path)).toEqual([
    '/api/auth/forgot-password',
    '/api/auth/reset-password/verify',
    '/api/auth/reset-password',
  ]);
  expect(state.writes[2]!.body).toEqual({
    challengeId: id,
    resetToken: 'a'.repeat(64),
    newPassword: ' Raw synthetic value 12A ',
  });
  expect(navigation).toHaveBeenCalledWith({ to: '/login', replace: true });
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe('');
});
it('requires matching strong passwords before any reset and focuses the appropriate native field', async () => {
  const state = fixture();
  await mount();
  await request();
  await verify();
  await fill('#new-password', 'weak');
  await fill('#confirm-password', 'weak');
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.querySelector('#new-password')!.getAttribute('aria-invalid')).toBe('true');
  await resetValues();
  await fill('#confirm-password', 'Different synthetic value 12A');
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.textContent).toContain(t('auth.resetPassword.mismatch', 'en'));
});
it('keeps password and confirmation after backend password-history rejection', async () => {
  const state = fixture();
  await mount();
  await request();
  await verify();
  await resetValues();
  state.override = () => Response.json({ error: 'AUTH:LOGIN:PASSWORD_REUSED' }, { status: 422 });
  await submit();
  expect(host.querySelector<HTMLInputElement>('#new-password')!.value).toBe(
    ' Raw synthetic value 12A '
  );
  expect(host.querySelector<HTMLInputElement>('#confirm-password')!.value).toBe(
    ' Raw synthetic value 12A '
  );
  expect(navigation).not.toHaveBeenCalled();
});
it('owns deferred validation and a pending write before duplicate native/synthetic submit or resend', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await request();
  state.override = () => held.promise;
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('#recovery-code')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      '123456'
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(2);
  await act(async () => held.resolve(Response.json(grant())));
  expect(host.querySelector('#new-password')).not.toBeNull();
});
it('holds an unknown verification without clearing code or automatically replaying the consumed OTP', async () => {
  const state = fixture();
  await mount();
  await request();
  state.override = () => Response.json({}, { status: 503 });
  await verify();
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.textContent).toContain(copy('uncertain', 'en'));
  expect(host.querySelector<HTMLInputElement>('#recovery-code')!.value).toBe('1');
  expect(host.querySelector('#new-password')).toBeNull();
});
it('holds a malformed reset receipt and clears secrets only on an explicit new recovery', async () => {
  const state = fixture();
  await mount();
  await request();
  await verify();
  await resetValues();
  state.override = () => Response.json({});
  await submit();
  await submit();
  expect(state.writes).toHaveLength(3);
  expect(navigation).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('#new-password')!.value).toBe(
    ' Raw synthetic value 12A '
  );
  const restart = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === copy('restart', 'en')
  )!;
  await act(async () => restart.click());
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' Recovery@Example.test ');
  expect(host.querySelector('#new-password')).toBeNull();
});
it('fences an unmounted pending verification result without navigating or touching another page', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await request();
  state.override = () => held.promise;
  await verify();
  await act(async () => root.render(<QueryProvider>{<p>Another page</p>}</QueryProvider>));
  await act(async () => held.resolve(Response.json(grant())));
  expect(host.textContent).toBe('Another page');
  expect(navigation).not.toHaveBeenCalled();
});

it('refuses a retired reset-token submission dispatched in the same frame as explicit restart', async () => {
  const state = fixture();
  await mount();
  await request();
  await verify();
  await resetValues();
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  const oldForm = host.querySelector('form')!;
  const restart = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === copy('restart', 'en')
  )!;
  await act(async () => {
    restart.click();
    oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(3);
  expect(host.querySelector('#new-password')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' Recovery@Example.test ');
});

it('keeps invalid destination feedback when a native blur overlaps submit validation', async () => {
  const state = fixture();
  await mount();
  await fill('#username', 'invalid value');
  const input = host.querySelector<HTMLInputElement>('#username')!;
  await act(async () => {
    input.focus();
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(0);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(host.textContent).toContain(copy('usernameInvalid', 'en'));
});

const activationPassword = 'Activation-test-123!';
const activationToken = 'a'.repeat(64);
const activationUrl = (token: string) => `/activate#token=${token}`;
async function fillActivation() {
  await fill('#activation-password', activationPassword);
  await fill('#activation-confirmation', activationPassword);
}

it('bounds an activation response body and discards a late success', async () => {
  vi.useFakeTimers();
  const body = deferred<unknown>();
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) => ({
    status: 200,
    json: () => body.promise,
  }));
  vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', activationUrl(activationToken));
  await mount(ActivationRoute);
  await fillActivation();
  await submit();
  expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  const signal = fetcher.mock.calls[0]![1].signal!;
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(signal.aborted).toBe(true);
  expect(host.querySelector('[role=alert]')?.textContent).toBe(copy('activationUnconfirmed', 'en'));
  expect(host.querySelector('form')).toBeNull();
  await act(async () => body.resolve({ activated: true }));
  expect(host.textContent).not.toContain(t('auth.activate.success', 'en'));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('retires the submitted token and draft when a different link arrives', async () => {
  const response = deferred<Response>();
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) => response.promise);
  vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', activationUrl(activationToken));
  await mount(ActivationRoute);
  await fillActivation();
  await submit();
  const signal = fetcher.mock.calls[0]![1].signal!;
  const oldForm = host.querySelector('form')!;
  await act(async () => {
    window.history.replaceState(null, '', activationUrl('b'.repeat(64)));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(signal.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('');
  expect(host.querySelector<HTMLInputElement>('#activation-password')?.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#activation-confirmation')?.value).toBe('');
  await act(async () => response.resolve(Response.json({ activated: true })));
  expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe('false');
  expect(host.textContent).not.toContain(t('auth.activate.success', 'en'));
});

it('bounds the new-contact receipt body and never reapplies an uncertain proof', async () => {
  vi.useFakeTimers();
  const body = deferred<unknown>();
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) => ({
    status: 200,
    json: () => body.promise,
  }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<RecoveryContactForm />));
  await fill('#recovery-caseId', id);
  await fill('#recovery-challengeId', '00000000-0000-4000-8000-000000000002');
  await fill('#recovery-code', '123456');
  await submit();
  expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  expect(fetcher).toHaveBeenCalledOnce();
  const signal = fetcher.mock.calls[0]![1].signal!;
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(signal.aborted).toBe(true);
  expect(host.querySelector('[role=alert]')?.textContent).toBe(
    recoveryText('auth.recovery.unconfirmed', 'en')
  );
  expect(host.querySelector('#recovery-code')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#recovery-caseId')?.value).toBe(id);
  await submit();
  await act(async () => body.resolve({ verified: true }));
  expect(host.textContent).not.toContain(recoveryText('auth.recovery.verified', 'en'));
  expect(fetcher).toHaveBeenCalledOnce();
});
