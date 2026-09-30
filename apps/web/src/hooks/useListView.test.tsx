import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListViewToggle } from '@barghsa/ui';
import { AccountUserProvider } from './useAccountUser.js';
import { useListView } from './useListView.js';

let root: Root;
let container: HTMLDivElement;
let desktop = true;
const mediaListeners = new Set<() => void>();
function Example({
  user = 'first',
  history = 'invoices',
}: {
  user?: string | null;
  history?: string;
}) {
  return (
    <AccountUserProvider value={user}>
      <View history={history} />
    </AccountUserProvider>
  );
}
function View({ history }: { history: string }) {
  const { view, setView } = useListView(history);
  return (
    <ListViewToggle
      value={view}
      onChange={setView}
      labels={{ group: 'List display', table: 'Table', card: 'Cards' }}
    />
  );
}
const selected = () => container.querySelector('[aria-pressed="true"]')?.textContent;
async function choose(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label
  )!;
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  desktop = true;
  localStorage.clear();
  mediaListeners.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return desktop;
    },
    addEventListener: (_event: string, callback: () => void) => mediaListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => mediaListeners.delete(callback),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('follows the viewport default until explicitly chosen, without writing a default', async () => {
  await act(async () => root.render(<Example />));
  expect(selected()).toBe('Table');
  expect(localStorage.length).toBe(0);
  await act(async () => {
    desktop = false;
    mediaListeners.forEach((listener) => listener());
  });
  expect(selected()).toBe('Cards');
  await choose('Table');
  await act(async () => {
    desktop = true;
    mediaListeners.forEach((listener) => listener());
    desktop = false;
    mediaListeners.forEach((listener) => listener());
  });
  expect(selected()).toBe('Table');
  expect(localStorage.getItem('barghsa.list-view:first:invoices')).toBe('table');
  expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'List display'
  );
});

it('restores preferences on remount while isolating accounts and histories', async () => {
  await act(async () => root.render(<Example />));
  await choose('Cards');
  await act(async () => root.render(<Example user="second" />));
  expect(selected()).toBe('Table');
  await act(async () => root.render(<Example user="first" history="contracts" />));
  expect(selected()).toBe('Table');
  await act(async () => root.render(<Example key="new-mount" user="first" />));
  expect(selected()).toBe('Cards');
  expect(localStorage.getItem('barghsa.list-view:second:invoices')).toBeNull();
});

it('ignores invalid preferences and responds to another tab updating or clearing storage', async () => {
  localStorage.setItem('barghsa.list-view:first:invoices', 'invalid');
  await act(async () => root.render(<Example />));
  expect(selected()).toBe('Table');
  await act(async () => {
    localStorage.setItem('barghsa.list-view:first:invoices', 'card');
    window.dispatchEvent(new StorageEvent('storage'));
  });
  expect(selected()).toBe('Cards');
  await act(async () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage'));
  });
  expect(selected()).toBe('Table');
});

it('keeps switching usable if storage is blocked and isolates the temporary choice', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  await act(async () => root.render(<Example />));
  await choose('Cards');
  expect(selected()).toBe('Cards');
  await act(async () => root.render(<Example user="second" />));
  expect(selected()).toBe('Table');
});

it('does not store anonymous choices or apply them to an authenticated account', async () => {
  await act(async () => root.render(<Example user={null} />));
  await choose('Cards');
  expect(localStorage.length).toBe(0);
  await act(async () => root.render(<Example user={null} history="contracts" />));
  expect(selected()).toBe('Table');
  await act(async () => root.render(<Example user="first" />));
  expect(selected()).toBe('Table');
});
