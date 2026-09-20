import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AsyncView,
  FinancialReviewSummary,
  ProgressStepper,
  StatusBadge,
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
