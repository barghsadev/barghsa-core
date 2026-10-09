import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { PublicKnowledgeAssistant, StaffKnowledgeAssistant } from './PublicKnowledgeAssistant.js';
import { KnowledgeAssistantLauncher } from './KnowledgeAssistantLauncher.js';
import Panel from './KnowledgeAssistantPanel.js';
import AIChat from '../pages/AIChat.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: () => '12:00' }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
const profileId = '01900000-0000-7000-8000-000000000001';
const available = {
  available: true,
  profileId,
  profileName: 'Old private profile',
  slotKey: 'individual_chatbot',
};
const unavailable = { available: false, profileId: null, profileName: null, slotKey: null };
type Owner = 'public' | 'staff' | 'launcher' | 'page' | 'panel';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(owner: Owner, actor = 'staff-a', visible = true) {
  const node =
    owner === 'public' ? (
      <PublicKnowledgeAssistant locale="en" />
    ) : owner === 'staff' ? (
      <StaffKnowledgeAssistant locale="en" />
    ) : owner === 'launcher' ? (
      <KnowledgeAssistantLauncher locale="en" />
    ) : owner === 'page' ? (
      <AIChat />
    ) : (
      <Panel
        embedded
        locale="en"
        profileId={profileId}
        profileName="Customer"
        slotKey="individual_chatbot"
        open
        onOpenChange={() => {}}
      />
    );
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>{visible ? node : null}</AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function accountStatus() {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === t('assistant.account.action', 'en')
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it.each(['public', 'staff', 'launcher', 'page'] as const)(
  'keeps %s availability manual and cancels pending bytes on page-only unmount',
  async (owner) => {
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init!.signal as AbortSignal;
      const response = Response.json({});
      response.json = () =>
        new Promise((done) => {
          finish = done;
        });
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    await render(owner);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await render(owner, 'staff-a', false);
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(owner === 'public' || owner === 'staff' ? { available: true } : available)
    );
    expect(host.textContent).toBe('');
  }
);
it.each(['staff', 'launcher', 'page'] as const)(
  'isolates %s availability from an old account reply',
  async (owner) => {
    let old = true;
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (!old) return Response.json(owner === 'staff' ? { available: false } : unavailable);
        signal = init!.signal as AbortSignal;
        const response = Response.json({});
        response.json = () =>
          new Promise((done) => {
            finish = done;
          });
        return response;
      })
    );
    await render(owner);
    old = false;
    await render(owner, 'staff-b');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(owner === 'staff' ? { available: true } : available));
    expect(host.textContent).not.toContain('Old private profile');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('[aria-haspopup=dialog]')).toBeNull();
  }
);
it.each(['account', 'profile-context'] as const)(
  'cancels the manual account snapshot on %s replacement without reviving old money',
  async (replacement) => {
    let old = true;
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/dashboard');
      expect(init?.credentials).toBe('include');
      expect(init?.cache).toBe('no-store');
      if (!old)
        return Response.json({
          profile: { id: profileId, name: 'New account snapshot' },
          access: { wallet: true, invoices: true },
          wallet: { balance: '9007199254740993123456', currency: 'IRR' },
          pendingInvoices: 2,
        });
      signal = init!.signal as AbortSignal;
      const response = Response.json({});
      response.json = () =>
        new Promise((done) => {
          finish = done;
        });
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    await render('panel');
    expect(fetcher).not.toHaveBeenCalled();
    await accountStatus();
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetcher).toHaveBeenCalledOnce();
    old = false;
    if (replacement === 'account') await render('panel', 'staff-b');
    else await act(async () => refreshProfileContext());
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish({
        profile: { id: profileId, name: 'Old private account snapshot' },
        wallet: { balance: '99999999999999999999', currency: 'IRR' },
        pendingInvoices: 1,
      })
    );
    expect(host.textContent).not.toContain('Old private account snapshot');
    expect(fetcher).toHaveBeenCalledOnce();
    await accountStatus();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('New account snapshot');
    expect(host.textContent).toContain('9,007,199,254,740,993,123,456');
  }
);
