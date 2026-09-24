import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SavingOrdersPage } from './SavingOrdersPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: { status?: string };
    className?: string;
  }) => (
    <a href={search?.status ? `${to}?status=${search.status}` : to} className={className}>
      {children}
    </a>
  ),
}));

it('requests pending saving orders and offers the full list', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(async (url: string) =>
    Response.json(
      url === '/api/profiles'
        ? { activeProfileId: 'profile-1' }
        : url === '/api/user/settings/timezone'
          ? { timezone: 'Asia/Tehran' }
          : { orders: [], nextBefore: null }
    )
  );
  vi.stubGlobal('fetch', request);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SavingOrdersPage pendingOnly />));
    expect(request).toHaveBeenCalledWith(
      '/api/saving/orders?profileId=profile-1&status=pending',
      expect.any(Object)
    );
    expect(container.textContent).toContain('No saving orders in progress');
    expect(container.querySelector('a[href="/savings/orders"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
