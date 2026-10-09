import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { usePreferenceSettingsOwner } from '../hooks/usePreferenceSettingsForm.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TosBanner } from './TosBanner.js';
import TelegramLinkPanel from './TelegramLinkPanel.js';
import { t } from '@barghsa/i18n/terms';
const route = vi.hoisted(() => ({ path: '/dashboard' }));
vi.mock('@tanstack/react-router', () => ({ useRouterState: () => route.path }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: String }),
}));
vi.mock('./TosContent.js', () => ({
  default: function Content({ content, onReady }: { content: string; onReady: () => void }) {
    useEffect(onReady, [onReady]);
    return <p>{content}</p>;
  },
}));
const terms = {
  id: 'terms-one',
  versionId: 'version-one',
  content: 'Current terms content',
  updatedAt: '2026-01-01',
  publishedAt: '2026-01-01',
};
let host: HTMLDivElement,
  root: Root,
  target: 'status' | 'review' | 'telegram',
  first: boolean,
  signal: AbortSignal,
  finish: (value: unknown) => void;
const telegram = {
  available: true,
  profileId: '0199f111-1111-7111-8111-111111111111',
  link: null,
  intent: null,
  latestDelivery: null,
};
function Panel() {
  const scope = usePreferenceSettingsOwner();
  return <TelegramLinkPanel scope={scope} />;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  route.path = '/dashboard';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(init?.credentials).toBe(target === 'telegram' ? 'include' : undefined);
      const held =
        target === 'status'
          ? path === '/api/auth/user'
          : target === 'review'
            ? path.startsWith('/api/tos/current')
            : path === '/api/telegram/link';
      if (first && held) {
        first = false;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      return Response.json(
        path === '/api/auth/user'
          ? { userId: 'current-user', requiresTosAcceptance: target === 'review' }
          : target === 'telegram'
            ? telegram
            : terms
      );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'account-one', locale: 'en' | 'fa' = 'en') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present && (target === 'telegram' ? <Panel /> : <TosBanner locale={locale} />)}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const kind of ['status', 'review', 'telegram'] as const)
  it.each(['unmount', 'actor', 'profile-context'])(
    `retires actual ${kind} complete JSON on %s`,
    async (change) => {
      target = kind;
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal,
        oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      const count = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(count);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'account-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          kind === 'status'
            ? { userId: 'obsolete-private-user', requiresTosAcceptance: true }
            : kind === 'review'
              ? { ...terms, content: 'obsolete-private-terms' }
              : {
                  ...telegram,
                  link: {
                    id: telegram.profileId,
                    profile_id: telegram.profileId,
                    telegram_user_id: 'obsolete-private-id',
                  },
                }
        )
      );
      expect(document.body.innerHTML).not.toContain('obsolete-private');
      if (change !== 'unmount' && kind === 'review')
        expect(document.body.textContent).toContain('Current terms content');
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
it('aborts status JSON during navigation and does not open an obsolete consent review', async () => {
  target = 'status';
  await render();
  await vi.waitFor(() => expect(finish).toBeDefined());
  const oldSignal = signal,
    oldFinish = finish;
  route.path = '/contracts';
  await render();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => oldFinish({ userId: 'old', requiresTosAcceptance: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toBe('');
});
it.each(['exempt-route', 'close', 'locale'])(
  'retires pending terms JSON on %s without an obsolete acceptance target',
  async (change) => {
    target = 'review';
    await render();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal,
      oldFinish = finish;
    if (change === 'exempt-route') {
      route.path = '/contracts';
      await render();
    } else if (change === 'locale') await render(true, 'account-one', 'fa');
    else {
      const close = document.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]')!;
      expect(close).not.toBeNull();
      expect(close.textContent).toContain(t('tos.modal.close', 'en'));
      await act(async () => close.click());
    }
    expect(oldSignal.aborted).toBe(true);
    await act(async () =>
      oldFinish({ ...terms, id: 'obsolete-private-terms', content: 'obsolete-private-content' })
    );
    expect(document.body.innerHTML).not.toContain('obsolete-private');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
      true
    );
  }
);
