import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import type * as Documents from '../lib/documents.js';
import CancellationEditor from './ContractCancellationEditor.js';
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
  result: null as unknown,
  fail: false,
  success: null as null | ((value: unknown) => Promise<void>),
  invalid: null as null | ((fields: unknown[]) => boolean),
  deny: null as null | (() => void),
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => h.locale }));
vi.mock('../lib/documents.js', async (original) => ({
  ...(await original<typeof Documents>()),
  documentRequest: vi.fn(async (path: string) => {
    if (h.fail) throw new Error('offline');
    if (path.endsWith('cancellation-status')) return h.status;
    if (path.includes('cancellation-preview')) return h.preview;
    return { intent: h.intent };
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    summary,
    onClose,
    onSuccess,
    onValidationError,
    onDenied,
  }: {
    action: TeamAction;
    summary: ReactNode;
    onClose: () => void;
    onSuccess: (value: unknown) => Promise<void>;
    onValidationError: (fields: unknown[]) => boolean;
    onDenied: () => void;
  }) => {
    h.action = action;
    h.success = onSuccess;
    h.invalid = onValidationError;
    h.deny = onDenied;
    return (
      <div role="dialog">
        {summary}
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
  contractId: 'contract',
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
    contractId: 'contract',
    profileId: 'profile',
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
  const w = h.locale === 'fa' ? fa : en;
  if (label === w.cancellationReview)
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll('button')].some(
          (button) => button.textContent === w.cancellationRefresh
        )
      ).toBe(true);
      expect(container.textContent).not.toContain(w.loading);
    });
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
      await submitDecision();
      expect(h.action?.path).toBe('/api/admin/contracts/contract/cancellations');
      expect(h.action?.body).toMatchObject({
        expectedVersionId: 'version',
        expectedFingerprint: 'fingerprint',
        reason: 'End service',
        refundDecision: { mode: 'full_wallet' },
        idempotencyKey: expect.any(String),
      });
      expect(
        container.querySelector('section[aria-label="' + w.cancellationFinancialReview + '"]')
      ).not.toBeNull();
      expect(container.textContent).toContain(w.cancellationPaid);
      expect(container.textContent).toContain(w['cancellation.wallet']);
      await click('Confirm');
      expect(changed).not.toHaveBeenCalled();
      await click(w.cancellationConfirm);
      expect(h.action?.body).toMatchObject({ intentId: 'intent' });
      expect(h.action?.description).toContain(w.cancellationIrreversible);
      expect(container.textContent).toContain(w.cancellationAlreadyReturned);
      h.result = {
        contractId: 'contract',
        versionId: 'version',
        intentId: 'intent',
        state: 'Cancelled',
      };
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
  await submitDecision();
  expect(h.action).toBeNull();
  expect(container.textContent).toContain(en.cancellationAmountInvalid);
  await input('input[inputmode="numeric"]', '40');
  await submitDecision();
  expect(h.action?.body).toMatchObject({
    refundDecision: {
      mode: 'custom',
      refunds: [{ invoiceId: 'invoice', amount: '40', destination: 'wallet' }],
    },
  });
  expect(container.textContent).toContain('40 IRR');
  expect(container.textContent).toContain(en.cancellationFinancialReview);
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
  expect(container.textContent).toContain(en.cancellationReasonInvalid);
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

async function prepareDraft() {
  await render();
  await click(en.cancellationReview);
  await input('#cancellation-reason', '  Raw cancellation draft  ');
}
async function submitDecision() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(() =>
    expect(
      container.querySelector('form')?.getAttribute('aria-busy') === 'true' &&
        !container.querySelector('[role="dialog"]')
    ).toBe(false)
  );
}
it('preserves custom amounts and destinations across unchanged and changed financial refreshes', async () => {
  h.preview!.serviceType = 'solar';
  await prepareDraft();
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await input('input[inputmode=numeric]', '40');
  await act(async () => {
    const el = container.querySelector('select')!;
    el.value = 'external_bank';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(en.cancellationRefresh);
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
  expect(container.querySelector<HTMLInputElement>('input[inputmode=numeric]')?.value).toBe('40');
  expect(container.querySelector('select')?.value).toBe('external_bank');
  h.preview = {
    ...h.preview!,
    fingerprint: 'changed',
    invoices: [{ ...h.preview!.invoices[0]!, availableRefundAmount: '30' }],
  };
  await click(en.cancellationRefresh);
  await submitDecision();
  expect(h.action).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector('input[inputmode=numeric]'))
  );
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
  await input('input[inputmode=numeric]', '20');
  await submitDecision();
  expect(h.action?.body).toMatchObject({
    expectedFingerprint: 'changed',
    reason: 'Raw cancellation draft',
    refundDecision: {
      mode: 'custom',
      refunds: [{ invoiceId: 'invoice', amount: '20', destination: 'external_bank' }],
    },
  });
});
it('maps a submitted refund index to the filtered invoice and rejects mixed metadata', async () => {
  h.preview!.serviceType = 'solar';
  h.preview!.invoices.unshift({ ...h.preview!.invoices[0]!, id: 'zero' });
  await prepareDraft();
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await input('#return-zero', '0');
  await input('#return-invoice', '40');
  await submitDecision();
  expect(h.invalid!(['refundAmount1'])).toBe(false);
  expect(h.invalid!(['refundAmount0', 'invoiceId'])).toBe(false);
  await act(async () => {
    expect(h.invalid!(['refundAmount0'])).toBe(true);
  });
  await click('Dismiss');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector('#return-invoice'))
  );
  expect(container.querySelector<HTMLInputElement>('#return-invoice')?.value).toBe('40');
  expect(container.querySelector<HTMLInputElement>('#return-zero')?.value).toBe('0');
  expect(changed).not.toHaveBeenCalled();
});
it('does not validate hidden custom amounts for a full wallet decision', async () => {
  h.preview!.serviceType = 'solar';
  await prepareDraft();
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await input('#return-invoice', 'bad');
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await submitDecision();
  expect(h.action?.body).toMatchObject({ refundDecision: { mode: 'full_wallet' } });
});
it('keeps drafts through a failed financial read and ordinary dismissal', async () => {
  await prepareDraft();
  h.fail = true;
  await click(en.cancellationRefresh);
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
  h.fail = false;
  await click(en.cancellationRefresh);
  await submitDecision();
  await click('Dismiss');
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
});
it('locks amounts, destination, mode and reason while retaining one command', async () => {
  h.preview!.serviceType = 'solar';
  await prepareDraft();
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await submitDecision();
  const captured = h.action;
  expect(container.querySelector('textarea')?.disabled).toBe(true);
  expect(container.querySelector('select')?.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('#return-invoice')?.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled).toBe(true);
  await submitDecision();
  expect(h.action).toBe(captured);
});
it.each([
  'contractId',
  'versionId',
  'financialFingerprint',
  'reason',
  'customerRequestId',
  'refundDecision',
] as const)('requires a matching prepare acknowledgement: %s', async (field) => {
  await prepareDraft();
  await submitDecision();
  const receipt = {
    ...saved(),
    reason: 'Raw cancellation draft',
    [field]: field === 'refundDecision' ? { mode: 'custom', refunds: [] } : 'other',
  };
  await expect(h.success!(receipt)).rejects.toThrow('acknowledgement');
  expect(changed).not.toHaveBeenCalled();
  await click('Dismiss');
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
});
it('requires a matching execute acknowledgement before reporting a cancellation', async () => {
  h.intent = saved();
  await render();
  await click(en.cancellationReview);
  await click(en.cancellationConfirm);
  await expect(
    h.success!({
      contractId: 'contract',
      versionId: 'version',
      intentId: 'other',
      state: 'Cancelled',
    })
  ).rejects.toThrow('acknowledgement');
  expect(changed).not.toHaveBeenCalled();
  expect(h.invalid!(['reason'])).toBe(false);
});
it('clears private financial work on denial and ignores the captured prepare result', async () => {
  await prepareDraft();
  await submitDecision();
  const success = h.success!;
  await act(async () => h.deny!());
  await act(async () => success(saved()));
  expect(changed).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.textContent).not.toContain('Raw cancellation draft');
  await click(en.cancellationRefresh);
  expect(container.querySelector('textarea')?.value).toBe('');
});
it('abandons old version callbacks and drafts on scope change', async () => {
  await prepareDraft();
  await submitDecision();
  const success = h.success!;
  await act(async () =>
    root.render(
      <ContractCancellationPanel id="contract" versionId="next" staff={true} onChanged={changed} />
    )
  );
  await act(async () => success(saved()));
  expect(changed).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')).toBeNull();
});
it('retains the decision draft during a parent status refresh', async () => {
  await prepareDraft();
  await click(en.refresh);
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
});

