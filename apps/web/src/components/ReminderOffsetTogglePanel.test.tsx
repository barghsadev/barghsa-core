import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultReminderOffsetToggles } from '@barghsa/shared/finance'
import ReminderOffsetTogglePanel from './ReminderOffsetTogglePanel.js'

function matrixWith(serviceType: string, offset: number, enabled: boolean) {
  return defaultReminderOffsetToggles().map((row) =>
    row.serviceType === serviceType && row.offset === offset ? { ...row, enabled } : row,
  )
}

describe('ReminderOffsetTogglePanel (T-04.1.04.05)', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.documentElement.lang = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => defaultReminderOffsetToggles(),
        }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          serviceType: string
          offset: number
          enabled: boolean
        }
        return {
          ok: true,
          json: async () => matrixWith(body.serviceType, body.offset, body.enabled),
        }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
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

  async function renderPanel() {
    await act(async () => {
      root.render(<ReminderOffsetTogglePanel />)
    })
    await act(async () => {
      await Promise.all(fetchMock.mock.results.map((entry) => entry.value).filter(Boolean))
    })
  }

  it('renders a switch for every service type × offset and loads the matrix', async () => {
    await renderPanel()

    expect(container.textContent).toContain('Payment reminders by service type')
    expect(container.textContent).toContain('Electricity')
    expect(container.textContent).toContain('7 days before')
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(24)
    expect(
      (container.querySelector('[data-testid="reminder-toggle-electricity--7"]') as HTMLInputElement)
        .checked,
    ).toBe(true)
  })

  it('PUTs the flipped toggle and updates the switch from the response', async () => {
    await renderPanel()

    const toggle = container.querySelector(
      '[data-testid="reminder-toggle-electricity--7"]',
    ) as HTMLInputElement
    await act(async () => {
      toggle.click()
    })

    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'PUT')
    expect(put).toBeDefined()
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({
      serviceType: 'electricity',
      offset: -7,
      enabled: false,
    })
    expect(toggle.checked).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('reverts the switch when the save fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      return { ok: false, status: 500, json: async () => ({ message: 'boom' }) }
    })

    await renderPanel()

    const toggle = container.querySelector(
      '[data-testid="reminder-toggle-manual-0"]',
    ) as HTMLInputElement
    await act(async () => {
      toggle.click()
    })

    expect(toggle.checked).toBe(true)
    expect(container.textContent).toContain('boom')
  })

  type PutBody = { serviceType: string; offset: number; enabled: boolean }
  type PutGate = {
    body: PutBody
    resolve: (value: { ok: boolean; status?: number; json: () => Promise<unknown> }) => void
  }

  function installDeferredPuts(): PutGate[] {
    const puts: PutGate[] = []
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as PutBody
        return await new Promise((resolve) => {
          puts.push({ body, resolve })
        })
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })
    return puts
  }

  async function clickToggle(testId: string): Promise<HTMLInputElement> {
    const toggle = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement
    await act(async () => {
      toggle.click()
    })
    return toggle
  }

  it.each([
    { order: [0, 1] as const, label: 'in request order' },
    { order: [1, 0] as const, label: 'out of request order' },
  ])('keeps both cells when overlapping PUTs resolve $label', async ({ order }) => {
    const puts = installDeferredPuts()
    await renderPanel()

    const first = await clickToggle('reminder-toggle-electricity--7')
    const second = await clickToggle('reminder-toggle-manual-0')

    expect(puts).toHaveLength(2)
    expect(first.disabled).toBe(true)
    expect(second.disabled).toBe(true)
    expect(first.checked).toBe(false)
    expect(second.checked).toBe(false)

    for (const index of order) {
      const gate = puts[index]!
      await act(async () => {
        gate.resolve({
          ok: true,
          json: async () => matrixWith(gate.body.serviceType, gate.body.offset, gate.body.enabled),
        })
      })
    }

    expect(first.checked).toBe(false)
    expect(second.checked).toBe(false)
    expect(first.disabled).toBe(false)
    expect(second.disabled).toBe(false)
  })

  it('reverts only the failed cell when one of two overlapping PUTs fails', async () => {
    const puts = installDeferredPuts()
    await renderPanel()

    const first = await clickToggle('reminder-toggle-electricity--7')
    const second = await clickToggle('reminder-toggle-manual-0')

    expect(puts).toHaveLength(2)

    await act(async () => {
      puts[1]!.resolve({
        ok: true,
        json: async () => matrixWith('manual', 0, false),
      })
    })
    await act(async () => {
      puts[0]!.resolve({
        ok: false,
        status: 500,
        json: async () => ({ message: 'boom' }),
      })
    })

    expect(first.checked).toBe(true)
    expect(second.checked).toBe(false)
    expect(container.textContent).toContain('boom')
  })

  function setInputValue(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function stepUpForbidden() {
    return {
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: 'AUTHZ:STEP_UP_REQUIRED', message: 'Re-verify your identity to continue' },
      }),
    }
  }

  it('opens a step-up challenge when PUT returns AUTHZ:STEP_UP_REQUIRED and keeps the optimistic toggle', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        return stepUpForbidden()
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')

    expect(toggle.checked).toBe(false)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('Verification required')
    expect(container.textContent).not.toContain('Re-verify your identity to continue')
  })

  it('rejects the write until step-up, then retries the PUT after verification', async () => {
    let putCount = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        putCount += 1
        if (putCount === 1) return stepUpForbidden()
        const body = JSON.parse(String(init.body)) as PutBody
        return {
          ok: true,
          json: async () => matrixWith(body.serviceType, body.offset, body.enabled),
        }
      }
      if (url.endsWith('/api/auth/step-up') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ password: 'secret' })
        return {
          ok: true,
          json: async () => ({ message: 'ok', stepUpVerifiedAt: '2026-08-31T01:00:00.000Z' }),
        }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')
    expect(putCount).toBe(1)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).not.toBeNull()

    const password = container.querySelector(
      '[data-testid="reminder-step-up-password"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(password, 'secret')
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="reminder-step-up-submit"]') as HTMLButtonElement).click()
    })

    const stepUp = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/auth/step-up'))
    expect(stepUp).toBeDefined()
    expect((stepUp![1] as RequestInit).method).toBe('POST')
    expect(putCount).toBe(2)
    expect(toggle.checked).toBe(false)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).toBeNull()
  })

  it('reverts the toggle when the step-up challenge is cancelled', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        return stepUpForbidden()
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')
    expect(toggle.checked).toBe(false)

    await act(async () => {
      ;(container.querySelector('[data-testid="reminder-step-up-cancel"]') as HTMLButtonElement).click()
    })

    expect(toggle.checked).toBe(true)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).toBeNull()
  })

  it('keeps the challenge open when password verification fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        return stepUpForbidden()
      }
      if (url.endsWith('/api/auth/step-up') && init?.method === 'POST') {
        return { ok: false, status: 422, json: async () => ({ error: { code: 'AUTH:LOGIN_INVALID_CREDENTIALS' } }) }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')
    const password = container.querySelector(
      '[data-testid="reminder-step-up-password"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(password, 'wrong')
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="reminder-step-up-submit"]') as HTMLButtonElement).click()
    })

    expect(toggle.checked).toBe(false)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('Verification failed')
  })

  it('reverts the switch and clears pending when the PUT promise rejects', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        throw new TypeError('Failed to fetch')
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')

    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(false)
    expect(container.textContent).toContain('Failed to save reminder toggle')
  })

  it('keeps the challenge and queued toggle when step-up fetch rejects', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        return stepUpForbidden()
      }
      if (url.endsWith('/api/auth/step-up') && init?.method === 'POST') {
        throw new TypeError('Failed to fetch')
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')
    const password = container.querySelector(
      '[data-testid="reminder-step-up-password"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(password, 'secret')
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="reminder-step-up-submit"]') as HTMLButtonElement).click()
    })

    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(true)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('Verification failed')
  })

  it('reverts the toggle when the retry PUT rejects after a successful step-up', async () => {
    let putCount = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && (!init || init.method === 'GET')) {
        return { ok: true, json: async () => defaultReminderOffsetToggles() }
      }
      if (url.endsWith('/api/admin/config/invoice-reminder-offsets') && init?.method === 'PUT') {
        putCount += 1
        if (putCount === 1) return stepUpForbidden()
        throw new TypeError('Failed to fetch')
      }
      if (url.endsWith('/api/auth/step-up') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ message: 'ok', stepUpVerifiedAt: '2026-08-31T01:00:00.000Z' }),
        }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    })

    await renderPanel()
    const toggle = await clickToggle('reminder-toggle-electricity--7')
    const password = container.querySelector(
      '[data-testid="reminder-step-up-password"]',
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(password, 'secret')
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="reminder-step-up-submit"]') as HTMLButtonElement).click()
    })

    expect(putCount).toBe(2)
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(false)
    expect(container.querySelector('[data-testid="reminder-step-up-dialog"]')).toBeNull()
    expect(container.textContent).toContain('Failed to save reminder toggle')
  })
})
