import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  DatePicker,
  FinancialReviewSummary,
  Input,
  Label,
  Textarea,
  datePickerCalendarDate,
} from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import {
  postalCalendarDate,
  postalDateInput,
  type SolarPostalTracking,
} from '../lib/solar-postal-tracking.js';
import { SolarPostalTrackingSummary } from './SolarPostalTrackingSummary.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

type Command = {
  estimatedArrivalDate: string | null;
  trackingUrl: string | null;
  note: string;
  expectedRevision: number;
  idempotencyKey: string;
};
type Review = {
  hash: string;
  data: SolarPostalTracking & {
    previousEstimatedArrivalDate: string | null;
    previousTrackingUrl: string | null;
    previousNote: string | null;
  };
};
export function SolarPostalTrackingEditor({
  requestId,
  onSaved,
  onDenied,
}: {
  requestId: string;
  onSaved: () => void;
  onDenied: () => void;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [detail, setDetail] = useState<SolarPostalTracking | null>(null);
  const [estimate, setEstimate] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ review: Review; action: TeamAction } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const path = `/api/admin/solar/requests/${encodeURIComponent(requestId)}/postal/tracking`;
  useEffect(() => {
    const controller = new AbortController();
    ++generation.current;
    setDetail(null);
    setProposal(null);
    setError(null);
    setBusy(false);
    inFlight.current = false;
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return null;
        if (response.status === 401 || response.status === 403) {
          setDetail(null);
          setError('load');
          onDenied();
          return null;
        }
        if (!response.ok) throw new Error('tracking');
        return response.json() as Promise<SolarPostalTracking>;
      })
      .then((value) => {
        if (controller.signal.aborted || !value) return;
        setDetail(value);
        setEstimate(value.estimatedArrivalDate ?? '');
        setUrl(value.trackingUrl ?? '');
        setNote(value.note ?? '');
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('load');
      });
    return () => {
      controller.abort();
      ++generation.current;
    };
  }, [path, revision]);
  async function review(event: FormEvent) {
    event.preventDefault();
    if (!detail?.canEdit || inFlight.current) return;
    const token = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body: Command = {
      estimatedArrivalDate: estimate || null,
      trackingUrl: url.trim() || null,
      note: note.trim(),
      expectedRevision: detail.revision,
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      const response = await fetch(`${path}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (generation.current !== token) return;
      if (response.status === 401 || response.status === 403) {
        setDetail(null);
        setRevision((v) => v + 1);
        onSaved();
        return;
      }
      if (!response.ok) throw new Error('review');
      const snapshot = (await response.json()) as Review;
      if (generation.current !== token) return;
      setProposal({
        review: snapshot,
        action: {
          title: copy('postalTrackingReviewTitle'),
          description: copy('postalTrackingReviewDescription'),
          path,
          method: 'POST',
          successStatus: 200,
          body: { ...body, expectedReviewHash: snapshot.hash },
          conflictMessage: copy('postalTrackingChanged'),
        },
      });
    } catch {
      if (generation.current === token) setError('save');
    } finally {
      if (generation.current === token) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const formatted = (value: string | null) =>
    postalCalendarDate(value, locale) ?? copy('postalNotRecorded');
  return (
    <section className="space-y-4 border-t pt-4" aria-label={copy('postalTrackingUpdate')}>
      <h3 className="text-lg font-semibold">{copy('postalTrackingUpdate')}</h3>
      {!detail && !error && <p role="status">{copy('loading')}</p>}
      {error && (
        <p role="alert">
          {copy(error === 'load' ? 'postalTrackingLoadError' : 'postalTrackingSaveError')}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          ++generation.current;
          setProposal(null);
          setDetail(null);
          setRevision((v) => v + 1);
        }}
      >
        {copy('postalTrackingReload')}
      </Button>
      {detail && (
        <>
          <SolarPostalTrackingSummary tracking={detail} />
          {!detail.canEdit && <p>{copy('postalTrackingBlocked')}</p>}
          {detail.canEdit && (
            <form className="space-y-4" onSubmit={(event) => void review(event)}>
              <div className="space-y-2">
                <DatePicker
                  id="postal-arrival-estimate"
                  label={copy('postalArrivalEstimate')}
                  locale={locale}
                  timezone={time.timezone}
                  disabled={busy || time.status !== 'ready'}
                  {...(estimate ? { value: datePickerCalendarDate(estimate, time.timezone) } : {})}
                  {...(detail.sendDate
                    ? { minDate: datePickerCalendarDate(detail.sendDate, time.timezone) }
                    : {})}
                  onChange={(value) => setEstimate(postalDateInput(value, time.timezone))}
                />
                {estimate && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEstimate('')}
                  >
                    {copy('postalClearEstimate')}
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">{copy('postalEstimateHelp')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal-tracking-url">{copy('postalTrackingUrl')}</Label>
                <Input
                  id="postal-tracking-url"
                  type="url"
                  dir="ltr"
                  maxLength={2000}
                  value={url}
                  disabled={busy}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal-tracking-note">{copy('postalTrackingNote')}</Label>
                <Textarea
                  id="postal-tracking-note"
                  required
                  maxLength={1000}
                  aria-describedby="postal-tracking-note-help"
                  value={note}
                  disabled={busy}
                  onChange={(event) => setNote(event.target.value)}
                />
                <p id="postal-tracking-note-help" className="text-sm text-muted-foreground">
                  {copy('postalTrackingNoteHelp')}
                </p>
              </div>
              <Button type="submit" disabled={busy || !note.trim()}>
                {copy('postalTrackingReview')}
              </Button>
            </form>
          )}
        </>
      )}
      {proposal && (
        <TeamActionDialog
          action={proposal.action}
          onClose={() => setProposal(null)}
          onDenied={() => {
            ++generation.current;
            setDetail(null);
            setProposal(null);
            setError('load');
            setRevision((v) => v + 1);
            onSaved();
          }}
          onSuccess={async () => {
            setProposal(null);
            setDetail(null);
            setRevision((v) => v + 1);
            onSaved();
          }}
          summary={
            <FinancialReviewSummary
              title={copy('postalTrackingReviewTitle')}
              total={{
                label: copy('postalTrackingUpdate'),
                value: copy('postalTrackingReviewDescription'),
              }}
              rows={[
                {
                  id: 'courier',
                  label: copy('postalCourier'),
                  value: proposal.review.data.courier ?? copy('postalNotRecorded'),
                },
                {
                  id: 'tracking',
                  label: copy('postalTracking'),
                  value: (
                    <bdi dir="ltr">
                      {proposal.review.data.trackingNumber ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'sent',
                  label: copy('postalSendDate'),
                  value: formatted(proposal.review.data.sendDate),
                },
                {
                  id: 'previous-estimate',
                  label: copy('postalTrackingPrevious'),
                  value: formatted(proposal.review.data.previousEstimatedArrivalDate),
                },
                {
                  id: 'estimate',
                  label: copy('postalArrivalEstimate'),
                  value: formatted(proposal.review.data.estimatedArrivalDate),
                },
                {
                  id: 'previous-url',
                  label: copy('postalTrackingPreviousUrl'),
                  value: (
                    <bdi dir="ltr" className="break-all">
                      {proposal.review.data.previousTrackingUrl ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'url',
                  label: copy('postalTrackingUrl'),
                  value: (
                    <bdi dir="ltr" className="break-all">
                      {proposal.review.data.trackingUrl ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'previous-note',
                  label: copy('postalTrackingPreviousNote'),
                  value: proposal.review.data.previousNote ?? copy('postalNotRecorded'),
                },
                {
                  id: 'note',
                  label: copy('postalTrackingNote'),
                  value: proposal.review.data.note ?? '',
                },
              ]}
            />
          }
        />
      )}
    </section>
  );
}