it('retains but disables a draft until a failed parent status refresh recovers', async () => {
  await prepareDraft();
  h.fail = true;
  await click(en.refresh);
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
  expect(container.querySelector('textarea')?.disabled).toBe(true);
  await submitDecision();
  expect(h.action).toBeNull();
  h.fail = false;
  await click(en.refresh);
  expect(container.querySelector('textarea')?.disabled).toBe(false);
  expect(container.querySelector('textarea')?.value).toBe('  Raw cancellation draft  ');
});

for (const locale of ['en', 'fa'] as const)
  it(locale + ': captures rejection explicitly and accepts only its executed state', async () => {
    h.locale = locale;
    const w = locale === 'en' ? en : fa;
    h.preview = { ...h.preview!, terminalAction: 'reject' };
    h.result = { ...saved(), terminalAction: 'reject' };
    await act(async () =>
      root.render(
        <CancellationEditor
          id="contract"
          terminalAction="reject"
          customerRequestId={null}
          canChooseRefund={false}
          unavailable={false}
          onChanged={changed}
        />
      )
    );
    await input('textarea', 'End service');
    await submitDecision();
    expect(h.action?.body).toMatchObject({
      terminalAction: 'reject',
      reason: 'End service',
      expectedFingerprint: 'fingerprint',
    });
    expect(h.action?.title).toBe(w.rejectionSave);
    expect(container.textContent).toContain(w.rejectionFinancialReview);
    await click('Confirm');
    await click(w.rejectionConfirm);
    expect(h.action?.description).toContain(w.rejectionIrreversible);
    const receipt = {
      contractId: 'contract',
      versionId: 'version',
      intentId: 'intent',
      state: 'Cancelled',
    };
    await act(async () => {
      await expect(h.success!(receipt)).rejects.toThrow('acknowledgement mismatch');
    });
    expect(changed).not.toHaveBeenCalled();
    expect(h.action).not.toBeNull();
    await act(async () => h.success!({ ...receipt, state: 'Rejected' }));
    expect(changed).toHaveBeenCalledOnce();
  });
it('withdraws rejection when its authoritative preview is for cancellation', async () => {
  await act(async () =>
    root.render(
      <CancellationEditor
        id="contract"
        terminalAction="reject"
        customerRequestId={null}
        canChooseRefund={false}
        unavailable={false}
        onChanged={changed}
      />
    )
  );
  expect(container.querySelector('textarea')).toBeNull();
  expect(h.action).toBeNull();
});
