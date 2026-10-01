import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Settings } from 'lucide-react';
import { AdminSettingsLayout } from './AdminSettingsLayout.js';
import {
  ADMIN_SETTINGS_SECTIONS,
  activeAdminSettingsPath,
  adminSettingsGroups,
} from '../lib/admin-settings-navigation.js';
const router = vi.hoisted(() => ({
  path: '/admin/contract-limits',
  navigate: vi.fn(async () => {}),
}));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: router.path }),
  useNavigate: () => router.navigate,
  Link: ({ to, children, ...props }: Omit<ComponentProps<'a'>, 'href'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router.path = '/admin/contract-limits';
  router.navigate.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const offered = [
  {
    label: 'Workspace',
    items: [
      { to: '/admin/contract-limits', label: 'Limits', icon: Settings },
      { to: '/admin/electricity-rules', label: 'Green electricity', icon: Settings },
      { to: '/admin/verification', label: 'Verification', icon: Settings },
      { to: '/admin/invoices', label: 'Operational invoices', icon: Settings },
    ],
  },
];
const render = async (locale: 'fa' | 'en' = 'en') =>
  act(async () =>
    root.render(
      <AdminSettingsLayout groups={offered} locale={locale}>
        <h1>Existing page</h1>
      </AdminSettingsLayout>
    )
  );
it('groups only offered configuration links, preserving route labels and icons', () => {
  expect(adminSettingsGroups(offered, 'en')).toEqual([
    { label: 'Electricity', items: offered[0]!.items.slice(0, 2).reverse() },
    { label: 'Security', items: [offered[0]!.items[2]] },
  ]);
  expect(ADMIN_SETTINGS_SECTIONS).toHaveLength(12);
});
it.each([
  '/admin/invoices',
  '/admin/tickets',
  '/admin/contracts',
  '/admin/roles-not-real',
  '/settings/security',
])('keeps normal workspace content for %s', async (path) => {
  router.path = path;
  await render();
  expect(host.textContent).toBe('Existing page');
  expect(activeAdminSettingsPath(path)).toBeNull();
  expect(host.querySelector('nav')).toBeNull();
});
it('selects the matching configuration ancestor without accepting a partial segment', async () => {
  router.path = '/admin/contract-limits/details';
  await render();
  expect(activeAdminSettingsPath(router.path)).toBe('/admin/contract-limits');
  expect(host.querySelector('a[aria-current=page]')?.getAttribute('href')).toBe(
    '/admin/contract-limits'
  );
  expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('/admin/contract-limits');
});
it('rejects an injected destination and focuses new content after valid section navigation', async () => {
  await render();
  const select = host.querySelector<HTMLSelectElement>('select')!;
  const option = new Option('Unsafe', 'https://foreign.test');
  select.append(option);
  select.value = option.value;
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
  expect(router.navigate).not.toHaveBeenCalled();
  select.value = '/admin/verification';
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
  expect(router.navigate).toHaveBeenCalledWith({ to: '/admin/verification' });
  router.path = '/admin/verification';
  await render();
  expect(document.activeElement).toBe(host.querySelector('[role=region]'));
});
it('offers the same destinations with Persian category labels and omits unavailable roles', async () => {
  await render('fa');
  expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('بخش تنظیمات');
  expect(host.querySelectorAll('optgroup')).toHaveLength(2);
  expect([...host.querySelectorAll('option')].map((option) => option.value)).toEqual([
    '/admin/electricity-rules',
    '/admin/contract-limits',
    '/admin/verification',
  ]);
  expect(host.querySelector('a[href="/admin/roles"]')).toBeNull();
});
