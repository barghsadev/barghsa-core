import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvoiceDetailsPage } from './InvoiceDetailsPage.js'
import type { CustomerInvoiceDetails } from '../lib/customer-invoices.js'

const ORIGINAL_ID = '22222222-2222-7222-8222-222222222222'
const REPLACEMENT_ID = '33333333-3333-7333-8333-333333333333'
const ADJUSTMENT_ID = '44444444-4444-7444-8444-444444444444'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
  }) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
}))

function node(overrides: Partial<CustomerInvoiceDetails['invoice']> & { invoiceId: string }) {
  return {
    role: 'original' as const,
    state: 'Unpaid',
    totalAmount: '100000',
    paidAmount: '0',
    refundedAmount: '0',
    accountingAmount: '100000',
    adjustmentKind: null,
    issuedAt: '2026-08-01T10:00:00.000Z',
    payableFrom: '2026-08-01T10:00:00.000Z',
    dueAt: '2026-08-08T10:00:00.000Z',
    cancelledAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    replacesInvoiceId: null,
    adjustmentForInvoiceId: null,
    explanation: null,
    lines: [
      {
        description: 'Usage',
        quantity: 1,
        unitPrice: '100000',
        lineTotal: '100000',
        vatRate: 0,
        vatAmount: '0',
        isTaxable: false,
      },
    ],
    ...overrides,
  }
}

function replacementPayload(): CustomerInvoiceDetails {
  const original = node({
    invoiceId: ORIGINAL_ID,
    state: 'Cancelled',
    cancelledAt: '2026-08-02T10:00:00.000Z',
  })
  const replacement = node({
    invoiceId: REPLACEMENT_ID,
    role: 'replacement',
    totalAmount: '200000',
    replacesInvoiceId: ORIGINAL_ID,
    explanation: 'Quantity was billed as 1 instead of 2',
    lines: [
      {
        description: 'Corrected usage',
        quantity: 2,
        unitPrice: '100000',
        lineTotal: '200000',
        vatRate: 0,
        vatAmount: '0',
        isTaxable: false,
      },
    ],
  })
  return {
    viewedInvoiceId: REPLACEMENT_ID,
    originalInvoiceId: ORIGINAL_ID,
    invoice: replacement,
    chain: [original, replacement],
  }
}

function adjustmentPayload(): CustomerInvoiceDetails {
  const original = node({
    invoiceId: ORIGINAL_ID,
    state: 'Paid',
    paidAmount: '100000',
  })
  const adjustment = node({
    invoiceId: ADJUSTMENT_ID,
    role: 'adjustment_charge',
    totalAmount: '50000',
    adjustmentKind: 'charge',
    adjustmentForInvoiceId: ORIGINAL_ID,
    explanation: 'Post-payment quantity increase',
    lines: [
      {
        description: 'Post-payment quantity increase',
        quantity: 1,
        unitPrice: '50000',
        lineTotal: '50000',
        vatRate: 0,
        vatAmount: '0',
        isTaxable: false,
      },
    ],
  })
  return {
    viewedInvoiceId: ORIGINAL_ID,
    originalInvoiceId: ORIGINAL_ID,
    invoice: original,
    chain: [original, adjustment],
  }
}

