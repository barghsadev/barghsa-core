import { QueryComponentProvider } from '../test/query-provider.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { VerificationBanner } from './VerificationBanner.js';
import { DefaultProfileModal } from './DefaultProfileModal.js';

vi.mock('@tanstack/react-router', () => ({
  useLocation: (options?: { select?: (location: { pathname: string }) => unknown }) =>
    options?.select ? options.select({ pathname: '/dashboard' }) : { pathname: '/dashboard' },
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
let host: HTMLDivElement, root: Root;
let pending: boolean, signal: AbortSignal, finish: (value: unknown) => void, payload: unknown;
let readCount: number;
const choices = {
  hasDefault: false,
  activeProfileId: null,
  profiles: [
    {
      id: 'old-private-one',
      profileType: 'INDIVIDUAL',
      firstName: 'Private owner',
      lastName: 'One',
      title: null,
    },
    {
      id: 'old-private-two',
      profileType: 'LEGAL',
      firstName: null,
      lastName: null,
      title: 'Private company',
    },
  ],
};
const notice = {
  activeProfileId: 'old-private-one',
  profileStatus: 'PENDING_VERIFICATION',
  isVerified: false,
  verificationRequired: true,
  verificationMethod: 'manual',
  canAutoVerify: false,
  verificationNotice: {
    id: 'private-notice',
    localizedContent: { en: { title: 'Private notice', body: 'Private account instructions' } },
  },
};
const empty = (kind: string) =>
  kind === 'verification'
    ? { ...notice, isVerified: true, verificationNotice: null }
    : { profiles: [], hasDefault: true, activeProfileId: null };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  pending = true;
  readCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(['/api/profiles', '/api/profiles/verification-status']).toContain(String(url));
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      readCount++;
      signal = init!.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
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
});
async function render(kind: string | null, accountId = 'old-owner') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {kind === 'verification' ? (
          <VerificationBanner accountId={accountId} />
        ) : kind === 'selection' ? (
          <DefaultProfileModal accountId={accountId} />
        ) : null}
      </QueryComponentProvider>
    )
  );
}
for (const kind of ['verification', 'selection']) {
  it.each(['unmount', 'account', 'profile-context'])(
    'cancels pending ' + kind + ' bytes on %s and refuses private late replies',
    async (change) => {
      await render(kind);
      const oldSignal = signal,
        oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(readCount).toBe(1);
      pending = false;
      payload = empty(kind);
      if (change === 'unmount') await render(null);
      else if (change === 'account') await render(kind, 'replacement-owner');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish(kind === 'verification' ? notice : choices));
      expect(document.body.textContent).not.toContain('Private');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    }
  );
  it(
    'withdraws accepted private ' + kind + ' content before the replacement account read resolves',
    async () => {
      pending = false;
      payload = kind === 'verification' ? notice : choices;
      await render(kind);
      expect(document.body.textContent).toContain('Private');
      pending = true;
      await render(kind, 'replacement-owner');
      expect(document.body.textContent).not.toContain('Private');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => finish(empty(kind)));
      expect(document.body.textContent).not.toContain('Private');
    }
  );
}
