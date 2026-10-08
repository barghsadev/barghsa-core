import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as Preferences } from './index.js';
import { Route as Timezone } from './timezone.js';
import { AccountUserProvider } from '../../../hooks/useAccountUser.js';
import { AnalyticsConsentProvider } from '../../../providers/AnalyticsConsentProvider.js';
import { t } from '@barghsa/i18n/app';
import { timezoneText } from '@barghsa/i18n/timezone';
import { shellText } from '@barghsa/i18n/shell';
import { tPreferenceSettingsForms as copy } from '@barghsa/i18n/preference-settings-forms';
import { QueryProvider } from '../../../providers/QueryProvider.js';
import { connectToast, toast } from '../../../lib/toast-api.js';
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ isStaff: false }),
  }),
  useLocation: () => ({ pathname: '/settings' }),
}));
vi.mock('../../../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
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
  toast.dismiss();
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
    notifications: { channels: ['IN_APP', 'EMAIL'], availableChannels: ['IN_APP', 'EMAIL', 'SMS'] },
    marketing: {
      channels: {
        email: { optedIn: false, lastChangedAt: null as string | null },
        sms: { optedIn: false, lastChangedAt: null as string | null },
      },
    },
    timezone: 'Asia/Tehran',
    readStatus: 200,
    readOverride: undefined as undefined | (() => Promise<Response>),
    reads: [] as string[],
    writes: [] as { path: string; body: Record<string, unknown>; csrf: string | null }[],
    override: undefined as
      undefined | ((path: string, body: Record<string, unknown>) => Response | Promise<Response>),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        state.reads.push(path);
        if (path.includes('/analytics/consent')) return Response.json({ consent: false });
        if (state.readOverride) return state.readOverride();
        const body = path.endsWith('/timezone')
          ? { timezone: state.timezone }
          : path.endsWith('/notifications')
            ? state.notifications
            : state.marketing;
        return Response.json(body, { status: state.readStatus });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.writes.push({ path, body, csrf: new Headers(init.headers).get('x-csrf-token') });
      if (state.override) return state.override(path, body);
      if (path.endsWith('/notifications')) {
        state.notifications = { ...state.notifications, channels: body.channels as string[] };
        return Response.json(state.notifications);
      }
      if (path.endsWith('/timezone')) {
        state.timezone = body.timezone as string;
        return Response.json({ timezone: state.timezone });
      }
      if (path.includes('/analytics/')) return Response.json(body);
      state.marketing = {
        channels: {
          email: { optedIn: body.email as boolean, lastChangedAt: '2026-10-05T00:00:00Z' },
          sms: { optedIn: body.sms as boolean, lastChangedAt: null },
        },
      };
      return Response.json(state.marketing);
    })
  );
  return state;
}
async function mount(timezone = false, actor = 'user') {
  const Page = (timezone ? Timezone : Preferences).options.component as ComponentType;
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <AnalyticsConsentProvider area="customer">
            <Page />
          </AnalyticsConsentProvider>
        </AccountUserProvider>
      </QueryProvider>
    )
  );
}
function form(family: 'notifications' | 'marketing' | 'timezone') {
  return host.querySelectorAll<HTMLFormElement>('form')[family === 'marketing' ? 1 : 0]!;
}
async function submit(family: 'notifications' | 'marketing' | 'timezone') {
  await act(async () => {
    form(family).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
async function toggle(id: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('#' + id)!.click());
}
async function zone(value: string) {
  const select = host.querySelector<HTMLSelectElement>('#settings-timezone')!;
  if (!Array.from(select.options).some((v) => v.value === value)) {
    const option = new Option(value, value);
    select.add(option);
  }
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(key: string, parent: ParentNode = host) {
  const button = Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === copy(key, 'en')
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
it('saves actual notification choices and retains unsent marketing intent with current CSRF', async () => {
  const state = fixture();
  document.cookie = 'barghsa_csrf=preference-token';
  await mount();
  await toggle('marketing-email');
  await toggle('notification-SMS');
  await submit('notifications');
  expect(state.writes).toEqual([
    {
      path: '/api/user/settings/notifications',
      body: { channels: ['IN_APP', 'EMAIL', 'SMS'] },
      csrf: 'preference-token',
    },
  ]);
  expect(host.querySelector('#marketing-email')?.getAttribute('aria-checked')).toBe('true');
  expect(form('notifications').textContent).not.toContain('channelInvalid');
});
it('saves both marketing choices and renders actual change dates while preserving notification draft', async () => {
  const state = fixture();
  await mount();
  await toggle('notification-EMAIL');
  await toggle('marketing-sms');
  await submit('marketing');
  expect(state.writes[0]!.body).toEqual({ email: false, sms: true });
  const label = t('settings.marketing.lastChangedAt', 'en').replace(
    '{date}',
    '2026-10-05T00:00:00Z'
  );
  expect(label).not.toContain('settings.marketing.');
  expect(host.textContent).toContain(label);
  expect(host.textContent).not.toContain('{date}');
  expect(host.querySelector('#notification-EMAIL')?.getAttribute('aria-checked')).toBe('false');
});
it('saves an offered timezone with the exact wire and announces the confirmed preference', async () => {
  const state = fixture(),
    listener = vi.fn();
  window.addEventListener('barghsa:timezone-changed', listener);
  await mount(true);
  await zone('Europe/Istanbul');
  await submit('timezone');
  expect(state.writes[0]!.body).toEqual({ timezone: 'Europe/Istanbul' });
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener('barghsa:timezone-changed', listener);
});
it('rejects an injected non-offered timezone with native linked feedback, focus and zero PUTs', async () => {
  const state = fixture();
  await mount(true);
  await zone('not/a-zone');
  await submit('timezone');
  expect(state.writes).toHaveLength(0);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#settings-timezone'))
  );
  expect(host.textContent).toContain(copy('timezoneInvalid', 'en'));
  expect(host.querySelector('#settings-timezone')?.getAttribute('aria-invalid')).toBe('true');
});
it('claims one synchronous owner for duplicate/companion native submissions and analytics actions', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount();
  state.override = () => held.promise;
  await act(async () => {
    form('notifications').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form('notifications').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form('marketing').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(state.writes).toHaveLength(1);
  const reads = state.reads.length;
  const allow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === shellText('analyticsAllow', 'en')
  )!;
  expect(allow.disabled).toBe(true);
  await act(async () => allow.dispatchEvent(new Event('click', { bubbles: true })));
  expect(state.writes).toHaveLength(1);
  expect(state.reads).toHaveLength(reads);
  await act(async () => held.resolve(Response.json({ error: 'CONFLICT:STATE' }, { status: 409 })));
  expect(form('marketing').querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(
    false
  );
});
it('proves a committed lost timezone result with authorized reads and no second PUT', async () => {
  const state = fixture();
  await mount(true);
  await zone('Europe/Istanbul');
  state.override = (_path, body) => {
    state.timezone = body.timezone as string;
    return Response.json({ message: 'PRIVATE-RESULT' });
  };
  await submit('timezone');
  expect(state.writes).toHaveLength(1);
  expect(host.textContent).not.toContain('PRIVATE-RESULT');
  state.readStatus = 503;
  await click('confirm');
  expect(
    Array.from(host.querySelectorAll('button')).some((v) => v.textContent === copy('restart', 'en'))
  ).toBe(false);
  state.readStatus = 200;
  await click('confirm');
  expect(state.writes).toHaveLength(1);
  expect(host.textContent).toContain(timezoneText('success', 'en'));
});
it('requires a valid confirmation before deliberate restart and keeps both independent drafts', async () => {
  const state = fixture();
  await mount();
  await toggle('marketing-email');
  await toggle('notification-SMS');
  state.override = () => Response.json({}, { status: 503 });
  await submit('notifications');
  const card = form('notifications').parentElement!;
  await click('confirm', card);
  await click('restart', card);
  expect(state.writes).toHaveLength(1);
  expect(host.querySelector('#notification-SMS')?.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector('#marketing-email')?.getAttribute('aria-checked')).toBe('true');
});
it('keeps a same-actor refresh from overwriting unsaved timezone choice', async () => {
  const state = fixture();
  await mount(true);
  await zone('Europe/Istanbul');
  await click('refresh');
  expect(state.writes).toHaveLength(0);
  expect(host.querySelector<HTMLSelectElement>('#settings-timezone')!.value).toBe(
    'Europe/Istanbul'
  );
});
it('fences an old actor write while a new actor source is accepted', async () => {
  const state = fixture(),
    held = deferred<Response>();
  await mount(true);
  await zone('Europe/Istanbul');
  state.override = () => held.promise;
  await submit('timezone');
  await mount(true, 'new-user');
  await act(async () => held.resolve(Response.json({ timezone: 'Europe/Istanbul' })));
  expect(host.querySelector<HTMLSelectElement>('#settings-timezone')!.value).toBe('Asia/Tehran');
  expect(host.textContent).not.toContain(timezoneText('success', 'en'));
});
it('retires private choices on a denied confirmation read', async () => {
  const state = fixture();
  await mount();
  await toggle('marketing-email');
  state.override = () => Response.json({}, { status: 503 });
  await submit('marketing');
  state.readStatus = 403;
  await click('confirm', form('marketing').parentElement!);
  expect(host.querySelectorAll('form')).toHaveLength(0);
  expect(host.textContent).toContain(copy('forbidden', 'en'));
  expect(state.writes).toHaveLength(1);
});

it('keeps the synchronous read owner when a prior restart control is dispatched during rechecking', async () => {
  const state = fixture();
  await mount(true);
  await zone('Europe/Istanbul');
  state.override = () => Response.json({}, { status: 503 });
  await submit('timezone');
  await click('confirm');
  const restart = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === copy('restart', 'en')
  )!;
  expect(restart).toBeDefined();
  const held = deferred<Response>();
  state.readOverride = () => held.promise;
  const before = state.reads.length;
  const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (v) => v.textContent === copy('confirm', 'en')
  )!;
  await act(async () => {
    confirm.click();
    restart.dispatchEvent(new Event('click', { bubbles: true }));
    form('timezone').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(state.writes).toHaveLength(1);
  expect(state.reads).toHaveLength(before + 1);
  expect(form('timezone').querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(
    true
  );
  await act(async () => held.resolve(Response.json({ timezone: 'Asia/Tehran' })));
  expect(state.writes).toHaveLength(1);
});

it('toasts only a confirmed preference save and labels a lost result without claiming success', async () => {
  const state = fixture(),
    success = vi.fn(),
    error = vi.fn();
  toast.dismiss();
  const disconnect = connectToast({ success, error, dismiss: vi.fn() });
  try {
    await mount(true);
    await zone('Europe/Istanbul');
    state.override = (_path, body) => {
      state.timezone = body.timezone as string;
      return Response.json({ message: 'PRIVATE-UNKNOWN-RESULT' });
    };
    await submit('timezone');
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(copy('uncertainToast', 'en'), undefined);
    expect(host.textContent).toContain(copy('uncertain', 'en'));
    await click('confirm');
    expect(state.writes).toHaveLength(1);
    expect(host.textContent).toContain(timezoneText('success', 'en'));
    await zone('Asia/Tehran');
    state.override = undefined;
    await submit('timezone');
    expect(success).toHaveBeenCalledExactlyOnceWith(copy('savedToast', 'en'), undefined);
    expect(state.writes).toHaveLength(2);
  } finally {
    disconnect();
  }
});
