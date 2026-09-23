import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface IncreaseRequest {
  requestId: string;
  contractId: string;
  orderId: string;
  originalKwh: string;
  requestedKwh: string;
  maxPercentage: number;
  effectiveFrom: string;
  periodEnd: string;
  createdAt: string;
  contractState: string;
}

export default function AdminElectricityIncreasesPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const [requests, setRequests] = useState<IncreaseRequest[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [effectiveDate, setEffectiveDate] = useState<Record<string, string>>({});
  const [action, setAction] = useState<TeamAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    const path =
      '/api/staff/electricity/increase-requests' +
      (before ? `?before=${encodeURIComponent(before)}` : '');
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          setDenied(true);
          return null;
        }
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{
          requests: IncreaseRequest[];
          nextBefore: string | null;
        }>;
      })
      .then((value) => {
        if (!controller.signal.aborted && value) {
          setRequests(value.requests);
          setNextBefore(value.nextBefore);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [before, revision]);

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setBefore(null);
            setRevision((value) => value + 1);
          }}
        >
          {copy('refresh')}
        </Button>
      </header>
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {denied ? <p role="alert">{copy('forbidden')}</p> : null}
      {error ? <p role="alert">{copy('error')}</p> : null}
      {!loading && !denied && !error && requests.length === 0 ? <p>{copy('empty')}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {requests.map((request) => (
          <Card key={request.requestId}>
            <CardContent className="space-y-3 pt-6 text-sm">
              <h2 className="font-semibold">{copy('request')}</h2>
              <p>
                {copy('contract')}:{' '}
                <a className="break-all text-primary underline" href="/admin/contracts">
                  {request.contractId}
                </a>
              </p>
              <p>
                {copy('order')}: {request.orderId}
              </p>
              <p>
                {copy('quantity')}: {numbers.irrDigits(request.originalKwh)} →{' '}
                {numbers.irrDigits(request.requestedKwh)} kWh
              </p>
              <p>
                {copy('change')}:{' '}
                {numbers.number(
                  Number(
                    ((BigInt(request.requestedKwh) - BigInt(request.originalKwh)) * 10000n) /
                      BigInt(request.originalKwh)
                  ) / 100
                )}
                %
              </p>
              <p>
                {copy('effective')}: {new Date(request.effectiveFrom).toLocaleString(locale)}
              </p>
              <p>
                {copy('end')}: {new Date(request.periodEnd).toLocaleString(locale)}
              </p>
              <p>
                {copy('status')}:{' '}
                {copy(
                  `state.${['Active', 'Completed', 'Cancelled'].includes(request.contractState) ? request.contractState : 'other'}`
                )}
              </p>
              <div className="space-y-2">
                <Label htmlFor={`increase-effective-${request.requestId}`}>
                  {copy('approveDate')}
                </Label>
                <Input
                  id={`increase-effective-${request.requestId}`}
                  type="datetime-local"
                  value={effectiveDate[request.requestId] ?? ''}
                  onChange={(event) =>
                    setEffectiveDate((current) => ({
                      ...current,
                      [request.requestId]: event.target.value,
                    }))
                  }
                />
                <p className="text-muted-foreground">{copy('approveDateHelp')}</p>
                <Button
                  onClick={() =>
                    setAction({
                      title: copy('approve'),
                      description: copy('approveConfirm'),
                      path: `/api/staff/electricity/increase-requests/${request.requestId}/approve`,
                      method: 'POST',
                      body: {
                        ...(effectiveDate[request.requestId]
                          ? {
                              effectiveFrom: new Date(
                                effectiveDate[request.requestId]!
                              ).toISOString(),
                            }
                          : {}),
                        idempotencyKey: crypto.randomUUID(),
                      },
                      conflictMessage: copy('conflict'),
                      forbiddenMessage: copy('forbidden'),
                    })
                  }
                >
                  {copy('approve')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`increase-reason-${request.requestId}`}>{copy('reason')}</Label>
                <Input
                  id={`increase-reason-${request.requestId}`}
                  maxLength={1000}
                  value={reason[request.requestId] ?? ''}
                  onChange={(event) =>
                    setReason((current) => ({
                      ...current,
                      [request.requestId]: event.target.value,
                    }))
                  }
                />
                <Button
                  variant="destructive"
                  disabled={!(reason[request.requestId] ?? '').trim()}
                  onClick={() =>
                    setAction({
                      title: copy('reject'),
                      description: copy('confirm'),
                      path: `/api/staff/electricity/increase-requests/${request.requestId}/reject`,
                      method: 'POST',
                      body: {
                        reason: reason[request.requestId]?.trim(),
                        idempotencyKey: crypto.randomUUID(),
                      },
                      conflictMessage: copy('conflict'),
                      forbiddenMessage: copy('forbidden'),
                    })
                  }
                >
                  {copy('reject')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {nextBefore ? (
        <Button variant="outline" onClick={() => setBefore(nextBefore)}>
          {copy('more')}
        </Button>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
