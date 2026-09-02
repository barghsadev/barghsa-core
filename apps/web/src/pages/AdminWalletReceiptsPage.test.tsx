import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@barghsa/shared/errors'
import { setCsrfToken } from '../lib/csrf.js'
import AdminWalletReceiptsPage from './AdminWalletReceiptsPage.js'

const TX_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const TX_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const CSRF = 'csrf-wallet-receipt'

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

function stepUpForbidden(): Response {
  return {
    ok: false,
    status: 403,
    json: async () => ({
      error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code, message: 'Re-verify your identity' },
    }),
  } as Response
}

async function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.endsWith('/api/admin/config/wallet-top-up-limit') && method === 'GET') {
    return { ok: true, json: async () => ({ limitIrR: 2_000_000_000, version: 0 }) } as Response
  }
  if (url.endsWith('/api/admin/wallet/bank-receipt-top-ups') && method === 'GET') {
    return {
      ok: true,
      json: async () => ({ items: [receiptDto(TX_A), receiptDto(TX_B)] }),
    } as Response
  }
  if (url.endsWith(`/api/admin/wallet/bank-receipt-top-ups/${TX_A}`) && method === 'GET') {
    return { ok: true, json: async () => receiptDto(TX_A) } as Response
  }
  if (url.endsWith(`/api/admin/wallet/bank-receipt-top-ups/${TX_B}`) && method === 'GET') {
    return { ok: true, json: async () => receiptDto(TX_B) } as Response
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
    } as Response
  }
  if (url.endsWith(`/${TX_A}/reject`) && method === 'POST') {
    return {
      ok: true,
      json: async () =>
        receiptDto(TX_A, {
          state: 'Rejected',
          canDecide: false,
        }),
    } as Response
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
    } as Response
  }
  return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response
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
    setCsrfToken(CSRF)
    vi.stubGlobal('fetch', vi.fn(defaultFetch))
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

    const confirm = container.querySelector(
      '[data-testid="wallet-receipt-confirm"]',
    ) as HTMLButtonElement | null
    expect(confirm).toBeTruthy()
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
    expect((confirmCall?.[1] as RequestInit).body).toBe(JSON.stringify({}))
    expect(new Headers((confirmCall?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe(CSRF)
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
    expect(container.querySelector('#reject-reason')?.getAttribute('aria-invalid')).toBe('true')
    const fetchMock = vi.mocked(fetch)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/reject')),
    ).toBe(false)
  })

  it('rejects with a customer-visible reason and never posts confirm', async () => {
    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    const textarea = container.querySelector('#reject-reason') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '  Illegible scan  ')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('[data-testid="wallet-receipt-reject"]')?.dispatchEvent(
        new Event('click', { bubbles: true, cancelable: true }),
      )
      textarea!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    const fetchMock = vi.mocked(fetch)
    const rejectCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/${TX_A}/reject`) &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(rejectCall).toBeTruthy()
    expect((rejectCall?.[1] as RequestInit).body).toBe(JSON.stringify({ reason: 'Illegible scan' }))
    expect(new Headers((rejectCall?.[1] as RequestInit).headers).get('X-CSRF-Token')).toBe(CSRF)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/confirm') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
    expect(container.textContent).toContain('Receipt rejected; balance unchanged')
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

    await act(async () => {
      ;(container.querySelector('[data-testid="wallet-receipt-confirm"]') as HTMLButtonElement).click()
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

  it('opens a step-up challenge on confirm, then retries after verification', async () => {
    let confirmCalls = 0
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith(`/${TX_A}/confirm`) && method === 'POST') {
        confirmCalls += 1
        if (confirmCalls === 1) return stepUpForbidden()
        return {
          ok: true,
          json: async () =>
            receiptDto(TX_A, {
              state: 'Released',
              canDecide: false,
              creditTransactionId: 'credit-1',
            }),
        } as Response
      }
      if (url.endsWith('/api/auth/step-up') && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({ password: 'secret' })
        return { ok: true, json: async () => ({ message: 'ok' }) } as Response
      }
      return defaultFetch(input, init)
    })

    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    await act(async () => {
      ;(container.querySelector('[data-testid="wallet-receipt-confirm"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(confirmCalls).toBe(1)
    expect(container.querySelector('[data-testid="wallet-receipt-step-up-dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('Verification required')

    const password = container.querySelector(
      '[data-testid="wallet-receipt-step-up-password"]',
    ) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(password, 'secret')
      password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="wallet-receipt-step-up-submit"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(confirmCalls).toBe(2)
    expect(container.querySelector('[data-testid="wallet-receipt-step-up-dialog"]')).toBeNull()
    expect(container.textContent).toContain('Receipt confirmed and wallet credited')
  })

  it('restores focus to confirm when the step-up dialog is cancelled', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith(`/${TX_A}/confirm`) && method === 'POST') return stepUpForbidden()
      return defaultFetch(input, init)
    })

    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()

    const confirm = container.querySelector(
      '[data-testid="wallet-receipt-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })
    await flush()
    expect(container.querySelector('[data-testid="wallet-receipt-step-up-dialog"]')).not.toBeNull()

    await act(async () => {
      ;(container.querySelector('[data-testid="wallet-receipt-step-up-cancel"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(container.querySelector('[data-testid="wallet-receipt-step-up-dialog"]')).toBeNull()
    expect(document.activeElement).toBe(confirm)
  })

  it('renders Persian copy when the document language is fa', async () => {
    document.documentElement.lang = 'fa'
    await act(async () => {
      root.render(<AdminWalletReceiptsPage />)
    })
    await flush()
    expect(container.textContent).toContain('بررسی رسید شارژ کیف پول')
    expect(container.textContent).toContain('تأیید و واریز به کیف پول')
    expect(container.textContent).toContain('رد رسید')
  })
})
