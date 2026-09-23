import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  NativeSelect,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest } from '../lib/documents.js';
import { contractBase } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

export interface CancellationRequest {
  id: string;
  contractId: string;
  versionId: string;
  reason: string;
  preferredDestination: 'wallet' | 'external_bank';
  status: 'Pending' | 'Rejected' | 'Fulfilled' | 'Closed';
  resolutionReason: string | null;
  contractState: string;
  stale: boolean;
  savingOrderId?: string | null;
  billIdentifier?: string | null;
  planTitle?: { fa?: string; en?: string } | null;
  customerName?: string;
}
export function ContractCancellationRequestPanel({
  id,
  versionId,
  staff,
  onChanged,
  onReview,
}: {
  id: string;
  versionId: string;
  staff: boolean;
  onChanged: () => void;
  onReview: (request: CancellationRequest) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [data, setData] = useState<{
    request: CancellationRequest | null;
    canRequest?: boolean;
  } | null>(null);
  const [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  const [reason, setReason] = useState(''),
    [destination, setDestination] = useState<'wallet' | 'external_bank'>('wallet');
  const [invalid, setInvalid] = useState(false),
    [action, setAction] = useState<TeamAction | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    setReason('');
    setInvalid(false);
    setAction(null);
    void documentRequest<{ request: CancellationRequest | null; canRequest?: boolean }>(
      `${contractBase(staff)}/${id}/cancellation-requests`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, versionId, staff, reload]);
  function choose(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
      title: word(staff ? 'cancellationRequestReject' : 'cancellationRequestSubmit'),
      description: word(staff ? 'cancellationRequestRejectNotice' : 'cancellationRequestNotice'),
      path: staff
        ? `/api/admin/contract-cancellation-requests/${data!.request!.id}/reject`
        : `/api/contracts/${id}/cancellation-requests`,
      method: 'POST',
      body: {
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
        ...(!staff ? { expectedVersionId: versionId, preferredDestination: destination } : {}),
      },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const request = data?.request;
  if (data && staff && !request) return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4"
      aria-label={word('cancellationRequestTitle')}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium">{word('cancellationRequestTitle')}</h4>
        <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
          {word('refresh')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {request ? (
            <>
              <StatusBadge label={word('cancellationRequest.' + request.status)} />
              <p className="whitespace-pre-wrap break-words text-sm">{request.reason}</p>
              <p className="text-sm text-muted-foreground">
                {word('cancellationRequestPreference')}:{' '}
                {word('cancellation.' + request.preferredDestination)}
              </p>
              {request.resolutionReason ? (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {request.resolutionReason}
                </p>
              ) : null}
              {request.status === 'Rejected' ? (
                <p className="text-sm">{word('cancellationSupport')}</p>
              ) : null}
              {request.status === 'Closed' ? (
                <p className="text-sm">
                  {word('cancellationRequestClosedNotice')} {word(request.contractState)}
                </p>
              ) : null}
              {request.stale && request.status === 'Pending' ? (
                <p role="status" className="text-sm">
                  {word('cancellationRequestStale')}
                </p>
              ) : null}
            </>
          ) : null}
          {staff && request?.status === 'Pending' ? (
            <>
              <p className="text-sm text-muted-foreground">
                {word('cancellationRequestReviewNotice')}
              </p>
              <Button
                className="self-start"
                variant="outline"
                disabled={request.stale}
                onClick={() => onReview(request)}
              >
                {word('cancellationRequestReview')}
              </Button>
            </>
          ) : null}
          {(!staff && data.canRequest) || (staff && request?.status === 'Pending') ? (
            <form onSubmit={choose} className="flex flex-col gap-3">
              {!staff ? (
                <p className="text-sm text-muted-foreground">{word('cancellationRequestNotice')}</p>
              ) : null}
              <Field>
                <FieldLabel htmlFor={'request-reason-' + id}>
                  {word(staff ? 'cancellationRequestRejectReason' : 'cancellationReason')}
                </FieldLabel>
                <Textarea
                  id={'request-reason-' + id}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={invalid}
                />
              </Field>
              {!staff ? (
                <Field>
                  <FieldLabel htmlFor={'request-destination-' + id}>
                    {word('cancellationRequestPreference')}
                  </FieldLabel>
                  <NativeSelect
                    id={'request-destination-' + id}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value as 'wallet' | 'external_bank')}
                  >
                    <option value="wallet">{word('cancellation.wallet')}</option>
                    <option value="external_bank">{word('cancellation.external_bank')}</option>
                  </NativeSelect>
                </Field>
              ) : null}
              {invalid ? <p role="alert">{word('cancellationInvalid')}</p> : null}
              <Button type="submit" variant={staff ? 'outline' : 'default'} className="self-start">
                {word(staff ? 'cancellationRequestReject' : 'cancellationRequestSubmit')}
              </Button>
            </form>
          ) : null}
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReload((n) => n + 1);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
