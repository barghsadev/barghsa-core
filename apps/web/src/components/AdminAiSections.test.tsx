import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminAiSections from './AdminAiSections.js';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';

const router = vi.hoisted(() => ({
  path: '/admin/agents',
  navigate: vi.fn(async () => {}),
  paths: ['/admin/agents', '/admin/policies'] as string[],
  area: 'staff',
}));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: router.path }),
  useNavigate: () => router.navigate,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNavigation.js', () => ({
  useNavigation: () => ({ area: router.area, paths: router.paths }),
}));
let host: HTMLDivElement, root: Root;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const originalAnimations = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getAnimations');
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router.path = '/admin/agents';
  router.paths = ['/admin/agents', '/admin/policies'];
  router.area = 'staff';
  router.navigate.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (originalScroll)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  if (originalAnimations)
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', originalAnimations);
  else Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
});
const render = (section = router.path) =>
  act(async () =>
    root.render(
      <AdminAiSections section={section}>
        <h1>Existing page</h1>
      </AdminAiSections>
    )
  );

it('offers only granted AI tabs and selects a page only after route confirmation', async () => {
  await render();
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  expect(tabs.map((node) => node.textContent)).toEqual([
    t('admin.policies.title', 'en'),
    t('admin.agents.title', 'en'),
  ]);
  expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(
    t('admin.agents.title', 'en')
  );
  expect(host.querySelectorAll('[role=tabpanel]:not([hidden])')).toHaveLength(1);
  expect(host.querySelector('[role=tabpanel]:not([hidden])')?.textContent).toBe('Existing page');
  await act(async () => tabs[0]!.click());
  expect(router.navigate).toHaveBeenCalledWith({ to: '/admin/policies' });
  expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(
    t('admin.agents.title', 'en')
  );
  router.path = '/admin/policies';
  await render('/admin/agents');
  expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(
    t('admin.agents.title', 'en')
  );
  await render();
  expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(
    t('admin.policies.title', 'en')
  );
  expect(document.activeElement).toBe(host.querySelector('[role=tab][aria-selected=true]'));
});
it.each(['customer', 'unavailable'])(
  'does not invent navigation outside current staff grants: %s',
  async (area) => {
    router.area = area;
    await render();
    expect(host.querySelector('[role=tablist]')).toBeNull();
    expect(host.textContent).toBe('Existing page');
    expect(router.navigate).not.toHaveBeenCalled();
  }
);
