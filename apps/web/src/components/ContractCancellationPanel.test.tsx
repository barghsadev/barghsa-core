import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import { ContractCancellationPanel } from './ContractCancellationPanel.js';
import type {
  CancellationIntent,
  CancellationPreview,
  CancellationStatus,
} from '../lib/contract-cancellation.js';
import { validCancellationAmount } from '../lib/contract-cancellation.js';
import type { TeamAction } from './TeamActionDialog.js';
const h = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  status: null as CancellationStatus | null,
  preview: null as CancellationPreview | null,
  intent: null as CancellationIntent | null,
  result: null as CancellationIntent | null,
  fail: false,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => h.locale }));
vi.mock('../lib/documents.js', () => ({
  documentRequest: vi.fn(async (path: string) => {
    if (h.fail) throw new Error('offline');
    if (path.endsWith('cancellation-status')) return h.status;
    if (path.endsWith('cancellation-preview')) return h.preview;
    return { intent: h.intent };
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: (value: unknown) => Promise<void>;
  }) => {
    h.action = action;
    return (
      <div role="dialog">
        <button onClick={onClose}>Dismiss</button>
        <button onClick={() => void onSuccess(h.result)}>Confirm</button>
      </div>
    );
  },
}));
let container: HTMLDivElement, root: Root;
const changed = vi.fn();
const saved = (): CancellationIntent => ({
  id: 'intent',
  versionId: 'version',
  reason: 'End service',
  financialFingerprint: 'fingerprint',
  status: 'ready',
  approvalRequestId: null,
  refundDecision: {
    mode: 'full_wallet',
    refunds: [{ invoiceId: 'invoice', amount: '100', destination: 'wallet' }],
  },
});
beforeEach(() => {
  h.locale = 'en';
  h.action = null;
  h.intent = null;
  h.result = saved();
  h.fail = false;
  changed.mockReset();
  h.status = {
    contractId: 'contract',
    state: 'Active',
    cancelledAt: null,
    financialStatus: 'not_cancelled',
    financiallyClosed: false,
    refundAmount: '0',
    returnedAmount: '0',
    canCancel: true,
    canChooseRefund: true,
    refunds: [],
  };
  h.preview = {
    versionId: 'version',
    fingerprint: 'fingerprint',
    serviceType: 'electricity',
    refundableAmount: '100',
    blockers: [],
    invoices: [
      {
        id: 'invoice',
        paidAmount: '100',
        refundedAmount: '0',
        availableRefundAmount: '100',
        refundableAmount: '100',
      },
    ],
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(staff = true) {
  await act(async () =>
    root.render(
      <ContractCancellationPanel
        id="contract"
        versionId="version"
        staff={staff}
        onChanged={changed}
      />
    )
  );
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function input(selector: string, value: string) {
  const node = container.querySelector(selector)!;
  const proto =
    node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
for (const locale of ['en', 'fa'] as const)
  it(
    locale + ': saves the exact decision before confirming irreversible cancellation',
    async () => {
      h.locale = locale;
      const w = locale === 'en' ? en : fa;
      await render();
      await click(w.cancellationReview);
      expect(container.textContent).toContain(w.cancellationElectricity);
      await input('textarea', 'End service');
      await act(async () =>
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(h.action?.path).toBe('/api/admin/contracts/contract/cancellations');
      expect(h.action?.body).toMatchObject({
        expectedVersionId: 'version',
        expectedFingerprint: 'fingerprint',
        reason: 'End service',
        refundDecision: { mode: 'full_wallet' },
        idempotencyKey: expect.any(String),
      });
      await click('Confirm');
      expect(changed).not.toHaveBeenCalled();
      await click(w.cancellationConfirm);
      expect(h.action?.body).toMatchObject({ intentId: 'intent' });
      expect(h.action?.description).toContain(w.cancellationIrreversible);
      await click('Confirm');
      expect(changed).toHaveBeenCalledOnce();
    }
  );
it('resumes approval and requires a refresh before execution', async () => {
  h.intent = { ...saved(), status: 'awaiting_approval', approvalRequestId: 'approval' };
  await render();
  await click(en.cancellationReview);
  expect(container.textContent).toContain(en.cancellationApprovalNotice);
  expect(
    Array.from(container.querySelectorAll('button')).some(
      (b) => b.textContent === en.cancellationConfirm
    )
  ).toBe(false);
  h.intent = { ...h.intent, status: 'ready' };
  await click(en.cancellationRefresh);
  await click(en.cancellationConfirm);
  expect(h.action?.path).toContain('/execute');
});
it('prevents stale decisions and unresolved payment blockers from executing', async () => {
  h.intent = { ...saved(), financialFingerprint: 'old' };
  h.preview!.blockers = ['payment_in_progress'];
  await render();
  await click(en.cancellationReview);
  expect(container.textContent).toContain(en['cancellation.stale']);
  expect(container.textContent).toContain(en['cancellation.blocker.payment_in_progress']);
  expect(
    Array.from(container.querySelectorAll('button')).some(
      (b) => b.textContent === en.cancellationConfirm
    )
  ).toBe(false);
  await click(en.cancellationNewDecision);
  expect(container.querySelector('textarea')).toBeTruthy();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});
it('validates explicit custom refunds before opening the confirmation', async () => {
  h.preview!.serviceType = 'solar';
  await render();
  await click(en.cancellationReview);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
  );
  await input('textarea', 'Partial return');
  await input('input[inputmode="numeric"]', '101');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(h.action).toBeNull();
  expect(container.textContent).toContain(en.cancellationInvalid);
  await input('input[inputmode="numeric"]', '40');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(h.action?.body).toMatchObject({
    refundDecision: {
      mode: 'custom',
      refunds: [{ invoiceId: 'invoice', amount: '40', destination: 'wallet' }],
    },
  });
});
it('shows failed customer returns separately from cancelled service', async () => {
  h.locale = 'fa';
  h.status = {
    ...h.status!,
    state: 'Cancelled',
    financialStatus: 'needs_attention',
    refundAmount: '100',
    refunds: [
      {
        id: 'refund',
        invoiceId: 'invoice',
        amount: '100',
        destination: 'wallet',
        state: 'Failed',
        transactionState: 'Pending',
      },
    ],
  };
  await render(false);
  expect(container.textContent).toContain(fa.cancellationServiceEnded);
  expect(container.textContent).toContain(fa.cancellationSupport);
  expect(container.textContent).toContain(fa['cancellation.refund.Failed']);
  expect(container.querySelector('form')).toBeNull();
});
it('keeps read-only staff from opening cancellation', async () => {
  h.status!.canCancel = false;
  await render();
  expect(container.textContent).toContain(en.cancellationNoAction);
  expect(container.textContent).not.toContain(en.cancellationReview);
});
it('keeps discretionary financial decisions disabled without finance permission', async () => {
  h.preview!.serviceType = 'solar';
  h.status!.canChooseRefund = false;
  await render();
  await click(en.cancellationReview);
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});
it('recovers a failed read through refresh', async () => {
  h.fail = true;
  await render();
  expect(container.textContent).toContain(en.error);
  h.fail = false;
  await click(en.refresh);
  expect(container.textContent).toContain(en.cancellationReview);
});
it('recovers an unavailable financial preview without allowing a decision first', async () => {
  await render();
  h.fail = true;
  await click(en.cancellationReview);
  expect(container.textContent).toContain(en.error);
  expect(container.querySelector('form')).toBeNull();
  h.fail = false;
  await click(en.cancellationRefresh);
  expect(container.querySelector('form')).toBeTruthy();
});
it('requires a reason even for an explicit zero discretionary return', async () => {
  h.preview!.serviceType = 'solar';
  await render();
  await click(en.cancellationReview);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
  );
  await input('input[inputmode="numeric"]', '0');
  const submit = () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  await submit();
  expect(h.action).toBeNull();
  expect(container.textContent).toContain(en.cancellationInvalid);
  await input('textarea', 'No discretionary return approved');
  await submit();
  expect(h.action?.body).toMatchObject({ refundDecision: { mode: 'custom', refunds: [] } });
});
it.each(['-1', '1.5', ' 1', '01', '9223372036854775808'])(
  'rejects invalid IRR amount %s',
  (value) => {
    expect(validCancellationAmount(value, '9223372036854775807')).toBe(false);
  }
);
it('keeps bigint precision and permits an explicit zero refund', () => {
  expect(validCancellationAmount('0', '10')).toBe(true);
  expect(validCancellationAmount('9007199254740993', '9007199254740993')).toBe(true);
  expect(validCancellationAmount('9007199254740994', '9007199254740993')).toBe(false);
});
