import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  parseBankReceiptRejectReason,
} from '@barghsa/shared/finance'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'
import { formatIrr } from '../lib/customer-invoices.js'
import { isImageAttachment, isPdfAttachment, isTransactionUuid } from '../lib/bank-receipt-confirmation.js'
import WalletTopUpLimitConfigPanel from '../components/WalletTopUpLimitConfigPanel.js'

/**
 * Staff bank-receipt confirmation queue (T-04.2.02.04).
 *
 * Finance staff review a Pending wallet top-up receipt, then confirm
 * (credits via WalletService.credit()) or reject with a customer-visible
 * reason. Confirm and reject require step-up authentication.
 */

interface StaffDecision {
  decision: 'confirmed' | 'rejected'
  actorUserId: string
  decidedAt: string
  reason: string | null
  customerVisible: boolean
  creditTransactionId: string | null
}

interface BankReceiptReviewDto {
  transactionId: string
  walletId: string
  amount: string
  currency: 'IRR'
  state: string
  paymentDate: string | null
  payerReference: string | null
  attachmentKey: string | null
  attachmentUrl: string | null
  customerNote: string | null
  submittedAt: string
  canDecide: boolean
  staffDecision: StaffDecision | null
  creditTransactionId: string | null
  overpayment: OverpaymentSnapshot | null
}

interface OverpaymentSnapshot {
  invoiceId: string
  remainingBefore: string
  invoiceAllocation: string
  walletCreditAmount: string
  overpaymentCreditTransactionId: string | null
}

interface AllocationPreview {
  transactionId: string
  invoiceId: string
  invoiceState: string
  receiptAmount: string
  remaining: string
  invoiceAllocation: string
  walletCreditAmount: string
  isOverpayment: boolean
}

type PendingAction = { kind: 'confirm' } | { kind: 'reject'; reason: string }

function readErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const rec = data as { error?: unknown; requiresStepUp?: unknown }
  if (typeof rec.error === 'string') return rec.error
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { code?: unknown }
    if (typeof nested.code === 'string') return nested.code
  }
  if (rec.requiresStepUp === true) return ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
  return null
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const rec = data as { message?: unknown; error?: unknown }
  if (typeof rec.message === 'string' && rec.message) return rec.message
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { message?: unknown }
    if (typeof nested.message === 'string' && nested.message) return nested.message
  }
  if (typeof rec.error === 'string' && rec.error) return rec.error
  return fallback
}

function isStepUpRequired(res: Response, data: unknown): boolean {
  return res.status === 403 && readErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    return errorMessage(await res.json(), fallback)
  } catch {
    return fallback
  }
}

async function verifyStepUp(password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    })
    return res.ok
  } catch {
    return false
  }
}

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getTabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    return true
  })
}

function inertOutside(keep: HTMLElement): () => void {
  const applied: HTMLElement[] = []
  let current: HTMLElement | null = keep
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement
    if (!parent) break
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue
      if (sibling.hasAttribute('inert')) continue
      sibling.setAttribute('inert', '')
      applied.push(sibling)
    }
    current = parent
  }
  return () => {
    for (const el of applied) el.removeAttribute('inert')
  }
}

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return t('admin.walletReceipts.none', locale)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])
    const day = Number(parts[2])
    const d = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(d.getTime())) return value
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fa-IR', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(d)
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d)
}

