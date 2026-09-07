import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmptyState, ErrorBoundary, PageLoading } from './components/ui/page-states';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const labels = {
  title: 'Something went wrong',
  description: 'Please try again.',
  retryLabel: 'Retry',
  supportContact: <a href="mailto:support@example.com">Support</a>,
};
function Fragile({ broken }: { broken: boolean }) {
  if (broken) throw new Error('private database connection details');
  return <p>Recovered content</p>;
}

it('contains a rendering failure, hides private details and retries the child', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let broken = true;
  const onError = vi.fn();
  const onReset = vi.fn(() => {
    broken = false;
  });
  function Child() {
    return <Fragile broken={broken} />;
  }
  await act(async () =>
    root.render(
      <ErrorBoundary {...labels} onError={onError} onReset={onReset}>
        <Child />
      </ErrorBoundary>
    )
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(labels.title);
  expect(container.textContent).not.toContain('private database');
  expect(container.querySelector('a')?.href).toBe('mailto:support@example.com');
  expect(onError).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector('button')!.click());
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('Recovered content');
});

it('does not retry a broken resource on unrelated renders and recovers when its key changes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const onError = vi.fn();
  const render = (resetKey: string, broken: boolean) =>
    act(async () =>
      root.render(
        <ErrorBoundary {...labels} onError={onError} resetKey={resetKey}>
          <Fragile broken={broken} />
        </ErrorBoundary>
      )
    );
  await render('one', true);
  await render('one', false);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(onError).toHaveBeenCalledTimes(1);
  await render('two', false);
  expect(container.textContent).toBe('Recovered content');
});

it('keeps a persistent failure recoverable without an automatic retry loop', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const onError = vi.fn();
  await act(async () =>
    root.render(
      <ErrorBoundary {...labels} onError={onError}>
        <Fragile broken />
      </ErrorBoundary>
    )
  );
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(onError).toHaveBeenCalledTimes(2);
});

it.each(['Loading page', 'در حال بارگذاری صفحه'])(
  'announces %s with hidden decorative skeletons',
  async (label) => {
    await act(async () => root.render(<PageLoading label={label} />));
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(label);
    const skeletons = [...container.querySelectorAll('[data-slot="skeleton"]')];
    expect(skeletons).toHaveLength(3);
    expect(skeletons.every((node) => node.closest('[aria-hidden="true"]'))).toBe(true);
    expect(skeletons.every((node) => node.classList.contains('motion-safe:animate-pulse'))).toBe(
      true
    );
  }
);

it('shows actionable empty-state guidance in RTL and keeps decorative icons out of announcements', async () => {
  const action = vi.fn();
  await act(async () =>
    root.render(
      <div dir="rtl">
        <EmptyState
          title="فاکتوری وجود ندارد"
          description="پس از ثبت خرید، فاکتور اینجا نمایش داده می‌شود."
          icon={<svg />}
          action={<button onClick={action}>خرید برق</button>}
        />
      </div>
    )
  );
  expect(container.querySelector('h2')?.textContent).toBe('فاکتوری وجود ندارد');
  expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
  await act(async () => container.querySelector('button')!.click());
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<EmptyState title="No invoices" description="Invoices appear after purchase." />)
  );
  expect(container.querySelector('button')).toBeNull();
  expect(container.querySelector('[data-slot="empty-icon"]')).toBeNull();
});
