import { t } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { BANK_RECEIPT_STORAGE_PURPOSE } from '@barghsa/shared/finance/browser';
import type { InvoiceBankReceiptSubmissionReview } from '@barghsa/shared/finance';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { expect, type Page, type Route } from './coverage-fixture';
import { correctionStaffOrder, correctionStaffReview } from './electricity-correction-form-fixture';
import { pdfPreviewFixture } from './upload-fixture';

const receiptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const refundId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const attachmentKey = 'receipts/advanced-electricity.pdf';
const receiptDate = '2026-09-22';
const payerReference = 'ADVANCED-ELECTRICITY-47';
export const bankRefundReason = 'Unable to deliver approved supply';
export const bankJourneyCsrf = 'advanced-electricity-csrf';

export type BankJourneyStage =
  'unsubmitted' | 'submitted' | 'confirmed' | 'processing' | 'completed';
type BankJourneyState = { stage: BankJourneyStage; context: 'customer' | 'staff' };
export type BankJourneyOrder = {
  orderId: string;
  profileId: string;
  contractId: string;
  versionId: string;
  invoiceId: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  totalKwh: string;
  pricingSnapshot: ReturnType<typeof correctionStaffOrder>['pricingSnapshot'];
  submittedAt: string;
};
type UploadReceiver = {
  url: string;
  uploads: { method: string | undefined; body: Buffer }[];
};

export function bankJourneyReceipt(stage: BankJourneyStage, amount: string, submittedAt: string) {
  if (stage === 'unsubmitted') return [];
  return [
    {
      id: receiptId,
      amount,
      state: stage === 'submitted' ? 'Submitted' : 'Confirmed',
      paymentDate: receiptDate,
      payerReference,
      rejectionReason: null,
      createdAt: submittedAt,
      confirmedAt: stage === 'submitted' ? null : submittedAt,
    },
  ];
}

