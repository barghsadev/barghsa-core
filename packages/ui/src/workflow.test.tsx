import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AsyncView,
  DualStatusDisplay,
  FinancialReviewSummary,
  ProgressStepper,
  StatusBadge,
  StatusTimeline,
} from './components/ui/workflow';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Pagination } from './components/ui/pagination';
import { Button } from './components/ui/button';
import { Progress, ProgressTrack, ProgressIndicator } from './components/ui/progress';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('keeps valid zero data and chooses loading, error and empty states explicitly', async () => {
  const render = (loading: boolean, error: boolean, empty: boolean) =>
    act(async () =>
      root.render(
        <AsyncView
          loading={loading}
          error={error}
          empty={empty}
          loadingView="Loading"
          errorView="Retry"
          emptyView="No items"
        >
          {0}
        </AsyncView>
      )
    );
  await render(false, false, false);
  expect(host.textContent).toBe('0');
  await render(true, true, true);
  expect(host.textContent).toBe('Loading');
  await render(false, true, true);
  expect(host.textContent).toBe('Retry');
  await render(false, false, true);
  expect(host.textContent).toBe('No items');
});
it('pending buttons retain their label and suppress duplicate activation', async () => {
  const click = vi.fn();
  await act(async () =>
    root.render(
      <Button loading onClick={click}>
        Save
      </Button>
    )
  );
  const button = host.querySelector('button')!;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.textContent).toBe('Save');
  await act(async () => button.click());
  expect(click).not.toHaveBeenCalled();
});
it('renders one track with default or composed progress', async () => {
  await act(async () => root.render(<Progress value={50} aria-label="Upload" />));
  expect(host.querySelectorAll('[data-slot=progress-track]')).toHaveLength(1);
  await act(async () =>
    root.render(
      <Progress value={50} aria-label="Upload">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    )
  );
  expect(host.querySelectorAll('[data-slot=progress-track]')).toHaveLength(1);
});
it('keeps financial strings exact, without converting them to floating point', async () => {
  await act(async () =>
    root.render(
      <FinancialReviewSummary
        title="Review"
        rows={[{ id: 'source', label: 'Source', value: 'Wallet' }]}
        total={{ label: 'Total', value: '9,007,199,254,740,993 IRR' }}
      />
    )
  );
  expect(host.querySelectorAll('dd')[1]?.textContent).toBe('9,007,199,254,740,993 IRR');
});
it('exposes current step and readable status without relying on color', async () => {
  await act(async () =>
    root.render(
      <>
        <StatusBadge tone="warning" label="Awaiting review" />
        <ProgressStepper
          label="Order progress"
          steps={[{ id: 'review', label: 'Review', state: 'current', stateLabel: 'In progress' }]}
        />
      </>
    )
  );
  expect(host.textContent).toContain('Awaiting review');
  expect(host.querySelector('[aria-current=step]')?.textContent).toContain('Review');
});
it('connects completed, current and pending stages while preserving their details', async () => {
  await act(async () =>
    root.render(
      <ProgressStepper
        label="Fulfillment"
        steps={[
          {
            id: 'review',
            label: 'Review',
            state: 'complete',
            stateLabel: 'Completed',
            description: <time dateTime="2026-09-30">September 30</time>,
          },
          { id: 'delivery', label: 'Delivery', state: 'current', stateLabel: 'In progress' },
          { id: 'installation', label: 'Installation', state: 'pending', stateLabel: 'Pending' },
        ]}
      />
    )
  );
  const list = host.querySelector('ol[aria-label="Fulfillment"]');
  expect([...list!.querySelectorAll('li')].map((item) => item.dataset.state)).toEqual([
    'complete',
    'current',
    'pending',
  ]);
  expect(list?.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(5);
  expect(list?.querySelector('li[aria-current="step"]')?.textContent).toContain('In progress');
  expect(list?.querySelector('time[datetime="2026-09-30"]')?.textContent).toBe('September 30');
  expect(
    list?.querySelector('li[aria-current="step"] > span[aria-hidden="true"].rounded-full')
      ?.className
  ).toContain('bg-info-soft');
});
it('renders status history with localized dates, isolated actor names and literal notes', async () => {
  await act(async () =>
    root.render(
      <StatusTimeline
        label="تاریخچه"
        items={[
          {
            id: 'one',
            state: 'Submitted',
            title: 'ارسال شد',
            dateTime: '2026-10-01T00:00:00Z',
            dateLabel: '۹ مهر',
            actorLabel: 'مریم Example',
            description: '<script>alert(1)</script>',
          },
          {
            id: 'two',
            state: 'Rejected',
            title: 'رد شد',
            dateTime: '2026-10-02T00:00:00Z',
            dateLabel: '۱۰ مهر',
            description: <span>دلیل مشتری</span>,
          },
          {
            id: 'three',
            state: 'future_state',
            title: 'به‌روز شد',
            dateTime: '2026-10-03T00:00:00Z',
            dateLabel: '۱۱ مهر',
          },
        ]}
      />
    )
  );
  expect(host.querySelectorAll('ol[aria-label="تاریخچه"] > li')).toHaveLength(3);
  expect(
    [...host.querySelectorAll('[data-tone]')].map((node) => node.getAttribute('data-tone'))
  ).toEqual(['info', 'destructive', 'default']);
  expect(host.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-01T00:00:00Z');
  expect(host.querySelector('time')?.textContent).toBe('۹ مهر');
  expect(host.querySelector('bdi')?.textContent).toBe('مریم Example');
  expect(host.textContent).toContain('<script>alert(1)</script>');
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).not.toContain('future_state');
});
it('names commercial and financial states independently', async () => {
  await act(async () =>
    root.render(
      <DualStatusDisplay
        commercialLabel="Service"
        commercialStatus="Active"
        commercialTone="success"
        financialLabel="Payment"
        financialStatus="Unpaid"
        financialTone="warning"
      />
    )
  );
  expect([...host.querySelectorAll('dt')].map((item) => item.textContent)).toEqual([
    'Service',
    'Payment',
  ]);
  expect([...host.querySelectorAll('dd')].map((item) => item.textContent)).toEqual([
    'Active',
    'Unpaid',
  ]);
  expect(
    [...host.querySelectorAll('[data-slot="badge"]')].map((item) => item.getAttribute('title'))
  ).toEqual(['Service: Active', 'Payment: Unpaid']);
});

it.each([
  ['Pending', 'warning'],
  ['waiting_for_review', 'warning'],
  ['awaiting_staff_review', 'warning'],
  ['Active', 'success'],
  ['approved', 'success'],
  ['PAID', 'success'],
  ['signed', 'success'],
  ['Rejected', 'destructive'],
  ['cancelled', 'destructive'],
  ['FAILED', 'destructive'],
  ['Draft', 'info'],
  ['submitted', 'info'],
  ['Completed', 'default'],
  ['Resolved', 'default'],
  ['unpaid', 'warning'],
  ['payment_under_review', 'warning'],
  ['partially_funded', 'warning'],
  ['refund_pending', 'warning'],
  ['partially_refunded', 'warning'],
  ['future_paid_state', 'default'],
] as const)('renders %s with its intended color and a readable title', async (state, tone) => {
  await act(async () => root.render(<StatusBadge state={state} label="Localized status" />));
  const badge = host.querySelector('[data-slot="badge"]')!;
  expect(badge.getAttribute('data-variant')).toBe(tone);
  expect(badge.getAttribute('title')).toBe('Localized status');
  expect(badge.textContent).toBe('Localized status');
  expect(badge.textContent).not.toContain(state);
});
it.each(['default', 'dot'] as const)(
  'keeps the localized meaning in the %s display',
  async (variant) => {
    await act(async () =>
      root.render(
        <StatusBadge state="Pending" label="در انتظار بررسی" variant={variant} dot={false} />
      )
    );
    const badge = host.querySelector('[data-slot="badge"]')!;
    expect(badge.getAttribute('title')).toBe('در انتظار بررسی');
    expect(badge.textContent).toBe('در انتظار بررسی');
    expect(badge.querySelector('.sr-only') !== null).toBe(variant === 'dot');
    expect(badge.querySelector('[aria-hidden="true"]') !== null).toBe(variant === 'dot');
  }
);
it('retains explicit domain tones and title text instead of overriding them with a generic state', async () => {
  await act(async () =>
    root.render(
      <StatusBadge
        state="Completed"
        label="Receipt confirmed"
        tone="success"
        title="Verified bank deposit"
      />
    )
  );
  expect(host.querySelector('[data-slot="badge"]')?.getAttribute('data-variant')).toBe('success');
  expect(host.querySelector('[data-slot="badge"]')?.getAttribute('title')).toBe(
    'Verified bank deposit'
  );
});
it('requires exact phrase and resets on reopen', async () => {
  const confirm = vi.fn(),
    cancel = vi.fn();
  const render = (open: boolean, loading = false) =>
    act(async () =>
      root.render(
        <ConfirmDialog
          open={open}
          loading={loading}
          onConfirm={confirm}
          onCancel={cancel}
          title="Remove record"
          description="This cannot be undone."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          confirmation={{ phrase: 'REMOVE', label: 'Type REMOVE' }}
        />
      )
    );
  await render(true);
  const remove = () =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Remove')!;
  expect(remove().disabled).toBe(true);
  const input = document.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'REMOVE'
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(remove().disabled).toBe(false);
  await act(async () => remove().click());
  expect(confirm).toHaveBeenCalledTimes(1);
  await render(true, true);
  expect(remove().disabled).toBe(true);
  await render(false);
  await render(true);
  expect(remove().disabled).toBe(true);
});

it('bounds pagination and requests only valid pages', async () => {
  const change = vi.fn();
  const render = (page: number) =>
    act(async () =>
      root.render(
        <Pagination
          page={page}
          pageCount={1000}
          onPageChange={change}
          label="Pages"
          previousLabel="Previous"
          nextLabel="Next"
          pageLabel={(p) => `Page ${p}`}
        />
      )
    );
  await render(1);
  expect(host.querySelector<HTMLButtonElement>('[aria-label=Previous]')!.disabled).toBe(true);
  expect(host.querySelectorAll('button').length).toBeLessThanOrEqual(7);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label=Next]')!.click());
  expect(change).toHaveBeenLastCalledWith(2);
  await render(1000);
  expect(host.querySelector<HTMLButtonElement>('[aria-label=Next]')!.disabled).toBe(true);
});
