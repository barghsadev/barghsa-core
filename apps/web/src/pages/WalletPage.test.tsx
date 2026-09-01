import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPage } from './WalletPage.js'

const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function setTextAreaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('WalletPage (T-04.2.02.01 / T-04.2.02.03)', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    assign = vi.fn()
    vi.stubGlobal('location', { assign, href: 'http://localhost/' })
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return jsonResponse({ activeProfileId: PROFILE_ID })
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}/top-ups`) && method === 'POST') {
        return jsonResponse(
          { redirectUrl: 'https://pay.test/start?authority=abc' },
          201,
        )
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}`) && method === 'GET') {
        return jsonResponse({
          balance: 1_500_000,
          currency: 'IRR',
          onlineTopUpLimit: 2_000_000_000,
        })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function flushFetches() {
    await act(async () => {
      await Promise.all(fetchMock.mock.results.map((entry) => entry.value).filter(Boolean))
    })
  }

  async function renderPage() {
    await act(async () => {
      root.render(<WalletPage />)
    })
    for (let i = 0; i < 10; i++) {
      await flushFetches()
      if (
        container.querySelector('[data-testid="wallet-loaded"]') ||
        container.querySelector('[data-testid="wallet-error"]')
      ) {
        break
      }
    }
  }

  it('loads the active profile wallet and shows the available balance', async () => {
    await renderPage()
    await flushFetches()
    expect(container.textContent).toContain('Wallet')
    const balance = container.querySelector('[data-testid="wallet-balance"]')?.textContent ?? ''
    expect(balance.replace(/[^\d]/g, '')).toBe('1500000')
    expect(balance).toContain('IRR')
    expect(container.querySelector('[data-testid="wallet-page"]')?.getAttribute('dir')).toBe('ltr')
    expect(container.querySelector('#top-up-amount-hint')?.textContent).toContain('2,000,000,000')
  })

  it('posts the amount and redirects the browser to the gateway', async () => {
    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement

    await act(async () => {
      setInputValue(input, '250000')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    const topUpCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).includes('/top-ups') && (init as RequestInit | undefined)?.method === 'POST'
    })
    expect(topUpCall).toBeTruthy()
    const init = topUpCall![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ amount: 250000 })
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy()
    expect(assign).toHaveBeenCalledWith('https://pay.test/start?authority=abc')
  })

  it('does not redirect when the API returns a non-https URL', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return jsonResponse({ activeProfileId: PROFILE_ID })
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}`) && method === 'GET') {
        return jsonResponse({ balance: 0, currency: 'IRR' })
      }
      if (url.includes('/top-ups') && method === 'POST') {
        return jsonResponse({ redirectUrl: 'javascript:alert(1)' }, 201)
      }
      return jsonResponse({}, 404)
    })

    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => {
      setInputValue(input, '250000')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    expect(assign).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="wallet-error"]')?.textContent).toContain(
      'The payment gateway is unavailable',
    )
  })

  it('blocks submit client-side when the amount exceeds the advertised onlineTopUpLimit', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return jsonResponse({ activeProfileId: PROFILE_ID })
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}`) && method === 'GET') {
        return jsonResponse({
          balance: 0,
          currency: 'IRR',
          onlineTopUpLimit: 50_000,
          configVersion: 2,
        })
      }
      return jsonResponse({}, 404)
    })

    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => {
      setInputValue(input, '50001')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/top-ups') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
    expect(container.querySelector('[data-testid="wallet-error"]')?.textContent).toContain(
      'Amount exceeds the online top-up limit',
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows the limit-exceeded error and does not redirect', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return jsonResponse({ activeProfileId: PROFILE_ID })
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}`) && method === 'GET') {
        return jsonResponse({ balance: 0, currency: 'IRR' })
      }
      if (url.includes('/top-ups')) {
        return jsonResponse(
          { message: 'Online top-up amount 2000000001 IRR exceeds the configured per-transaction limit of 2000000000 IRR' },
          400,
        )
      }
      return jsonResponse({}, 404)
    })

    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => {
      setInputValue(input, '2000000001')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    expect(container.querySelector('[data-testid="wallet-error"]')?.textContent).toContain(
      'Amount exceeds the online top-up limit',
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows an empty state when there is no active profile', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/profiles')) {
        return jsonResponse({ activeProfileId: null })
      }
      return jsonResponse({}, 404)
    })
    await renderPage()
    expect(container.querySelector('[data-testid="wallet-error"]')?.textContent).toContain(
      'No active profile found',
    )
    expect(container.querySelector('[data-testid="wallet-submit"]')).toBeNull()
  })

  it('renders RTL when the document language is Persian', async () => {
    document.documentElement.lang = 'fa'
    await renderPage()
    expect(container.querySelector('[data-testid="wallet-page"]')?.getAttribute('dir')).toBe('rtl')
    expect(container.textContent).toContain('کیف پول')
  })

  it('submits a normalized IRR amount when Persian numerals are entered in the Persian locale', async () => {
    document.documentElement.lang = 'fa'
    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement

    await act(async () => {
      setInputValue(input, '۲۵۰٬۰۰۰')
    })
    expect(input.value).toBe('250000')

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    const topUpCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).includes('/top-ups') && (init as RequestInit | undefined)?.method === 'POST'
    })
    expect(topUpCall).toBeTruthy()
    expect(JSON.parse(String((topUpCall![1] as RequestInit).body))).toEqual({ amount: 250000 })
    expect(assign).toHaveBeenCalledWith('https://pay.test/start?authority=abc')
  })

  it('submits a normalized IRR amount when Arabic-Indic numerals are entered in the Persian locale', async () => {
    document.documentElement.lang = 'fa'
    await renderPage()
    const input = container.querySelector('[data-testid="wallet-amount"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement

    await act(async () => {
      setInputValue(input, '٢٥٠٠٠٠')
    })
    expect(input.value).toBe('250000')

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    const topUpCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).includes('/top-ups') && (init as RequestInit | undefined)?.method === 'POST'
    })
    expect(topUpCall).toBeTruthy()
    expect(JSON.parse(String((topUpCall![1] as RequestInit).body))).toEqual({ amount: 250000 })
    expect(assign).toHaveBeenCalledWith('https://pay.test/start?authority=abc')
  })

  it('submits a bank receipt top-up after uploading the file and does not redirect', async () => {
    const attachmentKey = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/profiles') && method === 'GET') {
        return jsonResponse({ activeProfileId: PROFILE_ID })
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}/bank-receipt-top-ups`) && method === 'POST') {
        return jsonResponse(
          {
            ok: true,
            transactionId: 'tx-receipt-1',
            amount: '250000',
            currency: 'IRR',
            state: 'Pending',
            attachmentKey,
          },
          201,
        )
      }
      if (url.includes(`/api/wallet/${PROFILE_ID}`) && method === 'GET') {
        return jsonResponse({ balance: 1_500_000, currency: 'IRR' })
      }
      if (url.endsWith('/api/upload/presigned-url') && method === 'POST') {
        return jsonResponse({
          key: attachmentKey,
          presignedUrl: 'https://s3.test/put',
          expiresIn: 3600,
        })
      }
      if (url === 'https://s3.test/put' && method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (url.includes('/verify') && method === 'POST') {
        return jsonResponse({ key: attachmentKey, exists: true, status: 'confirmed' })
      }
      if (url.includes('/record') && method === 'POST') {
        return jsonResponse({ key: attachmentKey, status: 'recorded' })
      }
      return jsonResponse({}, 404)
    })

    await renderPage()
    const amount = container.querySelector('[data-testid="wallet-receipt-amount"]') as HTMLInputElement
    const date = container.querySelector('[data-testid="wallet-receipt-date"]') as HTMLInputElement
    const payer = container.querySelector('[data-testid="wallet-receipt-payer-ref"]') as HTMLInputElement
    const note = container.querySelector('[data-testid="wallet-receipt-note"]') as HTMLTextAreaElement
    const fileInput = container.querySelector('[data-testid="wallet-receipt-file"]') as HTMLInputElement
    const form = container.querySelector('[data-testid="wallet-receipt-form"]') as HTMLFormElement

    await act(async () => {
      setInputValue(amount, '250000')
      setInputValue(date, '2026-08-15')
      setInputValue(payer, 'TRK-998877')
      setTextAreaValue(note, 'Branch transfer')
      const file = new File(['%PDF-1.4 receipt'], 'receipt.pdf', { type: 'application/pdf' })
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    for (let i = 0; i < 20; i++) {
      await flushFetches()
      if (container.querySelector('[data-testid="wallet-receipt-success"]')) break
    }

    const submitCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes('/bank-receipt-top-ups') &&
        (init as RequestInit | undefined)?.method === 'POST'
      )
    })
    expect(submitCall).toBeTruthy()
    expect(JSON.parse(String((submitCall![1] as RequestInit).body))).toEqual({
      amount: '250000',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey,
      customerNote: 'Branch transfer',
    })
    const recordCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).includes('/record') && (init as RequestInit | undefined)?.method === 'POST'
    })
    expect(recordCall).toBeTruthy()
    expect(JSON.parse(String((recordCall![1] as RequestInit).body))).toMatchObject({
      purpose: 'bank_receipt',
      profileId: PROFILE_ID,
    })
    expect(new Headers((submitCall![1] as RequestInit).headers).get('Idempotency-Key')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="wallet-receipt-success"]')?.textContent).toContain(
      'pending finance confirmation',
    )
    const balance = container.querySelector('[data-testid="wallet-balance"]')?.textContent ?? ''
    expect(balance.replace(/[^\d]/g, '')).toBe('1500000')
  })

  it('does not submit a bank receipt without a file', async () => {
    await renderPage()
    const amount = container.querySelector('[data-testid="wallet-receipt-amount"]') as HTMLInputElement
    const date = container.querySelector('[data-testid="wallet-receipt-date"]') as HTMLInputElement
    const payer = container.querySelector('[data-testid="wallet-receipt-payer-ref"]') as HTMLInputElement
    const form = container.querySelector('[data-testid="wallet-receipt-form"]') as HTMLFormElement

    await act(async () => {
      setInputValue(amount, '250000')
      setInputValue(date, '2026-08-15')
      setInputValue(payer, 'TRK-998877')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushFetches()

    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        return (
          String(url).includes('/bank-receipt-top-ups') &&
          (init as RequestInit | undefined)?.method === 'POST'
        )
      }),
    ).toBe(false)
    expect(container.querySelector('[data-testid="wallet-receipt-error"]')?.textContent).toContain(
      'valid receipt file',
    )
  })
})
