import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboard from './AdminDashboard.js'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to: string
    search?: unknown
    className?: string
    'aria-label'?: string
  }) => (
    <a href={to} className={props.className} aria-label={props['aria-label']}>
      {children}
    </a>
  ),
}))

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AdminDashboard chargeback warning (T-04.2.04.03)', () => {
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

  it('shows an assertive warning when unresolved chargebacks exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) }
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 2,
              unmatchedCount: 1,
              reversalFailedCount: 1,
              items: [
                {
                  eventId: 'evt-unmatched',
                  status: 'unmatched',
                  amountIrR: '150000',
                  walletId: null,
                  originalTransactionId: null,
                  reason: 'provider chargeback',
                  createdAt: '2026-09-02T06:00:00.000Z',
                },
              ],
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    await act(async () => {
      root.render(<AdminDashboard />)
    })
    await flush()

    const banner = container.querySelector('[role="alert"]')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('Unresolved chargebacks')
    expect(banner?.textContent).toContain('evt-unmatched')
    expect(banner?.textContent).toContain('150000')
    expect(banner?.getAttribute('aria-live')).toBe('assertive')
    expect(container.querySelector('div[dir="ltr"]')).toBeTruthy()
    const eventId = container.querySelector('span[dir="ltr"]')
    expect(eventId?.textContent).toBe('evt-unmatched')
    const chargebackCall = vi.mocked(fetch).mock.calls.find((call) =>
      String(call[0]).includes('/api/admin/wallet/chargebacks/unresolved-warning'),
    )
    expect(chargebackCall?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('renders the warning in RTL Persian with the event id forced LTR', async () => {
    document.documentElement.lang = 'fa'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) }
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 1,
              unmatchedCount: 1,
              reversalFailedCount: 0,
              items: [
                {
                  eventId: 'evt-fa',
                  status: 'unmatched',
                  amountIrR: '150000',
                  walletId: null,
                  originalTransactionId: null,
                  reason: 'provider chargeback',
                  createdAt: '2026-09-02T06:00:00.000Z',
                },
              ],
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    await act(async () => {
      root.render(<AdminDashboard />)
    })
    await flush()

    expect(container.querySelector('div[dir="rtl"]')).toBeTruthy()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('شارژبک حل‌نشده')
    expect(container.querySelector('span[dir="ltr"]')?.textContent).toBe('evt-fa')
  })

  it('hides the warning when every chargeback is resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) }
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 0,
              unmatchedCount: 0,
              reversalFailedCount: 0,
              items: [],
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    await act(async () => {
      root.render(<AdminDashboard />)
    })
    await flush()

    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
