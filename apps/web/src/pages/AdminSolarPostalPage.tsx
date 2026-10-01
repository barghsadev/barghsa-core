import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tSolar } from '@barghsa/i18n/solar';
import { Button, FinancialReviewSummary, ListPage } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { SolarContractForm } from '../components/SolarContractForm.js';
import { withCsrf } from '../lib/csrf.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

interface Guidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
interface Row {
  id: string;
  profile_id: string;
  profile_name: string;
  request_status: string;
  postal_status: string;
  courier: string | null;
  tracking_number: string | null;
  send_date: string | null;
  receipt_image_id: string | null;
  staff_notes: string | null;
  created_at: string;
}

type PostalLane = 'needs_staff' | 'waiting_customer' | 'all';
type FinalDecision = 'approve' | 'reject' | 'close-no-contract';
interface FinalReview {
  hash: string;
  data: {
    requestId: string;
    currentStatus: string;
    postalStatus: string | null;
    trackingNumber: string | null;
    reason: string | null;
    outcome: string;
  };
}
interface PostalReview {
  hash: string;
  data: {
    requestId: string;
    currentRequestStatus: string;
    currentPostalStatus: string;
    courier: string | null;
    trackingNumber: string | null;
    sendDate: string | null;
    receiptImageId: string | null;
    reason: string | null;
    postalOutcome: string;
    requestOutcome: string;
  };
}

