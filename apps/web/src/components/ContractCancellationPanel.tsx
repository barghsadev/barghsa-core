import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, PageLoading, StatusBadge } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { DocumentRequestError } from '../lib/documents.js';
import { contractBase } from '../lib/contracts.js';
import type { CancellationStatus } from '../lib/contract-cancellation.js';
import { ContractCancellationRequestPanel } from './ContractCancellationRequestPanel.js';
const CancellationEditor = lazy(() => import('./ContractCancellationEditor.js'));

type CancellationPanelProps = {
  id: string;
  versionId: string;
  staff: boolean;
  onChanged: () => void;
};
export function ContractCancellationPanel(props: CancellationPanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <CancellationWorkspace
      key={JSON.stringify([actor, revision, `${props.id}:${props.versionId}:${props.staff}`])}
      {...props}
    />
  );
}
function CancellationWorkspace({ id, versionId, staff, onChanged }: CancellationPanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([id, versionId, staff])
  );
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const money = (value: string) => new Intl.NumberFormat(locale).format(BigInt(value));
  const [status, setStatus] = useState<CancellationStatus | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [open, setOpen] = useState(false),
    [terminalAction, setTerminalAction] = useState<'cancel' | 'reject'>('cancel'),
    [customerRequestId, setCustomerRequestId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setLoading(true);
    void readContract<CancellationStatus>(`${contractBase(staff)}/${id}/cancellation-status`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setStatus(value);
          setLoading(false);
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)) {
          setStatus(null);
          setOpen(false);
        }
        setError(true);
      });
    return () => controller.abort();
  }, [id, staff, reload, readContract]);
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('cancellationTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('cancellationTitle')}</h3>
        <Button disabled={loading} variant="ghost" onClick={() => setReload((n) => n + 1)}>
          {word('refresh')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : null}
      {!status ? (
        !error ? (
          <PageLoading label={word('loading')} />
        ) : null
      ) : (
        <>
          {!staff || status.canCancel ? (
            <ContractCancellationRequestPanel
              id={id}
              versionId={versionId}
              staff={staff}
              unavailable={loading || error}
              onChanged={onChanged}
              onReview={(request) => {
                setTerminalAction('cancel');
                setCustomerRequestId(request.id);
                setOpen(true);
              }}
            />
          ) : null}
          {status.state === 'Cancelled' ||
          (status.state === 'Rejected' && status.financialStatus !== 'not_cancelled') ? (
            <>
              <p>
                {word(
                  status.state === 'Rejected' ? 'rejectionServiceEnded' : 'cancellationServiceEnded'
                )}
              </p>
              <StatusBadge label={word('cancellation.' + status.financialStatus)} />
              <p className="text-sm">
                {word('cancellationReturned')}:{' '}
                <bdi>
                  {money(status.returnedAmount)} / {money(status.refundAmount)}
                </bdi>{' '}
                {word('irr')}
              </p>
              {status.financialStatus === 'needs_attention' ||
              status.financialStatus === 'unverified' ? (
                <p role="status">{word('cancellationSupport')}</p>
              ) : null}
              <ul className="divide-y">
                {status.refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span>
                      <bdi>{money(refund.amount)}</bdi> {word('irr')} ·{' '}
                      {word('cancellation.' + refund.destination)}
                    </span>
                    <StatusBadge label={word('cancellation.refund.' + refund.state)} />
                  </li>
                ))}
              </ul>
            </>
          ) : status.canCancel && staff ? (
            <>
              <p className="text-sm text-muted-foreground">{word('cancellationNotice')}</p>
              <Button
                disabled={loading || error}
                variant="outline"
                className="self-start"
                aria-expanded={open && terminalAction === 'cancel'}
                onClick={() => {
                  setTerminalAction('cancel');
                  setCustomerRequestId(null);
                  setOpen(terminalAction === 'cancel' ? !open : true);
                }}
              >
                {word('cancellationReview')}
              </Button>
              {status.canReject ? (
                <Button
                  disabled={loading || error}
                  variant="destructive"
                  className="self-start"
                  aria-expanded={open && terminalAction === 'reject'}
                  onClick={() => {
                    setTerminalAction('reject');
                    setCustomerRequestId(null);
                    setOpen(terminalAction === 'reject' ? !open : true);
                  }}
                >
                  {word('rejectionTitle')}
                </Button>
              ) : null}
              {open ? (
                <Suspense fallback={<PageLoading label={word('loading')} />}>
                  <CancellationEditor
                    key={id + ':' + versionId + ':' + customerRequestId + ':' + terminalAction}
                    id={id}
                    terminalAction={terminalAction}
                    customerRequestId={customerRequestId}
                    canChooseRefund={status.canChooseRefund === true}
                    unavailable={loading || error}
                    onChanged={onChanged}
                  />
                </Suspense>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{word('cancellationNoAction')}</p>
          )}
        </>
      )}
    </section>
  );
}
