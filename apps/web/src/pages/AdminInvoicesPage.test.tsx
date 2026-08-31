import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminInvoicesPage from './AdminInvoicesPage.js'

const INVOICE_A = '11111111-1111-7111-8111-111111111111'
const INVOICE_B = '22222222-2222-7222-8222-222222222222'

function invoiceDto(invoiceId: string) {
  return {
    invoiceId,
    state: 'Unpaid',
    issuedAt: '2026-08-01T00:00:00.000Z',
    payableFrom: '2026-08-01T00:00:00.000Z',
    dueAt: '2026-09-15T08:00:00.000Z',
    canOverride: true,
    dueAtOverride: null,
  }
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('AdminInvoicesPage lookup binding (T-04.1.03.03)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith(`/api/admin/invoices/${INVOICE_A}/due-at`)) {
          return {
            ok: true,
            json: async () => invoiceDto(INVOICE_A),
          }
        }
        if (url.endsWith('/api/admin/config/invoice-reminder-offsets')) {
          return { ok: true, json: async () => [] }
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

  it('hides the override form when the lookup ID is edited after loading', async () => {
    await act(async () => {
      root.render(<AdminInvoicesPage />)
    })

    const lookup = container.querySelector('#invoice-id') as HTMLInputElement
    expect(lookup).toBeTruthy()

    await act(async () => {
      setInputValue(lookup, INVOICE_A)
    })

    const loadForm = lookup.closest('form')
    expect(loadForm).toBeTruthy()
    await act(async () => {
      loadForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(container.querySelector('[data-testid="loaded-invoice-id"]')?.textContent).toBe(
      INVOICE_A,
    )
    expect(container.querySelector('#due-at')).toBeTruthy()
    expect(container.querySelector('#override-reason')).toBeTruthy()

    await act(async () => {
      setInputValue(lookup, INVOICE_B)
    })

    expect(container.querySelector('[data-testid="loaded-invoice-id"]')).toBeNull()
    expect(container.querySelector('#due-at')).toBeNull()
    expect(container.querySelector('#override-reason')).toBeNull()
    expect(container.textContent).not.toContain('Apply due-date override')
  })
})
