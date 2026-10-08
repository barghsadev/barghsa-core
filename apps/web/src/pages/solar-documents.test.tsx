import { QueryProvider, QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SolarRequestDetailPage } from './SolarRequestDetailPage.js';
import { tSolar } from '@barghsa/i18n/solar';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ requestId: 'request-1' }),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('../components/DocumentsWorkspace.js', () => ({
  DocumentResults: () => <div>File list</div>,
}));
afterEach(() => vi.unstubAllGlobals());

it.each(['en', 'fa'] as const)(
  'shows an unrecorded legacy address explicitly in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/user/settings/timezone')
          return Response.json({ timezone: 'Asia/Tehran' });
        if (url.endsWith('/documents'))
          return Response.json({
            guidance: { en: '', fa: '', suggestions: [] },
            requestedDocuments: [],
          });
        return Response.json({
          request: {
            id: 'request-1',
            profile_id: 'profile-1',
            status: 'cancelled',
            building_type: 'non_household',
            grid_type: 'off_grid',
            site_address: null,
            agreement_version: 'legacy-v1',
            agreement_snapshot: 'Legacy terms',
            agreement_accepted_at: '2020-01-01T00:00:00Z',
            submitted_at: '2020-01-01T00:00:00Z',
          },
        });
      })
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <QueryProvider>
            <SolarRequestDetailPage />
          </QueryProvider>
        )
      );
      expect(host.textContent).toContain(tSolar('addressNotRecorded', locale));
      expect([...host.querySelectorAll('dt')].map((node) => node.textContent)).toContain(
        tSolar('address', locale)
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);

it('allows an empty solar document set to be sent for review', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/user/settings/timezone') return Response.json({ timezone: 'Asia/Tehran' });
    if (url === '/api/solar/requests/request-1' && !options?.method)
      return new Response(
        JSON.stringify({
          request: {
            id: 'request-1',
            profile_id: 'profile-1',
            status: 'submitted',
            building_type: 'building_apartment',
            grid_type: 'off_grid',
            agreement_version: 'v1',
            agreement_snapshot: 'terms',
            agreement_accepted_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(),
          },
        })
      );
    if (url === '/api/solar/requests/request-1/documents' && !options?.method)
      return new Response(
        JSON.stringify({
          guidance: { fa: 'راهنما', en: 'Upload relevant files', suggestions: [] },
          requestedDocuments: [],
        })
      );
    if (url === '/api/solar/requests/request-1/documents/complete' && options?.method === 'POST')
      return new Response(JSON.stringify({ status: 'documents_under_review' }));
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <SolarRequestDetailPage />
        </QueryProvider>
      )
    );
    expect(container.textContent).toContain('Upload relevant files');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Send documents for review'
    )!;
    expect(button.disabled).toBe(true);
    await act(async () => checkbox.click());
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    const posted = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/solar/requests/request-1/documents/complete' && options?.method === 'POST'
    );
    expect(JSON.parse(posted![1]!.body as string)).toEqual({ allDocumentsUploaded: true });
    expect(container.textContent).toContain('Document set sent for review.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const solarDetail = (address = 'Private site') => ({
  request: {
    id: 'request-1',
    profile_id: 'profile-1',
    status: 'submitted',
    building_type: 'building_apartment',
    grid_type: 'off_grid',
    site_address: address,
    agreement_version: 'v1',
    agreement_snapshot: 'Accepted terms',
    agreement_accepted_at: '2026-10-01T10:00:00Z',
    submitted_at: '2026-10-01T10:00:00Z',
  },
});
const guidance = (text = 'Upload evidence') => ({
  guidance: { fa: text, en: text, suggestions: [] },
  requestedDocuments: [],
});
async function scopedSolar(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/user/settings/timezone'
      ? Promise.resolve(Response.json({ timezone: 'Asia/Tehran' }))
      : fetcher(url, init)
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  async function actor(id: string) {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <AccountUserProvider value={id}>
            <SolarRequestDetailPage />
          </AccountUserProvider>
        </QueryComponentProvider>
      )
    );
  }
  await actor('buyer');
  return {
    host,
    actor,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function solarButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  expect(button, label).toBeDefined();
  return button!;
}

