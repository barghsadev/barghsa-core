import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tWorkspace as t } from '@barghsa/i18n/workspace-crm';
import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import Directory from './CrmProfileList.js';
import { CrmProfileRecords } from '../components/CrmProfileRecords.js';
import { CrmLegalDocuments } from '../components/CrmLegalDocuments.js';
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ timezone: 'UTC', status: 'ready', retry: () => {} }),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
const user = {
  userId: 'user-1',
  username: 'Old private user',
  registrationDate: '2026-10-01T00:00:00Z',
  lastLogin: null,
  profileCount: 0,
  hasVerifiedProfile: false,
  profiles: [],
};
const record = {
  id: 'event-1',
  event: 'verified',
  actor: 'Old private actor',
  previousStatus: null,
  newStatus: 'verified',
  reason: 'Old private reason',
  createdAt: '2026-10-01T00:00:00Z',
};
const oldRecords = { items: [record], nextCursor: null };
type Owner = 'directory' | 'records' | 'documents';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  owner: Owner,
  options: {
    actor?: string;
    visible?: boolean;
    canRead?: boolean;
    profile?: string;
    initial?: unknown;
  } = {}
) {
  const profile = options.profile ?? 'profile-a';
  const node =
    owner === 'directory' ? (
      <Directory />
    ) : owner === 'records' ? (
      <CrmProfileRecords
        profileId={profile}
        kind="verification"
        initial={options.initial ?? null}
      />
    ) : (
      <CrmLegalDocuments profileId={profile} canRead={options.canRead ?? true} />
    );
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={options.actor ?? 'staff-a'}>
          {options.visible === false ? null : node}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
function payload(owner: Owner, fresh = false, profileId = 'profile-a') {
  return owner === 'directory'
    ? {
        users: [{ ...user, username: fresh ? 'New permitted user' : user.username }],
        cursor: null,
        hasMore: false,
      }
    : owner === 'records'
      ? {
          items: [
            {
              ...record,
              actor: fresh ? 'New permitted actor' : record.actor,
              reason: fresh ? 'New permitted reason' : record.reason,
            },
          ],
          nextCursor: null,
        }
      : {
          profileId,
          documents: [
            {
              name: fresh ? 'New permitted file' : 'Old private file',
              url: 'https://files.example.test/private.pdf',
            },
          ],
        };
}
it.each(['directory', 'records', 'documents'] as const)(
  'keeps %s reads manual and cancels pending bytes on page-only unmount',
  async (owner) => {
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
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
    if (owner === 'documents') {
      expect(fetcher).not.toHaveBeenCalled();
      await click(t('crm.documents.load', 'en'));
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await render(owner, { visible: false });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(payload(owner)));
    expect(host.textContent).toBe('');
  }
);
it.each(['directory', 'records', 'documents'] as const)(
  'refuses old %s data after account replacement',
  async (owner) => {
    let old = true;
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (!old) return Response.json(payload(owner, true));
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
    if (owner === 'documents') await click(t('crm.documents.load', 'en'));
    old = false;
    await render(owner, { actor: 'staff-b' });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(payload(owner)));
    expect(host.textContent).not.toContain('Old private');
    if (owner === 'documents') await click(t('crm.documents.load', 'en'));
    expect(host.textContent).toContain(
      owner === 'directory'
        ? 'New permitted user'
        : owner === 'records'
          ? 'New permitted actor'
          : 'New permitted file'
    );
  }
);
it('withdraws private record rows on current denial and only restores them from a healthy explicit read', async () => {
  let status = 403;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(payload('records', true), { status }))
  );
  await render('records', { initial: oldRecords });
  expect(host.textContent).toContain('Old private actor');
  await click(t('crm.records.refresh', 'en'));
  expect(host.textContent).not.toContain('Old private actor');
  expect(host.querySelector('table')).toBeNull();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  status = 503;
  await click(t('crm.records.retry', 'en'));
  expect(host.querySelector('table')).toBeNull();
  status = 200;
  await click(t('crm.records.retry', 'en'));
  expect(host.textContent).toContain('New permitted actor');
});
it.each(['profile', 'permission'] as const)(
  'cancels signed-document bytes on %s replacement and requires a new manual read',
  async (replacement) => {
    let old = true;
    let signal!: AbortSignal, finish!: (value: unknown) => void;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.cache).toBe('no-store');
      if (!old)
        return Response.json(
          payload('documents', true, replacement === 'profile' ? 'profile-b' : 'profile-a')
        );
      signal = init!.signal as AbortSignal;
      const response = Response.json({});
      response.json = () =>
        new Promise((done) => {
          finish = done;
        });
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    await render('documents');
    await click(t('crm.documents.load', 'en'));
    await render(
      'documents',
      replacement === 'profile' ? { profile: 'profile-b' } : { canRead: false }
    );
    expect(signal.aborted).toBe(true);
    await act(async () => finish(payload('documents')));
    expect(host.querySelector('a')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    old = false;
    if (replacement === 'permission') await render('documents', { canRead: true });
    expect(host.querySelector('a')).toBeNull();
    await click(t('crm.documents.load', 'en'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('New permitted file');
  }
);
