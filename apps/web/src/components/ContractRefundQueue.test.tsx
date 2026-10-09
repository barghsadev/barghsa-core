import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en } from '@barghsa/i18n/contracts';
import { refundDecisionReviewFixture } from '../test/refund-review-fixtures.js';
import { ContractRefundQueue } from './ContractRefundQueue.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import type { TeamAction } from './TeamActionDialog.js';
import type * as Documents from '../lib/documents.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../lib/documents.js', async (original) => ({
  ...(await original<typeof Documents>()),
  documentRequest: vi.fn(),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action, onClose }: { action: TeamAction; onClose: () => void }) => (
    <div role="dialog">
      <span>{action.path}</span>
      <button onClick={onClose}>Dismiss</button>
    </div>
  ),
}));
const request = vi.mocked(documentRequest);
const row = (id: string) => ({
  id:
    id === 'wallet'
      ? '11111111-1111-4111-8111-111111111111'
      : id === 'bank'
        ? '22222222-2222-4222-8222-222222222222'
        : id,
  contractId: '33333333-3333-4333-8333-333333333333',
  invoiceId: '44444444-4444-4444-8444-444444444444',
  amount: '100',
  destination: 'wallet',
  state: 'Failed',
  bankReference: null,
  nextAttemptAt: '2026-09-22T00:00:00Z',
  exhausted: false,
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        refundDecisionReviewFixture(
          row('wallet').invoiceId,
          row('wallet').id,
          'wallet',
          'Failed',
          'process',
          null,
          null,
          '100'
        )
      )
    )
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(<QueryComponentProvider>{<ContractRefundQueue />}</QueryComponentProvider>)
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  if (label === en['cancellation.queue.process'])
    await vi.waitFor(() => expect(container.querySelector('[role=dialog]')).not.toBeNull());
  if (label === en['cancellation.queue.reconcile'])
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')).not.toBeNull());
}
it('hides finance obligations from an unauthorized staff member', async () => {
  request.mockRejectedValue(new DocumentRequestError(403, null));
  await render();
  expect(container.textContent).toBe('');
});
it('recovers from a failed load and retains scheduled automatic retries without a manual action', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(container.textContent).toContain(en.cancellationQueueError);
  request.mockResolvedValue({ obligations: [row('scheduled')], nextBefore: null });
  await click(en.refresh);
  expect(container.textContent).not.toContain(en.cancellationQueueError);
  expect(container.textContent).toContain(en.cancellationQueueScheduled);
  expect(container.textContent).not.toContain(en['cancellation.queue.process']);
});
it('appends pages once and refreshes from the first page', async () => {
  request.mockResolvedValueOnce({ obligations: [row('one')], nextBefore: 'cursor/one' });
  await render();
  request.mockResolvedValueOnce({ obligations: [row('one'), row('two')], nextBefore: null });
  await click(en.next);
  expect(request.mock.calls[1]?.[0]).toContain('?before=cursor%2Fone');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  request.mockResolvedValueOnce({ obligations: [], nextBefore: null });
  await click(en.refresh);
  expect(request.mock.calls[2]?.[0]).not.toContain('?');
  expect(container.querySelectorAll('li')).toHaveLength(0);
  expect(container.textContent).toContain(en.cancellationQueueEmpty);
});
it('requires a stored transfer reference before reconciliation and allows dismissing a retry', async () => {
  request.mockResolvedValue({
    obligations: [
      { ...row('bank'), destination: 'external_bank', state: 'Processing' },
      { ...row('wallet'), exhausted: true },
    ],
    nextBefore: null,
  });
  await render();
  await click(en['cancellation.queue.reconcile']);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    en.refundBankReferenceInvalid
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click(en['cancellation.queue.process']);
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    '/' + row('wallet').id + '/process'
  );
  await click('Dismiss');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('ignores a response after the queue has unmounted', async () => {
  let resolve!: (value: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  const signal = request.mock.calls[0]?.[1]?.signal;
  await act(async () => root.render(<QueryComponentProvider>{null}</QueryComponentProvider>));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ obligations: [row('late')], nextBefore: null }));
  expect(container.textContent).toBe('');
});
