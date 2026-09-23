import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button, Label } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';

interface Detail {
  request: {
    id: string;
    status: string;
    product_snapshot: { title: { fa: string; en: string } };
    submitted_at: string;
    fee: string | null;
    scope: string | null;
    deliverables: string | null;
    expected_next_step: string | null;
    offer_valid_until: string | null;
    invoice_id: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer';
    reason: string | null;
    created_at: string;
  }>;
}

export function ConsultationDetailPage() {
  const { requestId } = useParams({ from: '/_app/consultations/$requestId' });
  const locale = useLocale();
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

  const request = detail?.request;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <a href="/consultations" className="text-sm text-primary underline">
        {copy('back')}
      </a>
      <h1 className="text-3xl font-semibold">{copy('details')}</h1>
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('loadError')}</p>}
      {request && (
        <>
          <section className="space-y-3 rounded-xl border bg-card p-5">
            <h2 className="text-xl font-semibold" dir="auto">
              {request.product_snapshot.title[locale]}
            </h2>
            <p>
              {copy('status')}: <strong>{copy(`status_${request.status}`)}</strong>
            </p>
            <p>
              {copy('submittedAt')}:{' '}
              <time dateTime={request.submitted_at}>
                {new Intl.DateTimeFormat(locale).format(new Date(request.submitted_at))}
              </time>
            </p>
            <p>
              {copy('nextStep')}: {request.expected_next_step ?? copy('staffReview')}
            </p>
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
                  {new Intl.DateTimeFormat(locale).format(new Date(request.offer_valid_until))}
                </time>
              </p>
            )}
            {request.invoice_id && (
              <p>
                <a className="text-primary underline" href={`/invoices/${request.invoice_id}`}>
                  {copy('viewInvoice')}
                </a>
              </p>
            )}
          </section>
          {request.status === 'awaiting_customer_info' && (
            <form onSubmit={provideInfo} className="space-y-3 rounded-xl border bg-card p-5">
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
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(event.created_at))}
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
