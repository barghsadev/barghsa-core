import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TelegramLinkPanel from './TelegramLinkPanel.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { usePreferenceSettingsOwner } from '../hooks/usePreferenceSettingsForm.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { telegramText as copy } from '@barghsa/i18n/telegram';
const uuid = '0199f111-1111-7111-8111-111111111111';
const url = 'https://t.me/barghsa_dev_bot?start=' + 'a'.repeat(43);
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  document.cookie = 'barghsa_csrf=original';
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
function Panel() {
  const scope = usePreferenceSettingsOwner();
  return <TelegramLinkPanel scope={scope} />;
}
async function mount(actor = 'test-user') {
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value={actor}>
            <Panel />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
}
function button(key: Parameters<typeof copy>[0]) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === copy(key, 'en')
  )!;
}
async function click(key: Parameters<typeof copy>[0]) {
  await act(async () => button(key).click());
}
async function input(value: string, type = 'text') {
  const field = host.querySelector<HTMLInputElement>(
    type === 'text' ? 'input:not([type="password"])' : `input[type="${type}"]`
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
function fixture() {
  const state = {
    available: true,
    profileId: uuid,
    link: null as unknown,
    intent: null as unknown,
    latestDelivery: null as unknown,
  };
  const requests: Array<{ method: string; path: string; body: unknown; csrf: string | null }> = [];
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      csrf: new Headers(init?.headers).get('x-csrf-token'),
    });
    if (method === 'GET') return Response.json(state);
    if (method === 'DELETE') {
      state.link = null;
      state.intent = null;
      return Response.json({ revoked: true });
    }
    if (path.endsWith('/confirm')) {
      state.link = { id: uuid, profile_id: uuid, telegram_user_id: '123' };
      state.intent = null;
      return Response.json(state.link);
    }
    state.intent = {
      id: uuid,
      status: 'pending',
      telegram_user_id: null,
      expires_at: '2030-01-01T00:00:00Z',
    };
    return Response.json({ id: uuid, url });
  });
  vi.stubGlobal('fetch', fetcher);
  return { state, requests, fetcher };
}
it('displays only a freshly scoped link and confirms normalized digits with live CSRF', async () => {
  const f = fixture();
  await mount();
  await click('connect');
  expect(host.querySelector('a')?.getAttribute('href')).toBe(url);
  f.state.intent = {
    id: uuid,
    status: 'claimed',
    telegram_user_id: '123',
    expires_at: '2030-01-01T00:00:00Z',
  };
  await click('refresh');
  const field = await input('۱۲٣۴۵٦');
  expect(field.value).toBe('123456');
  document.cookie = 'barghsa_csrf=latest';
  await submit();
  expect(f.requests.find((r) => r.path.endsWith('/confirm'))).toMatchObject({
    body: { id: uuid, code: '123456' },
    csrf: 'latest',
  });
  expect(host.textContent).toContain(copy('linked', 'en'));
  await click('revoke');
  expect(host.textContent).not.toContain(copy('linked', 'en'));
});
it('focuses invalid code and sends no malformed confirmation', async () => {
  const f = fixture();
  f.state.intent = {
    id: uuid,
    status: 'claimed',
    telegram_user_id: '123',
    expires_at: '2030-01-01T00:00:00Z',
  };
  await mount();
  const field = await input('12x');
  await submit();
  expect(field).toBe(document.activeElement);
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(f.requests.every((r) => r.method === 'GET')).toBe(true);
});
it('freezes an uncertain write until an owned status read without blindly retrying', async () => {
  const f = fixture();
  await mount();
  f.fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }));
  await click('connect');
  expect(button('connect').disabled).toBe(true);
  expect(host.textContent).toContain(copy('requestUnknown', 'en'));
  await click('connect');
  expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  await click('refresh');
  expect(button('connect').disabled).toBe(false);
  await click('connect');
  expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
});
it('retires data and a late create response when the profile context changes', async () => {
  const f = fixture();
  await mount();
  let resolve!: (value: Response) => void;
  f.fetcher.mockReturnValueOnce(
    new Promise<Response>((done) => {
      resolve = done;
    })
  );
  await click('connect');
  await act(async () => refreshProfileContext());
  await act(async () => resolve(Response.json({ id: uuid, url })));
  expect(host.querySelector('a')).toBeNull();
  expect(host.querySelector('input')).toBeNull();
});
it('withdraws private state on denied reads and never renders unsafe deep links', async () => {
  const f = fixture();
  await mount();
  f.fetcher.mockResolvedValueOnce(
    Response.json({ id: uuid, url: 'https://evil.test/?secret=private' })
  );
  await click('connect');
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).not.toContain('private');
  f.fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }));
  await click('refresh');
  expect(button('connect')).toBeUndefined();
  expect(host.querySelector('input')).toBeNull();
});
it('reauthenticates creation with rotated CSRF and requires a fresh intent after confirming session rotation', async () => {
  const f = fixture();
  await mount();
  f.fetcher.mockResolvedValueOnce(
    Response.json({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } }, { status: 403 })
  );
  await click('connect');
  await input('owned password', 'password');
  f.fetcher.mockImplementationOnce(async () => {
    document.cookie = 'barghsa_csrf=rotated';
    return Response.json({
      message: 'Step-up authentication successful.',
      stepUpVerifiedAt: '2026-10-05T00:00:00Z',
    });
  });
  await submit();
  expect(f.requests.find((r) => r.method === 'POST')?.csrf).toBe('rotated');
  f.state.intent = {
    id: uuid,
    status: 'claimed',
    telegram_user_id: '123',
    expires_at: '2030-01-01T00:00:00Z',
  };
  await click('refresh');
  await input('123456');
  f.fetcher.mockResolvedValueOnce(
    Response.json({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } }, { status: 403 })
  );
  await submit();
  await input('owned password', 'password');
  f.fetcher.mockResolvedValueOnce(
    Response.json({
      message: 'Step-up authentication successful.',
      stepUpVerifiedAt: '2026-10-05T00:00:00Z',
    })
  );
  await submit();
  expect(host.textContent).toContain(copy('relinkRequired', 'en'));
  expect(f.requests.filter((r) => r.path.endsWith('/confirm'))).toHaveLength(0);
});
