import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import type { TeamActionDialog, TeamAction } from './TeamActionDialog.js';
import { en, fa } from '@barghsa/i18n/contracts';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  props: null as ComponentProps<typeof TeamActionDialog> | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: (v: string) => `${v} IRR`,
    number: String,
    percent: String,
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    harness.props = props;
    return (
      <div role="dialog">
        {props.summary}
        <button disabled={props.confirmationDisabled}>Confirm</button>
      </div>
    );
  },
}));
const contractId = '11111111-1111-7111-8111-111111111111';
const versionId = '22222222-2222-7222-8222-222222222222';
const profileId = '33333333-3333-7333-8333-333333333333';
const originalId = '44444444-4444-7444-8444-444444444444';
const signedId = '55555555-5555-7555-8555-555555555555';
function review(): ContractFinancialReview {
  return {
    schemaVersion: 1,
    scope: { action: 'contract.acceptance', profileId, resourceId: contractId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId,
        versionNumber: 2,
        serviceType: 'electricity',
        state: 'AwaitingCustomerAcceptance',
        publishedAt: '2026-09-21T09:00:00.000Z',
        content: { title: 'Electricity supply', terms: ['Published terms'] },
      },
      activation: {
        ruleRevision: 3,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: true,
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature: null,
    },
  };
}
function signing(record = false): ContractFinancialReview {
  const value = review();
  value.scope.action = record ? 'contract.signature-record' : 'contract.signature-request';
  value.data.contract.state = record ? 'AwaitingSignature' : 'Accepted';
  const document = {
    id: originalId,
    contractId,
    versionId,
    originalName: 'contract.pdf',
    checksum: 'b'.repeat(64),
    state: 'Approved' as const,
  };
  value.data.signature = {
    requestId: record ? originalId : null,
    requestNumber: record ? 1 : null,
    originalDocument: document,
    signedDocument: record
      ? { ...document, id: signedId, checksum: 'c'.repeat(64), originalName: 'signed.pdf' }
      : null,
  };
  return value;
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  harness.locale = 'en';
  harness.props = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const success = vi.fn(async () => {});
function actionFor(value: ContractFinancialReview): TeamAction {
  const sig = value.data.signature;
  const acceptance = value.scope.action === 'contract.acceptance';
  const request = value.scope.action === 'contract.signature-request';
  return {
    title: 'Confirm contract',
    description: 'Review',
    method: 'POST',
    path: `/api/${request ? 'admin/' : ''}contracts/${contractId}/${acceptance ? 'accept' : request ? 'signature-request' : 'signature'}`,
    body: {
      expectedVersionId: versionId,
      idempotencyKey: 'intent-key',
      ...(acceptance
        ? {}
        : request
          ? { originalDocumentId: sig!.originalDocument.id, expectedRequestId: sig!.requestId }
          : { signedDocumentId: sig!.signedDocument!.id, requestId: sig!.requestId }),
    },
  };
}
async function render(action: TeamAction, status = 'ready') {
  const time = {
    status,
    format: (v: string) => `Account time: ${v}`,
    notice: null,
  } as ComponentProps<typeof ContractFinancialReviewDialog>['time'];
  await act(async () =>
    root.render(
      <ContractFinancialReviewDialog
        action={action}
        contractId={contractId}
        profileId={profileId}
        time={time}
        onClose={() => {}}
        onSuccess={success}
      />
    )
  );
}
for (const locale of ['en', 'fa'] as const) {
  for (const kind of ['acceptance', 'request', 'record'] as const) {
    it(`${locale} ${kind}: confirms the captured review and preserves its hash and intent on retries`, async () => {
      harness.locale = locale;
      const value = kind === 'acceptance' ? review() : signing(kind === 'record');
      const action = actionFor(value);
      const fetcher = vi.fn(async () => new Response(JSON.stringify(value)));
      vi.stubGlobal('fetch', fetcher);
      await render(action);
      expect(harness.props?.confirmationDisabled).toBe(false);
      expect(harness.props?.action?.body).toEqual({
        ...(action.body as object),
        expectedReviewHash: value.hash,
      });
      expect(host.textContent).toContain((locale === 'en' ? en : fa).financialReviewNotice);
      expect(host.textContent).toContain('Published terms');
      expect(host.textContent).toContain('0 IRR');
      expect(host.textContent).toContain('Account time:');
      if (value.data.signature)
        expect(host.textContent).toContain(value.data.signature.originalDocument.checksum);
      const captured = harness.props?.action?.body;
      await render(action);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(harness.props?.action?.body).toEqual(captured);
      await expect(
        harness.props!.onSuccess({ financialReview: { ...value, hash: 'b'.repeat(64) } })
      ).rejects.toThrow();
      await harness.props!.onSuccess({ financialReview: value });
      expect(success).toHaveBeenCalled();
    });
  }
}
it.each(['unavailable', 'malformed', 'profile', 'version', 'document', 'request'])(
  'blocks confirmation for %s reviews',
  async (fault) => {
    const value = signing(true),
      action = actionFor(value);
    if (fault === 'profile') {
      value.scope.profileId = originalId;
      value.data.profile.id = originalId;
    }
    if (fault === 'version') value.data.contract.versionId = originalId;
    if (fault === 'document') value.data.signature!.signedDocument!.id = profileId;
    if (fault === 'request') value.data.signature!.requestId = profileId;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(fault === 'malformed' ? {} : value), {
            status: fault === 'unavailable' ? 503 : 200,
          })
      )
    );
    await render(action);
    expect(harness.props?.confirmationDisabled).toBe(true);
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  }
);
it('blocks confirmation while the account timezone is unavailable without reloading consent', async () => {
  const value = review(),
    action = actionFor(value);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(value)));
  vi.stubGlobal('fetch', fetcher);
  await render(action, 'error');
  expect(harness.props?.confirmationDisabled).toBe(true);
  await render(action);
  expect(harness.props?.confirmationDisabled).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('shows the exact linked invoice amount separately from the zero payment', async () => {
  const value = review();
  value.data.activation.initialInvoiceId = originalId;
  value.data.initialInvoice = {
    currency: 'IRR',
    profile: value.data.profile,
    invoice: {
      id: originalId,
      state: 'Unpaid',
      orderId: null,
      serviceType: 'electricity',
      issuedAt: null,
      payableFrom: null,
      dueAt: null,
      totalAmount: '9007199254740993',
      paidAmount: '0',
      remainingAmount: '9007199254740993',
    },
    lines: [],
    totals: null,
    contracts: [],
    cancellation: 'separate_review_required',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value)))
  );
  await render(actionFor(value));
  expect(host.textContent).toContain('9007199254740993 IRR');
  expect(host.textContent).toContain('Payment collected now0 IRR');
});