export default function AdminWalletReceiptsPage() {
  const locale = useLocale()
  const [items, setItems] = useState<BankReceiptReviewDto[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<BankReceiptReviewDto | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientIssue, setClientIssue] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [invoiceId, setInvoiceId] = useState('')
  const [allocation, setAllocation] = useState<AllocationPreview | null>(null)
  const [allocationError, setAllocationError] = useState<string | null>(null)

  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [stepUpPassword, setStepUpPassword] = useState('')
  const [stepUpError, setStepUpError] = useState<string | null>(null)
  const [stepUpSubmitting, setStepUpSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [reasonInvalid, setReasonInvalid] = useState(false)
  const stepUpDialogRef = useRef<HTMLDivElement | null>(null)
  const stepUpPasswordRef = useRef<HTMLInputElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const rejectButtonRef = useRef<HTMLButtonElement | null>(null)
  const statusRef = useRef<HTMLParagraphElement | null>(null)
  const stepUpTriggerRef = useRef<HTMLButtonElement | null>(null)
  const restoreTriggerRef = useRef(false)
  const stepUpSubmittingRef = useRef(false)
  stepUpSubmittingRef.current = stepUpSubmitting

  const loadQueue = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/wallet/bank-receipt-top-ups')
      if (!res.ok) throw new Error(await parseError(res, t('admin.walletReceipts.error.load', locale)))
      const data = (await res.json()) as { items?: BankReceiptReviewDto[] }
      const next = Array.isArray(data.items) ? data.items : []
      setItems(next)
      setSelectedId((current) => {
        if (current && next.some((row) => row.transactionId === current)) return current
        return next[0]?.transactionId ?? null
      })
    } catch (err) {
      setItems([])
      setSelected(null)
      setSelectedId(null)
      setError(err instanceof Error ? err.message : t('admin.walletReceipts.error.load', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }
    const fromList = items.find((row) => row.transactionId === selectedId)
    if (fromList) setSelected(fromList)
    setInvoiceId('')
    setAllocation(null)
    setAllocationError(null)
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/admin/wallet/bank-receipt-top-ups/${selectedId}`)
        if (!res.ok) return
        const data = (await res.json()) as BankReceiptReviewDto
        if (!cancelled) setSelected(data)
      } catch {
        /* keep list snapshot */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, items])

  useEffect(() => {
    const trimmed = invoiceId.trim()
    if (!selected || !trimmed) {
      setAllocation(null)
      setAllocationError(null)
      return
    }
    if (!isTransactionUuid(trimmed)) {
      setAllocation(null)
      setAllocationError(t('admin.walletReceipts.error.invoiceId', locale))
      return
    }
    let cancelled = false
    setAllocationError(null)
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/wallet/bank-receipt-top-ups/${selected.transactionId}/allocation?invoiceId=${encodeURIComponent(trimmed)}`,
        )
        const data: unknown = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          setAllocation(null)
          setAllocationError(errorMessage(data, t('admin.walletReceipts.error.allocation', locale)))
          return
        }
        setAllocation(data as AllocationPreview)
      } catch {
        if (!cancelled) {
          setAllocation(null)
          setAllocationError(t('admin.walletReceipts.error.allocation', locale))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId, selected, locale])

  useEffect(() => {
    if (!stepUpOpen) return
    const dialog = stepUpDialogRef.current
    if (!dialog) return
    const restore = inertOutside(dialog)
    stepUpPasswordRef.current?.focus()
    return restore
  }, [stepUpOpen])

  useEffect(() => {
    if (stepUpOpen || !restoreTriggerRef.current) return
    restoreTriggerRef.current = false
    const trigger = stepUpTriggerRef.current
    stepUpTriggerRef.current = null
    if (trigger && document.body.contains(trigger) && !trigger.disabled) {
      trigger.focus()
      return
    }
    statusRef.current?.focus()
  }, [stepUpOpen, selectedId, status])

  async function postDecision(action: PendingAction): Promise<'step_up' | 'ok' | 'error'> {
    if (!selected) return 'error'
    const path =
      action.kind === 'confirm'
        ? `/api/admin/wallet/bank-receipt-top-ups/${selected.transactionId}/confirm`
        : `/api/admin/wallet/bank-receipt-top-ups/${selected.transactionId}/reject`
    const res = await fetch(path, {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body:
        action.kind === 'reject'
          ? JSON.stringify({ reason: action.reason })
          : JSON.stringify(
              isTransactionUuid(invoiceId) ? { invoiceId: invoiceId.trim() } : {},
            ),
    })
    const data: unknown = await res.json().catch(() => null)
    if (isStepUpRequired(res, data)) return 'step_up'
    if (!res.ok) {
      setError(errorMessage(data, t('admin.walletReceipts.error.save', locale)))
      return 'error'
    }
    const dto = data as BankReceiptReviewDto
    const overpay = dto.overpayment && BigInt(dto.overpayment.walletCreditAmount) > 0n
    setStatus(
      action.kind === 'confirm'
        ? overpay
          ? t('admin.walletReceipts.overpaymentConfirmed', locale)
          : t('admin.walletReceipts.confirmed', locale)
        : t('admin.walletReceipts.rejected', locale),
    )
    setReason('')
    setInvoiceId('')
    setAllocation(null)
    setClientIssue(null)
    setReasonInvalid(false)
    setItems((current) => {
      const remaining = current.filter((row) => row.transactionId !== dto.transactionId)
      setSelectedId(remaining[0]?.transactionId ?? null)
      return remaining
    })
    return 'ok'
  }

  async function runAction(action: PendingAction) {
    setActing(true)
    setError(null)
    setStatus(null)
    try {
      const outcome = await postDecision(action)
      if (outcome === 'step_up') {
        restoreTriggerRef.current = true
        stepUpTriggerRef.current =
          action.kind === 'confirm' ? confirmButtonRef.current : rejectButtonRef.current
        setPendingAction(action)
        setStepUpPassword('')
        setStepUpError(null)
        setStepUpOpen(true)
      }
    } catch {
      setError(t('admin.walletReceipts.error.save', locale))
    } finally {
      setActing(false)
    }
  }

  function handleConfirm() {
    const trimmed = invoiceId.trim()
    if (trimmed && !isTransactionUuid(trimmed)) {
      setReasonInvalid(false)
      setClientIssue(t('admin.walletReceipts.error.invoiceId', locale))
      return
    }
    setReasonInvalid(false)
    setClientIssue(null)
    void runAction({ kind: 'confirm' })
  }

  function handleReject(e: FormEvent) {
    e.preventDefault()
    const parsed = parseBankReceiptRejectReason({ reason })
    if (!parsed.ok) {
      setReasonInvalid(true)
      setClientIssue(t('admin.walletReceipts.error.reason', locale))
      return
    }
    setReasonInvalid(false)
    setClientIssue(null)
    void runAction({ kind: 'reject', reason: parsed.reason })
  }

  function cancelStepUp() {
    if (stepUpSubmitting) return
    setStepUpOpen(false)
    setPendingAction(null)
    setStepUpPassword('')
    setStepUpError(null)
  }

  async function submitStepUp(e?: FormEvent) {
    e?.preventDefault()
    if (!stepUpPassword.trim() || stepUpSubmitting || !pendingAction) return
    setStepUpSubmitting(true)
    setStepUpError(null)
    try {
      const verified = await verifyStepUp(stepUpPassword)
      if (!verified) {
        setStepUpError(t('admin.walletReceipts.stepUp.failed', locale))
        return
      }
      const outcome = await postDecision(pendingAction)
      if (outcome === 'step_up') {
        setStepUpError(t('admin.walletReceipts.stepUp.failed', locale))
        return
      }
      if (outcome === 'ok') {
        setStepUpOpen(false)
        setPendingAction(null)
        setStepUpPassword('')
      }
    } catch {
      setStepUpError(t('admin.walletReceipts.stepUp.failed', locale))
    } finally {
      setStepUpSubmitting(false)
    }
  }

  function onStepUpKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelStepUp()
      return
    }
    if (event.key !== 'Tab' || !stepUpDialogRef.current) return
    const tabbable = getTabbable(stepUpDialogRef.current)
    if (tabbable.length === 0) return
    const first = tabbable[0]!
    const last = tabbable[tabbable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('admin.walletReceipts.title', locale)}</h1>
        <p className="text-gray-600 mt-2">{t('admin.walletReceipts.description', locale)}</p>
      </header>

      <WalletTopUpLimitConfigPanel />

      {error && (
        <div
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded"
          role="alert"
        >
          {error}
        </div>
      )}

      {status && (
        <p
          ref={statusRef}
          className="text-sm text-green-700"
          role="status"
          tabIndex={-1}
        >
          {status}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-600" role="status">
          {t('admin.walletReceipts.loading', locale)}
        </p>
      ) : items.length === 0 && !selected ? (
        <p className="text-sm text-gray-600" role="status">
          {t('admin.walletReceipts.empty', locale)}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <nav
            aria-label={t('admin.walletReceipts.queueLabel', locale)}
            className="bg-white rounded-lg border border-gray-200 p-3 space-y-1"
          >
            {items.map((row) => {
              const active = row.transactionId === selectedId
              return (
                <button
                  key={row.transactionId}
                  type="button"
                  onClick={() => {
                    setSelectedId(row.transactionId)
                    setStatus(null)
                    setClientIssue(null)
                    setReasonInvalid(false)
                    setReason('')
                  }}
                  className={`w-full text-start rounded px-3 py-2 text-sm ${
                    active ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50'
                  }`}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="block font-medium">
                    {formatIrr(row.amount, locale)} {row.currency}
                  </span>
                  <span className="block text-xs text-gray-500" dir="ltr">
                    {row.payerReference}
                  </span>
                </button>
              )
            })}
          </nav>

          {selected && (
            <section
              className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
              aria-labelledby="receipt-review-heading"
            >
              <h2 id="receipt-review-heading" className="text-lg font-semibold">
                {t('admin.walletReceipts.reviewTitle', locale)}
              </h2>

              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.amount', locale)}</dt>
                  <dd className="font-medium">
                    {formatIrr(selected.amount, locale)} {selected.currency}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.paymentDate', locale)}</dt>
                  <dd>{formatDate(selected.paymentDate, locale)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.payerReference', locale)}</dt>
                  <dd className="font-mono text-sm" dir="ltr">
                    {selected.payerReference ?? t('admin.walletReceipts.none', locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.walletId', locale)}</dt>
                  <dd className="font-mono text-sm" dir="ltr">
                    {selected.walletId}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.submittedAt', locale)}</dt>
                  <dd>{formatDate(selected.submittedAt, locale)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('admin.walletReceipts.note', locale)}</dt>
                  <dd>{selected.customerNote ?? t('admin.walletReceipts.none', locale)}</dd>
                </div>
              </dl>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  {t('admin.walletReceipts.attachment', locale)}
                </h3>
                {selected.attachmentUrl && isImageAttachment(selected.attachmentKey) ? (
                  <img
                    src={selected.attachmentUrl}
                    alt={t('admin.walletReceipts.attachmentAlt', locale)}
                    className="max-h-80 rounded border border-gray-200"
                  />
                ) : selected.attachmentUrl && isPdfAttachment(selected.attachmentKey) ? (
                  <iframe
                    title={t('admin.walletReceipts.attachmentAlt', locale)}
                    src={selected.attachmentUrl}
                    className="w-full h-80 rounded border border-gray-200"
                  />
                ) : selected.attachmentUrl ? (
                  <a
                    href={selected.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {t('admin.walletReceipts.openAttachment', locale)}
                  </a>
                ) : (
                  <p className="text-sm text-gray-600" dir="ltr">
                    {selected.attachmentKey ?? t('admin.walletReceipts.none', locale)}
                  </p>
                )}
              </div>

              {selected.canDecide ? (
                <div className="space-y-4 border-t border-gray-100 pt-4">
                  <div>
                    <label
                      htmlFor="apply-invoice-id"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('admin.walletReceipts.invoiceId', locale)}
                    </label>
                    <input
                      id="apply-invoice-id"
                      name="invoiceId"
                      type="text"
                      dir="ltr"
                      inputMode="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={invoiceId}
                      onChange={(e) => setInvoiceId(e.target.value)}
                      placeholder={t('admin.walletReceipts.invoiceIdPlaceholder', locale)}
                      aria-describedby="apply-invoice-hint"
                      className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                    />
                    <p id="apply-invoice-hint" className="text-xs text-gray-500 mt-1">
                      {t('admin.walletReceipts.invoiceIdHint', locale)}
                    </p>
                  </div>

                  {allocationError && (
                    <p className="text-sm text-red-600" role="alert">
                      {allocationError}
                    </p>
                  )}

                  {allocation && (
                    <dl
                      className="rounded border border-amber-200 bg-amber-50 p-3 text-sm space-y-1"
                      aria-live="polite"
                    >
                      <div>
                        <dt className="text-gray-600">
                          {t('admin.walletReceipts.remaining', locale)}
                        </dt>
                        <dd className="font-medium">
                          {formatIrr(allocation.remaining, locale)} {selected.currency}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-600">
                          {t('admin.walletReceipts.invoiceAllocation', locale)}
                        </dt>
                        <dd className="font-medium">
                          {formatIrr(allocation.invoiceAllocation, locale)} {selected.currency}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-600">
                          {t('admin.walletReceipts.overpaymentCredit', locale)}
                        </dt>
                        <dd className="font-medium">
                          {formatIrr(allocation.walletCreditAmount, locale)} {selected.currency}
                        </dd>
                      </div>
                      {allocation.isOverpayment && (
                        <p className="text-amber-900 pt-1">
                          {t('admin.walletReceipts.overpaymentPreview', locale)}
                        </p>
                      )}
                    </dl>
                  )}

                  {clientIssue && (
                    <p
                      id={reasonInvalid ? 'reject-reason-error' : 'wallet-receipt-client-issue'}
                      className="text-sm text-red-600"
                      role="alert"
                    >
                      {clientIssue}
                    </p>
                  )}

                  <button
                    ref={confirmButtonRef}
                    type="button"
                    data-testid="wallet-receipt-confirm"
                    onClick={handleConfirm}
                    disabled={acting}
                    aria-busy={acting}
                    className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
                  >
                    {acting
                      ? t('admin.walletReceipts.saving', locale)
                      : t('admin.walletReceipts.confirm', locale)}
                  </button>

                  <form onSubmit={handleReject} className="space-y-3" noValidate>
                    <div>
                      <label
                        htmlFor="reject-reason"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        {t('admin.walletReceipts.reason', locale)}{' '}
                        <span className="text-red-500" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <textarea
                        id="reject-reason"
                        name="reason"
                        required
                        aria-required="true"
                        aria-invalid={reasonInvalid}
                        aria-describedby={
                          reasonInvalid
                            ? 'reject-reason-error reject-reason-hint'
                            : 'reject-reason-hint'
                        }
                        maxLength={BANK_RECEIPT_REJECT_REASON_MAX_LENGTH}
                        rows={3}
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value)
                          if (reasonInvalid) {
                            setReasonInvalid(false)
                            setClientIssue(null)
                          }
                        }}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                      <p id="reject-reason-hint" className="text-xs text-gray-500 mt-1">
                        {t('admin.walletReceipts.reasonHint', locale)}
                      </p>
                    </div>
                    <button
                      ref={rejectButtonRef}
                      type="submit"
                      data-testid="wallet-receipt-reject"
                      disabled={acting}
                      aria-busy={acting}
                      className="px-4 py-2 bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-50"
                    >
                      {acting
                        ? t('admin.walletReceipts.saving', locale)
                        : t('admin.walletReceipts.reject', locale)}
                    </button>
                  </form>
                </div>
              ) : (
                <p className="text-sm text-amber-700" role="status">
                  {t('admin.walletReceipts.alreadyDecided', locale)}
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {stepUpOpen && (
        <div
          ref={stepUpDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-receipt-step-up-title"
          data-testid="wallet-receipt-step-up-dialog"
          onKeyDown={onStepUpKeyDown}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !stepUpSubmitting) cancelStepUp()
          }}
        >
          <form
            onSubmit={submitStepUp}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg space-y-4"
          >
            <h3 id="wallet-receipt-step-up-title" className="text-lg font-semibold text-gray-900">
              {t('admin.walletReceipts.stepUp.title', locale)}
            </h3>
            <p className="text-sm text-gray-600">
              {t('admin.walletReceipts.stepUp.description', locale)}
            </p>
            <div>
              <label
                htmlFor="wallet-receipt-step-up-password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.walletReceipts.stepUp.passwordLabel', locale)}
              </label>
              <input
                ref={stepUpPasswordRef}
                id="wallet-receipt-step-up-password"
                data-testid="wallet-receipt-step-up-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={Boolean(stepUpError)}
                aria-describedby={stepUpError ? 'wallet-receipt-step-up-error' : undefined}
                value={stepUpPassword}
                onChange={(e) => {
                  setStepUpPassword(e.target.value)
                  if (stepUpError) setStepUpError(null)
                }}
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
            {stepUpError && (
              <p id="wallet-receipt-step-up-error" className="text-sm text-red-600" role="alert">
                {stepUpError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                data-testid="wallet-receipt-step-up-submit"
                disabled={stepUpSubmitting || !stepUpPassword.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {stepUpSubmitting
                  ? t('admin.walletReceipts.stepUp.verifying', locale)
                  : t('admin.walletReceipts.stepUp.submit', locale)}
              </button>
              <button
                type="button"
                data-testid="wallet-receipt-step-up-cancel"
                onClick={cancelStepUp}
                disabled={stepUpSubmitting}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('admin.walletReceipts.stepUp.cancel', locale)}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
