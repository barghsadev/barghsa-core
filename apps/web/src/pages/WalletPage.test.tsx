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

describe('WalletPage (T-04.2.02.01)', () => {
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
        return jsonResponse({ balance: 1_500_000, currency: 'IRR' })
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
})