describe('InvoiceDetailsPage (T-04.1.05.04)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the original invoice and the replacement with its explanation', async () => {
    const payload = replacementPayload()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}`)) {
          return { ok: true, status: 200, json: async () => payload }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={REPLACEMENT_ID} />)
    })

    expect(
      container.querySelector(`[data-testid="invoice-card-${ORIGINAL_ID}"]`),
    ).toBeTruthy()
    expect(
      container.querySelector(`[data-testid="invoice-card-${REPLACEMENT_ID}"]`),
    ).toBeTruthy()
    expect(
      container.querySelector(`[data-testid="invoice-explanation-${REPLACEMENT_ID}"]`)
        ?.textContent,
    ).toContain('Quantity was billed as 1 instead of 2')
    expect(container.textContent).toContain('Original invoice')
    expect(container.textContent).toContain('Replacement')
    expect(container.textContent).toContain('Corrected usage')
  })

  it('shows linked post-payment adjustments with explanations', async () => {
    const payload = adjustmentPayload()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => payload,
      })),
    )

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={ORIGINAL_ID} />)
    })

    expect(
      container.querySelector(`[data-testid="invoice-explanation-${ADJUSTMENT_ID}"]`)
        ?.textContent,
    ).toContain('Post-payment quantity increase')
    expect(container.textContent).toContain('Adjustment — additional charge')
  })

  it('shows a not-found message when the API returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' }),
      })),
    )

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={ORIGINAL_ID} />)
    })

    expect(container.textContent).toContain('Invoice not found')
  })

  it('shows the bank-receipt upload form for an unpaid invoice', async () => {
    const payload = replacementPayload()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}`)) {
          return { ok: true, status: 200, json: async () => payload }
        }
        if (url.endsWith('/api/profiles')) {
          return { ok: true, status: 200, json: async () => ({ activeProfileId: ORIGINAL_ID }) }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={REPLACEMENT_ID} />)
    })

    expect(container.querySelector('[data-testid="invoice-receipt-form"]')).toBeTruthy()
    expect(container.textContent).toContain('Submit a bank receipt')
  })

  it('hides the bank-receipt upload form for a paid invoice', async () => {
    const payload = adjustmentPayload()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => payload,
      })),
    )

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={ORIGINAL_ID} />)
    })

    expect(container.querySelector('[data-testid="invoice-receipt-form"]')).toBeNull()
  })

  it('does not submit a receipt when the amount is zero', async () => {
    const payload = replacementPayload()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}`) && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => payload }
      }
      if (url.endsWith('/api/profiles')) {
        return { ok: true, status: 200, json: async () => ({ activeProfileId: ORIGINAL_ID }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={REPLACEMENT_ID} />)
    })

    const amount = container.querySelector(
      '[data-testid="invoice-receipt-amount"]',
    ) as HTMLInputElement
    const date = container.querySelector('[data-testid="invoice-receipt-date"]') as HTMLInputElement
    const payer = container.querySelector(
      '[data-testid="invoice-receipt-payer-ref"]',
    ) as HTMLInputElement
    const form = container.querySelector('[data-testid="invoice-receipt-form"]') as HTMLFormElement

    await act(async () => {
      amount.value = '0'
      amount.dispatchEvent(new Event('input', { bubbles: true }))
      amount.dispatchEvent(new Event('change', { bubbles: true }))
      date.value = '2026-08-15'
      date.dispatchEvent(new Event('input', { bubbles: true }))
      date.dispatchEvent(new Event('change', { bubbles: true }))
      payer.value = 'TRK-1'
      payer.dispatchEvent(new Event('input', { bubbles: true }))
      payer.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/bank-receipts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
    expect(container.querySelector('[data-testid="invoice-receipt-error"]')?.textContent).toContain(
      'positive integer',
    )
  })

  it('does not submit a receipt when a decimal amount would otherwise concatenate to a valid integer', async () => {
    const payload = replacementPayload()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}`) && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => payload }
      }
      if (url.endsWith('/api/profiles')) {
        return { ok: true, status: 200, json: async () => ({ activeProfileId: ORIGINAL_ID }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={REPLACEMENT_ID} />)
    })

    const amount = container.querySelector(
      '[data-testid="invoice-receipt-amount"]',
    ) as HTMLInputElement
    const date = container.querySelector('[data-testid="invoice-receipt-date"]') as HTMLInputElement
    const payer = container.querySelector(
      '[data-testid="invoice-receipt-payer-ref"]',
    ) as HTMLInputElement
    const form = container.querySelector('[data-testid="invoice-receipt-form"]') as HTMLFormElement
    const nativeInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

    await act(async () => {
      nativeInput?.call(amount, '12.5')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
      amount.dispatchEvent(new Event('change', { bubbles: true }))
      nativeInput?.call(date, '2026-08-15')
      date.dispatchEvent(new Event('input', { bubbles: true }))
      nativeInput?.call(payer, 'TRK-1')
      payer.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(amount.value).toBe('12.5')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/bank-receipts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
    expect(container.querySelector('[data-testid="invoice-receipt-error"]')?.textContent).toContain(
      'positive integer',
    )
  })

  it('uploads a valid receipt and posts a Submitted bank receipt', async () => {
    const payload = replacementPayload()
    const attachmentKey = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}`) && method === 'GET') {
        return { ok: true, status: 200, json: async () => payload }
      }
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ activeProfileId: ORIGINAL_ID }) }
      }
      if (url.endsWith('/api/upload/presigned-url') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: attachmentKey, presignedUrl: 'https://s3.test/put' }),
        }
      }
      if (url === 'https://s3.test/put' && method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (url.includes('/verify') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ status: 'confirmed' }) }
      }
      if (url.includes('/record') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ status: 'recorded' }) }
      }
      if (url.endsWith(`/api/invoices/${REPLACEMENT_ID}/bank-receipts`) && method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ok: true,
            receiptId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
            amount: '250000',
            state: 'Submitted',
            attachmentKey,
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<InvoiceDetailsPage invoiceId={REPLACEMENT_ID} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const amount = container.querySelector(
      '[data-testid="invoice-receipt-amount"]',
    ) as HTMLInputElement
    const date = container.querySelector('[data-testid="invoice-receipt-date"]') as HTMLInputElement
    const payer = container.querySelector(
      '[data-testid="invoice-receipt-payer-ref"]',
    ) as HTMLInputElement
    const fileInput = container.querySelector(
      '[data-testid="invoice-receipt-file"]',
    ) as HTMLInputElement
    const form = container.querySelector('[data-testid="invoice-receipt-form"]') as HTMLFormElement

    const nativeInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      nativeInput?.call(amount, '250000')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
      nativeInput?.call(date, '2026-08-15')
      date.dispatchEvent(new Event('input', { bubbles: true }))
      nativeInput?.call(payer, 'TRK-998877')
      payer.dispatchEvent(new Event('input', { bubbles: true }))
      const file = new File(['%PDF-1.4 receipt'], 'receipt.pdf', { type: 'application/pdf' })
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve()
      })
      if (container.querySelector('[data-testid="invoice-receipt-success"]')) break
    }

    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/bank-receipts') &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(submitCall).toBeTruthy()
    expect(JSON.parse(String((submitCall![1] as RequestInit).body))).toEqual({
      amount: '250000',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey,
    })
    expect(container.querySelector('[data-testid="invoice-receipt-success"]')?.textContent).toContain(
      'pending finance confirmation',
    )
  })
})
