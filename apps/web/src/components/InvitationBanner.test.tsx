import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvitationBanner } from './InvitationBanner.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
const harness = vi.hoisted(() => ({ invalidate: vi.fn(), navigate: vi.fn(), refresh: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => harness }));
vi.mock('../lib/profile-context.js', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../lib/profile-context.js')),
  refreshProfileContext: () => harness.refresh(),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (v: string) => v }),
}));
const invitation = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  profileName: 'Chosen company',
  role: 'Finance',
  invitedBy: 'private-owner-id',
  inviterName: 'Actual Inviter',
  createdAt: '2026-09-01T00:00:00Z',
  expiresAt: null,
  message: 'A plain invitation message',
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const list = (items: unknown[] = [invitation]) => json({ invitations: items });
const receipt = (status = 'Accepted', extra = {}) =>
  json({
    invitation: {
      id: invitation.id,
      profileId: invitation.profileId,
      role: invitation.role,
      status,
      ...extra,
    },
  });
const deferred = () => {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  document.cookie = 'barghsa_csrf=first-csrf';
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=;max-age=0';
});
async function mount(account: string | null = 'customer', locale: 'en' | 'fa' = 'en') {
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value={account}>
            <InvitationBanner locale={locale} />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
}
function button(name: string) {
  const b = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  expect(b).toBeDefined();
  return b!;
}
async function click(name: string) {
  await act(async () => {
    button(name).click();
    await import('../lib/invitation-action.js');
  });
}

