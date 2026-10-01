import { exactIrr, formatNumber } from '@barghsa/i18n/numbers';
/**
 * Customer invoice details page helpers (T-04.1.05.04).
 *
 * Typed fetch wrappers plus IRR formatting. Amounts stay decimal-digit
 * strings end-to-end so int8 IRR never passes through JSON Number.
 */

import type { Locale } from '@barghsa/i18n/app';

export type InvoiceCorrectionRole =
  'original' | 'replacement' | 'adjustment_charge' | 'adjustment_credit';

export interface CustomerInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  vatRate: number;
  vatAmount: string;
  isTaxable: boolean;
}

export interface CustomerInvoiceNode {
  invoiceId: string;
  role: InvoiceCorrectionRole;
  state: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  accountingAmount: string | null;
  adjustmentKind: 'charge' | 'credit' | null;
  issuedAt: string | null;
  payableFrom: string | null;
  dueAt: string | null;
  periodStart?: string;
  periodEnd?: string;
  dueAtOverrideReason?: string | null;
  cancelledAt: string | null;
  createdAt: string;
  replacesInvoiceId: string | null;
  adjustmentForInvoiceId: string | null;
  explanation: string | null;
  lines: CustomerInvoiceLine[];
}

export interface InvoicePaymentActivity {
  id: string;
  source: 'wallet' | 'bank_receipt';
  amount: string;
  state: string;
  createdAt: string;
}
export interface InvoiceReceiptActivity {
  id: string;
  amount: string;
  state: string;
  paymentDate: string;
  payerReference: string;
  bankName: string | null;
  customerNote: string | null;
  rejectionReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  /** Omitted only while an older API deployment is still serving this page. */
  statusHistory?: Array<{
    state: 'Submitted' | 'UnderReview' | 'Confirmed' | 'Rejected';
    occurredAt: string;
    backfilled: boolean;
  }>;
}
export interface InvoiceRefundActivity {
  id: string;
  amount: string;
  state: string;
  destination: 'wallet' | 'external_bank';
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInvoiceDetails {
  viewedInvoiceId: string;
  originalInvoiceId: string;
  consultationId?: string | null;
  contractId?: string | null;
  contractState?: string | null;
  electricityOrderId?: string | null;
  savingOrderId?: string | null;
  solarRequestId?: string | null;
  invoice: CustomerInvoiceNode;
  chain: CustomerInvoiceNode[];
  /** Optional during rolling deployment of the expanded details API. */
  payments?: InvoicePaymentActivity[];
  bankReceipts?: InvoiceReceiptActivity[];
  refunds?: InvoiceRefundActivity[];
}

export interface CustomerInvoiceListItem {
  invoiceId: string;
  role: InvoiceCorrectionRole;
  state: string;
  totalAmount: string;
  paidAmount?: string;
  accountingAmount: string | null;
  adjustmentKind: 'charge' | 'credit' | null;
  issuedAt: string | null;
  dueAt: string | null;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
  explanation: string | null;
}

export interface CustomerInvoiceList {
  invoices: CustomerInvoiceListItem[];
  nextBefore?: string | null;
}

export interface CustomerBankReceiptListItem {
  receiptId: string;
  invoiceId: string;
  amount: string;
  bankName: string | null;
  state: 'Submitted' | 'UnderReview' | 'Confirmed' | 'Rejected';
  paymentDate: string;
  submittedAt: string;
}

export interface CustomerBankReceiptPage {
  items: CustomerBankReceiptListItem[];
  nextCursor: { beforeAt: string; beforeId: string } | null;
}

export async function fetchBankReceiptPage(
  options: {
    q?: string;
    sort?: 'submitted_at:desc' | 'submitted_at:asc';
    from?: string | undefined;
    to?: string | undefined;
    min?: string | undefined;
    max?: string | undefined;
    state?: CustomerBankReceiptListItem['state'];
    statuses?: readonly CustomerBankReceiptListItem['state'][];
    cursor?: CustomerBankReceiptPage['nextCursor'];
    signal?: AbortSignal;
  } = {}
): Promise<CustomerBankReceiptPage> {
  const query = new URLSearchParams();
  if (options.q) query.set('q', options.q);
  if (options.sort && options.sort !== 'submitted_at:desc') query.set('sort', options.sort);
  for (const field of ['from', 'to', 'min', 'max'] as const)
    if (options[field] !== undefined) query.set(field, options[field]);
  if (options.state) query.set('state', options.state);
  if (options.statuses?.length) query.set('statuses', options.statuses.join(','));
  if (options.cursor) {
    query.set('beforeAt', options.cursor.beforeAt);
    query.set('beforeId', options.cursor.beforeId);
  }
  const response = await fetch(`/api/invoices/bank-receipts${query.size ? `?${query}` : ''}`, {
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new InvoiceRequestError(response.status, 'Could not load bank receipts');
  return (await response.json()) as CustomerBankReceiptPage;
}

export class InvoiceRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'InvoiceRequestError';
    this.status = status;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function fetchInvoiceDetails(invoiceId: string): Promise<CustomerInvoiceDetails> {
  const res = await fetch(`/api/invoices/${invoiceId}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) {
    throw new InvoiceRequestError(404, 'not found');
  }
  if (!res.ok) {
    throw new InvoiceRequestError(res.status, `HTTP ${res.status}`);
  }
  return readJson<CustomerInvoiceDetails>(res);
}

export async function fetchInvoiceList(
  unpaidOnly = false,
  options: {
    before?: string | undefined;
    statuses?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    q?: string | undefined;
    sort?: string | undefined;
    min?: string | undefined;
    max?: string | undefined;
    signal?: AbortSignal | undefined;
  } = {}
): Promise<CustomerInvoiceList> {
  const params = new URLSearchParams();
  if (unpaidOnly) params.set('status', 'unpaid');
  for (const key of ['before', 'statuses', 'from', 'to', 'q', 'sort', 'min', 'max'] as const) {
    const value = options[key];
    if (value && !(key === 'sort' && value === 'created_at:desc')) params.set(key, value);
  }
  const res = await fetch(`/api/invoices${params.size ? `?${params}` : ''}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    throw new InvoiceRequestError(res.status, `HTTP ${res.status}`);
  }
  return readJson<CustomerInvoiceList>(res);
}

/** Format a decimal-digit IRR string with grouping separators. */
export function formatIrr(amount: string, locale: Locale): string {
  try {
    return formatNumber(exactIrr(amount), locale);
  } catch {
    return amount;
  }
}

export function roleI18nKey(role: InvoiceCorrectionRole): string {
  return `invoices.details.role.${role}`;
}

export function stateI18nKey(state: string): string {
  return `invoices.state.${state}`;
}
