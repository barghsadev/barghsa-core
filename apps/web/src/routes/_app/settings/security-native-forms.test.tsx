import { QueryProvider } from '../../../test/query-provider.js';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route } from './security.js';
import { AccountUserProvider } from '../../../hooks/useAccountUser.js';
import { t } from '@barghsa/i18n/app';
import { trustedDeviceText } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText as copy } from '@barghsa/i18n/security-settings-forms';
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock('../../../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (v: string) => v }),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
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
const row = (sessionId: string, isCurrentSession: boolean) => ({
  sessionId,
  deviceInfo: { ip: '192.0.2.1', userAgent: 'Windows' },
  location: null,
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  idleDeadline: '2030-01-01T00:00:00Z',
  isCurrentSession,
});
const trust = {
  id: 'trust/opaque',
  userAgent: null,
  ip: null,
  trustedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  isCurrentDevice: true,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const state = {
    sessions: [row('current', true), row('other/opaque', false)],
    devices: [trust],
    readStatus: 200,
    requests: [] as {
      path: string;
      method: string;
      body: unknown;
      csrf: string | null;
      keyed: boolean;
    }[],
    override: undefined as
      undefined | ((path: string, method: string) => Response | Promise<Response>),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      // This ledger asserts the existing session/device flow. The new independent panel
      // receives a valid unavailable status, rather than the unrelated sessions array.
      if (path === '/api/telegram/link' && method === 'GET')
        return Response.json({
          available: false,
          profileId: '0199f111-1111-7111-8111-111111111111',
          link: null,
          intent: null,
          latestDelivery: null,
        });
      state.requests.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get('x-csrf-token'),
        keyed: new Headers(init?.headers).has('idempotency-key'),
      });
      if (state.override) return state.override(path, method);
      if (method === 'GET')
        return Response.json(path.endsWith('trusted-devices') ? state.devices : state.sessions, {
          status: state.readStatus,
        });
      if (path.endsWith('step-up')) {
        document.cookie = 'barghsa_csrf=rotated';
        state.sessions[0] = row('rotated-current', true);
        return Response.json({
          message: 'Step-up authentication successful.',
          stepUpVerifiedAt: '2026-10-05T00:00:00Z',
        });
      }
      if (path.endsWith('revoke-all')) {
        const count = state.sessions.length - 1;
        state.sessions = state.sessions.filter((v) => v.isCurrentSession);
        return Response.json({
          message: `All ${count} other session(s) revoked.`,
          revokedCount: count,
        });
      }
      if (path.includes('trusted-devices/')) {
        state.devices = [];
        return Response.json({ revoked: true });
      }
      state.sessions = state.sessions.filter((v) => v.isCurrentSession);
      return Response.json({ message: 'Session revoked.' });
    })
  );
  return state;
}
async function mount(actor = 'opaque:security/user') {
  const Page = Route.options.component as ComponentType;
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value={actor}>
            <Page />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
}
function button(label: string, parent: ParentNode = document.body) {
  return Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === label
  )!;
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function open(kind: 'session' | 'trust' | 'others') {
  const label =
    kind === 'trust'
      ? trustedDeviceText('remove', 'en')
      : t(kind === 'others' ? 'settings.security.revokeAll' : 'settings.security.revoke', 'en');
  await act(async () => button(label, host).click());
}
async function password(value: string) {
  const input = dialog().querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    dialog()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
async function click(key: string) {
  await act(async () => button(copy(key, 'en')).click());
}
it('revokes the captured other session with encoded ID and current CSRF, leaving device trust intact', async () => {
  const state = fixture();
  document.cookie = 'barghsa_csrf=security-current';
  await mount();
  await open('session');
  await submit();
  expect(state.requests.filter((v) => v.method !== 'GET')).toEqual([
    {
      path: '/api/auth/sessions/other%2Fopaque',
      method: 'DELETE',
      body: null,
      csrf: 'security-current',
      keyed: false,
    },
  ]);
  expect(dialog()).toBeNull();
  expect(host.textContent).toContain(copy('confirmed', 'en'));
  expect(state.devices).toEqual([trust]);
});
it('validates the required password before any revoke-all POST with linked feedback and focus', async () => {
  const state = fixture();
  await mount();
  await open('others');
  await submit();
  expect(state.requests.filter((v) => v.method !== 'GET')).toHaveLength(0);
  const input = dialog().querySelector('input')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  expect(dialog().textContent).toContain(copy('passwordRequired', 'en'));
});
it('preserves raw rejected password and never renders a private backend message', async () => {
  const state = fixture();
  await mount();
  await open('others');
  await password('  wrong password  ');
  state.override = () =>
    Response.json(
      { error: 'AUTH:LOGIN:INVALID_CREDENTIALS', message: 'private account detail' },
      { status: 422 }
    );
  await submit();
  expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('  wrong password  ');
  expect(dialog().textContent).toContain(copy('invalidPassword', 'en'));
  expect(document.body.textContent).not.toContain('private account detail');
  const rejectedSample = ['  wrong', 'password  '].join(' ');
  expect(state.requests.at(-1)!.body).toEqual({ password: rejectedSample });
});
it('reads the rotated session before a trust DELETE and uses the replacement CSRF', async () => {
  const state = fixture();
  await mount();
  await open('trust');
  state.override = () =>
    Response.json({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } }, { status: 403 });
  await submit();
  state.override = undefined;
  await password(' raw password ');
  await submit();
  const requests = state.requests.slice(3);
  expect(requests.map((v) => [v.path, v.method])).toEqual([
    ['/api/auth/step-up', 'POST'],
    ['/api/auth/sessions', 'GET'],
    ['/api/auth/trusted-devices', 'GET'],
    ['/api/auth/trusted-devices/trust%2Fopaque', 'DELETE'],
  ]);
  expect(requests[0]!.body).toEqual({ password: ' raw password ' });
  expect(requests.at(-1)!.csrf).toBe('rotated');
  expect(state.sessions).toHaveLength(2);
});
it('requires a fresh read proving all other sessions inactive after a valid revoke-all receipt', async () => {
  const state = fixture();
  await mount();
  await open('others');
  await password(' raw password ');
  await submit();
  expect(state.requests.slice(2).map((v) => v.method)).toEqual(['POST', 'GET']);
  expect(state.sessions).toEqual([row('current', true)]);
  expect(state.devices).toEqual([trust]);
  expect(dialog()).toBeNull();
});
it('holds one synchronous owner across duplicates, companion controls and uncertain writes; a read proves removal', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await open('session');
  state.override = () => held.promise;
  await act(async () => {
    const form = dialog().querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    button(trustedDeviceText('remove', 'en'), host).click();
    button(copy('refresh', 'en'), host).click();
    await vi.dynamicImportSettled();
  });
  expect(state.requests.filter((v) => v.method !== 'GET')).toHaveLength(1);
  expect(state.requests).toHaveLength(3);
  await act(async () => held.resolve(Response.json({ message: 'wrong receipt' })));
  expect(dialog().textContent).toContain(copy('uncertain', 'en'));
  state.override = undefined;
  state.sessions = [row('current', true)];
  await click('check');
  expect(dialog()).toBeNull();
  expect(state.requests.filter((v) => v.method !== 'GET')).toHaveLength(1);
});
it('invalidates old restart eligibility during a new read, preserves raw password and refuses same-frame replay', async () => {
  const state = fixture();
  await mount();
  await open('others');
  await password(' raw password ');
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  state.override = undefined;
  await click('check');
  expect(button(copy('restart', 'en'))).toBeDefined();
  const held = deferred<Response>();
  state.override = () => held.promise;
  await act(async () => {
    const restart = button(copy('restart', 'en'));
    button(copy('check', 'en')).click();
    restart.click();
    dialog()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(state.requests.filter((v) => v.method !== 'GET')).toHaveLength(1);
  await act(async () => held.resolve(Response.json(state.sessions)));
  state.override = undefined;
  await click('restart');
  expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe(' raw password ');
});
it('never sends the target DELETE after an unknown password-verification result', async () => {
  const state = fixture();
  await mount();
  await open('session');
  state.override = () => Response.json({ error: 'AUTHZ:STEP_UP_REQUIRED' }, { status: 403 });
  await submit();
  await password(' raw password ');
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  expect(state.requests.filter((v) => v.method === 'DELETE')).toHaveLength(1);
  expect(state.requests.filter((v) => v.path.endsWith('step-up'))).toHaveLength(1);
  state.override = undefined;
  await click('check');
  expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe(' raw password ');
});
it('fences old-account writes and isolates the new account source without stale success or focus', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await open('session');
  state.override = () => held.promise;
  await submit();
  state.override = undefined;
  state.sessions = [row('new-current', true), row('new-other', false)];
  await mount('new:actor');
  await act(async () => held.resolve(Response.json({ message: 'Session revoked.' })));
  expect(dialog()).toBeNull();
  expect(host.textContent).not.toContain(copy('confirmed', 'en'));
  expect(state.sessions).toHaveLength(2);
});
it('retires both private lists and the dialog on denied current reads', async () => {
  const state = fixture();
  await mount();
  await open('trust');
  state.override = () => Response.json({}, { status: 503 });
  await submit();
  state.override = undefined;
  state.readStatus = 401;
  await click('check');
  expect(dialog()).toBeNull();
  expect(host.querySelector('section')).toBeNull();
  expect(host.textContent).toContain(copy('denied', 'en'));
  expect(state.requests.filter((v) => v.method !== 'GET')).toHaveLength(1);
});