it('keeps solar reads manual and cancels a pending detail transport on unmount', async () => {
  let finish!: (response: Response) => void, signal!: AbortSignal;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const view = await scopedSolar(fetcher);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);
  await view.close();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(Response.json(solarDetail())));
  expect(view.host.textContent).toBe('');
});

it('recovers solar detail by one explicit fresh read and refuses malformed identity', async () => {
  let value: unknown = { request: { ...solarDetail().request, id: 'other-request' } };
  const fetcher = vi.fn(async (url: string) =>
    Response.json(url.endsWith('/documents') ? guidance() : value)
  );
  const view = await scopedSolar(fetcher);
  try {
    expect(view.host.textContent).not.toContain('Private site');
    value = solarDetail();
    await act(async () => {
      solarButton(view.host, 'Try again').click();
      solarButton(view.host, 'Try again').click();
    });
    expect(fetcher.mock.calls.filter(([url]) => !url.endsWith('/documents'))).toHaveLength(2);
    expect(view.host.textContent).toContain('Private site');
    expect(view.host.textContent).toContain('Upload evidence');
  } finally {
    await view.close();
  }
});

it('recovers malformed document guidance locally without losing the upload confirmation or posting', async () => {
  let valid = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) throw new Error('Unexpected write');
    return Response.json(
      url.endsWith('/documents')
        ? valid
          ? guidance()
          : { guidance: null, requestedDocuments: [] }
        : solarDetail()
    );
  });
  const view = await scopedSolar(fetcher);
  try {
    const checkbox = view.host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    valid = true;
    await act(async () => {
      solarButton(view.host, 'Try again').click();
      solarButton(view.host, 'Try again').click();
    });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/documents'))).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([url]) => !url.endsWith('/documents'))).toHaveLength(1);
    expect(view.host.querySelector('input[type=checkbox]')).toBe(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(view.host.textContent).toContain('Upload evidence');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  } finally {
    await view.close();
  }
});

it('withdraws solar private detail after document read authority is lost', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/documents') ? new Response('{}', { status: 403 }) : Response.json(solarDetail())
  );
  const view = await scopedSolar(fetcher);
  try {
    expect(view.host.textContent).not.toContain('Private site');
    expect(view.host.textContent).not.toContain('Accepted terms');
    expect(view.host.querySelector('input[type=checkbox]')).toBeNull();
    expect(
      [...view.host.querySelectorAll('button')].some((b) => b.textContent === 'Try again')
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await view.close();
  }
});

it('cancels old account guidance and suppresses its late private reply without replacing the provider', async () => {
  let next = false,
    finish!: (response: Response) => void,
    signal!: AbortSignal;
  const view = await scopedSolar(async (url: string, init?: RequestInit) => {
    if (next) return new Response('{}', { status: 403 });
    if (url.endsWith('/documents')) {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json(solarDetail());
  });
  try {
    expect(view.host.textContent).toContain('Private site');
    next = true;
    await view.actor('other-buyer');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json(guidance('Late private guidance'))));
    expect(view.host.textContent).not.toContain('Private site');
    expect(view.host.textContent).not.toContain('Late private guidance');
    expect(view.host.querySelector('input[type=checkbox]')).toBeNull();
  } finally {
    await view.close();
  }
});

it('does not publish an old document submission into a replacement account view', async () => {
  let finish!: (response: Response) => void,
    next = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return Response.json(
      url.endsWith('/documents')
        ? guidance(next ? 'New guidance' : 'Old guidance')
        : solarDetail(next ? 'New site' : 'Old site')
    );
  });
  const view = await scopedSolar(fetcher);
  try {
    await act(async () =>
      view.host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
    );
    await act(async () => solarButton(view.host, 'Send documents for review').click());
    next = true;
    await view.actor('other-buyer');
    expect(view.host.textContent).toContain('New site');
    expect(view.host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
    await act(async () => finish(Response.json({ status: 'documents_under_review' })));
    expect(view.host.textContent).toContain('New guidance');
    expect(view.host.textContent).not.toContain('Document set sent for review.');
    expect(solarButton(view.host, 'Send documents for review').disabled).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  } finally {
    await view.close();
  }
});
