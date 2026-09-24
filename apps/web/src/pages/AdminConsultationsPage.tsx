import { useEffect, useState } from 'react';
import { Button, Label } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { offerInputFromInstant, offerInstantFromInput } from '../lib/consultation-offer-time.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';

interface RequestRow {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  staff_owner_id: string | null;
  staff_team: string | null;
  submitted_at: string;
  priority: 'high' | 'normal';
}
interface Detail {
  request: RequestRow & {
    scope: string | null;
    deliverables: string | null;
    fee: string | null;
    invoice_id: string | null;
    invoice_state: string | null;
    has_paid_invoice: boolean;
    uncovered_credit: string;
    offer_valid_until: string | null;
    expected_next_step: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer';
    reason: string | null;
    created_at: string;
  }>;
}

const statuses = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
] as const;

export function AdminConsultationsPage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');
  const [assignment, setAssignment] = useState('all');
  const [priority, setPriority] = useState('all');
  const [minAgeDays, setMinAgeDays] = useState('0');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [scope, setScope] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [offerReason, setOfferReason] = useState('');
  const [offerKey, setOfferKey] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  function resetQueue(clearSelection = false) {
    setRows([]);
    setAfter(null);
    setNextAfter(null);
    if (clearSelection) setSelectedId(null);
  }
  function refresh() {
    resetQueue();
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/consultations/teams', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('teams');
        return (await response.json()) as { teams: Array<{ name: string }> };
      })
      .then((result) => {
        if (!controller.signal.aborted) setTeams(result.teams.map((item) => item.name));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setQueueLoading(true);
    const query = new URLSearchParams({ assignment, priority, minAgeDays });
    if (status) query.set('status', status);
    if (after) query.set('after', after);
    void fetch(`/api/admin/consultations/requests?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('queue');
        return (await response.json()) as { requests: RequestRow[]; nextAfter: string | null };
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows((current) => {
            if (!after) return result.requests;
            const shown = new Set(current.map((request) => request.id));
            return [...current, ...result.requests.filter((request) => !shown.has(request.id))];
          });
          setNextAfter(result.nextAfter);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [status, assignment, priority, minAgeDays, after, revision]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/admin/consultations/requests/${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('detail');
        return (await response.json()) as Detail;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setDetail(result);
          setFee(result.request.fee ?? '');
          setScope(result.request.scope ?? '');
          setDeliverables(result.request.deliverables ?? '');
          setOfferReason('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [selectedId, revision]);

  useEffect(() => {
    if (detail && time.status === 'ready') {
      setValidUntil(offerInputFromInstant(detail.request.offer_valid_until, time.timezone));
    }
  }, [detail, time.status, time.timezone]);

  function prepare(path: string, title: string, body: Record<string, unknown> = {}) {
    if (!selectedId) return;
    setAction({
      title,
      description: `${detail?.request.profile_name ?? ''} · ${title}`,
      path: `/api/admin/consultations/requests/${selectedId}/${path}`,
      method: 'POST',
      body,
      forbiddenMessage: copy('actionError'),
    });
  }

  const current = detail?.request;
  const offerDeadline =
    time.status === 'ready'
      ? current?.offer_valid_until &&
        validUntil === offerInputFromInstant(current.offer_valid_until, time.timezone)
        ? new Date(current.offer_valid_until)
        : offerInstantFromInput(validUntil, time.timezone)
      : undefined;
  const validOfferDeadline =
    offerDeadline && Number.isFinite(offerDeadline.getTime()) && offerDeadline > new Date();
  return (
    <main className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('staffTitle')}</h1>
          <p className="text-muted-foreground">{copy('staffIntro')}</p>
        </div>
        <Button variant="outline" onClick={refresh}>
          {copy('refresh')}
        </Button>
      </header>
      {time.notice}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>{copy('filterStatus')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={status}
            onChange={(event) => {
              resetQueue(true);
              setStatus(event.target.value);
            }}
          >
            <option value="">{copy('openRequests')}</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {copy(`status_${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('filterAssignment')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={assignment}
            onChange={(event) => {
              resetQueue(true);
              setAssignment(event.target.value);
            }}
          >
            <option value="all">{copy('all')}</option>
            <option value="mine">{copy('mine')}</option>
            <option value="unassigned">{copy('unassigned')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('priority')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={priority}
            onChange={(event) => {
              resetQueue(true);
              setPriority(event.target.value);
            }}
          >
            <option value="all">{copy('all')}</option>
            <option value="high">{copy('high')}</option>
            <option value="normal">{copy('normal')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('age')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={minAgeDays}
            onChange={(event) => {
              resetQueue(true);
              setMinAgeDays(event.target.value);
            }}
          >
            <option value="0">{copy('all')}</option>
            <option value="1">{copy('oneDay')}</option>
            <option value="7">{copy('sevenDays')}</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {copy('loadError')}
        </p>
      )}
      {queueLoading && <p role="status">{copy('loading')}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-label={copy('staffTitle')} className="space-y-2">
          {!rows.length && !error && !queueLoading && (
            <p className="text-muted-foreground">{copy('noWork')}</p>
          )}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setSelectedId(row.id);
                setDetail(null);
                setReason('');
                setOfferKey(crypto.randomUUID());
              }}
              aria-pressed={selectedId === row.id}
              className={`w-full rounded-xl border bg-card p-4 text-start hover:border-primary ${selectedId === row.id ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <span className="block font-semibold" dir="auto">
                {row.product_snapshot.title[locale]}
              </span>
              <span className="mt-1 block text-sm" dir="auto">
                {row.profile_name}
              </span>
              <span className="mt-2 block text-sm text-muted-foreground">
                {copy(`status_${row.status}`)} · {copy(row.priority)} ·{' '}
                {time.format(row.submitted_at, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            </button>
          ))}
          {nextAfter && !error && (
            <Button variant="outline" disabled={queueLoading} onClick={() => setAfter(nextAfter)}>
              {copy('moreWork')}
            </Button>
          )}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={copy('details')}>
          {!current && <p className="text-muted-foreground">{copy('selectRequest')}</p>}
          {current && (
            <>
              <div>
                <h2 className="text-xl font-semibold" dir="auto">
                  {current.product_snapshot.title[locale]}
                </h2>
                <p>
                  {copy('customer')}: <span dir="auto">{current.profile_name}</span>
                </p>
                <p>
                  {copy('status')}: {copy(`status_${current.status}`)}
                </p>
                <p>
                  {copy('owner')}: {current.staff_owner_id ?? copy('unassigned')}
                </p>
                {current.staff_team && (
                  <p>
                    {copy('team')}: {current.staff_team}
                  </p>
                )}
              </div>
              {current.expected_next_step && (
                <p>
                  {copy('nextStep')}: <span dir="auto">{current.expected_next_step}</span>
                </p>
              )}
              {current.fee && (
                <section
                  className="space-y-2 rounded-lg border p-4"
                  aria-label={copy('savedOffer')}
                >
                  <h3 className="font-semibold">{copy('savedOffer')}</h3>
                  <p>
                    {copy('fee')}: {new Intl.NumberFormat(locale).format(BigInt(current.fee))} IRR
                  </p>
                  {current.scope && (
                    <p>
                      {copy('scope')}: <span dir="auto">{current.scope}</span>
                    </p>
                  )}
                  {current.deliverables && (
                    <p>
                      {copy('deliverables')}: <span dir="auto">{current.deliverables}</span>
                    </p>
                  )}
                  {current.offer_valid_until && (
                    <p>
                      {copy('offerValidUntil')}:{' '}
                      <time dateTime={current.offer_valid_until}>
                        {time.format(current.offer_valid_until)}
                      </time>
                    </p>
                  )}
                  {current.invoice_id && (
                    <p>
                      {copy('invoiceStatus')}:{' '}
                      {current.invoice_state
                        ? copy(`invoice_state_${current.invoice_state}`)
                        : copy('unknownInvoiceStatus')}{' '}
                      <a
                        className="text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
                        href={`/admin/invoices?invoiceId=${encodeURIComponent(current.invoice_id)}`}
                      >
                        {copy('viewInvoice')}
                      </a>
                    </p>
                  )}
                </section>
              )}
              {(current.status === 'under_review' ||
                (current.status === 'offer_pending' && !current.has_paid_invoice)) && (
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-semibold">{copy('feeOffer')}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span>{copy('feeIrr')}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[1-9][0-9]*"
                        value={fee}
                        onChange={(event) => setFee(event.target.value)}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span>{copy('offerValidUntil')}</span>
                      <input
                        type="datetime-local"
                        value={validUntil}
                        onChange={(event) => setValidUntil(event.target.value)}
                        disabled={time.status !== 'ready'}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span>{copy('scope')}</span>
                    <textarea
                      value={scope}
                      onChange={(event) => setScope(event.target.value)}
                      maxLength={4000}
                      className="min-h-20 w-full rounded-md border bg-background p-2"
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>{copy('deliverables')}</span>
                    <textarea
                      value={deliverables}
                      onChange={(event) => setDeliverables(event.target.value)}
                      maxLength={4000}
                      className="min-h-20 w-full rounded-md border bg-background p-2"
                    />
                  </label>
                  {current.invoice_id && (
                    <label className="block space-y-1 text-sm">
                      <span>{copy('replaceReason')}</span>
                      <textarea
                        value={offerReason}
                        onChange={(event) => setOfferReason(event.target.value)}
                        maxLength={2000}
                        className="min-h-16 w-full rounded-md border bg-background p-2"
                      />
                    </label>
                  )}
                  <Button
                    disabled={
                      !/^[1-9][0-9]{0,18}$/.test(fee) ||
                      !scope.trim() ||
                      !deliverables.trim() ||
                      !validOfferDeadline ||
                      (!!current.invoice_id && !offerReason.trim())
                    }
                    onClick={() =>
                      prepare('fee', copy('issueFee'), {
                        idempotencyKey: offerKey,
                        fee,
                        scope: scope.trim(),
                        deliverables: deliverables.trim(),
                        validUntil: offerDeadline!.toISOString(),
                        ...(current.invoice_id ? { reason: offerReason.trim() } : {}),
                      })
                    }
                  >
                    {copy(current.invoice_id ? 'replaceFee' : 'issueFee')}
                  </Button>
                </div>
              )}
              {current.status === 'offer_pending' && current.has_paid_invoice && (
                <p className="rounded-lg border p-4 text-sm">{copy('paidAdjustmentPending')}</p>
              )}
              {current.status === 'offer_accepted' && (
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-semibold">{copy('adjustPaidFee')}</h3>
                  <p className="text-sm text-muted-foreground">{copy('adjustPaidFeeHelp')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span>{copy('feeIrr')}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[1-9][0-9]*"
                        value={fee}
                        onChange={(event) => setFee(event.target.value)}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span>{copy('offerValidUntil')}</span>
                      <input
                        type="datetime-local"
                        value={validUntil}
                        onChange={(event) => setValidUntil(event.target.value)}
                        disabled={time.status !== 'ready'}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span>{copy('adjustmentReason')}</span>
                    <textarea
                      value={offerReason}
                      onChange={(event) => setOfferReason(event.target.value)}
                      maxLength={1000}
                      className="min-h-16 w-full rounded-md border bg-background p-2"
                    />
                  </label>
                  <Button
                    disabled={
                      !/^[1-9][0-9]{0,18}$/.test(fee) ||
                      fee === current.fee ||
                      !offerReason.trim() ||
                      !validOfferDeadline
                    }
                    onClick={() =>
                      prepare('paid-fee', copy('adjustPaidFee'), {
                        idempotencyKey: offerKey,
                        fee,
                        reason: offerReason.trim(),
                        validUntil: offerDeadline!.toISOString(),
                      })
                    }
                  >
                    {copy('adjustPaidFee')}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => prepare('assign', copy('assignSelf'), { assignTo: 'self' })}
                >
                  {copy('assignSelf')}
                </Button>
                {current.status === 'submitted' && (
                  <Button onClick={() => prepare('review', copy('startReview'))}>
                    {copy('startReview')}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="consultation-team">{copy('team')}</Label>
                  <select
                    id="consultation-team"
                    value={team}
                    onChange={(event) => setTeam(event.target.value)}
                    className="w-full rounded-md border bg-background p-2"
                  >
                    <option value="">{copy('selectTeam')}</option>
                    {teams.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="outline"
                  disabled={!team.trim()}
                  onClick={() =>
                    prepare('assign', copy('assignTeam'), { assignTo: 'team', team: team.trim() })
                  }
                >
                  {copy('assignTeam')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="consultation-reason">{copy('note')}</Label>
                <textarea
                  id="consultation-reason"
                  className="min-h-24 w-full rounded-md border bg-background p-2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                />
                {current.has_paid_invoice && (
                  <p className="text-sm text-muted-foreground">{copy('paidClosureHelp')}</p>
                )}
                {BigInt(current.uncovered_credit) > 0n && (
                  <p role="status" className="text-sm text-destructive">
                    {copy('uncoveredCredit')}:{' '}
                    {new Intl.NumberFormat(locale).format(BigInt(current.uncovered_credit))} IRR
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {current.status === 'under_review' && (
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() =>
                        prepare('request-info', copy('requestInfo'), { reason: reason.trim() })
                      }
                    >
                      {copy('requestInfo')}
                    </Button>
                  )}
                  {current.status === 'offer_accepted' && (
                    <Button
                      disabled={!reason.trim()}
                      onClick={() =>
                        prepare('complete', copy('complete'), { reason: reason.trim() })
                      }
                    >
                      {copy('complete')}
                    </Button>
                  )}
                  {!['completed', 'rejected', 'cancelled', 'offer_declined'].includes(
                    current.status
                  ) && (
                    <>
                      <Button
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() =>
                          prepare(
                            current.has_paid_invoice ? 'paid-reject' : 'reject',
                            copy('reject'),
                            {
                              reason: reason.trim(),
                              ...(current.has_paid_invoice ? { idempotencyKey: offerKey } : {}),
                            }
                          )
                        }
                      >
                        {copy('reject')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() =>
                          prepare(
                            current.has_paid_invoice ? 'paid-cancel' : 'cancel',
                            copy('cancel'),
                            {
                              reason: reason.trim(),
                              ...(current.has_paid_invoice ? { idempotencyKey: offerKey } : {}),
                            }
                          )
                        }
                      >
                        {copy('cancel')}
                      </Button>
                    </>
                  )}
                  {BigInt(current.uncovered_credit) > 0n && (
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() =>
                        prepare('refund-recovery', copy('recoverRefund'), {
                          idempotencyKey: offerKey,
                          reason: reason.trim(),
                        })
                      }
                    >
                      {copy('recoverRefund')}
                    </Button>
                  )}
                </div>
              </div>
              <section className="space-y-2">
                <h3 className="font-semibold">{copy('history')}</h3>
                <ol className="space-y-2 border-s-2 ps-3">
                  {detail.history.map((event, index) => (
                    <li key={`${event.created_at}-${index}`} className="rounded border p-2 text-sm">
                      <span className="font-medium">{copy(`status_${event.status}`)}</span> ·{' '}
                      {copy(`actor_${event.actor_type}`)}
                      <time
                        className="block text-xs text-muted-foreground"
                        dateTime={event.created_at}
                      >
                        {time.format(event.created_at)}
                      </time>
                      {event.reason && <p dir="auto">{event.reason}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setReason('');
            setOfferKey(crypto.randomUUID());
            refresh();
          }}
        />
      )}
    </main>
  );
}
