import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as LoginRoute } from './login.js';
import { loginFormText } from '@barghsa/i18n/login-forms';
import { t } from '@barghsa/i18n/auth';
const routing = vi.hoisted(() => ({
  navigate: vi.fn(async () => {}),
  search: { challengeId: '00000000-0000-4000-8000-000000000001', destination: 'd***@example.test' },
  state: { location: { pathname: '/register/verify' } },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => routing,
  useSearch: () => routing.search,
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock('../components/AuthLayout.js', () => ({
  AuthLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ numberStyle: 'locale', number: (value: number) => String(value) }),
}));
vi.mock('../lib/public-auth-fetch.js', () => ({
  publicAuthFetch: (path: string, init: RequestInit) => fetch(path, init),
}));
vi.mock('../lib/toast-api.js', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/auth-entry-feedback.js', () => ({ rememberAuthSuccess: vi.fn() }));
let root: Root, host: HTMLDivElement;
const id = '00000000-0000-4000-8000-000000000001';
const rawCredential = [' short legacy ', 'input '].join('');
const rawNewPassword = [' Raw synthetic value ', '12A '].join('');
const session = {
  requiresOtp: false,
  userId: 'user',
  sessionId: 'session',
  csrfToken: 'csrf',
  expiresAt: '2030-01-01T00:00:00Z',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  routing.navigate.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
function fixture() {
  const state = {
    writes: [] as { path: string; body: Record<string, unknown>; locale: string | null }[],
    login: { requiresOtp: true, challengeId: id } as unknown,
    override: undefined as undefined | ((path: string) => Response | Promise<Response>),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      state.writes.push({
        path,
        body: JSON.parse(String(init!.body)),
        locale: new Headers(init!.headers).get('Accept-Language'),
      });
      if (state.override) return state.override(path);
      return Response.json(
        path.endsWith('/login')
          ? state.login
          : path.endsWith('/force-change-password')
            ? { message: 'Password changed' }
            : session
      );
    })
  );
  return state;
}
async function mount() {
  const Page = LoginRoute.options.component as ComponentType;
  await act(async () => root.render(<Page />));
}
async function fill(selector: string, value: string, blur = false) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (blur) input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
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
async function credentials() {
  await fill('#username', ' USER@Example.test ');
  await fill('#password', rawCredential);
}
async function changeDraft() {
  await fill('#new-password', rawNewPassword);
  await fill('#confirm-password', rawNewPassword);
}
async function changeStage(state: ReturnType<typeof fixture>) {
  state.login = {
    requiresOtp: false,
    mustChangePassword: true,
    passwordChangeToken: 'change-grant',
  };
  await credentials();
  await submit();
}
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('links and focuses invalid credentials before I/O', async () => {
  const state = fixture();
  await mount();
  await fill('#username', 'invalid');
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector('#username')!.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#username')));
});
it('links an empty password and allows pre-policy raw credentials after a known rejection', async () => {
  const state = fixture();
  await mount();
  await fill('#username', ' USER@Example.test ');
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector('#password')!.getAttribute('aria-invalid')).toBe('true');
  state.override = () =>
    Response.json(
      { error: 'AUTH:LOGIN:INVALID_CREDENTIALS', message: 'private detail' },
      { status: 401 }
    );
  await fill('#password', rawCredential);
  await submit();
  expect(state.writes[0]).toEqual({
    path: '/api/auth/login',
    body: { username: 'user@example.test', password: rawCredential },
    locale: 'en',
  });
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe(rawCredential);
  expect(host.textContent).not.toContain('private detail');
});
it('owns credential submission before deferred validation and rejects duplicate native events', async () => {
  const state = fixture(),
    pending = held<Response>();
  state.override = () => pending.promise;
  await mount();
  await credentials();
  await submit();
  await submit();
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#username')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('#password')!.disabled).toBe(true);
  await act(async () =>
    pending.resolve(Response.json({ error: 'AUTH:LOGIN:INVALID_CREDENTIALS' }, { status: 401 }))
  );
  expect(host.querySelector<HTMLInputElement>('#password')!.disabled).toBe(false);
});
it('holds unknown credentials and retires same-frame old password and form events on explicit restart', async () => {
  const state = fixture();
  state.override = () => Response.json({}, { status: 503 });
  await mount();
  await credentials();
  await submit();
  expect(host.textContent).toContain(loginFormText('uncertain', 'en'));
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe(rawCredential);
  const oldForm = host.querySelector('form')!,
    oldPassword = host.querySelector<HTMLInputElement>('#password')!;
  await act(async () => {
    [...host.querySelectorAll('button')]
      .find((x) => x.textContent === loginFormText('restart', 'en'))!
      .click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      oldPassword,
      rawCredential
    );
    oldPassword.dispatchEvent(new Event('input', { bubbles: true }));
    oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' USER@Example.test ');
});
it('requires a complete credential acknowledgement before changing stages', async () => {
  const state = fixture();
  state.login = { requiresOtp: true, challengeId: 12 };
  await mount();
  await credentials();
  await submit();
  expect(host.querySelector('#password')).not.toBeNull();
  expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
  expect(host.textContent).toContain(loginFormText('uncertain', 'en'));
  expect(routing.navigate).not.toHaveBeenCalled();
});
it('validates required password policy and confirmation with linked first-error focus', async () => {
  const state = fixture();
  await mount();
  await changeStage(state);
  await fill('#new-password', 'weak');
  await fill('#confirm-password', 'different');
  await submit();
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector('#new-password')!.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('#confirm-password')!.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#new-password')));
  await fill('#new-password', rawNewPassword);
  await submit();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#confirm-password'))
  );
});
it('preserves raw password and confirmation after a known history rejection', async () => {
  const state = fixture();
  await mount();
  await changeStage(state);
  await changeDraft();
  state.override = () =>
    Response.json(
      { error: 'AUTH:LOGIN:PASSWORD_REUSED', message: 'private detail' },
      { status: 422 }
    );
  await submit();
  expect(state.writes.at(-1)).toEqual({
    path: '/api/auth/force-change-password',
    body: { passwordChangeToken: 'change-grant', newPassword: rawNewPassword },
    locale: 'en',
  });
  expect(host.querySelector<HTMLInputElement>('#new-password')!.value).toBe(rawNewPassword);
  expect(host.querySelector<HTMLInputElement>('#confirm-password')!.value).toBe(rawNewPassword);
  expect(host.textContent).toContain(t('auth.login.error.passwordReused', 'en'));
  expect(host.textContent).not.toContain('private detail');
});
it('locks required password and companion navigation while submission is pending', async () => {
  const state = fixture(),
    pending = held<Response>();
  await mount();
  await changeStage(state);
  await changeDraft();
  state.override = () => pending.promise;
  await submit();
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('#new-password')!.disabled).toBe(true);
  await act(async () =>
    pending.resolve(Response.json({ error: 'AUTH:LOGIN:PASSWORD_REUSED' }, { status: 422 }))
  );
  expect(host.querySelector<HTMLInputElement>('#new-password')!.disabled).toBe(false);
});
it('holds a malformed change receipt without replaying its grant and clears all secrets on restart', async () => {
  const state = fixture();
  await mount();
  await changeStage(state);
  await changeDraft();
  state.override = () => Response.json(null);
  await submit();
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('#new-password')!.disabled).toBe(true);
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((x) => x.textContent === loginFormText('restart', 'en'))!
      .click()
  );
  expect(host.querySelector('#new-password')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' USER@Example.test ');
  expect(routing.navigate).not.toHaveBeenCalled();
});
it('returns to credentials with only the raw destination after an acknowledged password change', async () => {
  const state = fixture();
  await mount();
  await changeStage(state);
  await changeDraft();
  await submit();
  expect(host.querySelector('#new-password')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' USER@Example.test ');
});
it('validates partial OTP with linked focus and no verification write', async () => {
  const state = fixture();
  await mount();
  await credentials();
  await submit();
  await fill('input[inputmode="numeric"]', '123');
  await submit();
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector('input[inputmode="numeric"]')!.getAttribute('aria-invalid')).toBe(
    'true'
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('input[inputmode="numeric"]'))
  );
});
it('captures device trust with normalized digits and serializes pending OTP writes', async () => {
  const state = fixture(),
    pending = held<Response>();
  await mount();
  await credentials();
  await submit();
  state.override = () => pending.promise;
  await fill('input[inputmode="numeric"]', '۱۲۳۴۵۶');
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#trust-device')!.disabled).toBe(false);
  await act(async () => host.querySelector<HTMLInputElement>('#trust-device')!.click());
  await submit();
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(state.writes.at(-1)!.body).toEqual({ challengeId: id, otp: '123456', trustDevice: true });
  expect(host.querySelector<HTMLInputElement>('#trust-device')!.disabled).toBe(true);
  await act(async () =>
    pending.resolve(Response.json({ error: 'AUTH:OTP:INVALID' }, { status: 401 }))
  );
  expect(host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#trust-device')!.checked).toBe(true);
});
it('holds a malformed session receipt with its possibly consumed code until explicit fresh login', async () => {
  const state = fixture();
  await mount();
  await credentials();
  await submit();
  state.override = () => Response.json(null);
  await fill('input[inputmode="numeric"]', '123456');
  await submit();
  expect(state.writes).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.value).toBe('1');
  expect(host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.disabled).toBe(true);
  expect(routing.navigate).not.toHaveBeenCalled();
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((x) => x.textContent === loginFormText('restart', 'en'))!
      .click()
  );
  expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
});
it('navigates only after a complete session receipt and clears credentials', async () => {
  const state = fixture();
  state.login = session;
  await mount();
  await credentials();
  await submit();
  expect(routing.navigate).toHaveBeenCalledWith({ to: '/app', replace: true });
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
});
it('ignores credential results after unmount', async () => {
  const state = fixture(),
    pending = held<Response>();
  state.override = () => pending.promise;
  await mount();
  await credentials();
  await submit();
  await act(async () => root.render(null));
  await act(async () => pending.resolve(Response.json(session)));
  expect(routing.navigate).not.toHaveBeenCalled();
});

