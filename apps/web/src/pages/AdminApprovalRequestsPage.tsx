import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@barghsa/i18n'
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance'
import { Button, Label } from '@barghsa/ui'
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js'
import { useLocale } from '../hooks/useLocale.js'
import { formatIrr } from '../lib/customer-invoices.js'

type Status = 'pending' | 'approved' | 'rejected'
interface Request {
  id: string; actionType: 'refund' | 'manual_adjustment' | 'bank_payment_confirmation'
  amountIrR: string; initiatorId: string; initiatorUsername: string | null
  reason: string; status: Status; reviewerId: string | null; reviewerUsername: string | null
  reviewReason: string | null; details: Record<string, unknown> | null
}
const PAGE_SIZE = 25

export default function AdminApprovalRequestsPage() {
  const locale = useLocale()
  const [status, setStatus] = useState<Status>('pending')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [action, setAction] = useState<TeamAction | null>(null)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError(false); setItems([]); setReasons({})
    try {
      const response = await fetch(`/api/admin/approval-requests?status=${status}&limit=${PAGE_SIZE + 1}&offset=${offset}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Queue unavailable')
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('Invalid queue')
      if (current === generation.current) setItems(data)
    } catch { if (current === generation.current) setError(true) }
    finally { if (current === generation.current) setLoading(false) }
  }, [status, offset])
  useEffect(() => { void load(); return () => { ++generation.current } }, [load])

  function decide(request: Request, decision: 'approve' | 'reject') {
    const reason = (reasons[request.id] ?? '').trim()
    if (decision === 'reject' && !reason) return
    setSaved(false)
    setAction({ title: t(`admin.approvals.${decision}`, locale),
      description: `${t('admin.approvals.confirm', locale)} ${request.id} · ${formatIrr(request.amountIrR, locale)} ${decision === 'reject' ? `· ${reason}` : ''}`,
      path: `/api/admin/approval-requests/${encodeURIComponent(request.id)}/${decision}`, method: 'POST',
      ...(decision === 'reject' ? { body: { reason } } : {}),
      conflictMessage: t('admin.approvals.conflict', locale), forbiddenMessage: t('admin.approvals.forbidden', locale),
    })
  }

  return <section className="mx-auto max-w-4xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{t('admin.approvals.title', locale)}</h1>
      <p className="text-sm text-gray-600">{t('admin.approvals.description', locale)}</p></header>
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor="approval-status">{t('admin.approvals.status', locale)}</Label>
      <select id="approval-status" className="rounded border bg-white p-2" value={status} disabled={!!action}
        onChange={event => { setStatus(event.target.value as Status); setOffset(0); setSaved(false) }}>
        {(['pending', 'approved', 'rejected'] as const).map(value => <option key={value} value={value}>{t(`admin.approvals.${value}`, locale)}</option>)}
      </select>
      <Button variant="outline" disabled={loading || !!action} onClick={() => void load()}>{t('admin.approvals.refresh', locale)}</Button>
    </div>
    {saved && <p role="status">{t('admin.approvals.saved', locale)}</p>}
    {loading ? <p role="status">{t('admin.approvals.loading', locale)}</p> : error ? <p role="alert">{t('admin.approvals.error', locale)}</p> : items.length === 0 ? <p>{t('admin.approvals.empty', locale)}</p> :
      <ul className="space-y-4">{items.slice(0, PAGE_SIZE).map(request => <li key={request.id} className="space-y-3 rounded-lg border bg-white p-4 break-words">
        <h2 className="font-semibold">{t(`admin.approvals.${request.actionType}`, locale)}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {[[t('admin.approvals.requestId', locale), request.id], [t('admin.approvals.amount', locale), formatIrr(request.amountIrR, locale)],
            [t('admin.approvals.initiator', locale), request.initiatorUsername ?? request.initiatorId], [t('admin.approvals.reason', locale), request.reason],
            [t('admin.approvals.status', locale), t(`admin.approvals.${request.status}`, locale)],
            ...(['receiptId', 'invoiceId', 'walletId'] as const).flatMap(key => typeof request.details?.[key] === 'string' ? [[t(`admin.approvals.${key}`, locale), request.details[key] as string]] : []),
            ...(request.reviewerId ? [[t('admin.approvals.reviewer', locale), request.reviewerUsername ?? request.reviewerId]] : []),
            ...(request.reviewReason ? [[t('admin.approvals.reviewReason', locale), request.reviewReason]] : []),
          ].map(([label, value]) => <div key={label}><dt className="text-gray-500">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}
        </dl>
        {request.details?.entityType === 'wallet_bank_receipt' && <a className="text-blue-700 underline" href="/admin/wallet-receipts">{t('admin.approvals.walletReceipts', locale)}</a>}
        {request.status === 'pending' && <div className="space-y-2">
          <Label htmlFor={`reason-${request.id}`}>{t('admin.approvals.rejectReason', locale)}</Label>
          <textarea id={`reason-${request.id}`} maxLength={APPROVAL_REVIEW_REASON_MAX_LENGTH} className="block w-full rounded border p-2" disabled={!!action}
            value={reasons[request.id] ?? ''} onChange={event => setReasons(previous => ({ ...previous, [request.id]: event.target.value }))} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!action} onClick={() => decide(request, 'approve')}>{t('admin.approvals.approve', locale)}</Button>
            <Button variant="outline" disabled={!!action || !(reasons[request.id] ?? '').trim()} onClick={() => decide(request, 'reject')}>{t('admin.approvals.reject', locale)}</Button>
          </div>
        </div>}
      </li>)}</ul>}
    <nav aria-label={t('admin.approvals.title', locale)} className="flex gap-3">
      <Button variant="outline" disabled={loading || !!action || offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>{t('admin.approvals.previous', locale)}</Button>
      <Button variant="outline" disabled={loading || error || !!action || items.length <= PAGE_SIZE} onClick={() => setOffset(value => value + PAGE_SIZE)}>{t('admin.approvals.next', locale)}</Button>
    </nav>
    {action && <TeamActionDialog action={action} onClose={() => setAction(null)} onSuccess={async () => { setSaved(true); await load() }} />}
  </section>
}
