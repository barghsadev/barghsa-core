import { QueryProvider } from '../test/query-provider.js';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContractCancellationRequestQueue } from './ContractCancellationRequestQueue.js';
import { ContractRefundQueue } from './ContractRefundQueue.js';
import { AdminApprovalRequestsView } from '../pages/AdminApprovalRequestsPage.js';
import type { TeamAction } from './TeamActionDialog.js';
import { en } from '@barghsa/i18n/contracts';
import { refundDecisionReviewFixture } from '../test/refund-review-fixtures.js';
import {
  cancellationRow,
  obligationRow,
  approvalRow,
  financeCursor,
} from '../test/contract-finance-list-fixtures.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/admin/approval-requests">{children}</a>
  ),
}));
vi.mock('./DualApprovalThresholdPanel.js', () => ({ default: () => null }));
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as (() => Promise<void>) | null,
  changed: null as (() => void) | null,
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
  }: {
    action: TeamAction;
    onSuccess: () => Promise<void>;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    return (
      <div role="dialog" aria-label="Confirmation">
        {action.path}
      </div>
    );
  },
}));
vi.mock('./ContractDetail.js', () => ({
  ContractDetail: ({ id, onChanged }: { id: string; onChanged: () => void }) => {
    const [draft, setDraft] = useState('');
    captured.changed = onChanged;
    return (
      <section aria-label="Contract detail">
        {id}
        <label htmlFor="detail-draft">Review draft</label>
        <input id="detail-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </section>
    );
  },
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  captured.action = null;
  captured.success = null;
  captured.changed = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  if (label === en['cancellation.queue.record-transfer'])
    await vi.waitFor(() => expect(container.querySelector('[role=dialog]')).not.toBeNull());
}
async function set(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `#${id}`
  )!;
  expect(input).not.toBeNull();
  await act(async () => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('cancellation retry preserves selected detail and exact cursor without rereading or remounting work', async () => {
  let status = 200;
  const fetcher = vi.fn(async (_url: string) =>
    status === 200
      ? Response.json({ requests: [cancellationRow], nextBefore: financeCursor })
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>{<ContractCancellationRequestQueue service="savings" />}</QueryProvider>
    )
  );
  await click(en.cancellationRequestOpen);
  await set('detail-draft', 'Keep review');
  const input = container.querySelector('#detail-draft');
  status = 503;
  await click(en.next);
  const failed = fetcher.mock.calls.at(-1)![0];
  expect(failed).toContain('service=savings');
  expect(failed).toContain(encodeURIComponent(financeCursor));
  expect(container.querySelector('#detail-draft')).toBe(input);
  status = 200;
  await click(en.retry);
  expect(fetcher.mock.calls.at(-1)![0]).toBe(failed);
  expect((input as HTMLInputElement).value).toBe('Keep review');
  expect(container.querySelectorAll('li')).toHaveLength(1);
});
it('cancellation scope changes clear selected work and abandon the earlier page and detail callback', async () => {
  const pending = deferred();
  let hold = false;
  const fetcher = vi.fn((url: string) =>
    hold && url.includes('service=savings')
      ? pending.promise
      : Promise.resolve(Response.json({ requests: [cancellationRow], nextBefore: null }))
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>{<ContractCancellationRequestQueue service="savings" />}</QueryProvider>
    )
  );
  await click(en.cancellationRequestOpen);
  const oldChanged = captured.changed!;
  hold = true;
  await click(en.refresh);
  await act(async () =>
    root.render(<QueryProvider>{<ContractCancellationRequestQueue />}</QueryProvider>)
  );
  const count = fetcher.mock.calls.length;
  await act(async () => {
    pending.resolve(
      Response.json({ requests: [{ ...cancellationRow, reason: 'Obsolete' }], nextBefore: null })
    );
    oldChanged();
  });
  expect(container.querySelector('#detail-draft')).toBeNull();
  expect(container.textContent).not.toContain('Obsolete');
  expect(fetcher.mock.calls.length).toBe(count);
});
it('cancellation denial clears detail and blocks its late update callback', async () => {
  let status = 200;
  const fetcher = vi.fn(async () =>
    status === 200
      ? Response.json({ requests: [cancellationRow], nextBefore: null })
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<QueryProvider>{<ContractCancellationRequestQueue />}</QueryProvider>)
  );
  await click(en.cancellationRequestOpen);
  const changed = captured.changed!;
  status = 401;
  await click(en.refresh);
  const count = fetcher.mock.calls.length;
  await act(async () => changed());
  expect(container.textContent).toBe('');
  expect(fetcher.mock.calls.length).toBe(count);
});
it('selecting the same cancellation contract keeps its active detail callback usable', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ requests: [cancellationRow], nextBefore: null })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<QueryProvider>{<ContractCancellationRequestQueue />}</QueryProvider>)
  );
  await click(en.cancellationRequestOpen);
  await click(en.cancellationRequestOpen);
  const count = fetcher.mock.calls.length;
  await act(async () => captured.changed!());
  expect(fetcher.mock.calls.length).toBe(count + 1);
});
it('refund cursor retry and first-page refresh preserve bank references and confirmation until fresh state changes', async () => {
  let status = 200,
    changed = false;
  const fetcher = vi.fn(async (_url: string) =>
    status === 200
      ? Response.json({
          obligations: [
            {
              ...obligationRow,
              state: changed ? 'Processing' : 'Approved',
              bankReference: changed ? 'BANK-FINAL' : null,
            },
          ],
          nextBefore: financeCursor,
        })
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  const reads = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.endsWith('/record-transfer/review')) {
      const body = JSON.parse(options?.body as string);
      return Promise.resolve(
        Response.json(
          refundDecisionReviewFixture(
            obligationRow.invoiceId,
            obligationRow.id,
            'external_bank',
            'Approved',
            'record-transfer',
            body.bankReference,
            null,
            obligationRow.amount
          )
        )
      );
    }
    return reads(url, options);
  });
  await act(async () => root.render(<QueryProvider>{<ContractRefundQueue />}</QueryProvider>));
  await set('bank-return-' + obligationRow.id, 'BANK-DRAFT');
  await click(en['cancellation.queue.record-transfer']);
  const action = captured.action;
  const input = container.querySelector('input');
  status = 503;
  await click(en.next);
  const failed = fetcher.mock.calls.at(-1)![0];
  expect(container.querySelector('input')).toBe(input);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  status = 200;
  await click(en.retry);
  expect(fetcher.mock.calls.at(-1)![0]).toBe(failed);
  expect(captured.action).toBe(action);
  expect((input as HTMLInputElement).value).toBe('BANK-DRAFT');
  changed = true;
  await click(en.refresh);
  expect(fetcher.mock.calls.at(-1)![0]).not.toContain('?');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('BANK-FINAL');
});
it('refund denial clears references and invalidates a late successful write', async () => {
  let status = 200;
  const fetcher = vi.fn(async () =>
    status === 200
      ? Response.json({ obligations: [obligationRow], nextBefore: null })
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  const reads = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.endsWith('/record-transfer/review')) {
      const body = JSON.parse(options?.body as string);
      return Promise.resolve(
        Response.json(
          refundDecisionReviewFixture(
            obligationRow.invoiceId,
            obligationRow.id,
            'external_bank',
            'Approved',
            'record-transfer',
            body.bankReference,
            null,
            obligationRow.amount
          )
        )
      );
    }
    return reads(url, options);
  });
  await act(async () => root.render(<QueryProvider>{<ContractRefundQueue />}</QueryProvider>));
  await set('bank-return-' + obligationRow.id, 'BANK-DRAFT');
  await click(en['cancellation.queue.record-transfer']);
  const success = captured.success!;
  status = 403;
  await click(en.refresh);
  const count = fetcher.mock.calls.length;
  await act(async () => success());
  expect(container.textContent).toBe('');
  expect(fetcher.mock.calls.length).toBe(count);
});
it('duplicate refund pages update fresh eligibility once and clear stale confirmation', async () => {
  let changed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        obligations: [{ ...obligationRow, state: changed ? 'Completed' : 'Approved' }],
        nextBefore: financeCursor,
      })
    )
  );
  const reads = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.endsWith('/record-transfer/review')) {
      const body = JSON.parse(options?.body as string);
      return Promise.resolve(
        Response.json(
          refundDecisionReviewFixture(
            obligationRow.invoiceId,
            obligationRow.id,
            'external_bank',
            'Approved',
            'record-transfer',
            body.bankReference,
            null,
            obligationRow.amount
          )
        )
      );
    }
    return reads(url, options);
  });
  await act(async () => root.render(<QueryProvider>{<ContractRefundQueue />}</QueryProvider>));
  await set('bank-return-' + obligationRow.id, 'BANK-DRAFT');
  await click(en['cancellation.queue.record-transfer']);
  changed = true;
  await click(en.next);
  expect(container.querySelectorAll('li')).toHaveLength(1);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('input')).toBeNull();
});
it('malformed refund pages recover locally while accepted rows and references remain', async () => {
  let malformed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        malformed
          ? { obligations: {}, nextBefore: 7 }
          : { obligations: [obligationRow], nextBefore: null }
      )
    )
  );
  const reads = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (url.endsWith('/record-transfer/review')) {
      const body = JSON.parse(options?.body as string);
      return Promise.resolve(
        Response.json(
          refundDecisionReviewFixture(
            obligationRow.invoiceId,
            obligationRow.id,
            'external_bank',
            'Approved',
            'record-transfer',
            body.bankReference,
            null,
            obligationRow.amount
          )
        )
      );
    }
    return reads(url, options);
  });
  await act(async () => root.render(<QueryProvider>{<ContractRefundQueue />}</QueryProvider>));
  await set('bank-return-' + obligationRow.id, 'BANK-DRAFT');
  malformed = true;
  await click(en.refresh);
  expect((container.querySelector('input') as HTMLInputElement).value).toBe('BANK-DRAFT');
  malformed = false;
  await click(en.retry);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('approval pagination retries the failed offset with rejection drafts and accepted rows kept', async () => {
  let status = 200;
  const fetcher = vi.fn(async (_url: string) =>
    status === 200
      ? Response.json(
          Array.from({ length: 26 }, (_, n) => ({
            ...approvalRow,
            id: n ? 'other-' + n : approvalRow.id,
          }))
        )
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<QueryProvider>{<AdminApprovalRequestsView />}</QueryProvider>)
  );
  await set('reason-' + approvalRow.id, 'Reject draft');
  const input = container.querySelector('#reason-' + approvalRow.id);
  status = 503;
  await click('Next');
  const failed = fetcher.mock.calls.at(-1)![0];
  expect(failed).toContain('offset=25');
  expect(container.querySelector('#reason-' + approvalRow.id)).toBe(input);
  status = 200;
  await click('Try again');
  expect(fetcher.mock.calls.at(-1)![0]).toBe(failed);
  expect((input as HTMLTextAreaElement).value).toBe('Reject draft');
});
it('approval confirmation survives unchanged recovery and closes on changed request status', async () => {
  let status = 200,
    done = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 200
        ? Response.json([{ ...approvalRow, status: done ? 'approved' : 'pending' }])
        : Response.json({}, { status })
    )
  );
  await act(async () =>
    root.render(<QueryProvider>{<AdminApprovalRequestsView />}</QueryProvider>)
  );
  await click('Approve');
  const action = captured.action;
  status = 503;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  status = 200;
  await click('Try again');
  expect(captured.action).toBe(action);
  done = true;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('textarea')).toBeNull();
});
it('approval filters stay usable during loading and ignore the abandoned pending response', async () => {
  const pending = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('status=pending')
        ? pending.promise
        : Promise.resolve(
            Response.json([{ ...approvalRow, status: 'approved', reason: 'History row' }])
          )
    )
  );
  await act(async () =>
    root.render(<QueryProvider>{<AdminApprovalRequestsView />}</QueryProvider>)
  );
  await set('approval-status', 'approved');
  await act(async () => pending.resolve(Response.json([approvalRow])));
  expect(container.textContent).toContain('History row');
  expect(container.querySelector('textarea')).toBeNull();
});
it('approval denial clears drafts and old callbacks cannot overwrite recovered work', async () => {
  let status = 200;
  const fetcher = vi.fn(async () =>
    status === 200 ? Response.json([approvalRow]) : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<QueryProvider>{<AdminApprovalRequestsView />}</QueryProvider>)
  );
  await click('Approve');
  const success = captured.success!;
  status = 403;
  await click('Refresh');
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  status = 200;
  await click('Refresh');
  await set('reason-' + approvalRow.id, 'New draft');
  const count = fetcher.mock.calls.length;
  await act(async () => success());
  expect(fetcher.mock.calls.length).toBe(count);
  expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('New draft');
});
it('changing a linked approval clears its drafts and ignores the old request response', async () => {
  const pending = deferred();
  let hold = false;
  const other = '88888888-8888-4888-8888-888888888888';
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      hold && url.endsWith(approvalRow.id)
        ? pending.promise
        : Promise.resolve(
            Response.json({ ...approvalRow, id: url.endsWith(other) ? other : approvalRow.id })
          )
    )
  );
  await act(async () =>
    root.render(
      <QueryProvider>{<AdminApprovalRequestsView requestId={approvalRow.id} />}</QueryProvider>
    )
  );
  await set('reason-' + approvalRow.id, 'Old draft');
  hold = true;
  await click('Refresh');
  await act(async () =>
    root.render(<QueryProvider>{<AdminApprovalRequestsView requestId={other} />}</QueryProvider>)
  );
  await act(async () => pending.resolve(Response.json(approvalRow)));
  expect(container.querySelector('#reason-' + approvalRow.id)).toBeNull();
  expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
});
