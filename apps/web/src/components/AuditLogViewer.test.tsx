import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuditLogViewer } from './AuditLogViewer.js';
import { configAuditPage, configAuditCursor } from '../test/config-audit-fixtures.js';
import type { ConfigAuditScope } from '@barghsa/shared/admin';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { NavigationProvider } from '../hooks/useNavigation.js';
import { getProfileContextRevision } from '../lib/profile-context.js';
import AdminAuthorizationAudit from '../pages/AdminAuthorizationAudit.js';
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
let host: HTMLDivElement, root: Root, status: number, data: unknown;
const calls: string[] = [];
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  status = 200;
  data = configAuditPage();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return Response.json(data, { status });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
async function render(scope: ConfigAuditScope = 'otp', refreshKey = 0, onDenied?: () => void) {
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AuditLogViewer
            scope={scope}
            refreshKey={refreshKey}
            {...(onDenied ? { onDenied } : {})}
          />
        }
      </QueryProvider>
    )
  );
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
it('loads on demand and exposes expandable field values, date and author without HTML execution', async () => {
  data = configAuditPage('branding');
  await render('branding');
  expect(calls).toEqual([]);
  await click('View changes');
  expect(calls).toEqual(['/api/admin/config/audit?scope=branding']);
  expect(host.textContent).toContain('staff-auditor');
  const details = host.querySelector('details')!;
  expect(details.open).toBe(false);
  details.open = true;
  expect(host.textContent).toContain('<script>Reviewed title</script>');
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('Old title');
  expect(host.querySelector('time')?.dateTime).toBe('2026-09-30T12:00:00.000001Z');
});
it('shows denial fields and clears them when the dashboard grant is withdrawn', async () => {
  const fixture = configAuditPage();
  const details = {
    resource: '/api/admin/config/audit',
    action: 'GET',
    reason: 'AUTHZ:FORBIDDEN',
    correlationId: '01900000-0000-7000-8000-000000000003',
  };
  data = {
    scope: 'authorization',
    nextCursor: null,
    items: [
      {
        ...fixture.items[0]!,
        event: 'authorization_denied',
        version: null,
        changes: Object.entries(details).map(([field, value]) => ({
          field,
          previous: { recorded: false, value: null },
          current: { recorded: true, value },
        })),
      },
    ],
  };
  await render('authorization');
  await click('View denials');
  expect(calls).toEqual(['/api/admin/config/audit?scope=authorization']);
  expect(host.querySelector('summary')?.textContent).toContain('Access denied');
  const row = host.querySelector('details')!;
  row.open = true;
  for (const value of Object.values(details)) expect(row.textContent).toContain(value);
  expect(row.querySelector('time')?.dateTime).toBe(fixture.items[0]!.createdAt);
  status = 403;
  await click('Refresh denials');
  expect(host.textContent).toContain('You do not have access to authorization denials.');
  expect(host.querySelector('details')).toBeNull();
});
it('discards an open authorization audit on account or navigation authority changes', async () => {
  const renderPage = async (account: string, paths: string[]) =>
    act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value={account}>
            <NavigationProvider
              revision={getProfileContextRevision()}
              configuration={{
                version: 1,
                area: 'staff',
                profileId: null,
                profileType: null,
                paths,
              }}
            >
              <AdminAuthorizationAudit />
            </NavigationProvider>
          </AccountUserProvider>
        </QueryProvider>
      )
    );
  const path = '/admin/authorization-audit';
  data = { scope: 'authorization', nextCursor: null, items: [] };
  await renderPage('first-admin', [path]);
  await click('View denials');
  expect(host.textContent).toContain('No authorization denials recorded.');
  await renderPage('second-admin', [path]);
  expect(host.textContent).not.toContain('No authorization denials recorded.');
  expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
  expect(calls).toHaveLength(1);
  await renderPage('second-admin', []);
  expect(host.querySelector('button[aria-expanded]')).toBeNull();
  expect(host.textContent).toContain('You do not have access to authorization denials.');
});
it('keeps entries and expansion during failed refresh, retries and replaces rather than appending the first page', async () => {
  await render();
  await click('View changes');
  host.querySelector('details')!.open = true;
  status = 503;
  await click('Refresh changes');
  expect(host.querySelector('details')?.open).toBe(true);
  expect(host.textContent).toContain('600');
  status = 200;
  data = { ...configAuditPage(), nextCursor: null };
  await click('Try changes again');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  expect(host.querySelector('details')?.open).toBe(true);
});
it('retries only a failed cursor, deduplicates overlap and stops cursor cycles', async () => {
  await render();
  await click('View changes');
  status = 503;
  await click('Older changes');
  const failed = calls.at(-1)!;
  expect(failed).toContain(`cursor=${configAuditCursor}`);
  status = 200;
  data = {
    ...configAuditPage(),
    items: [
      ...configAuditPage().items,
      { ...configAuditPage().items[0]!, id: '01900000-0000-7000-8000-000000000002' },
    ],
  };
  await click('Try changes again');
  expect(calls.at(-1)).toBe(failed);
  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.textContent).toContain('Could not load changes');
  expect(host.textContent).not.toContain('Older changes');
});
it.each([
  {},
  { ...configAuditPage(), scope: 'branding' },
  {
    ...configAuditPage(),
    items: [
      {
        ...configAuditPage().items[0],
        changes: [
          {
            field: 'password',
            previous: { recorded: true, value: 'private' },
            current: { recorded: true, value: 'private' },
          },
        ],
      },
    ],
  },
])('rejects malformed or foreign-scope pages without replacing accepted rows %#', async (raw) => {
  await render();
  await click('View changes');
  data = raw;
  await click('Refresh changes');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  expect(host.textContent).not.toContain('private');
  expect(host.textContent).toContain('Could not load changes');
});
it('clears entries on denial and ignores a racing older request after a scope change', async () => {
  const denial = vi.fn();
  await render('otp', 0, denial);
  await click('View changes');
  status = 403;
  await click('Refresh changes');
  expect(denial).toHaveBeenCalledOnce();
  expect(host.querySelector('li')).toBeNull();
  expect(host.textContent).not.toContain('staff-auditor');
  status = 200;
  await click('Try changes again');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  await click('Refresh changes');
  await render('branding');
  await act(async () => finish!(Response.json(configAuditPage())));
  expect(host.textContent).not.toContain('staff-auditor');
  expect(host.querySelector('li')).toBeNull();
});
it('refreshes open history after verified save revisions and distinguishes missing values from null', async () => {
  data = {
    ...configAuditPage(),
    items: [
      {
        ...configAuditPage().items[0],
        changes: [
          {
            field: 'ttlSeconds',
            previous: { recorded: false, value: null },
            current: { recorded: true, value: null },
          },
        ],
      },
    ],
  };
  await render();
  await click('View changes');
  expect(host.textContent).toContain('Not recorded');
  expect(host.textContent).toContain('None');
  const before = calls.length;
  await render('otp', 1);
  expect(calls).toHaveLength(before + 1);
});
