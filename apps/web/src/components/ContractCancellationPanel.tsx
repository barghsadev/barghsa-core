import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  ListRefreshButton,
  PageLoading,
  StatusBadge,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { DocumentRequestError } from '../lib/documents.js';
import { contractBase } from '../lib/contracts.js';
import type { CancellationStatus, ContractCancellationView } from '../lib/contract-cancellation.js';
import { ContractCancellationRequestPanel } from './ContractCancellationRequestPanel.js';
const CancellationEditor = lazy(() => import('./ContractCancellationEditor.js'));

type CancellationPanelProps = {
  id: string;
  versionId: string;
  staff: boolean;
  onChanged: () => void;
  view?: ContractCancellationView;
  renderAction?:
    ((view: ContractCancellationView, label: string, disabled: boolean) => ReactNode) | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
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
function CancellationWorkspace({
  id,
  versionId,
  staff,
  onChanged,
  view,
  renderAction,
  onLocked,
}: CancellationPanelProps) {
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
          if (view && (value.contractId !== id || !Array.isArray(value.refunds)))
            throw new Error('Invalid cancellation status');
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
  }, [id, staff, reload, readContract, view]);
  const renderEditor = (action: 'cancel' | 'reject', requestId: string | null) => (
    <Suspense fallback={<PageLoading label={word('loading')} />}>
      <CancellationEditor
        key={id + ':' + versionId + ':' + requestId + ':' + action}
        id={id}
        terminalAction={action}
        customerRequestId={requestId}
        canChooseRefund={status?.canChooseRefund === true}
        unavailable={loading || error}
        versionId={view ? versionId : undefined}
        onLocked={onLocked}
        onChanged={onChanged}
      />
    </Suspense>
  );
  const ended =
    status?.state === 'Cancelled' ||
    (status?.state === 'Rejected' && status.financialStatus !== 'not_cancelled');
  const requestId = view && 'requestId' in view ? view.requestId : undefined;
  return (
    <section
      className={
        view && !ended
          ? 'min-w-0 space-y-3'
          : 'flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4'
      }
      aria-label={word('cancellationTitle')}
    >
      {(!view || error || ended) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {(!view || ended) && <h3 className="font-semibold">{word('cancellationTitle')}</h3>}
          <ListRefreshButton
            label={word('refresh')}
            refreshing={loading}
            onClick={() => setReload((n) => n + 1)}
          />
        </div>
      )}
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
          {(
            !view
              ? !staff || status.canCancel
              : view.action === 'request' || (status.canCancel && !!requestId && !ended)
          ) ? (
            <ContractCancellationRequestPanel
              id={id}
              versionId={versionId}
              staff={staff}
              unavailable={loading || error}
              view={view}
              renderAction={renderAction}
              onLocked={onLocked}
              renderReview={
                view?.action === 'review-cancellation'
                  ? (request) => renderEditor('cancel', request.id)
                  : undefined
              }
              onChanged={onChanged}
              onReview={(request) => {
                setTerminalAction('cancel');
                setCustomerRequestId(request.id);
                setOpen(true);
              }}
            />
          ) : null}
          {ended ? (
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
          ) : view ? (
            (view.action === 'cancel' || view.action === 'reject') &&
            status.canCancel &&
            (view.action === 'cancel' || status.canReject) ? (
              renderEditor(view.action, null)
            ) : staff && (!requestId || !status.canCancel) ? (
              <p role="status" className="text-sm text-muted-foreground">
                {word('cancellationNoAction')}
              </p>
            ) : null
          ) : status.canCancel && staff ? (
            <>
              <p className="text-sm text-muted-foreground">{word('cancellationNotice')}</p>
              <div className="flex flex-wrap gap-2">
                {renderAction ? (
                  renderAction({ action: 'cancel' }, word('cancellationReview'), loading || error)
                ) : (
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
                )}
                {status.canReject ? (
                  renderAction ? (
                    renderAction({ action: 'reject' }, word('rejectionTitle'), loading || error)
                  ) : (
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
                  )
                ) : null}
              </div>
              {!renderAction && open ? renderEditor(terminalAction, customerRequestId) : null}
            </>
          ) : staff ? (
            <p className="text-sm text-muted-foreground">{word('cancellationNoAction')}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
