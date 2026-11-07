import '@testing-library/jest-dom/vitest';
import { within } from '@testing-library/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmptyState, ErrorBoundary, ErrorState, PageLoading } from './components/ui/page-states';

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

it('exposes only a safe support code and opaque reference in collapsed details', async () => {
  await act(async () =>
    root.render(
      <ErrorState
        {...labels}
        onRetry={() => {}}
        details={{
          label: 'Support details',
          code: 'ROUTE_RENDER_FAILED',
          referenceLabel: 'Reference',
          reference: '10000000-0000-4000-8000-000000000001',
        }}
      />
    )
  );
  const details = container.querySelector('details');
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(details?.querySelector('summary')?.textContent).toBe('Support details');
  expect(details?.textContent).toContain('ROUTE_RENDER_FAILED');
  expect(details?.textContent).toContain('10000000-0000-4000-8000-000000000001');
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  const alert = within(container).getByRole('alert');
  expect(within(alert).getByRole('heading', { name: labels.title })).toBeInTheDocument();
  expect(within(alert).getByRole('button', { name: labels.retryLabel })).toBeInTheDocument();
});

it.each(['private SQL password', 'x'.repeat(81)])(
  'refuses unsafe diagnostic details: %s',
  async (code) => {
    await act(async () =>
      root.render(
        <ErrorState
          {...labels}
          onRetry={() => {}}
          details={{
            label: 'Support details',
            code,
            referenceLabel: 'Reference',
            reference: 'safe-reference',
          }}
        />
      )
    );
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain(code);
    expect(container.querySelector('button')?.textContent).toBe('Retry');
  }
);
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
    expect(within(container).getByRole('status', { name: label })).toBeInTheDocument();
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(label);
    const skeletons = [...container.querySelectorAll('[data-slot="skeleton"]')];
    expect(skeletons).toHaveLength(3);
    expect(skeletons.every((node) => node.closest('[aria-hidden="true"]'))).toBe(true);
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
  expect(
    within(container).getByRole('heading', { name: 'فاکتوری وجود ندارد', level: 2 })
  ).toBeInTheDocument();
  expect(within(container).getByRole('button', { name: 'خرید برق' })).toBeInTheDocument();
  expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
  await act(async () => container.querySelector('button')!.click());
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<EmptyState title="No invoices" description="Invoices appear after purchase." />)
  );
  expect(container.querySelector('button')).toBeNull();
  expect(container.querySelector('[data-slot="empty-icon"]')).toBeNull();
});
