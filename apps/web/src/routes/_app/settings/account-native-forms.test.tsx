import { QueryProvider } from '../../../test/query-provider.js';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route } from './username.js';
import { AccountUserProvider } from '../../../hooks/useAccountUser.js';
import { t } from '@barghsa/i18n/app';
import { tAccountSettingsForms as copy } from '@barghsa/i18n/account-settings-forms';
import type { AccountSettingsUser } from '../../../lib/account-settings-form.js';
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
let root: Root, host: HTMLDivElement;
const Page = Route.options.component as ComponentType;
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(contact: 'email' | 'mobile' = 'mobile') {
  const state = {
    user: {
      userId: 'user',
      username: contact === 'mobile' ? 'old@example.test' : '+989120000001',
      email: contact === 'mobile' ? 'old@example.test' : null,
      mobile: contact === 'mobile' ? null : '+989120000001',
      emailVerified: contact === 'mobile',
      mobileVerified: contact === 'email',
    } as AccountSettingsUser,
    readStatus: 200,
    readCount: 0,
    writes: [] as { path: string; body: Record<string, string>; csrf: string | null }[],
    override: undefined as
      ((path: string, body: Record<string, string>) => Promise<Response> | Response) | undefined,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!init?.method) {
        expect(path).toBe('/api/auth/user');
        state.readCount++;
        return Response.json(state.user, { status: state.readStatus });
      }
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      state.writes.push({ path, body, csrf: new Headers(init.headers).get('x-csrf-token') });
      if (state.override) return state.override(path, body);
      if (path.endsWith('/send-otp'))
        return Response.json({
          challengeId: '10000000-0000-4000-8000-000000000001',
          destination: body.newUsername ?? body.contactValue,
          ...(body.newUsername ? { previousDestination: state.user.username } : {}),
        });
      if (body.newUsername) state.user = { ...state.user, username: body.newUsername };
      else
        state.user = {
          ...state.user,
          [body.contactType!]: body.contactValue,
          [body.contactType === 'email' ? 'emailVerified' : 'mobileVerified']: true,
        };
      return Response.json({ message: 'verified' });
    })
  );
  return state;
}
async function mount(actor = 'user') {
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
function button(parent: ParentNode, label: string) {
  const value = Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === label
  );
  expect(value, label).toBeDefined();
  return value!;
}
async function click(label: string, parent: ParentNode = host) {
  await act(async () => button(parent, label).click());
}
async function change(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>('#' + id)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function form(family: 'username' | 'contact') {
  return host.querySelector<HTMLFormElement>('[data-slot=account-' + family + '-form]')!;
}
async function submit(family: 'username' | 'contact') {
  await act(async () => {
    form(family).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
const text = (key: string) => t(key, 'en');
async function openUsername() {
  await click(text('settings.username.change'));
}
async function openContact(type: 'email' | 'mobile' = 'mobile') {
  await click(text(type === 'mobile' ? 'settings.contact.addMobile' : 'settings.contact.addEmail'));
}
async function pair() {
  await openUsername();
  await change('new-username', '  NEW@example.test  ');
  await submit('username');
  await change('previous-otp', '112233');
  await change('change-otp', '123456');
}

it('owns touched native validation and preserves independent raw destination drafts with zero writes', async () => {
  const state = fixture();
  await mount();
  await openUsername();
  await openContact();
  await change('new-username', '  invalid  ');
  await change('new-contact', '  Retained companion  ');
  await submit('username');
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe('  invalid  ');
  expect(host.querySelector<HTMLInputElement>('#new-contact')?.value).toBe(
    '  Retained companion  '
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('#new-username')));
  const field = host.querySelector('#new-username')!;
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(
    document.getElementById(field.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent
  ).toBe(copy('usernameInvalid', 'en'));
});
it('blocks synchronous duplicate native submissions and all companion reads/cancels while sending', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await openUsername();
  await openContact();
  await change('new-username', 'new@example.test');
  await change('new-contact', '09120000001');
  state.override = () => held.promise;
  await act(async () => {
    form('username').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form('username').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form('contact').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(1);
  const reads = state.readCount;
  for (const input of host.querySelectorAll('input')) expect(input.disabled).toBe(true);
  const refresh = button(host, copy('refresh', 'en'));
  expect(refresh.disabled).toBe(true);
  await act(async () => refresh.dispatchEvent(new Event('click', { bubbles: true })));
  expect(state.readCount).toBe(reads);
  expect(state.writes).toHaveLength(1);
  await act(async () =>
    held.resolve(Response.json({ error: 'VALIDATION:INPUT:INVALID' }, { status: 400 }))
  );
  expect(host.querySelector<HTMLInputElement>('#new-contact')?.value).toBe('09120000001');
});
it('keeps both paired OTPs and the contact draft after a known401, then proves the actual account before clearing', async () => {
  const state = fixture();
  await mount();
  await pair();
  await openContact();
  await change('new-contact', ' 09120000001 ');
  state.override = () =>
    Response.json({ error: 'AUTH:OTP:INVALID', message: 'PRIVATE-SERVER-TEXT' }, { status: 401 });
  await submit('username');
  expect(host.querySelector<HTMLInputElement>('#previous-otp')?.value).toBe('112233');
  expect(host.querySelector<HTMLInputElement>('#change-otp')?.value).toBe('123456');
  expect(host.textContent).not.toContain('PRIVATE-SERVER-TEXT');
  state.override = undefined;
  await submit('username');
  expect(host.querySelector('#previous-otp')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#new-contact')?.value).toBe(' 09120000001 ');
  expect(state.writes.slice(1).map((x) => x.body)).toEqual(
    Array(2).fill({
      newUsername: 'new@example.test',
      otpChallengeId: '10000000-0000-4000-8000-000000000001',
      otp: '123456',
      previousOtp: '112233',
    })
  );
});
for (const type of ['email', 'mobile'] as const)
  it(`confirms canonical ${type} contact with its verified flag and retains username draft`, async () => {
    const state = fixture(type);
    await mount();
    await openUsername();
    await change('new-username', '  Companion@example.test  ');
    await openContact(type);
    const raw = type === 'email' ? '  NEW@EXAMPLE.TEST  ' : ' 09120000002 ';
    const destination = type === 'email' ? 'new@example.test' : '+989120000002';
    await change('new-contact', raw);
    expect(host.querySelector<HTMLInputElement>('#new-contact')?.value).toBe(raw);
    await submit('contact');
    await change('contact-otp', 'abcdef');
    await submit('contact');
    expect(state.writes).toHaveLength(1);
    await change('contact-otp', '123456');
    await submit('contact');
    expect(state.writes[1]?.body).toEqual({
      contactType: type,
      contactValue: destination,
      otpChallengeId: '10000000-0000-4000-8000-000000000001',
      otp: '123456',
    });
    expect(host.querySelector('#contact-otp')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe(
      '  Companion@example.test  '
    );
  });
it('retains an uncertain send and requires a fresh account check before an explicit restart without replay', async () => {
  const state = fixture();
  await mount();
  await openUsername();
  await change('new-username', '  NEW@example.test  ');
  state.override = () =>
    Response.json({ challengeId: 'not-uuid', destination: 'PRIVATE-WRONG-TARGET' });
  await submit('username');
  expect(host.querySelector('#previous-otp')).toBeNull();
  expect(host.textContent).not.toContain('PRIVATE-WRONG-TARGET');
  await submit('username');
  expect(state.writes).toHaveLength(1);
  expect(
    Array.from(host.querySelectorAll('button')).some((x) => x.textContent === copy('restart', 'en'))
  ).toBe(false);
  await click(copy('confirm', 'en'));
  expect(state.writes).toHaveLength(1);
  await click(copy('restart', 'en'));
  expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe('  NEW@example.test  ');
  state.override = undefined;
  await submit('username');
  expect(state.writes).toHaveLength(2);
  expect(host.querySelector('#previous-otp')).not.toBeNull();
});
it('does not clear from a message-only verification receipt until current account values match', async () => {
  const state = fixture();
  await mount();
  await pair();
  state.override = () => Response.json({ message: 'verified' });
  await submit('username');
  expect(host.querySelector<HTMLInputElement>('#previous-otp')?.value).toBe('112233');
  expect(button(form('username'), text('settings.contact.cancel')).disabled).toBe(true);
  await submit('username');
  expect(state.writes).toHaveLength(2);
  await click(copy('confirm', 'en'));
  await click(copy('restart', 'en'));
  expect(host.querySelector('#previous-otp')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe('  NEW@example.test  ');
  expect(state.writes).toHaveLength(2);
});
it('confirms a lost verification response through account GET without a second POST', async () => {
  const state = fixture();
  await mount();
  await pair();
  state.override = () => {
    state.user = { ...state.user, username: 'new@example.test' };
    return Promise.reject(new Error('lost response'));
  };
  await submit('username');
  expect(host.querySelector('#previous-otp')).not.toBeNull();
  await click(copy('confirm', 'en'));
  expect(host.querySelector('#previous-otp')).toBeNull();
  expect(state.writes).toHaveLength(2);
});
it('withdraws private account, challenges and both form drafts on a denied confirmation read', async () => {
  const state = fixture();
  await mount();
  await pair();
  await openContact();
  await change('new-contact', 'PRIVATE-COMPANION');
  state.override = () => Response.json({}, { status: 500 });
  await submit('username');
  state.readStatus = 401;
  await click(copy('confirm', 'en'));
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).not.toContain('PRIVATE-COMPANION');
  expect(host.textContent).not.toContain('old@example.test');
  expect(host.textContent).toContain(copy('forbidden', 'en'));
});
it('fences a late old-actor send response before exposing the fresh actor and fresh draft', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  await openUsername();
  await change('new-username', 'old-private@example.test');
  state.override = () => held.promise;
  await submit('username');
  state.user = { ...state.user, userId: 'new-user', username: 'fresh@example.test' };
  await mount('new-user');
  expect(host.querySelector('#new-username')).toBeNull();
  await openUsername();
  await change('new-username', 'fresh-draft@example.test');
  await act(async () =>
    held.resolve(
      Response.json({
        challengeId: '10000000-0000-4000-8000-000000000001',
        destination: 'old-private@example.test',
        previousDestination: 'old@example.test',
      })
    )
  );
  expect(host.querySelector('#previous-otp')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe(
    'fresh-draft@example.test'
  );
  expect(host.textContent).not.toContain('old-private');
});
it('retains both unsent drafts through a same-actor transient refresh and lets the initial read recover', async () => {
  const state = fixture();
  state.readStatus = 503;
  await mount();
  expect(host.querySelector('input')).toBeNull();
  state.readStatus = 200;
  await click(copy('refresh', 'en'));
  await openUsername();
  await openContact();
  await change('new-username', '  Draft@example.test  ');
  await change('new-contact', ' 09120000003 ');
  state.readStatus = 503;
  await click(copy('refresh', 'en'));
  expect(host.querySelector<HTMLInputElement>('#new-username')?.value).toBe(
    '  Draft@example.test  '
  );
  expect(host.querySelector<HTMLInputElement>('#new-contact')?.value).toBe(' 09120000003 ');
  expect(state.writes).toHaveLength(0);
});

it('keeps account reads manual and makes each explicit refresh a fresh abortable request', async () => {
  const state = fixture();
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(state.readCount).toBe(1);
  await click(copy('refresh', 'en'));
  expect(state.readCount).toBe(2);
  const requests = vi.mocked(fetch).mock.calls;
  expect(requests.every((request) => request[1]?.credentials === 'include')).toBe(true);
  const signals = requests.map((request) => request[1]?.signal);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(new Set(signals).size).toBe(2);
  expect(state.writes).toHaveLength(0);
});

it('cancels old-account reads and refuses their late authorization denial', async () => {
  const state = fixture(),
    held = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  vi.mocked(fetch).mockImplementationOnce(async (_path, init) => {
    signal = init?.signal;
    return held.promise;
  });
  await mount();
  state.user = { ...state.user, userId: 'new-user', username: 'replacement@example.test' };
  await mount('new-user');
  expect(signal?.aborted).toBe(true);
  await act(async () => held.resolve(Response.json({}, { status: 401 })));
  expect(
    host.querySelector('[aria-labelledby="username-section-title"] p[dir="ltr"]')?.textContent
  ).toBe('rep...est');
  expect(host.textContent).not.toContain(copy('forbidden', 'en'));
  expect(state.writes).toHaveLength(0);
});

it('aborts the owned refresh on unmount without publishing a late source', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  let signal: AbortSignal | null | undefined;
  vi.mocked(fetch).mockImplementationOnce(async (_path, init) => {
    signal = init?.signal;
    return held.promise;
  });
  await click(copy('refresh', 'en'));
  expect(signal?.aborted).toBe(false);
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(signal?.aborted).toBe(true);
  await act(async () => held.resolve(Response.json(state.user)));
  expect(host.textContent).toBe('');
  expect(state.writes).toHaveLength(0);
});

it('cannot certify cached account data or offer restart when a fresh confirmation fails', async () => {
  const state = fixture();
  await mount();
  await pair();
  state.override = () => Response.json({}, { status: 503 });
  await submit('username');
  state.readStatus = 503;
  await click(copy('confirm', 'en'));
  expect(host.textContent).toContain(copy('uncertain', 'en'));
  expect(
    Array.from(host.querySelectorAll('button')).some(
      (button) => button.textContent === copy('restart', 'en')
    )
  ).toBe(false);
  expect(state.writes).toHaveLength(2);
  state.readStatus = 200;
  await click(copy('confirm', 'en'));
  expect(button(host, copy('restart', 'en'))).toBeDefined();
  expect(state.writes).toHaveLength(2);
});
