import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button, Label } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { consultationNextAction } from '../lib/consultation-next-action.js';

interface Detail {
  request: {
    id: string;
    status: string;
    product_snapshot: { title: { fa: string; en: string } };
    submitted_at: string;
    staff_owner_username: string | null;
    staff_team: string | null;
    fee: string | null;
    scope: string | null;
    deliverables: string | null;
    expected_next_step: string | null;
    offer_valid_until: string | null;
    invoice_id: string | null;
    invoice_state: string | null;
    has_paid_invoice: boolean;
    accepted_at: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer';
    reason: string | null;
    created_at: string;
  }>;
  adjustments: Array<{
    id: string;
    adjustment_kind: 'charge' | 'credit';
    amount: string;
    state: string;
  }>;
  refunds: Array<{ id: string; amount: string; state: string; destination: string }>;
}

export function ConsultationDetailPage() {
  const { requestId } = useParams({ from: '/_app/consultations/$requestId' });
  const navigate = useNavigate();
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [information, setInformation] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [infoSent, setInfoSent] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/consultations/requests/${encodeURIComponent(requestId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('request');
        return (await response.json()) as Detail;
      })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestId, revision]);

  async function provideInfo(event: FormEvent) {
    event.preventDefault();
    if (!information.trim() || sending) return;
    setSending(true);
    setActionError(false);
    try {
      const response = await fetch(
        `/api/consultations/requests/${encodeURIComponent(requestId)}/provide-info`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ reason: information.trim() }),
        }
      );
      if (!response.ok) throw new Error('provide-info');
      setInformation('');
      setInfoSent(true);
      setRevision((value) => value + 1);
    } catch {
      setActionError(true);
    } finally {
      setSending(false);
    }
  }

  async function decide(decision: 'accept' | 'decline') {
    if (sending) return;
    if (decision === 'decline' && !window.confirm(copy('confirmDecline'))) return;
    setSending(true);
    setActionError(false);
    try {
      const response = await fetch(
        `/api/consultations/requests/${encodeURIComponent(requestId)}/${decision}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({}),
        }
      );
      if (!response.ok) throw new Error(decision);
      const result = (await response.json()) as { paymentRequired?: boolean; invoiceId?: string };
      if (decision === 'accept' && result.paymentRequired && result.invoiceId) {
        await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: result.invoiceId } });
        return;
      }
      setRevision((value) => value + 1);
    } catch {
      setActionError(true);
    } finally {
      setSending(false);
    }
  }

  const request = detail?.request;
  const offerExpired =
    !!request?.offer_valid_until &&
    new Date(request.offer_valid_until) <= new Date() &&
    request.invoice_state !== 'Paid' &&
    !request.accepted_at;
  const refundPending =
    detail?.refunds.some(
      (refund) => !['Completed', 'Rejected', 'Cancelled'].includes(refund.state)
    ) ?? false;
  const action = request ? consultationNextAction(request, refundPending, locale) : null;
  const latestEvent = detail?.history.at(-1);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Link to="/consultations" className="text-sm text-primary underline">
        {copy('back')}
      </Link>
      <h1 className="text-3xl font-semibold">{copy('details')}</h1>
      {time.notice}
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('loadError')}</p>}
      {request && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={copy(`status_${request.status}`)}
            happened={
              latestEvent?.reason ??
              `${copy(`status_${latestEvent?.status ?? request.status}`)} · ${time.format(latestEvent?.created_at ?? request.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}`
            }
            nextAction={action!.text}
            owner={action!.owner}
            actionHref={action?.href}
          />
          <section className="space-y-3 rounded-xl border bg-card p-5">
            <h2 className="text-xl font-semibold" dir="auto">
              {request.product_snapshot.title[locale]}
            </h2>
            <p>
              {copy('submittedAt')}:{' '}
              <time dateTime={request.submitted_at}>
                {time.format(request.submitted_at, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </time>
            </p>
            <p>
              {copy('owner')}:{' '}
              <span dir="auto">{request.staff_owner_username ?? copy('unassigned')}</span>
            </p>
            {request.staff_team && (
              <p>
                {copy('team')}: <span dir="auto">{request.staff_team}</span>
              </p>
            )}
            {request.fee ? (
              <p>
                {copy('fee')}: {new Intl.NumberFormat(locale).format(BigInt(request.fee))} IRR
              </p>
            ) : (
              <p className="text-muted-foreground">{copy('noFee')}</p>
            )}
            {request.scope && (
              <p>
                {copy('scope')}: <span dir="auto">{request.scope}</span>
              </p>
            )}
            {request.deliverables && (
              <p>
                {copy('deliverables')}: <span dir="auto">{request.deliverables}</span>
              </p>
            )}
            {request.offer_valid_until && (
              <p>
                {copy('offerValidUntil')}:{' '}
                <time dateTime={request.offer_valid_until}>
                  {time.format(request.offer_valid_until)}
                </time>
              </p>
            )}
            {request.invoice_id && request.accepted_at && (
              <p>
                <Link
                  className="text-primary underline"
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: request.invoice_id }}
                >
                  {copy('viewInvoice')}
                </Link>
              </p>
            )}
          </section>
          {(detail.adjustments.length > 0 || detail.refunds.length > 0) && (
            <section className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">{copy('financialActivity')}</h2>
              {['cancelled', 'rejected'].includes(request.status) &&
                detail.refunds.some(
                  (refund) => !['Completed', 'Rejected', 'Cancelled'].includes(refund.state)
                ) && <p role="status">{copy('paidClosurePending')}</p>}
              {detail.adjustments.map((item) => (
                <p key={item.id}>
                  {copy(
                    item.adjustment_kind === 'credit' ? 'creditAdjustment' : 'chargeAdjustment'
                  )}
                  : {new Intl.NumberFormat(locale).format(BigInt(item.amount))} IRR
                  {item.adjustment_kind === 'charge' && ` · ${copy(`invoice_state_${item.state}`)}`}
                </p>
              ))}
              {detail.refunds.map((item) => (
                <p key={item.id}>
                  {copy('refundRequest')}:{' '}
                  {new Intl.NumberFormat(locale).format(BigInt(item.amount))} IRR ·{' '}
                  {copy(`refund_state_${item.state}`)}
                </p>
              ))}
            </section>
          )}
          {request.status === 'offer_pending' && (
            <section id="consultation-offer" className="space-y-3 rounded-xl border bg-card p-5">
              {offerExpired && <p role="status">{copy('offerExpired')}</p>}
              {request.invoice_state === 'PaymentUnderReview' ? (
                <p>{copy('paymentUnderReview')}</p>
              ) : request.accepted_at && request.invoice_state !== 'Paid' ? (
                <p>{copy('acceptedAwaitingPayment')}</p>
              ) : (
                <p>{copy('reviewOffer')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(!request.accepted_at || request.invoice_state === 'Paid') && (
                  <Button
                    type="button"
                    disabled={sending || offerExpired}
                    onClick={() => void decide('accept')}
                  >
                    {copy(request.invoice_state === 'Paid' ? 'confirmAcceptance' : 'acceptOffer')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending || request.invoice_state === 'Paid' || request.has_paid_invoice}
                  onClick={() => void decide('decline')}
                >
                  {copy('declineOffer')}
                </Button>
              </div>
              {request.has_paid_invoice && <p>{copy('paidDeclineHelp')}</p>}
              {actionError && (
                <p role="alert" className="text-destructive">
                  {copy('actionError')}
                </p>
              )}
            </section>
          )}
          {request.status === 'awaiting_customer_info' && (
            <form
              id="consultation-information-form"
              onSubmit={provideInfo}
              className="space-y-3 rounded-xl border bg-card p-5"
            >
              <Label htmlFor="consultation-information">{copy('information')}</Label>
              <textarea
                id="consultation-information"
                value={information}
                onChange={(event) => setInformation(event.target.value)}
                maxLength={2000}
                required
                className="min-h-28 w-full rounded-md border bg-background p-3"
              />
              {actionError && (
                <p role="alert" className="text-destructive">
                  {copy('actionError')}
                </p>
              )}
              <Button type="submit" disabled={sending || !information.trim()}>
                {copy('provideInfo')}
              </Button>
            </form>
          )}
          {infoSent && <p role="status">{copy('infoSent')}</p>}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{copy('history')}</h2>
            <ol className="space-y-3 border-s-2 ps-4">
              {detail.history.map((event, index) => (
                <li
                  key={`${event.created_at}-${index}`}
                  className="space-y-1 rounded-lg border bg-card p-3"
                >
                  <p className="font-medium">{copy(`status_${event.status}`)}</p>
                  <time className="block text-xs text-muted-foreground" dateTime={event.created_at}>
                    {time.format(event.created_at)}
                  </time>
                  <p className="text-xs text-muted-foreground">
                    {copy('actor')}: {copy(`actor_${event.actor_type}`)}
                  </p>
                  {event.reason && (
                    <p>
                      {copy('reason')}: <span dir="auto">{event.reason}</span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
