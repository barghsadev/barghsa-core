/**
 * Customer invoice details page helpers (T-04.1.05.04).
 *
 * Typed fetch wrappers plus IRR formatting. Amounts stay decimal-digit
 * strings end-to-end so int8 IRR never passes through JSON Number.
 */

import type { Locale } from '@barghsa/i18n'

export type InvoiceCorrectionRole =
  | 'original'
  | 'replacement'
  | 'adjustment_charge'
  | 'adjustment_credit'

export interface CustomerInvoiceLine {
  description: string
  quantity: number
  unitPrice: string
  lineTotal: string
  vatRate: number
  vatAmount: string
  isTaxable: boolean
}

export interface CustomerInvoiceNode {
  invoiceId: string
  role: InvoiceCorrectionRole
  state: string
  totalAmount: string
  paidAmount: string
  refundedAmount: string
  accountingAmount: string | null
  adjustmentKind: 'charge' | 'credit' | null
  issuedAt: string | null
  payableFrom: string | null
  dueAt: string | null
  cancelledAt: string | null
  createdAt: string
  replacesInvoiceId: string | null
  adjustmentForInvoiceId: string | null
  explanation: string | null
  lines: CustomerInvoiceLine[]
}

export interface CustomerInvoiceDetails {
  viewedInvoiceId: string
  originalInvoiceId: string
  invoice: CustomerInvoiceNode
  chain: CustomerInvoiceNode[]
}

export interface CustomerInvoiceListItem {
  invoiceId: string
  role: InvoiceCorrectionRole
  state: string
  totalAmount: string
  accountingAmount: string | null
  adjustmentKind: 'charge' | 'credit' | null
  issuedAt: string | null
  dueAt: string | null
  createdAt: string
  explanation: string | null
}

export interface CustomerInvoiceList {
  invoices: CustomerInvoiceListItem[]
}

export class InvoiceRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'InvoiceRequestError'
    this.status = status
  }
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function fetchInvoiceDetails(
  invoiceId: string,
): Promise<CustomerInvoiceDetails> {
  const res = await fetch(`/api/invoices/${invoiceId}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    throw new InvoiceRequestError(404, 'not found')
  }
  if (!res.ok) {
    throw new InvoiceRequestError(res.status, `HTTP ${res.status}`)
  }
  return readJson<CustomerInvoiceDetails>(res)
}

export async function fetchInvoiceList(): Promise<CustomerInvoiceList> {
  const res = await fetch('/api/invoices', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new InvoiceRequestError(res.status, `HTTP ${res.status}`)
  }
  return readJson<CustomerInvoiceList>(res)
}

/** Format a decimal-digit IRR string with grouping separators. */
export function formatIrr(amount: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
      BigInt(amount),
    )
  } catch {
    return amount
  }
}

export function formatInvoiceInstant(
  iso: string | null,
  locale: Locale,
): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return iso
  }
}

export function roleI18nKey(role: InvoiceCorrectionRole): string {
  return `invoices.details.role.${role}`
}

export function stateI18nKey(state: string): string {
  return `invoices.state.${state}`
}
