import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WalletTopUpLimitConfigPanel from './WalletTopUpLimitConfigPanel.js'

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

describe('WalletTopUpLimitConfigPanel (T-04.2.02.06)', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/admin/config/wallet-top-up-limit') && method === 'GET') {
        return jsonResponse({ limitIrR: 2_000_000_000, version: 0 })
      }
      if (url.endsWith('/api/admin/config/wallet-top-up-limit') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { limit_irr: number }
        return jsonResponse({ limitIrR: body.limit_irr, version: 1 })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
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

  async function renderPanel() {
    await act(async () => {
      root.render(<WalletTopUpLimitConfigPanel />)
    })
    await act(async () => {
      await Promise.all(fetchMock.mock.results.map((entry) => entry.value).filter(Boolean))
    })
  }

  it('loads the current limit, formats it, and shows the Toman equivalent', async () => {
    await renderPanel()
    expect(container.textContent).toContain('Online wallet top-up limit')
    expect(container.textContent).toContain('Changing this limit affects all future online top-ups')
    const input = container.querySelector('[data-testid="wallet-top-up-limit-input"]') as HTMLInputElement
    expect(input.value.replace(/[^\d]/g, '')).toBe('2000000000')
    expect(container.querySelector('[data-testid="wallet-top-up-limit-toman"]')?.textContent).toContain(
      '200,000,000',
    )
    expect(container.querySelector('[data-testid="wallet-top-up-limit-current"]')?.textContent).toContain(
      'Config version: 0',
    )
    const get = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/config/wallet-top-up-limit') &&
        (init as RequestInit | undefined)?.method !== 'PUT',
    )
    expect(get?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('PUTs a new integer limit and shows the saved version', async () => {
    await renderPanel()
    const input = container.querySelector('[data-testid="wallet-top-up-limit-input"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => {
      setInputValue(input, '500000000')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await Promise.all(fetchMock.mock.results.map((entry) => entry.value).filter(Boolean))
    })

    const put = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/config/wallet-top-up-limit') &&
        (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(put).toBeTruthy()
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ limit_irr: 500_000_000 })
    expect(container.textContent).toContain('Saved')
    expect(container.querySelector('[data-testid="wallet-top-up-limit-current"]')?.textContent).toContain(
      'Config version: 1',
    )
  })

  it('rejects a non-integer client-side without calling PUT', async () => {
    await renderPanel()
    const input = container.querySelector('[data-testid="wallet-top-up-limit-input"]') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => {
      setInputValue(input, '')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toBe(false)
    expect(container.textContent).toContain('Limit must be an integer between 0 and')
  })

  it('hides the panel when the admin is not allowed to read the config', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.endsWith('/api/admin/config/wallet-top-up-limit') && method === 'GET') {
        return jsonResponse({ message: 'Admin role required' }, 403)
      }
      return jsonResponse({}, 404)
    })
    await renderPanel()
    expect(container.querySelector('[data-testid="wallet-top-up-limit-panel"]')).toBeNull()
    expect(container.textContent).not.toContain('Failed to load')
  })
})