export function AdminSolarPostalPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<Row[]>([]);
  const [localLane, setLane] = useState<PostalLane>('needs_staff');
  const lane = (queries?.query.filters.lane || localLane) as PostalLane;
  const [acceptedLane, setAcceptedLane] = useState(lane);
  const visibleRows = acceptedLane === lane ? rows : [];
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [originalsFa, setOriginalsFa] = useState('');
  const [originalsEn, setOriginalsEn] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<
    (TeamAction & { review?: FinalReview; postalReview?: PostalReview }) | null
  >(null);
  const [preparingDecision, setPreparingDecision] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const [queueError, setQueueError] = useState(false);
  const [queueDenied, setQueueDenied] = useState(false);
  const [guidanceError, setGuidanceError] = useState(false);
  const reviewRequest = useRef(0);
  const commandGeneration = useRef(0);
  function propose(next: NonNullable<typeof action>) {
    commandGeneration.current = ++reviewRequest.current;
    setPreparingDecision(false);
    setAction(next);
  }
  function invalidateReview() {
    reviewRequest.current += 1;
    setAction(null);
    setPreparingDecision(false);
  }
  const [localBefore, setBefore] = useState<string | null>(null);
  const before = queries ? queries.query.cursor || null : localBefore;
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const acceptedCursor = useRef<string | null>(null);
  const extendingCursor = useRef<string | null>(null);
  const queryScope = JSON.stringify([lane, before]);
  const previousScope = useRef(queryScope);
  if (previousScope.current !== queryScope) {
    previousScope.current = queryScope;
    ++reviewRequest.current;
  }
  useEffect(() => {
    invalidateReview();
    if (!before || extendingCursor.current !== before) {
      setSelected(null);
      setPreview(null);
      setReason('');
      setError(false);
    }
    extendingCursor.current = null;
  }, [queryScope]);
  useEffect(
    () => () => {
      ++reviewRequest.current;
    },
    []
  );
  const [queueLoading, setQueueLoading] = useState(true);
  const [createdContractId, setCreatedContractId] = useState<string | null>(null);
  const refresh = () => {
    invalidateReview();
    if (queries) {
      queries.setQuery({ cursor: '' });
      if (!before) setQueueRevision((value) => value + 1);
    } else {
      setBefore(null);
      setRevision((value) => value + 1);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setQueueLoading(true);
    setQueueError(false);
    setQueueDenied(false);
    const query = new URLSearchParams({ lane });
    if (before) query.set('before', before);
    void fetch(`/api/admin/solar/postal-queue?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ requests: Row[]; nextBefore: string | null }>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        const extending =
          !!before &&
          nextBefore === before &&
          acceptedCursor.current !== before &&
          acceptedLane === lane;
        setRows((current) => {
          if (!extending) return value.requests;
          const shown = new Set(current.map((request) => request.id));
          return [...current, ...value.requests.filter((request) => !shown.has(request.id))];
        });
        acceptedCursor.current = before;
        setAcceptedLane(lane);
        setNextBefore(value.nextBefore);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) {
          invalidateReview();
          setRows([]);
          setNextBefore(null);
          setSelected(null);
          setPreview(null);
          setQueueDenied(true);
        } else setQueueError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [before, lane, revision, queueRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setGuidanceError(false);
    void fetch('/api/admin/solar/postal-guidance', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance');
        return response.json() as Promise<Guidance>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setGuidance(value);
        setOriginalsFa(value.originals.map((item) => item.fa).join('\n'));
        setOriginalsEn(value.originals.map((item) => item.en).join('\n'));
      })
      .catch(() => {
        if (!controller.signal.aborted) setGuidanceError(true);
      });
    return () => controller.abort();
  }, [guidanceRevision]);
  const row = visibleRows.find((item) => item.id === selected);
  function saveGuidance(event: FormEvent) {
    event.preventDefault();
    if (!guidance) return;
    const fa = originalsFa
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const en = originalsEn
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!guidance.fa.trim() || !guidance.en.trim() || fa.length !== en.length) {
      setError(true);
      return;
    }
    propose({
      title: copy('postalSaveGuidance'),
      description: copy('postalSaveGuidance'),
      path: '/api/admin/solar/postal-guidance',
      method: 'PUT',
      body: {
        ...guidance,
        fa: guidance.fa.trim(),
        en: guidance.en.trim(),
        originals: fa.map((item, index) => ({ fa: item, en: en[index] })),
      },
    });
  }
  async function decide(decision: 'confirm-received' | 'mark-incomplete' | 'mark-not-received') {
    if (preparingDecision) return;
    if (!row || (decision !== 'confirm-received' && !reason.trim())) {
      setError(true);
      return;
    }
    const requestId = row.id;
    const decisionReason = reason.trim();
    const reviewDecision = {
      'confirm-received': 'received',
      'mark-incomplete': 'incomplete',
      'mark-not-received': 'not_received',
    }[decision];
    const request = ++reviewRequest.current;
    setPreparingDecision(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/solar/requests/${encodeURIComponent(requestId)}/postal/review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            decision: reviewDecision,
            ...(decision === 'confirm-received' ? {} : { reason: decisionReason }),
          }),
        }
      );
      if (!response.ok) throw new Error('review');
      const postalReview = (await response.json()) as PostalReview;
      if (request !== reviewRequest.current) return;
      propose({
        title: copy(`postal_${decision}`),
        description: requestId,
        path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/postal/${decision}`,
        method: 'POST',
        body: {
          ...(decision === 'confirm-received' ? {} : { reason: decisionReason }),
          expectedReviewHash: postalReview.hash,
        },
        conflictMessage: copy('postalReviewChanged'),
        postalReview,
      });
    } catch {
      if (request === reviewRequest.current) setError(true);
    } finally {
      if (request === reviewRequest.current) setPreparingDecision(false);
    }
  }
  async function prepareFinalDecision(decision: FinalDecision, requestId: string) {
    if (preparingDecision) return;
    const decisionReason = reason.trim();
    if (decision !== 'approve' && !decisionReason) {
      setError(true);
      return;
    }
    const request = ++reviewRequest.current;
    setPreparingDecision(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/solar/requests/${encodeURIComponent(requestId)}/final-decision/review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            decision,
            ...(decision === 'approve' ? {} : { reason: decisionReason }),
          }),
        }
      );
      if (!response.ok) throw new Error('review');
      const review = (await response.json()) as FinalReview;
      if (request !== reviewRequest.current) return;
      propose({
        title: copy(
          decision === 'approve'
            ? 'solarFinalApprove'
            : decision === 'reject'
              ? 'solarFinalReject'
              : 'solarCloseNoContract'
        ),
        description: requestId,
        path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/${decision === 'approve' ? 'final-approve' : decision === 'reject' ? 'final-reject' : 'close-no-contract'}`,
        method: 'POST',
        body: {
          ...(decision === 'approve' ? {} : { reason: decisionReason }),
          expectedReviewHash: review.hash,
        },
        conflictMessage: copy('solarFinalReviewChanged'),
        review,
      });
    } catch {
      if (request === reviewRequest.current) setError(true);
    } finally {
      if (request === reviewRequest.current) setPreparingDecision(false);
    }
  }
  const actionGeneration = commandGeneration.current;
  const viewGeneration = reviewRequest.current;
  return (
    <div className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('postalStaffTitle')}</h1>
      {time.notice}
      {error && <p role="alert">{copy('postalError')}</p>}
      {createdContractId && (
        <p role="status">
          {copy('solarContractCreated')}{' '}
          <a
            className="underline"
            href={`/admin/contracts?contractId=${encodeURIComponent(createdContractId)}`}
          >
            {copy('solarViewContract')}
          </a>
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('postalStaffQueue')}</h2>
        <ListPage>
          <ListPage.Toolbar
            filters={
              <label className="block max-w-xs space-y-1" htmlFor="solar-postal-lane">
                <span>{copy('postalLane')}</span>
                <select
                  id="solar-postal-lane"
                  className="w-full rounded-md border bg-background p-2"
                  value={lane}
                  onChange={(event) => {
                    if (queries) {
                      queries.setQuery({ filters: { lane: event.target.value } });
                      return;
                    }
                    invalidateReview();
                    setRows([]);
                    setBefore(null);
                    setNextBefore(null);
                    setSelected(null);
                    setLane(event.target.value as PostalLane);
                  }}
                >
                  <option value="needs_staff">{copy('postalLaneAction')}</option>
                  <option value="waiting_customer">{copy('postalLaneWaiting')}</option>
                  <option value="all">{copy('postalLaneAll')}</option>
                </select>
              </label>
            }
          />
          <ListPage.Content
            loading={queueLoading}
            error={queueError || queueDenied}
            empty={!visibleRows.length}
            retainContent={!!visibleRows.length && !queueDenied}
            loadingView={<p role="status">{copy('loading')}</p>}
            errorView={
              queueDenied ? (
                <p role="alert">{copy('staffQueueForbidden')}</p>
              ) : (
                <div className="space-y-2">
                  <p role="alert">{copy('staffQueueLoadError')}</p>
                  <Button variant="outline" onClick={() => setQueueRevision((v) => v + 1)}>
                    {copy('retry')}
                  </Button>
                </div>
              )
            }
            emptyView={
              <p>
                {copy(
                  lane === 'waiting_customer'
                    ? 'postalStaffEmptyWaiting'
                    : lane === 'all'
                      ? 'postalStaffEmptyAll'
                      : 'postalStaffEmpty'
                )}
              </p>
            }
          >
            <ul className="space-y-2">
              {visibleRows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md border p-3 text-start ${selected === item.id ? 'border-primary' : ''}`}
                    onClick={() => {
                      invalidateReview();
                      setSelected(item.id);
                      setPreview(null);
                      setReason('');
                    }}
                  >
                    <span className="block font-medium">{item.profile_name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {copy(`postal_${item.postal_status}`)} ·{' '}
                      {time.format(item.created_at, { dateStyle: 'medium' })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy('staffRequest')}: <bdi>{item.id}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ListPage.Content>
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!nextBefore &&
              !queueError &&
              !queueDenied &&
              (acceptedCursor.current !== before ||
                (nextBefore !== before && (!queries || queries.canAdvance(nextBefore))))
            }
            loading={queueLoading}
            label={copy('postalStaffQueue')}
            nextLabel={copy('moreRequests')}
            onNext={() => {
              extendingCursor.current = nextBefore;
              if (queries && nextBefore) queries.next(nextBefore);
              else setBefore(nextBefore);
            }}
          />
        </ListPage>
      </section>
      {row && (
        <section className="space-y-3 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{copy('postalShipment')}</h2>
          <p>
            {copy('postalStatus')}: {copy(`postal_${row.postal_status}`)}
          </p>
          {row.courier && (
            <p>
              {copy('postalCourier')}: {row.courier}
            </p>
          )}
          {row.tracking_number && (
            <p>
              {copy('postalTracking')}: <span dir="ltr">{row.tracking_number}</span>
            </p>
          )}
          {row.send_date && (
            <p>
              {copy('postalSendDate')}: {row.send_date.slice(0, 10)}
            </p>
          )}
          {row.staff_notes && (
            <p>
              {copy('postalStaffNotes')}: {row.staff_notes}
            </p>
          )}
          {row.receipt_image_id && (
            <button
              type="button"
              className="underline"
              onClick={() => setPreview(row.receipt_image_id)}
            >
              {copy('preview')}
            </button>
          )}
          {preview && (
            <DocumentDetail
              id={preview}
              staff
              onClose={() => setPreview(null)}
              onChanged={refresh}
              onPrevious={setPreview}
              onReplace={() => {}}
              allowReplacement={false}
            />
          )}
          {row.postal_status === 'shipped' && (
            <>
              <label className="block">
                {copy('reason')}
                <textarea
                  className="mt-1 w-full rounded-md border p-2"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                  disabled={preparingDecision}
                  onClick={() => void decide('confirm-received')}
                >
                  {copy('postal_confirm-received')}
                </button>
                <button
                  className="rounded-md border px-4 py-2"
                  disabled={preparingDecision}
                  onClick={() => void decide('mark-incomplete')}
                >
                  {copy('postal_mark-incomplete')}
                </button>
                <button
                  className="rounded-md border px-4 py-2"
                  disabled={preparingDecision}
                  onClick={() => void decide('mark-not-received')}
                >
                  {copy('postal_mark-not-received')}
                </button>
              </div>
            </>
          )}
          {['postal_documents_received', 'final_review', 'approved'].includes(
            row.request_status
          ) && (
            <div className="space-y-3">
              {row.request_status !== 'postal_documents_received' && (
                <label className="block">
                  {copy('reason')}
                  <textarea
                    className="mt-1 w-full rounded-md border p-2"
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                {row.request_status === 'postal_documents_received' && (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                    onClick={() =>
                      propose({
                        title: copy('solarStartFinalReview'),
                        description: row.id,
                        path: `/api/admin/solar/requests/${row.id}/start-final-review`,
                        method: 'POST',
                      })
                    }
                  >
                    {copy('solarStartFinalReview')}
                  </button>
                )}
                {row.request_status === 'final_review' && (
                  <>
                    <button
                      type="button"
                      className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                      disabled={preparingDecision}
                      onClick={() => void prepareFinalDecision('approve', row.id)}
                    >
                      {copy('solarFinalApprove')}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-destructive px-4 py-2 text-destructive"
                      disabled={preparingDecision}
                      onClick={() => void prepareFinalDecision('reject', row.id)}
                    >
                      {copy('solarFinalReject')}
                    </button>
                  </>
                )}
                {row.request_status !== 'postal_documents_received' && (
                  <button
                    type="button"
                    className="rounded-md border px-4 py-2"
                    disabled={preparingDecision}
                    onClick={() => void prepareFinalDecision('close-no-contract', row.id)}
                  >
                    {copy('solarCloseNoContract')}
                  </button>
                )}
              </div>
            </div>
          )}
          {row.request_status === 'approved' && (
            <SolarContractForm
              key={row.id}
              requestId={row.id}
              profileId={row.profile_id}
              onCreated={(contractId) => {
                if (viewGeneration !== reviewRequest.current) return;
                setCreatedContractId(contractId);
                setSelected(null);
                refresh();
              }}
            />
          )}
        </section>
      )}
      {guidanceError && (
        <div role="alert" className="space-y-2">
          <p>{copy('staffGuidanceLoadError')}</p>
          <Button variant="outline" onClick={() => setGuidanceRevision((v) => v + 1)}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {guidance && (
        <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance}>
          <h2 className="text-xl font-semibold">{copy('postalGuidance')}</h2>
          {(['fa', 'en', 'destinationAddress', 'contactDetails'] as const).map((key) => (
            <label key={key} className="block">
              {copy(`postalGuidance_${key}`)}
              <textarea
                className="mt-1 w-full rounded-md border p-2"
                value={guidance[key]}
                onChange={(event) => setGuidance({ ...guidance, [key]: event.target.value })}
              />
            </label>
          ))}
          <label className="block">
            {copy('postalOriginalsFa')}
            <textarea
              className="mt-1 w-full rounded-md border p-2"
              value={originalsFa}
              onChange={(event) => setOriginalsFa(event.target.value)}
            />
          </label>
          <label className="block">
            {copy('postalOriginalsEn')}
            <textarea
              className="mt-1 w-full rounded-md border p-2"
              value={originalsEn}
              onChange={(event) => setOriginalsEn(event.target.value)}
            />
          </label>
          <button className="rounded-md border px-4 py-2" type="submit">
            {copy('postalSaveGuidance')}
          </button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => {
            if (actionGeneration === reviewRequest.current) invalidateReview();
          }}
          summary={
            action.review ? (
              <FinancialReviewSummary
                title={copy('solarFinalReviewTitle')}
                rows={[
                  {
                    id: 'request',
                    label: copy('staffRequest'),
                    value: action.review.data.requestId,
                  },
                  {
                    id: 'status',
                    label: copy('solarFinalCurrentStatus'),
                    value: copy(`status_${action.review.data.currentStatus}`),
                  },
                  {
                    id: 'postal',
                    label: copy('postalStatus'),
                    value: action.review.data.postalStatus
                      ? copy(`postal_${action.review.data.postalStatus}`)
                      : copy('solarFinalNotAvailable'),
                  },
                  ...(action.review.data.trackingNumber
                    ? [
                        {
                          id: 'tracking',
                          label: copy('postalTracking'),
                          value: action.review.data.trackingNumber,
                        },
                      ]
                    : []),
                  ...(action.review.data.reason
                    ? [
                        {
                          id: 'reason',
                          label: copy('reason'),
                          value: action.review.data.reason,
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('solarFinalOutcome'),
                  value: copy(`status_${action.review.data.outcome}`),
                }}
                notice={copy('solarFinalNoFinancialChange')}
              />
            ) : action.postalReview ? (
              <FinancialReviewSummary
                title={copy('postalReviewTitle')}
                rows={[
                  {
                    id: 'request',
                    label: copy('staffRequest'),
                    value: action.postalReview.data.requestId,
                  },
                  {
                    id: 'request-status',
                    label: copy('solarFinalCurrentStatus'),
                    value: copy(`status_${action.postalReview.data.currentRequestStatus}`),
                  },
                  {
                    id: 'postal-status',
                    label: copy('postalStatus'),
                    value: copy(`postal_${action.postalReview.data.currentPostalStatus}`),
                  },
                  {
                    id: 'courier',
                    label: copy('postalCourier'),
                    value: action.postalReview.data.courier ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'tracking',
                    label: copy('postalTracking'),
                    value:
                      action.postalReview.data.trackingNumber ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'send-date',
                    label: copy('postalSendDate'),
                    value: action.postalReview.data.sendDate ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'receipt',
                    label: copy('postalReceipt'),
                    value: action.postalReview.data.receiptImageId ?? copy('postalNoReceipt'),
                  },
                  ...(action.postalReview.data.reason
                    ? [
                        {
                          id: 'reason',
                          label: copy('reason'),
                          value: action.postalReview.data.reason,
                        },
                      ]
                    : []),
                  {
                    id: 'postal-outcome',
                    label: copy('postalReviewOutcome'),
                    value: copy(`postal_${action.postalReview.data.postalOutcome}`),
                  },
                ]}
                total={{
                  label: copy('solarFinalOutcome'),
                  value: copy(`status_${action.postalReview.data.requestOutcome}`),
                }}
                notice={copy('solarFinalNoFinancialChange')}
              />
            ) : undefined
          }
          onSuccess={async () => {
            if (actionGeneration !== reviewRequest.current) return;
            setError(false);
            refresh();
            setReason('');
          }}
        />
      )}
    </div>
  );
}
