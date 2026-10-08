import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import { t } from '@barghsa/i18n/crm';
import CrmProfileDetail from './CrmProfileDetail.js';
const profileId = '11111111-1111-4111-8111-111111111111';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'fa' }));
const pending = vi.hoisted(() => ({
  props: null as ComponentProps<typeof TeamActionDialog> | null,
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ profileId }),
  Link: ({ children }: { children: ReactNode }) => <a href="/admin/crm">{children}</a>,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => language.value }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String, money: String, number: String }),
}));
vi.mock('../components/CrmProfileRecords.js', () => ({ CrmProfileRecords: () => null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    pending.props = props;
    return <p>Captured CRM action</p>;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  pending.props = null;
  language.value = 'en';
});
function detail(title = 'Private customer') {
  return {
    profile: {
      id: profileId,
      isDefault: true,
      archived: false,
      archivedAt: null,
      archivedReason: null,
      profileType: 'INDIVIDUAL',
      status: 'ACTIVE',
      title,
      contactEmail: 'office@example.test',
      contactMobile: '+989121234567',
      firstName: 'Example',
      lastName: 'Customer',
      nationalId: null,
      createdAt: '2026-08-01T01:00:00Z',
      updatedAt: '2026-08-01T01:00:00Z',
    },
    user: {
      userId: 'customer',
      username: 'customer@example.test',
      email: 'signin@example.test',
      mobile: '+989121234568',
      lastLogin: null,
      lastPasswordChange: '2026-08-02T01:00:00Z',
      isAdmin: false,
      createdAt: '2026-08-01T01:00:00Z',
    },
    viewerPermissions: { canEdit: true, canVerify: true, canManageUser: true },
    legalInfo: null,
    addresses: [],
    sessions: { count: 0, lastActive: null, entries: [] },
    siblingProfiles: [],
  };
}
async function mount(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  vi.stubGlobal('fetch', vi.fn(handler));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (actor = 'staff-one', visible = true) =>
    act(async () =>
      root.render(
        <QueryComponentProvider>
          <AccountUserProvider value={actor}>
            {visible ? <CrmProfileDetail /> : null}
          </AccountUserProvider>
        </QueryComponentProvider>
      )
    );
  await render();
  return {
    host,
    render,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function queued(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => button(view.host, t('crm.profile.edit', 'en')).click());
  await act(async () => button(view.host, t('crm.profile.edit.save', 'en')).click());
  expect(pending.props?.action).toBeDefined();
  const props = pending.props!;
  const body = props.action!.body as Record<string, unknown>;
  return {
    props,
    ack: {
      updated: true,
      profile: {
        id: profileId,
        title: body.title,
        contactEmail: body.email,
        contactMobile: body.mobile,
        updatedAt: '2026-10-09T01:00:00Z',
      },
    },
  };
}
it('keeps CRM profile reads manual and cancels when only the page is unmounted', async () => {
  let signal!: AbortSignal, finish!: (response: Response) => void;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const view = await mount(fetcher);
  try {
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    await view.render('staff-one', false);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json(detail())));
    expect(view.host.textContent).toBe('');
  } finally {
    await view.close();
  }
});
it('refuses a mismatched CRM profile and accepts only a fresh explicit retry', async () => {
  let valid = false;
  const fetcher = vi.fn(async () =>
    Response.json(
      valid ? detail() : { ...detail(), profile: { ...detail().profile, id: 'other-profile' } }
    )
  );
  const view = await mount(fetcher);
  try {
    expect(view.host.textContent).not.toContain('customer@example.test');
    expect(view.host.textContent).toContain(t('crm.profile.error.generic', 'en'));
    valid = true;
    await act(async () => button(view.host, t('crm.records.retry', 'en')).click());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.host.textContent).toContain('customer@example.test');
  } finally {
    await view.close();
  }
});
it('cancels old CRM account reads and suppresses late private data with the provider retained', async () => {
  let next = false,
    signal!: AbortSignal,
    finish!: (response: Response) => void;
  const view = await mount(async (_url, init) => {
    if (next) return new Response('{}', { status: 403 });
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  try {
    next = true;
    await view.render('staff-two');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json(detail())));
    expect(view.host.textContent).not.toContain('customer@example.test');
    expect(view.host.textContent).toContain(t('crm.profile.error.accessDenied', 'en'));
    expect(
      [...view.host.querySelectorAll('button')].some(
        (b) => b.textContent === t('crm.profile.edit', 'en')
      )
    ).toBe(false);
  } finally {
    await view.close();
  }
});
it('retains committed CRM success through a failed post-action read and healthy retry', async () => {
  let failed = false;
  const fetcher = vi.fn(async () =>
    failed ? new Response('{}', { status: 503 }) : Response.json(detail())
  );
  const view = await mount(fetcher);
  try {
    const { props, ack } = await queued(view);
    failed = true;
    await act(async () => props.onSuccess(ack));
    expect(view.host.textContent).toContain(t('crm.profile.error.generic', 'en'));
    failed = false;
    await act(async () => button(view.host, t('crm.records.retry', 'en')).click());
    expect(view.host.textContent).toContain(t('crm.profile.edit.saved', 'en'));
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    await view.close();
  }
});
it('cancels an old post-action CRM read without changing the replacement staff view', async () => {
  let phase = 'initial',
    signal!: AbortSignal,
    finish!: (response: Response) => void;
  const view = await mount(async (_url, init) => {
    if (phase === 'pending') {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json(detail(phase === 'initial' ? 'Old private title' : 'Fresh staff title'));
  });
  try {
    const { props, ack } = await queued(view);
    phase = 'pending';
    let settled!: Promise<void>;
    await act(async () => {
      settled = props.onSuccess(ack);
    });
    phase = 'fresh';
    await view.render('staff-two');
    expect(signal.aborted).toBe(true);
    await act(async () => button(view.host, t('crm.profile.tab.details', 'en')).click());
    await act(async () => {
      finish(Response.json(detail('Late old title')));
      await settled;
    });
    expect(view.host.textContent).toContain('Fresh staff title');
    expect(view.host.textContent).not.toContain('Late old title');
    expect(view.host.textContent).not.toContain(t('crm.profile.edit.saved', 'en'));
  } finally {
    await view.close();
  }
});

it('finishes loading when a current post-action read supersedes an in-flight locale refresh', async () => {
  let reads = 0,
    signal!: AbortSignal,
    finish!: (response: Response) => void;
  const view = await mount(async (_url, init) => {
    if (++reads === 2) {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json(detail());
  });
  try {
    const { props, ack } = await queued(view);
    language.value = 'fa';
    await view.render();
    await act(async () => props.onSuccess(ack));
    expect(signal.aborted).toBe(true);
    expect(view.host.textContent).toContain('customer@example.test');
    await act(async () => finish(Response.json(detail('Obsolete locale read'))));
    expect(view.host.textContent).toContain('customer@example.test');
    expect(reads).toBe(3);
  } finally {
    await view.close();
  }
});