export async function runElectricityBankRefund(
  page: Page,
  locale: 'en' | 'fa',
  order: BankJourneyOrder,
  state: BankJourneyState,
  uploadReceiver: UploadReceiver
) {
  const { orderId, profileId, contractId, versionId, invoiceId, amount, submittedAt } = order;
  const customerReceipt = `/api/invoices/${invoiceId}/bank-receipts`;
  const staffReceipt = '/api/admin/invoices/bank-receipts';
  const staffOrderPath = `/api/staff/electricity/orders/${orderId}`;
  const app = (key: string) => t(key, locale);
  const admin = (key: string) => adminText(key, locale);
  const money = formatCurrencyIrr(amount, locale);
  const pdf = pdfPreviewFixture();
  const assertPost = (route: Route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe(bankJourneyCsrf);
  };
  await page
    .context()
    .addCookies([
      { name: 'barghsa_csrf', value: bankJourneyCsrf, url: new URL(page.url()).origin },
    ]);
  const uploadFields = {
    fileName: 'advanced-electricity.pdf',
    contentType: 'application/pdf',
    fileSize: pdf.length,
    category: 'document',
    purpose: BANK_RECEIPT_STORAGE_PURPOSE,
    profileId,
  };
  await page.route('**/api/upload/presigned-url', (route) => {
    assertPost(route);
    expect(route.request().postDataJSON()).toEqual({
      ...uploadFields,
      metadata: { recordType: 'receipt' },
    });
    return route.fulfill({ json: { key: attachmentKey, presignedUrl: uploadReceiver.url } });
  });
  const encodedKey = encodeURIComponent(attachmentKey);
  await page.route(`**/api/upload/${encodedKey}/verify`, (route) => {
    assertPost(route);
    expect(uploadReceiver.uploads).toHaveLength(1);
    expect(uploadReceiver.uploads[0]).toMatchObject({ method: 'PUT', body: pdf });
    return route.fulfill({ json: { status: 'confirmed' } });
  });
  let recorded = false;
  await page.route(`**/api/upload/${encodedKey}/record`, (route) => {
    assertPost(route);
    expect(route.request().postDataJSON()).toEqual(uploadFields);
    expect(recorded).toBe(false);
    recorded = true;
    return route.fulfill({ status: 201, json: {} });
  });
  const receiptBody = { amount, paymentDate: receiptDate, payerReference, attachmentKey };
  const submissionHash = 'd'.repeat(64);
  await page.route(`**${customerReceipt}/review`, (route) => {
    assertPost(route);
    expect(recorded).toBe(true);
    expect(route.request().postDataJSON()).toEqual(receiptBody);
    return route.fulfill({
      json: {
        schemaVersion: 1,
        scope: { action: 'invoice.bank-receipt-submission', profileId, resourceId: invoiceId },
        data: {
          invoiceId,
          profileId,
          invoiceState: 'Unpaid',
          invoiceTotalIrR: amount,
          invoicePaidIrR: '0',
          invoiceRemainingIrR: amount,
          amountIrR: amount,
          paymentDate: receiptDate,
          payerReference,
          bankName: null,
          attachmentKey,
          fileName: uploadFields.fileName,
          fileSizeBytes: String(pdf.length),
          customerNote: null,
          stateAfterSubmission: 'Submitted',
          settlementRule: 'after_finance_confirmation',
          excessRule: 'confirmed_excess_to_wallet',
        },
        hash: submissionHash,
      } satisfies InvoiceBankReceiptSubmissionReview,
    });
  });
  await page.route(`**${customerReceipt}`, (route) => {
    assertPost(route);
    expect(state.stage).toBe('unsubmitted');
    expect(route.request().postDataJSON()).toEqual({
      ...receiptBody,
      expectedReviewHash: submissionHash,
    });
    state.stage = 'submitted';
    return route.fulfill({
      status: 201,
      json: { transactionId: receiptId, state: 'Submitted', amount },
    });
  });
  const staffRecord = () => ({
    ...bankJourneyReceipt(state.stage, amount, submittedAt)[0],
    receiptId,
    invoiceId,
    profileId,
    amount,
    bankName: null,
    customerNote: null,
    submittedAt,
    attachmentKey,
    attachmentUrl: 'https://receipts.example.test/advanced-electricity.pdf?signed=1',
    canConfirm: state.stage === 'submitted',
    canReject: state.stage === 'submitted',
    invoiceAllocation: state.stage === 'submitted' ? null : amount,
    walletCreditAmount: '0',
    requiresDualApproval: false,
    dualApprovalPending: false,
  });
  await page.route(/\/api\/admin\/invoices\/bank-receipts(?:\?|$)/, (route) =>
    route.fulfill({
      json: { items: state.stage === 'submitted' ? [staffRecord()] : [], nextCursor: null },
    })
  );
  await page.route(`**${staffReceipt}/${receiptId}`, (route) =>
    route.fulfill({ json: staffRecord() })
  );
  await page.route(`**${staffReceipt}/${receiptId}/allocation`, (route) =>
    route.fulfill({
      json: {
        receiptId,
        invoiceId,
        invoiceState: 'PaymentUnderReview',
        receiptAmount: amount,
        remaining: amount,
        invoiceAllocation: amount,
        walletCreditAmount: '0',
      },
    })
  );
  const confirmation = bankReceiptReview(receiptId, invoiceId, profileId);
  confirmation.scope.action = 'invoice.bank-receipt-confirmation';
  confirmation.data.receipt = {
    ...confirmation.data.receipt,
    amount,
    paymentDate: receiptDate,
    payerReference,
    attachmentKey,
    submittedAt,
  };
  Object.assign(confirmation.data.invoice!.invoice, {
    orderId,
    serviceType: 'electricity',
    state: 'PaymentUnderReview',
    totalAmount: amount,
    remainingAmount: amount,
  });
  confirmation.data.allocation = { invoiceAmount: amount, walletCredit: '0' };
  confirmation.data.wallet = { availableBefore: '0', availableAfter: '0' };
  await page.route(`**${staffReceipt}/${receiptId}/confirm/review`, (route) => {
    assertPost(route);
    expect(state.stage).toBe('submitted');
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: confirmation });
  });
  await page.route(`**${staffReceipt}/${receiptId}/confirm`, (route) => {
    assertPost(route);
    expect(state.stage).toBe('submitted');
    expect(route.request().postDataJSON()).toEqual({ expectedReviewHash: confirmation.hash });
    state.stage = 'confirmed';
    return route.fulfill({ json: staffRecord() });
  });

  const staffOrder = {
    ...correctionStaffOrder(orderId),
    ...order,
    totalIrR: amount,
    paidIrR: amount,
    commercialStatus: 'approved',
    contractState: 'AwaitingCustomerAcceptance',
    invoiceState: 'Paid',
    financialStatus: 'paid',
    nextAction: 'await_contract_acceptance',
  };
  const rejection = correctionStaffReview(staffOrder, {
    action: 'reject',
    reason: bankRefundReason,
  });
  rejection.data.outcome = 'refund_obligation';
  rejection.data.refundAmount = amount;
  await page.route('**/api/staff/electricity/orders', (route) =>
    route.fulfill({ json: { orders: [] } })
  );
  await page.route(`**${staffOrderPath}`, (route) =>
    route.fulfill({
      json: {
        ...staffOrder,
        ...(state.stage === 'processing'
          ? {
              commercialStatus: 'rejected',
              contractState: 'Rejected',
              invoiceState: 'Paid',
              financialStatus: 'refund_pending',
              nextAction: 'process_refund',
            }
          : {}),
      },
    })
  );
  await page.route(`**${staffOrderPath}/financial-review`, (route) => {
    assertPost(route);
    expect(state.stage).toBe('confirmed');
    expect(route.request().postDataJSON()).toEqual({ action: 'reject', reason: bankRefundReason });
    return route.fulfill({ json: rejection });
  });
  await page.route(`**${staffOrderPath}/reject`, (route) => {
    assertPost(route);
    expect(state.stage).toBe('confirmed');
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i),
      expectedVersionId: versionId,
      expectedReviewHash: rejection.hash,
      reason: bankRefundReason,
    });
    state.stage = 'processing';
    return route.fulfill({
      json: { orderId, contractId, invoiceId, status: 'rejected', refundId },
    });
  });

  await page.getByTestId('invoice-receipt-amount').fill(amount);
  await page.getByTestId('invoice-receipt-date').fill(receiptDate);
  await page.getByTestId('invoice-receipt-payer-ref').fill(payerReference);
  await page.getByTestId('invoice-receipt-file').setInputFiles({
    name: uploadFields.fileName,
    mimeType: uploadFields.contentType,
    buffer: pdf,
  });
  await page.getByTestId('invoice-receipt-submit').click();
  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', {
    name: app('invoices.details.receiptReviewConfirm'),
    exact: true,
  });
  await expect(dialog).toContainText(payerReference);
  await expect(dialog).toContainText(money);
  await expect(submit).toBeDisabled();
  expect(state.stage).toBe('unsubmitted');
  await approveRiskConfirmation(page, locale, 'financial');
  await submit.click();
  await expect(page.getByTestId('invoice-receipt-success')).toBeVisible();
  expect(state.stage).toBe('submitted');

  const readOrder = () => page.goto(`/electricity/orders/${orderId}`);
  const workflow = page.getByRole('region', { name: app('workflow.summary') });
  await readOrder();
  await expect(workflow).toContainText(app('electricity.order.nextAction.await_payment_review'));
  state.context = 'staff';
  await page.goto('/admin/invoices');
  await page
    .locator('#invoice-receipt-panel')
    .getByRole('button', { name: admin('admin.invoiceReceipts.title'), exact: true })
    .click();
  const queue = page.getByRole('region', {
    name: admin('admin.invoiceReceipts.title'),
    exact: true,
  });
  await queue
    .getByRole('button', { name: admin('admin.invoiceReceipts.open'), exact: true })
    .click();
  await expect(queue).toContainText(payerReference);
  await queue
    .getByRole('button', { name: admin('admin.invoiceReceipts.confirm'), exact: true })
    .click();
  const confirm = dialog.getByRole('button', { name: app('team.confirm'), exact: true });
  await expect(dialog).toContainText(money);
  await expect(confirm).toBeDisabled();
  expect(state.stage).toBe('submitted');
  await approveRiskConfirmation(page, locale, 'financial');
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  expect(state.stage).toBe('confirmed');
  state.context = 'customer';
  await readOrder();
  await expect(workflow).toContainText(app('electricity.order.nextAction.accept_contract'));

  state.context = 'staff';
  await page.goto(`/admin/electricity-orders?orderId=${orderId}`);
  await page.locator('#electricity-review-reason').fill(bankRefundReason);
  await page
    .getByRole('button', { name: admin('admin.electricityOrders.reject'), exact: true })
    .click();
  await expect(dialog).toContainText(bankRefundReason);
  const refundAmount = dialog.getByText(admin('admin.electricityOrders.reviewRefund'), {
    exact: true,
  });
  await expect(refundAmount.locator('..')).toContainText(money);
  await expect(confirm).toBeDisabled();
  expect(state.stage).toBe('confirmed');
  await approveRiskConfirmation(page, locale, 'both');
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  expect(state.stage).toBe('processing');

  state.context = 'customer';
  await readOrder();
  await expect(workflow).toContainText(app('electricity.order.nextAction.await_refund'));
  await expect(
    page.getByText(app('electricity.order.detail.refundPending'), { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(app('electricity.order.detail.financiallyClosed'), { exact: true })
  ).toHaveCount(0);
  // Simulate a later worker receipt independently of the staff rejection response.
  state.stage = 'completed';
  await page.reload();
  await expect(
    page.getByText(app('electricity.order.detail.financiallyClosed'), { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(app('electricity.order.refundedAmount'), { exact: true }).locator('..')
  ).toContainText(money);
}
