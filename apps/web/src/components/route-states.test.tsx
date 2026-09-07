import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RouteSkeleton, RouteSpinner } from './RouteSkeleton.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
let container: HTMLDivElement;
let root: Root;
let language: string;
beforeEach(() => {
  language = document.documentElement.lang;
  document.documentElement.lang = 'fa';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.lang = language;
  vi.unstubAllGlobals();
});

it.each([
  { name: 'page', element: <RouteSkeleton />, fa: 'در حال بارگذاری صفحه', en: 'Loading page' },
  {
    name: 'admin',
    element: <RouteSkeleton layout="admin" />,
    fa: 'در حال بارگذاری پنل مدیریت',
    en: 'Loading admin dashboard',
  },
  { name: 'spinner', element: <RouteSpinner />, fa: 'در حال بارگذاری صفحه', en: 'Loading page' },
])(
  'localizes the $name loading announcement live without requiring matchMedia',
  async ({ element, fa, en }) => {
    vi.stubGlobal('matchMedia', undefined);
    await act(async () => root.render(element));
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(fa);
    await act(async () => {
      document.documentElement.lang = 'en';
    });
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(en);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  }
);

it.each([
  { error: new Error('private SQL password'), title: 'Something went wrong' },
  {
    error: new TypeError('Failed to fetch dynamically imported module'),
    title: 'Failed to load this page',
  },
  { error: new TypeError('module loading failed'), title: 'Failed to load this page' },
  { error: new TypeError('ChunkLoadError'), title: 'Failed to load this page' },
  { error: new TypeError('private SQL password'), title: 'Something went wrong' },
])('offers safe localized recovery for $error', async ({ error, title }) => {
  const reset = vi.fn();
  await act(async () => root.render(<RouteErrorBoundary error={error} reset={reset} />));
  expect(container.textContent).toContain('تلاش دوباره');
  expect(container.textContent).not.toContain(error.message);
  await act(async () => {
    document.documentElement.lang = 'en';
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(title);
  expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
    '/support',
    '/',
  ]);
  await act(async () => container.querySelector('button')!.click());
  expect(reset).toHaveBeenCalledTimes(1);
});