it('preserves unresolved credentials across a display-language change without enabling replay', async () => {
  const state = fixture();
  state.override = () => Response.json({}, { status: 503 });
  await mount();
  await credentials();
  await submit();
  await act(async () => {
    document.documentElement.lang = 'fa';
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(host.textContent).toContain(loginFormText('restart', 'fa')));
  expect(host.querySelector<HTMLInputElement>('#password')!.disabled).toBe(true);
  await submit();
  expect(state.writes).toHaveLength(1);
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((x) => x.textContent === loginFormText('restart', 'fa'))!
      .click()
  );
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
});

it('retires an expired OTP grant and returns to clean credentials after its owned delay', async () => {
  const state = fixture();
  await mount();
  await credentials();
  await submit();
  vi.useFakeTimers();
  try {
    state.override = () => Response.json({ error: 'AUTH:OTP:EXPIRED' }, { status: 401 });
    await fill('input[inputmode="numeric"]', '123456');
    await submit();
    expect(host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
    expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' USER@Example.test ');
    expect(host.textContent).toContain(t('auth.login.otpExpired', 'en'));
  } finally {
    vi.useRealTimers();
  }
});
it('cancels its owned OTP expiry redirect when the page unmounts', async () => {
  const state = fixture();
  await mount();
  await credentials();
  await submit();
  vi.useFakeTimers();
  try {
    state.override = () => Response.json({ error: 'AUTH:OTP:EXPIRED' }, { status: 401 });
    await fill('input[inputmode="numeric"]', '123456');
    await submit();
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(host.textContent).toBe('');
    expect(routing.navigate).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