for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: confirms acceptance, preserves the workspace and opens only by explicit choice with fresh CSRF`, async () => {
    const calls: { path: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init });
        if (path.includes('/pending')) return list();
        if (path.endsWith('/accept')) return receipt();
        return json({ activeProfileId: invitation.profileId });
      })
    );
    await mount('customer', locale);
    await act(async () => {
      await import('./InvitationCards.js');
    });
    expect(container.querySelector('section')?.dir).toBe(locale === 'fa' ? 'rtl' : 'ltr');
    expect(container.textContent).toContain('Actual Inviter');
    expect(container.textContent).not.toContain('private-owner-id');
    await click(locale === 'fa' ? 'پذیرفتن' : 'Accept');
    expect(calls.filter((c) => c.path.endsWith('/accept'))).toHaveLength(1);
    const proposal = calls.find((c) => c.path.endsWith('/accept'))!.init!;
    expect(JSON.parse(proposal.body as string)).toEqual({
      expectedProfileId: invitation.profileId,
      expectedRole: 'Finance',
    });
    expect(new Headers(proposal.headers).get('X-CSRF-Token')).toBe('first-csrf');
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Chosen company');
    document.cookie = 'barghsa_csrf=rotated-csrf';
    await click(locale === 'fa' ? 'باز کردن پروفایل' : 'Open profile');
    expect(
      new Headers(calls.find((c) => c.path.includes('/switch/'))?.init?.headers).get('X-CSRF-Token')
    ).toBe('rotated-csrf');
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith({ to: '/app' });
  });
}
it('serializes all account decisions while acceptance rotates credentials', async () => {
  const pending = deferred();
  const fetchMock = vi.fn((path: string) =>
    path.includes('/pending')
      ? Promise.resolve(
          list([invitation, { ...invitation, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }])
        )
      : pending.promise
  );
  vi.stubGlobal('fetch', fetchMock);
  await mount();
  const actions = [...container.querySelectorAll('button')].filter(
    (b) => b.textContent === 'Accept'
  );
  await act(async () => {
    actions[0]!.click();
    actions[1]!.click();
  });
  expect(fetchMock.mock.calls.filter(([p]) => p.endsWith('/accept'))).toHaveLength(1);
  expect([...container.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  await act(async () => pending.resolve(receipt()));
  expect(button('Open profile').disabled).toBe(false);
});
for (const invalid of [
  { message: 'ok' },
  { id: 'wrong' },
  { profileId: 'wrong' },
  { role: 'Legal' },
  { status: 'Declined' },
]) {
  it(`rejects an unbound acceptance receipt ${JSON.stringify(invalid)} and rechecks before another decision`, async () => {
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path.includes('/pending')) {
          reads++;
          return list();
        }
        return 'message' in invalid ? json(invalid) : receipt('Accepted', invalid);
      })
    );
    await mount();
    await click('Accept');
    expect(container.textContent).toContain('Chosen company');
    expect(container.textContent).toContain('Error processing invitation');
    expect(button('Accept').disabled).toBe(true);
    expect(harness.invalidate).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
    await click('Retry');
    expect(reads).toBe(2);
    expect(button('Accept').disabled).toBe(false);
  });
}
it('retains company details during transient refresh failure, pauses decisions and recovers', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (++reads === 2 ? json({}, 503) : list()))
  );
  await mount();
  await click('Refresh invitations');
  expect(container.textContent).toContain('Actual Inviter');
  expect(button('Decline').disabled).toBe(true);
  await click('Retry');
  expect(button('Decline').disabled).toBe(false);
});
for (const status of [401, 403]) {
  it(`clears private data and rejects late mutation after ${status}`, async () => {
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.includes('/pending') ? (++reads === 2 ? json({}, status) : list()) : receipt()
      )
    );
    await mount();
    await click('Refresh invitations');
    expect(container.textContent).not.toContain('Chosen company');
    expect(container.textContent).not.toContain('Actual Inviter');
    await click('Retry');
    expect(button('Accept').disabled).toBe(false);
  });
}
it('aborts and rejects a late acceptance when the authenticated account changes', async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      if (path.endsWith('/accept')) {
        signal = init?.signal ?? undefined;
        return pending.promise;
      }
      return Promise.resolve(list());
    })
  );
  await mount('old-account');
  await click('Accept');
  await mount('new-account');
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(receipt()));
  expect(harness.invalidate).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('accepted');
  expect(button('Accept').disabled).toBe(false);
});
it('aborts a late account read and refuses to display its invitations', async () => {
  const pending = deferred();
  let reads = 0;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_path: string, init?: RequestInit) => {
      if (++reads === 1) {
        signal = init?.signal ?? undefined;
        return pending.promise;
      }
      return Promise.resolve(list([]));
    })
  );
  await mount('old-account');
  await mount('new-account');
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(list()));
  expect(container.textContent).not.toContain('Chosen company');
});
it('decline confirms the exact receipt without changing or refreshing the selected profile', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => (path.includes('/pending') ? list() : receipt('Declined')))
  );
  await mount();
  await click('Decline');
  expect(container.textContent).toContain('declined');
  expect(container.textContent).toContain('Chosen company');
  expect(harness.refresh).not.toHaveBeenCalled();
  expect(harness.invalidate).not.toHaveBeenCalled();
  expect(harness.navigate).not.toHaveBeenCalled();
});
it('refuses mismatched profile selection receipts and retains the accepted company for recovery', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path.includes('/pending')
        ? list()
        : path.endsWith('/accept')
          ? receipt()
          : json({ activeProfileId: 'wrong' })
    )
  );
  await mount();
  await click('Accept');
  await click('Open profile');
  expect(harness.refresh).not.toHaveBeenCalled();
  expect(harness.navigate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Chosen company');
  expect(button('Open profile').disabled).toBe(true);
  await click('Retry');
  expect(button('Open profile').disabled).toBe(false);
});
it('never reads invitations without an authenticated account', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  await mount(null);
  expect(f).not.toHaveBeenCalled();
  expect(container.childElementCount).toBe(0);
});

for (const status of [401, 403])
  it(`decision denial ${status} clears company details immediately`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => (path.includes('/pending') ? list() : json({}, status)))
    );
    await mount();
    await click('Accept');
    expect(container.textContent).not.toContain('Chosen company');
    expect(container.textContent).not.toContain('Actual Inviter');
    expect(harness.invalidate).not.toHaveBeenCalled();
  });
