import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as RegisterRoute } from './register/index.js';
import { Route as VerifyRoute } from './register/verify.js';
import { registrationFormText } from '@barghsa/i18n/registration-forms';
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
const rawPasswordDraft = [' Raw synthetic value ', '12A '].join('');
const terms = {
  id,
  versionId: 'v1',
  content: 'Published terms',
  updatedAt: '2030-01-01T00:00:00Z',
  publishedAt: '2030-01-01T00:00:00Z',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  routing.navigate.mockClear();
  routing.search = { challengeId: id, destination: 'd***@example.test' };
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
    terms: terms as unknown,
    override: undefined as undefined | ((path: string) => Response | Promise<Response>),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/tos/current')) return Response.json(state.terms);
      state.writes.push({
        path,
        body: JSON.parse(String(init!.body)),
        locale: new Headers(init!.headers).get('Accept-Language'),
      });
      if (state.override) return state.override(path);
      return Response.json(
        path.endsWith('/register') || path.endsWith('/resend')
          ? { challengeId: id }
          : {
              userId: 'user',
              sessionId: 'session',
              csrfToken: 'csrf',
              expiresAt: '2030-01-01T00:00:00Z',
            }
      );
    })
  );
  return state;
}
async function mount(verify = false) {
  const Page = (verify ? VerifyRoute : RegisterRoute).options.component as ComponentType;
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
async function draft(accept = true) {
  await fill('#username', ' Draft@Example.test ', true);
  await fill('#password', rawPasswordDraft);
  if (accept) await act(async () => host.querySelector<HTMLButtonElement>('#tos')!.click());
}
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('validates destination without I/O and links/focuses the native field', async () => {
  const state = fixture();
  await mount();
  await fill('#username', 'invalid');
  await submit();
  expect(state.writes).toHaveLength(0);
  const input = host.querySelector('#username')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  expect(host.querySelector('#password')).toBeNull();
});
it('requires explicit consent to the source-confirmed terms with linked native feedback', async () => {
  const state = fixture();
  await mount();
  await draft(false);
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('[role="checkbox"]'))
  );
  expect(host.textContent).toContain(t('auth.register.tosRequired', 'en'));
});
it('validates password policy before a registration request', async () => {
  const state = fixture();
  await mount();
  await draft();
  await fill('#password', 'weak');
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector('#password')!.getAttribute('aria-invalid')).toBe('true');
});
it('preserves raw password, destination and consent after a known rejection without private text', async () => {
  const state = fixture();
  await mount();
  await draft();
  state.override = () =>
    Response.json(
      { error: 'AUTH:REGISTER:WEAK_PASSWORD', message: 'private detail' },
      { status: 422 }
    );
  await submit();
  expect(state.writes[0]).toEqual({
    path: '/api/auth/register',
    body: {
      username: 'draft@example.test',
      password: rawPasswordDraft,
      tosVersionId: id,
    },
    locale: 'en',
  });
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' Draft@Example.test ');
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe(rawPasswordDraft);
  expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).not.toContain('private detail');
});
it('keeps a hidden password draft while destination is corrected', async () => {
  fixture();
  await mount();
  await draft();
  await fill('#username', 'invalid', true);
  expect(host.querySelector('#password')).toBeNull();
  await fill('#username', ' Draft@Example.test ', true);
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe(rawPasswordDraft);
});
it('cannot consent or submit using an incomplete terms response', async () => {
  const state = fixture();
  state.terms = { id, content: 'Incomplete terms' };
  await mount();
  await fill('#username', 'draft@example.test', true);
  await fill('#password', rawPasswordDraft);
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>('#tos')!.disabled).toBe(true);
  expect(host.textContent).toContain(t('tos.page.error', 'en'));
});
it('owns a pending registration before duplicate native submissions and captures its fields', async () => {
  const state = fixture(),
    pending = held<Response>();
  await mount();
  await draft();
  state.override = () => pending.promise;
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#password')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('#tos')!.disabled).toBe(true);
  await act(async () => pending.resolve(Response.json({ challengeId: id })));
  expect(routing.navigate).toHaveBeenCalledWith({
    to: '/register/verify',
    search: { challengeId: id, destination: 'd***@example.test' },
  });
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe('');
});
it('holds uncertain registration without replay; explicit restart preserves only raw destination', async () => {
  const state = fixture();
  await mount();
  await draft();
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  await submit();
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe(rawPasswordDraft);
  expect(host.textContent).toContain(registrationFormText('uncertain', 'en'));
  const restart = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === registrationFormText('restart', 'en')
  )!;
  await act(async () => restart.click());
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe(' Draft@Example.test ');
  expect(host.querySelector('#password')).toBeNull();
  expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('false');
});
it('validates the current partial OTP without posting a stale complete code', async () => {
  const state = fixture();
  await mount(true);
  await fill('#registration-code', '123');
  await submit();
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector('#registration-code')!.getAttribute('aria-invalid')).toBe('true');
  expect(host.textContent).toContain(registrationFormText('codeInvalid', 'en'));
});
it('preserves registration rejected-code clearing, linked feedback and six-digit auto-submit', async () => {
  const state = fixture();
  state.override = () => Response.json({ error: 'AUTH:OTP:INVALID' }, { status: 401 });
  await mount(true);
  await fill('#registration-code', '۱۲۳۴۵۶');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.body).toEqual({ challengeId: id, otp: '123456' });
  expect(host.querySelector<HTMLInputElement>('#registration-code')!.value).toBe('');
  expect(host.querySelector('#registration-code')!.getAttribute('aria-describedby')).toBe(
    'registration-code-error'
  );
});
it('accepts the complete session receipt and clears OTP before app navigation', async () => {
  const state = fixture();
  await mount(true);
  await fill('#registration-code', '123456');
  expect(state.writes).toHaveLength(1);
  expect(routing.navigate).toHaveBeenCalledWith({ to: '/app' });
  expect(host.querySelector<HTMLInputElement>('#registration-code')!.value).toBe('');
});
it('never replays a possibly consumed verification after a malformed session acknowledgement', async () => {
  const state = fixture();
  state.override = () => Response.json(null);
  await mount(true);
  await fill('#registration-code', '123456');
  await submit();
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#registration-code')!.value).toBe('1');
  expect(host.textContent).toContain(registrationFormText('uncertain', 'en'));
  expect(routing.navigate).not.toHaveBeenCalled();
});
it('retires pending results when the challenge changes', async () => {
  const state = fixture(),
    pending = held<Response>();
  state.override = () => pending.promise;
  await mount(true);
  await fill('#registration-code', '123456');
  routing.search = { challengeId: '00000000-0000-4000-8000-000000000002', destination: 'new' };
  await mount(true);
  await act(async () =>
    pending.resolve(
      Response.json({
        userId: 'user',
        sessionId: 'session',
        csrfToken: 'csrf',
        expiresAt: '2030-01-01T00:00:00Z',
      })
    )
  );
  expect(routing.navigate).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('#registration-code')!.value).toBe('');
});
it('fences an unmounted pending registration callback', async () => {
  const state = fixture(),
    pending = held<Response>();
  await mount();
  await draft();
  state.override = () => pending.promise;
  await submit();
  await act(async () => root.render(<p>Another page</p>));
  await act(async () => pending.resolve(Response.json({ challengeId: id })));
  expect(routing.navigate).not.toHaveBeenCalled();
  expect(host.textContent).toBe('Another page');
});

it('refuses retired password/consent controls in the same frame as explicit restart', async () => {
  const state = fixture();
  await mount();
  await draft();
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  const oldForm = host.querySelector('form')!,
    password = host.querySelector<HTMLInputElement>('#password')!,
    consent = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  const restart = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === registrationFormText('restart', 'en')
  )!;
  await act(async () => {
    restart.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      ' Old synthetic value 12A '
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
    consent.click();
    oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#password')?.value ?? '').toBe('');
  expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('false');
});
