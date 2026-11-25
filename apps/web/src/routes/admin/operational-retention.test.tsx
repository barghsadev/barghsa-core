import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { defaultOperationalRetention } from '@barghsa/shared/admin';
import { Route } from './operational-retention.js';
import Retention from '../../pages/AdminOperationalRetentionPage.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { QueryComponentProvider } from '../../test/query-provider.js';

vi.mock('../../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    params,
    children,
    ...props
  }: ComponentProps<'a'> & { to: string; params?: { view: string } }) => (
    <a {...props} href={params ? to.replace('$view', params.view) : to}>
      {children}
    </a>
  ),
}));

it('loads the admin retention page and provides an accessible pending fallback', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        version: 0,
        policy: defaultOperationalRetention,
        canEdit: true,
      })
    )
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    const Pending = Route.options.pendingComponent!;
    expect(Route.options.errorComponent).toBe(RouteErrorBoundary);
    await act(async () => root.render(<Pending />));
    expect(host.querySelector('main#main-content')).not.toBeNull();
    const heading = host.querySelector('h1')?.textContent;
    expect(heading).toBeTruthy();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(heading);
    expect(Route.options.component).toBeDefined();
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <Retention view="overview" />
        </QueryComponentProvider>
      )
    );
    await vi.waitFor(() => expect(host.querySelector('dl')?.textContent).toContain('30 days'));
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('a[href="/admin/operational-retention/edit"]')).not.toBeNull();
    expect(host.querySelector('main#main-content')).toBeNull();
    expect(host.querySelector('a[href="/admin/operational-retention/history"]')).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/config/operational-retention',
      expect.objectContaining({ credentials: 'include' })
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
