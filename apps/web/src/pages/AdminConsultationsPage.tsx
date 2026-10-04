import { t as appText } from '@barghsa/i18n/app';
import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import {
  Button,
  FinancialReviewSummary,
  Label,
  ListPage,
  StatusBadge,
  StatusTimeline,
  type StatusTone,
} from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  parseConsultationFeeReview,
  parseConsultationPaidFeeReview,
  parseConsultationPaidResolutionReview,
  type ConsultationFeeReview,
  type ConsultationPaidFeeReview,
  type ConsultationPaidResolutionReview,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { offerInputFromInstant, offerInstantFromInput } from '../lib/consultation-offer-time.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import type { ConsultationListQuery } from '../lib/support-list-query.js';

interface RequestRow {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  staff_owner_id: string | null;
  staff_owner_name?: string | null;
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
    actor_name?: string | null;
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

const statusTones: Record<(typeof statuses)[number], StatusTone> = {
  submitted: 'info',
  under_review: 'warning',
  awaiting_customer_info: 'warning',
  offer_pending: 'warning',
  offer_accepted: 'success',
  offer_declined: 'destructive',
  completed: 'default',
  rejected: 'destructive',
  cancelled: 'destructive',
};
function consultationStatus(status: string, copy: (key: string) => string) {
  return Object.hasOwn(statusTones, status)
    ? { label: copy(`status_${status}`), tone: statusTones[status as keyof typeof statusTones] }
    : { label: copy('status_unknown'), tone: 'default' as const };
}
function ConsultationAssignment({
  request,
  copy,
}: {
  request: RequestRow;
  copy: (key: string) => string;
}) {
  const team = request.staff_team?.trim();
  const owner = request.staff_owner_id
    ? request.staff_owner_name?.trim() || copy('assignedStaff')
    : team
      ? copy('awaitingOwner')
      : copy('unassigned');
  return (
    <span
      data-slot="consultation-assignment"
      className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground"
    >
      <span>
        {copy('owner')}: <bdi className="break-words">{owner}</bdi>
      </span>
      {team && (
        <span>
          {copy('team')}: <bdi className="break-words">{team}</bdi>
        </span>
      )}
    </span>
  );
}

export function AdminConsultationsPage({ queries }: { queries?: ConsultationListQuery } = {}) {
  const { assignment: initialAssignment } = useSearch({ from: '/admin/consultations' });
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    cursor: string | null;
    rows: RequestRow[];
    nextAfter: string | null;
  } | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [queueLoading, setQueueLoading] = useState(true);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selectedId = queries ? queries.selected : localSelected;
  const setSelectedId = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const detail = loadedDetail?.request.id === selectedId ? loadedDetail : null;
  const [status, setStatus] = useState('');
  const [assignment, setAssignment] = useState(initialAssignment ?? 'all');
  const [priority, setPriority] = useState('all');
  const [minAgeDays, setMinAgeDays] = useState('0');
  const appliedStatus = queries ? queries.queue.query.filters.status || '' : status;
  const appliedAssignment = queries ? queries.queue.query.filters.assignment || 'all' : assignment;
  const appliedPriority = queries ? queries.queue.query.filters.priority || 'all' : priority;
  const appliedMinAgeDays = queries ? queries.queue.query.filters.minAgeDays || '0' : minAgeDays;
  const criteria = JSON.stringify([
    appliedStatus,
    appliedAssignment,
    appliedPriority,
    appliedMinAgeDays,
  ]);
  const rows = accepted?.criteria === criteria ? accepted.rows : [];
  const nextAfter = accepted?.criteria === criteria ? accepted.nextAfter : null;
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
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [teamsRevision, setTeamsRevision] = useState(0);
  const [queueError, setQueueError] = useState(false);
  const [queueDenied, setQueueDenied] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [teamsError, setTeamsError] = useState(false);
  const reviewRequest = useRef(0);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [feeReview, setFeeReview] = useState<ConsultationFeeReview | null>(null);
  const [paidFeeReview, setPaidFeeReview] = useState<ConsultationPaidFeeReview | null>(null);
  const [resolutionReview, setResolutionReview] = useState<ConsultationPaidResolutionReview | null>(
    null
  );
  const [reviewLoading, setReviewLoading] = useState(false);
  function resetQueue(clearSelection = false) {
    setAccepted(null);
    setAfter(null);
    if (clearSelection) setSelectedId(null);
  }
  function refresh() {
    resetQueue();
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    setTeamsError(false);
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
        if (!controller.signal.aborted) setTeamsError(true);
      });
    return () => controller.abort();
  }, [revision, teamsRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setQueueError(false);
    setQueueDenied(false);
    setQueueLoading(true);
    const query = new URLSearchParams({
      assignment: appliedAssignment,
      priority: appliedPriority,
      minAgeDays: appliedMinAgeDays,
    });
    if (appliedStatus) query.set('status', appliedStatus);
    if (after) query.set('after', after);
    void fetch(`/api/admin/consultations/requests?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { requests: RequestRow[]; nextAfter: string | null };
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === criteria &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.rows : [];
            const shown = new Set(previous.map((request) => request.id));
            return {
              criteria,
              cursor: after,
              rows: [...previous, ...result.requests.filter((request) => !shown.has(request.id))],
              nextAfter: staffOrderId(result.nextAfter) || null,
            };
          });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && ['401', '403'].includes(error.message)) {
          reviewRequest.current += 1;
          setAccepted(null);
          setSelectedId(null, true);
          setDetail(null);
          setAction(null);
          setFeeReview(null);
          setPaidFeeReview(null);
          setResolutionReview(null);
          setReviewLoading(false);
          setQueueDenied(true);
        } else setQueueError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [
    appliedStatus,
    appliedAssignment,
    appliedPriority,
    appliedMinAgeDays,
    criteria,
    after,
    revision,
    listRevision,
  ]);

  useEffect(() => {
    setReason('');
    setTeam('');
    setFee('');
    setScope('');
    setDeliverables('');
    setValidUntil('');
    setOfferReason('');
    setOfferKey(crypto.randomUUID());
    setError(false);
  }, [selectedId]);

  useEffect(() => {
    reviewRequest.current += 1;
    setFeeReview(null);
    setPaidFeeReview(null);
    setResolutionReview(null);
    setAction(null);
    setReviewLoading(false);
    setDetailError(false);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
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
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selectedId, revision, detailRevision]);

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

  async function prepareFeeOffer() {
    if (!selectedId || !current || !offerDeadline || reviewLoading) return;
    const terms = {
      fee,
      scope: scope.trim(),
      deliverables: deliverables.trim(),
      validUntil: offerDeadline.toISOString(),
      ...(current.invoice_id ? { reason: offerReason.trim() } : {}),
    };
    const request = ++reviewRequest.current;
    setReviewLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/consultations/requests/${encodeURIComponent(selectedId)}/fee-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(terms),
        }
      );
      if (!response.ok) throw new Error('fee-review');
      const review = parseConsultationFeeReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !review ||
        review.scope.resourceId !== selectedId ||
        review.scope.profileId !== current.profile_id ||
        review.data.fee !== terms.fee ||
        review.data.scope !== terms.scope ||
        review.data.deliverables !== terms.deliverables ||
        review.data.validUntil !== terms.validUntil ||
        review.data.reason !== (terms.reason ?? null) ||
        review.data.previousInvoice?.id !== (current.invoice_id ?? undefined)
      )
        throw new Error('fee-review');
      setFeeReview(review);
      prepare('fee', copy(current.invoice_id ? 'replaceFee' : 'issueFee'), {
        ...terms,
        idempotencyKey: offerKey,
        expectedReviewHash: review.hash,
      });
    } catch {
      if (request !== reviewRequest.current) return;
      setError(true);
      refresh();
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  }

  async function preparePaidFee() {
    if (!selectedId || !current || !offerDeadline || reviewLoading) return;
    const terms = { fee, reason: offerReason.trim(), validUntil: offerDeadline.toISOString() };
    const request = ++reviewRequest.current;
    setReviewLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/consultations/requests/${encodeURIComponent(selectedId)}/paid-fee-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(terms),
        }
      );
      if (!response.ok) throw new Error('paid-fee-review');
      const review = parseConsultationPaidFeeReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !review ||
        review.scope.resourceId !== selectedId ||
        review.scope.profileId !== current.profile_id ||
        review.data.previousFee !== current.fee ||
        review.data.revisedFee !== terms.fee ||
        review.data.reason !== terms.reason ||
        review.data.validUntil !== terms.validUntil ||
        review.data.paidInvoice.id !== current.invoice_id
      )
        throw new Error('paid-fee-review');
      setPaidFeeReview(review);
      prepare('paid-fee', copy('adjustPaidFee'), {
        ...terms,
        idempotencyKey: offerKey,
        expectedReviewHash: review.hash,
      });
    } catch {
      if (request !== reviewRequest.current) return;
      setError(true);
      refresh();
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  }

  async function preparePaidResolution(
    action: 'cancel' | 'reject' | 'recover_refund',
    title: string,
    reason: string
  ) {
    if (!selectedId || !current || reviewLoading) return;
    const request = ++reviewRequest.current;
    setReviewLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/consultations/requests/${encodeURIComponent(selectedId)}/paid-resolution-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action, reason }),
        }
      );
      if (!response.ok) throw new Error('paid-resolution-review');
      const review = parseConsultationPaidResolutionReview(await response.json());
      if (request !== reviewRequest.current) return;
      if (
        !review ||
        review.scope.resourceId !== selectedId ||
        review.scope.profileId !== current.profile_id ||
        review.data.action !== action ||
        review.data.reason !== reason ||
        review.data.currentStatus !== current.status ||
        (review.data.currentInvoice?.id ?? null) !== current.invoice_id
      )
        throw new Error('paid-resolution-review');
      setResolutionReview(review);
      prepare(action === 'recover_refund' ? 'refund-recovery' : `paid-${action}`, title, {
        idempotencyKey: offerKey,
        reason,
        expectedReviewHash: review.hash,
      });
    } catch {
      if (request !== reviewRequest.current) return;
      setError(true);
      refresh();
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
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
      </header>
      {time.notice}
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span>{copy('filterStatus')}</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={appliedStatus}
                  onChange={(event) => {
                    if (queries) queries.setFilters({ status: event.target.value });
                    else {
                      resetQueue(true);
                      setStatus(event.target.value);
                    }
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
                  value={appliedAssignment}
                  onChange={(event) => {
                    if (queries) queries.setFilters({ assignment: event.target.value });
                    else {
                      resetQueue(true);
                      setAssignment(event.target.value);
                    }
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
                  value={appliedPriority}
                  onChange={(event) => {
                    if (queries) queries.setFilters({ priority: event.target.value });
                    else {
                      resetQueue(true);
                      setPriority(event.target.value);
                    }
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
                  value={appliedMinAgeDays}
                  onChange={(event) => {
                    if (queries) queries.setFilters({ minAgeDays: event.target.value });
                    else {
                      resetQueue(true);
                      setMinAgeDays(event.target.value);
                    }
                  }}
                >
                  <option value="0">{copy('all')}</option>
                  <option value="1">{copy('oneDay')}</option>
                  <option value="7">{copy('sevenDays')}</option>
                </select>
              </label>
            </div>
          }
          actions={
            <Button variant="outline" onClick={refresh} disabled={queueLoading}>
              {copy('refresh')}
            </Button>
          }
        />
        {teamsError && (
          <div className="space-y-2" role="alert">
            <p>{copy('teamsLoadError')}</p>
            <Button variant="outline" onClick={() => setTeamsRevision((value) => value + 1)}>
              {copy('retry')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {copy('loadError')}
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section aria-label={copy('staffTitle')} className="space-y-2">
            <ListPage.Content
              loading={queueLoading}
              error={queueError || queueDenied}
              empty={rows.length === 0}
              retainContent={rows.length > 0 && !queueDenied}
              loadingView={<p role="status">{copy('loading')}</p>}
              errorView={
                queueDenied ? (
                  <p role="alert">{copy('queueForbidden')}</p>
                ) : (
                  <div className="space-y-2">
                    <p role="alert">{copy('loadError')}</p>
                    <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                      {copy('retry')}
                    </Button>
                  </div>
                )
              }
              emptyView={<p className="text-muted-foreground">{copy('noWork')}</p>}
            >
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
                  className={`min-w-0 w-full rounded-xl border bg-card p-4 text-start hover:border-primary ${selectedId === row.id ? 'border-primary ring-1 ring-primary' : ''}`}
                >
                  <span className="block font-semibold" dir="auto">
                    {row.product_snapshot.title[locale]}
                  </span>
                  <span className="mt-1 block text-sm" dir="auto">
                    {row.profile_name}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <StatusBadge state={row.status} {...consultationStatus(row.status, copy)} />
                    <span>
                      {copy(row.priority)} ·{' '}
                      {time.format(row.submitted_at, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </span>
                  </span>
                  <span className="mt-2 block">
                    <ConsultationAssignment request={row} copy={copy} />
                  </span>
                </button>
              ))}
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={
                !!nextAfter &&
                !queueError &&
                !queueDenied &&
                (queueLoading ||
                  (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={queueLoading}
              onNext={() => {
                if (!nextAfter) return;
                if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled: !queueDenied && (queries?.queue.hasPrevious ?? false),
                onClick: () => queries?.queue.previous(),
                label: appText('historyPagination.previous', locale),
              }}
              label={appText('historyPagination.label', locale)}
              nextLabel={copy('moreWork')}
            />
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={copy('details')}>
            {!selectedId && <p className="text-muted-foreground">{copy('selectRequest')}</p>}
            {selectedId && !current && !detailError && <p role="status">{copy('loading')}</p>}
            {selectedId && detailError && (
              <div role="alert" className="space-y-2">
                <p>{copy('detailLoadError')}</p>
                <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                  {copy('retry')}
                </Button>
              </div>
            )}
            {current && (
              <>
                <div>
                  <h2 className="text-xl font-semibold" dir="auto">
                    {current.product_snapshot.title[locale]}
                  </h2>
                  <p>
                    {copy('customer')}: <span dir="auto">{current.profile_name}</span>
                  </p>
                  <p className="my-2 flex flex-wrap items-center gap-2">
                    {copy('status')}:{' '}
                    <StatusBadge
                      state={current.status}
                      {...consultationStatus(current.status, copy)}
                    />
                  </p>
                  <ConsultationAssignment request={current} copy={copy} />
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
                        reviewLoading ||
                        !/^[1-9][0-9]{0,18}$/.test(fee) ||
                        !scope.trim() ||
                        !deliverables.trim() ||
                        !validOfferDeadline ||
                        (!!current.invoice_id && !offerReason.trim())
                      }
                      onClick={() => void prepareFeeOffer()}
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
                        reviewLoading ||
                        !/^[1-9][0-9]{0,18}$/.test(fee) ||
                        fee === current.fee ||
                        !offerReason.trim() ||
                        !validOfferDeadline
                      }
                      onClick={() => void preparePaidFee()}
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
                          disabled={!reason.trim() || reviewLoading}
                          onClick={() =>
                            current.has_paid_invoice
                              ? void preparePaidResolution('reject', copy('reject'), reason.trim())
                              : prepare('reject', copy('reject'), { reason: reason.trim() })
                          }
                        >
                          {copy('reject')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!reason.trim() || reviewLoading}
                          onClick={() =>
                            current.has_paid_invoice
                              ? void preparePaidResolution('cancel', copy('cancel'), reason.trim())
                              : prepare('cancel', copy('cancel'), { reason: reason.trim() })
                          }
                        >
                          {copy('cancel')}
                        </Button>
                      </>
                    )}
                    {BigInt(current.uncovered_credit) > 0n && (
                      <Button
                        variant="outline"
                        disabled={!reason.trim() || reviewLoading}
                        onClick={() =>
                          void preparePaidResolution(
                            'recover_refund',
                            copy('recoverRefund'),
                            reason.trim()
                          )
                        }
                      >
                        {copy('recoverRefund')}
                      </Button>
                    )}
                  </div>
                </div>
                <section className="space-y-2">
                  <h3 className="font-semibold">{copy('history')}</h3>
                  <StatusTimeline
                    label={copy('history')}
                    items={detail.history.map((event, index) => {
                      const actor = ['staff', 'customer'].includes(event.actor_type)
                        ? event.actor_type
                        : 'unknown';
                      const presentation = consultationStatus(event.status, copy);
                      return {
                        id: `${event.created_at}-${index}`,
                        title: presentation.label,
                        tone: presentation.tone,
                        state: event.status,
                        dateTime: event.created_at,
                        dateLabel: time.format(event.created_at),
                        actorLabel: [
                          actor === 'unknown' ? null : event.actor_name,
                          copy(`actor_${actor}`),
                        ]
                          .filter(Boolean)
                          .join(' · '),
                        description: event.reason ?? undefined,
                      };
                    })}
                  />
                </section>
              </>
            )}
          </section>
        </div>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            resolutionReview ? (
              <FinancialReviewSummary
                title={copy('paidResolutionReviewTitle')}
                rows={[
                  {
                    id: 'profile',
                    label: copy('customer'),
                    value: resolutionReview.data.profileName,
                  },
                  {
                    id: 'service',
                    label: copy('details'),
                    value: resolutionReview.data.serviceTitle[locale],
                  },
                  {
                    id: 'status',
                    label: copy('status'),
                    value: copy(`status_${resolutionReview.data.currentStatus}`),
                  },
                  {
                    id: 'outcome',
                    label: copy('nextStep'),
                    value: copy(`status_${resolutionReview.data.resultingStatus}`),
                  },
                  ...(resolutionReview.data.currentInvoice
                    ? [
                        {
                          id: 'invoice',
                          label: copy('paidFeeReviewInvoice'),
                          value: resolutionReview.data.currentInvoice.id,
                        },
                        {
                          id: 'invoiceState',
                          label: copy('invoiceStatus'),
                          value: copy(
                            `invoice_state_${resolutionReview.data.currentInvoice.state}`
                          ),
                        },
                        {
                          id: 'invoicePaid',
                          label: copy('decisionReviewAlreadyPaid'),
                          value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.currentInvoice.paidAmount))} IRR`,
                        },
                      ]
                    : []),
                  ...(resolutionReview.data.cancelInvoiceId
                    ? [
                        {
                          id: 'cancelInvoice',
                          label: copy('paidResolutionCancelInvoice'),
                          value: resolutionReview.data.cancelInvoiceId,
                        },
                      ]
                    : []),
                  { id: 'reason', label: copy('reason'), value: resolutionReview.data.reason },
                  ...(resolutionReview.data.totalCredit !== '0'
                    ? [
                        {
                          id: 'credit',
                          label: copy('creditAdjustment'),
                          value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.totalCredit))} IRR`,
                        },
                      ]
                    : []),
                  ...resolutionReview.data.refundAllocations.map((allocation) => ({
                    id: `refund-${allocation.invoiceId}`,
                    label: copy('paidFeeReviewRefundInvoice'),
                    value: `${allocation.invoiceId} · ${new Intl.NumberFormat(locale).format(BigInt(allocation.amount))} IRR`,
                  })),
                ]}
                total={{
                  label: copy('paidResolutionRefundTotal'),
                  value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.totalRefund))} IRR`,
                }}
                notice={copy(
                  resolutionReview.data.action === 'recover_refund'
                    ? 'paidResolutionRecoveryOutcome'
                    : 'paidResolutionCloseOutcome'
                )}
              />
            ) : paidFeeReview ? (
              <FinancialReviewSummary
                title={copy('paidFeeReviewTitle')}
                rows={[
                  { id: 'profile', label: copy('customer'), value: paidFeeReview.data.profileName },
                  {
                    id: 'service',
                    label: copy('details'),
                    value: paidFeeReview.data.serviceTitle[locale],
                  },
                  { id: 'scope', label: copy('scope'), value: paidFeeReview.data.scope },
                  {
                    id: 'deliverables',
                    label: copy('deliverables'),
                    value: paidFeeReview.data.deliverables,
                  },
                  {
                    id: 'invoice',
                    label: copy('paidFeeReviewInvoice'),
                    value: paidFeeReview.data.paidInvoice.id,
                  },
                  {
                    id: 'previousFee',
                    label: copy('paidFeeReviewPrevious'),
                    value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.previousFee))} IRR`,
                  },
                  {
                    id: 'change',
                    label: copy(
                      paidFeeReview.data.outcome === 'charge_invoice'
                        ? 'chargeAdjustment'
                        : 'creditAdjustment'
                    ),
                    value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.adjustmentAmount))} IRR`,
                  },
                  {
                    id: 'deadline',
                    label: copy('offerValidUntil'),
                    value: time.format(paidFeeReview.data.validUntil),
                  },
                  { id: 'reason', label: copy('reason'), value: paidFeeReview.data.reason },
                  ...paidFeeReview.data.refundPlan.map((refund) => ({
                    id: `refund-${refund.invoiceId}`,
                    label: copy('paidFeeReviewRefundInvoice'),
                    value: `${refund.invoiceId} · ${new Intl.NumberFormat(locale).format(BigInt(refund.amount))} IRR`,
                  })),
                ]}
                total={{
                  label: copy('paidFeeReviewRevised'),
                  value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.revisedFee))} IRR`,
                }}
                notice={copy(
                  paidFeeReview.data.outcome === 'charge_invoice'
                    ? 'paidFeeReviewChargeOutcome'
                    : 'paidFeeReviewCreditOutcome'
                )}
              />
            ) : feeReview ? (
              <FinancialReviewSummary
                title={copy('feeReviewTitle')}
                rows={[
                  { id: 'profile', label: copy('customer'), value: feeReview.data.profileName },
                  {
                    id: 'service',
                    label: copy('details'),
                    value: feeReview.data.serviceTitle[locale],
                  },
                  { id: 'scope', label: copy('scope'), value: feeReview.data.scope },
                  {
                    id: 'deliverables',
                    label: copy('deliverables'),
                    value: feeReview.data.deliverables,
                  },
                  {
                    id: 'deadline',
                    label: copy('offerValidUntil'),
                    value: time.format(feeReview.data.validUntil),
                  },
                  ...(feeReview.data.previousInvoice
                    ? [
                        {
                          id: 'previous',
                          label: copy('feeReviewPreviousInvoice'),
                          value: feeReview.data.previousInvoice.id,
                        },
                        {
                          id: 'previousAmount',
                          label: copy('feeReviewPreviousAmount'),
                          value: `${new Intl.NumberFormat(locale).format(BigInt(feeReview.data.previousInvoice.totalAmount))} IRR`,
                        },
                      ]
                    : []),
                  ...(feeReview.data.reason
                    ? [{ id: 'reason', label: copy('reason'), value: feeReview.data.reason }]
                    : []),
                ]}
                total={{
                  label: copy('feeIrr'),
                  value: `${new Intl.NumberFormat(locale).format(BigInt(feeReview.data.fee))} IRR`,
                }}
                notice={copy(
                  feeReview.data.outcome === 'issue_invoice'
                    ? 'feeReviewIssueOutcome'
                    : 'feeReviewReplaceOutcome'
                )}
              />
            ) : undefined
          }
          onClose={() => {
            setAction(null);
            setFeeReview(null);
            setPaidFeeReview(null);
            setResolutionReview(null);
          }}
          onSuccess={async (result) => {
            if (
              (feeReview || paidFeeReview || resolutionReview) &&
              (result as { financialReview?: { hash?: string } } | null)?.financialReview?.hash !==
                (feeReview ?? paidFeeReview ?? resolutionReview)?.hash
            )
              throw new Error('Consultation fee confirmation did not match the review');
            setReason('');
            setOfferKey(crypto.randomUUID());
            setFeeReview(null);
            setPaidFeeReview(null);
            setResolutionReview(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
