import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminWalletReceiptsPage from './AdminWalletReceiptsPage.js'

const TX_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const TX_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

function receiptDto(transactionId: string, overrides: Record<string, unknown> = {}) {
  return {
    transactionId,
    walletId: '11111111-1111-7111-8111-111111111111',
    amount: '250000',
    currency: 'IRR',
    state: 'Pending',
    paymentDate: '2026-08-15',
    payerReference: `TRK-${transactionId.slice(0, 4)}`,
    attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
    attachmentUrl: null,
    customerNote: 'Branch transfer',
    submittedAt: '2026-09-01T10:00:00.000Z',
    canDecide: true,
    staffDecision: null,
    creditTransactionId: null,
    ...overrides,
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AdminWalletReceiptsPage (T-04.2.02.04)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.endsWith('/api/admin/config/wallet-top-up-limit') && method === 'GET') {
          return { ok: true, json: async () => ({ limitIrR: 2_000_000_000, version: 0 }) }
        }
        if (url.endsWith('/api/admin/wallet/bank-receipt-top-ups') && method === 'GET') {
          return {
            ok: true,
            json: async () => ({ items: [receiptDto(TX_A), receiptDto(TX_B)] }),
          }
        }
        if (url.endsWith(`/api/admin/wallet/bank-receipt-top-ups/${TX_A}`) && method === 'GET') {
          return { ok: true, json: async () => receiptDto(TX_A) }
        }
        if (url.endsWith(`/api/admin/wallet/bank-receipt-top-ups/${TX_B}`) && method === 'GET') {
          return { ok: true, json: async () => receiptDto(TX_B) }
        }
        if (url.endsWith(`/${TX_A}/confirm`) && method === 'POST') {
          return {
            ok: true,
            json: async () =>
              receiptDto(TX_A, {
                state: 'Released',
                canDecide: false,
                creditTransactionId: 'credit-1',
              }),
          }
        }
        if (url.endsWith(`/${TX_A}/reject`) && method === 'POST') {
          return {
            ok: true,
            json: async () =>
              receiptDto(TX_A, {
                state: 'Rejected',
                canDecide: false,
              }),
          }
        }
        if (url.includes(`/${TX_A}/allocation?`) && method === 'GET') {
          return {
            ok: true,
            json: async () => ({
              transactionId: TX_A,
              invoiceId: INVOICE_ID,
              invoiceState: 'Unpaid',
              receiptAmount: '250000',
              remaining: '100000',
              invoiceAllocation: '100000',
              walletCreditAmount: '150000',
              isOverpayment: true,
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
      }),
    )
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders pending receipts and confirms the selected one', async () => {
    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    expect(container.textContent).toContain('Staff wallet receipt review')
    expect(container.textContent).toContain('TRK-aaaa')
    expect(container.textContent).toContain('250,000')

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Confirm and credit wallet',
    )
    expect(confirm).toBeTruthy()
    await act(async () => {
      confirm!.click()
    })
    await flush()

    const fetchMock = vi.mocked(fetch)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/${TX_A}/confirm`) &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true)
    expect(container.textContent).toContain('Receipt confirmed and wallet credited')
  })

  it('requires a rejection reason before posting reject', async () => {
    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    const form = container.querySelector('#reject-reason')?.closest('form')
    expect(form).toBeTruthy()
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(container.textContent).toContain('A customer-visible reason is required')
    const fetchMock = vi.mocked(fetch)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/reject')),
    ).toBe(false)
  })

  it('previews overpayment and confirms with the invoice id', async () => {
    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    const invoiceInput = container.querySelector('#apply-invoice-id') as HTMLInputElement | null
    expect(invoiceInput).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(invoiceInput, INVOICE_ID)
      invoiceInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    await flush()

    expect(container.textContent).toContain('The receipt exceeds the invoice remaining')
    expect(container.textContent).toContain('Excess credited to wallet')

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Confirm and credit wallet',
    )
    await act(async () => {
      confirm!.click()
    })
    await flush()

    const fetchMock = vi.mocked(fetch)
    const confirmCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/${TX_A}/confirm`) &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(confirmCall).toBeTruthy()
    expect((confirmCall?.[1] as RequestInit).body).toBe(JSON.stringify({ invoiceId: INVOICE_ID }))
  })
})
