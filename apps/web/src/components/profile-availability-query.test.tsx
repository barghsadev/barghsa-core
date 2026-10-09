import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ProfileAvailabilityGuard } from './ProfileAvailabilityGuard.js';
const { router } = vi.hoisted(() => ({ router: { navigate: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }));
let host: HTMLDivElement, root: Root;
let pending: boolean,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  payload: unknown,
  status: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  router.navigate.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  pending = false;
  status = 200;
  payload = {
    profiles: [{ id: 'current-profile', isDefault: true }],
    hasDefault: true,
    activeProfileId: 'current-profile',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/profiles');
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      signal = init!.signal as AbortSignal;
      return {
        ok: status === 200,
        status,
        json: () =>
          pending
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : Promise.resolve(payload),
      };
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(
  accountId: string | null = 'owner',
  pathname = '/dashboard',
  revision = 0,
  present = true
) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {present && (
          <ProfileAvailabilityGuard accountId={accountId} pathname={pathname} revision={revision} />
        )}
      </QueryComponentProvider>
    )
  );
}
it('redirects a current empty profile directory to onboarding with replacement', async () => {
  payload = { profiles: [], hasDefault: false, activeProfileId: null };
  await render();
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/onboarding', replace: true });
});
it('keeps available profiles without selecting or switching a context', async () => {
  payload = {
    profiles: [{ id: 'profile-one' }, { id: 'profile-two' }],
    hasDefault: false,
    activeProfileId: null,
  };
  await render();
  expect(router.navigate).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 503])('does not reinterpret HTTP %s as an empty directory', async (code) => {
  status = code;
  payload = { profiles: [] };
  await render();
  expect(router.navigate).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not redirect a malformed profile response', async () => {
  payload = {};
  await render();
  expect(router.navigate).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalled();
});
it.each(['/app', '/app/orders'])(
  'leaves %s to its existing beforeLoad availability guard',
  async (pathname) => {
    await render('owner', pathname);
    expect(fetch).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  }
);
it.each(['unmount', 'account', 'revision', 'route'])(
  'cancels pending bytes on %s before an old empty response can redirect',
  async (change) => {
    pending = true;
    await render();
    const oldSignal = signal,
      oldFinish = finish;
    expect(oldSignal.aborted).toBe(false);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    pending = false;
    if (change === 'unmount') await render('owner', '/dashboard', 0, false);
    else if (change === 'account') await render('replacement-owner');
    else if (change === 'revision') await render('owner', '/dashboard', 1);
    else await render('owner', '/settings/profile');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => oldFinish({ profiles: [], hasDefault: false, activeProfileId: null }));
    expect(router.navigate).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  }
);
it('runs a fresh explicit directory check after navigation', async () => {
  await render();
  expect(router.navigate).not.toHaveBeenCalled();
  payload = { profiles: [], hasDefault: false, activeProfileId: null };
  await render('owner', '/settings/profile');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/onboarding', replace: true });
});
