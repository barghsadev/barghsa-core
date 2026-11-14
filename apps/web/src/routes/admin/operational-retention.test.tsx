import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { defaultOperationalRetention } from '@barghsa/shared/admin';
import { Route } from './operational-retention.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { QueryComponentProvider } from '../../test/query-provider.js';

vi.mock('../../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));

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
    const Page = Route.options.component!;
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <Page />
        </QueryComponentProvider>
      )
    );
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLInputElement>('#retention-searchableLogsDays')?.value).toBe(
        '30'
      )
    );
    expect(host.querySelector('main#main-content')).toBeNull();
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
