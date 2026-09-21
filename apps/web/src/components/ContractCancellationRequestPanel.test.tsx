import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import type * as Documents from '../lib/documents.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import {
  ContractCancellationRequestPanel,
  type CancellationRequest,
} from './ContractCancellationRequestPanel.js';
import { ContractCancellationRequestQueue } from './ContractCancellationRequestQueue.js';
import type { TeamAction } from './TeamActionDialog.js';
const h = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fa', action: null as TeamAction | null }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => h.locale }));
vi.mock('../lib/documents.js', async (original) => ({
  ...(await original<typeof Documents>()),
  documentRequest: vi.fn(),
}));
vi.mock('./ContractDetail.js', () => ({
  ContractDetail: ({
    id,
    onClose,
    onChanged,
  }: {
    id: string;
    onClose: () => void;
    onChanged: () => void;
  }) => (
    <div role="dialog">
      {id}
      <button onClick={onClose}>Close contract</button>
      <button onClick={onChanged}>Contract changed</button>
    </div>
  ),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: () => Promise<void>;
  }) => {
    h.action = action;
    return (
      <div role="dialog">
        <button onClick={onClose}>Dismiss</button>
        <button onClick={() => void onSuccess()}>Confirm</button>
      </div>
    );
  },
}));
const request = vi.mocked(documentRequest),
  changed = vi.fn(),
  review = vi.fn();
let container: HTMLDivElement, root: Root;
const pending = (): CancellationRequest => ({
  id: 'request',
  contractId: 'contract',
  versionId: 'version',
  reason: 'End service',
  preferredDestination: 'external_bank',
  status: 'Pending',
  resolutionReason: null,
  contractState: 'Active',
  stale: false,
});
beforeEach(() => {
  request.mockReset();
  changed.mockReset();
  review.mockReset();
  h.locale = 'en';
  h.action = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(staff = false) {
  await act(async () =>
    root.render(
      <ContractCancellationRequestPanel
        id="contract"
        versionId="version"
        staff={staff}
        onChanged={changed}
        onReview={review}
      />
    )
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function reason(value: string) {
  await act(async () => {
    const el = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
for (const locale of ['en', 'fa'] as const)
  it(
    locale + ': submits a version-bound request with a preference, not a cancellation command',
    async () => {
      h.locale = locale;
      const w = locale === 'fa' ? fa : en;
      request.mockResolvedValue({ request: null, canRequest: true });
      await render();
      expect(container.textContent).toContain(w.cancellationRequestNotice);
      await submit();
      expect(h.action).toBeNull();
      expect(container.textContent).toContain(w.cancellationInvalid);
      await reason('Please end service');
      await act(async () => {
        const select = container.querySelector('select')!;
        select.value = 'external_bank';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await submit();
      expect(h.action).toMatchObject({
        path: '/api/contracts/contract/cancellation-requests',
        body: {
          expectedVersionId: 'version',
          reason: 'Please end service',
          preferredDestination: 'external_bank',
          idempotencyKey: expect.any(String),
        },
      });
      request.mockResolvedValue({ request: pending(), canRequest: false });
      await click('Confirm');
      expect(changed).toHaveBeenCalledOnce();
      expect(container.querySelector('form')).toBeNull();
      expect(container.textContent).toContain(w['cancellationRequest.Pending']);
    }
  );
it('lets staff review the exact request or decline it with an explanation', async () => {
  request.mockResolvedValue({ request: pending() });
  await render(true);
  await click(en.cancellationRequestReview);
  expect(review).toHaveBeenCalledWith(pending());
  await submit();
  expect(h.action).toBeNull();
  await reason('Please contact support');
  await submit();
  expect(h.action).toMatchObject({
    path: '/api/admin/contract-cancellation-requests/request/reject',
    body: { reason: 'Please contact support', idempotencyKey: expect.any(String) },
  });
  request.mockResolvedValue({
    request: { ...pending(), status: 'Rejected', resolutionReason: 'Please contact support' },
  });
  await click('Confirm');
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain(en['cancellationRequest.Rejected']);
  expect(container.textContent).toContain(en.cancellationSupport);
});
it('blocks approval of a stale version but keeps reasoned rejection available', async () => {
  request.mockResolvedValue({ request: { ...pending(), stale: true } });
  await render(true);
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === en.cancellationRequestReview
  )!;
  expect(button.disabled).toBe(true);
  expect(container.textContent).toContain(en.cancellationRequestStale);
  expect(container.querySelector('textarea')).toBeTruthy();
});
it.each(['Closed', 'Fulfilled'] as const)(
  'shows %s without another customer mutation',
  async (status) => {
    request.mockResolvedValue({
      request: {
        ...pending(),
        status,
        contractState: 'Cancelled',
        resolutionReason: status === 'Fulfilled' ? 'Staff approved' : null,
      },
      canRequest: false,
    });
    await render();
    expect(container.textContent).toContain(en[`cancellationRequest.${status}`]);
    expect(container.querySelector('form')).toBeNull();
  }
);
it('recovers failed reads and dismisses a confirmation without reporting success', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(container.textContent).toContain(en.error);
  request.mockResolvedValue({ request: null, canRequest: true });
  await click(en.refresh);
  await reason('End service');
  await submit();
  await click('Dismiss');
  expect(changed).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('hides the staff panel when no request exists', async () => {
  request.mockResolvedValue({ request: null });
  await render(true);
  expect(container.textContent).toBe('');
});
it('paginates the queue without duplicates and opens the selected contract', async () => {
  request.mockResolvedValueOnce({ requests: [pending()], nextBefore: 'cursor/request' });
  await act(async () => root.render(<ContractCancellationRequestQueue />));
  request.mockResolvedValueOnce({
    requests: [
      pending(),
      { ...pending(), id: 'second', contractId: 'second-contract', stale: true },
    ],
    nextBefore: null,
  });
  await click(en.next);
  expect(request.mock.calls[1]?.[0]).toContain('?before=cursor%2Frequest');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  await click(en.cancellationRequestOpen);
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('contract');
  await click('Close contract');
  request.mockResolvedValue({ requests: [], nextBefore: null });
  await click(en.refresh);
  expect(container.textContent).toContain(en.cancellationRequestQueueEmpty);
});
it('hides the queue after permission denial', async () => {
  request.mockRejectedValue(new DocumentRequestError(403, null));
  await act(async () => root.render(<ContractCancellationRequestQueue />));
  expect(container.textContent).toBe('');
});
it('recovers a queue load error', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<ContractCancellationRequestQueue />));
  expect(container.textContent).toContain(en.error);
  request.mockResolvedValue({ requests: [], nextBefore: null });
  await click(en.refresh);
  expect(container.textContent).not.toContain(en.error);
});
