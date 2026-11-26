import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  ListRefreshButton,
  NativeSelect,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { cancellationEditorMessages } from '@barghsa/i18n/cancellation-editor';
import { useLocale } from '../hooks/useLocale.js';
import { useCancellationRequestForm } from '../hooks/useCancellationForm.js';
import { DocumentRequestError } from '../lib/documents.js';
import { contractBase } from '../lib/contracts.js';
import type { ContractCancellationView } from '../lib/contract-cancellation.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { CancellationReadNotice } from './CancellationReadNotice.js';
import {
  RecordEditorActions,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';

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
type RequestPanelProps = {
  id: string;
  versionId: string;
  staff: boolean;
  unavailable?: boolean;
  onChanged: () => void;
  onReview: (request: CancellationRequest) => void;
  view?: ContractCancellationView | undefined;
  renderAction?:
    ((view: ContractCancellationView, label: string, disabled: boolean) => ReactNode) | undefined;
  renderReview?: ((request: CancellationRequest) => ReactNode) | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
};
type RequestCommand = TeamAction & {
  priorRequest: string | null;
  body: {
    reason: string;
    idempotencyKey: string;
    preferredDestination?: string;
    expectedVersionId?: string;
  };
};
export function ContractCancellationRequestPanel(props: RequestPanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <RequestWorkspace
      key={JSON.stringify([actor, revision, `${props.id}:${props.versionId}:${props.staff}`])}
      {...props}
    />
  );
}
function RequestWorkspace({
  id,
  versionId,
  staff,
  onChanged,
  onReview,
  unavailable = false,
  view,
  renderAction,
  renderReview,
  onLocked,
}: RequestPanelProps) {
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
  const [data, setData] = useState<{
    request: CancellationRequest | null;
    canRequest?: boolean;
  } | null>(null);
  const [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  const draft = useCancellationRequestForm(staff);
  const [reason, setReason] = draft.field('reason');
  const [destination, setDestination] = draft.field('preferredDestination');
  const [action, setAction] = useState<RequestCommand | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const current = useRef<RequestCommand | null>(null);
  const unconfirmed = useRef<RequestCommand | null>(null);
  const live = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const generation = useRef(0);
  const target = view && 'requestId' in view ? view.requestId : undefined;
  const submitting = !!action || draft.form.formState.isSubmitting;
  useEffect(() => {
    if (view?.action === 'review-cancellation' || !onLocked) return;
    onLocked(submitting);
    return () => onLocked(false);
  }, [onLocked, submitting, view?.action]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      current.current = null;
    };
  }, []);
  function close() {
    current.current = null;
    setAction(null);
  }
  function deny() {
    generation.current++;
    close();
    unconfirmed.current = null;
    setNeedsRead(false);
    setData(null);
    setDenied(true);
    draft.form.reset({ reason: '', preferredDestination: 'wallet' });
  }
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  const busy = unavailable || loading || !!action || draft.form.formState.isSubmitting;
  useEffect(() => {
    const controller = new AbortController();
    const owner = ++generation.current;
    setLoading(true);
    setError(false);
    void readContract<{ request: CancellationRequest | null; canRequest?: boolean }>(
      `${contractBase(staff)}/${id}/cancellation-requests`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (controller.signal.aborted || generation.current !== owner) return;
        const request = value.request;
        if (
          request !== null &&
          (!request ||
            typeof request.id !== 'string' ||
            !request.id ||
            request.contractId !== id ||
            typeof request.versionId !== 'string' ||
            typeof request.reason !== 'string' ||
            !['wallet', 'external_bank'].includes(request.preferredDestination) ||
            !['Pending', 'Rejected', 'Fulfilled', 'Closed'].includes(request.status))
        )
          throw new Error('Unbound cancellation request');
        const previous = dataRef.current;
        if (previous?.request?.id !== request?.id)
          draft.form.reset({ reason: '', preferredDestination: 'wallet' });
        if (
          unconfirmed.current?.priorRequest !== (request?.id ?? null) ||
          (staff ? request?.status !== 'Pending' : value.canRequest !== true)
        )
          unconfirmed.current = null;
        setData(value);
        setNeedsRead(false);
        setDenied(false);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || generation.current !== owner) return;
        setLoading(false);
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          deny();
        else setError(true);
      });
    return () => controller.abort();
  }, [id, versionId, staff, reload, readContract]);
  function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || needsRead || denied || error || draft.form.isSubmissionPending()) return;
    const captured = data;
    const owner = generation.current;
    void draft.form.handleSubmit((values) => {
      if (
        !live.current ||
        unavailableRef.current ||
        owner !== generation.current ||
        dataRef.current !== captured ||
        current.current
      )
        return;
      if (
        !captured ||
        (target && captured.request?.id !== target) ||
        (staff ? captured.request?.status !== 'Pending' : !captured.canRequest)
      )
        return;
      const note = values.reason.trim();
      const priorRequest = captured.request?.id ?? null;
      const preferredDestination = staff ? undefined : values.preferredDestination;
      const pending = unconfirmed.current;
      const command: RequestCommand =
        pending &&
        pending.priorRequest === priorRequest &&
        pending.body.reason === note &&
        pending.body.preferredDestination === preferredDestination
          ? pending
          : {
              priorRequest,
              risk: 'destructive',
              title: word(staff ? 'cancellationRequestReject' : 'cancellationRequestSubmit'),
              description: word(
                staff ? 'cancellationRequestRejectNotice' : 'cancellationRequestNotice'
              ),
              path: staff
                ? `/api/admin/contract-cancellation-requests/${captured.request!.id}/reject`
                : `/api/contracts/${id}/cancellation-requests`,
              method: 'POST',
              body: {
                reason: note,
                idempotencyKey: crypto.randomUUID(),
                ...(!staff
                  ? {
                      expectedVersionId: versionId,
                      preferredDestination: values.preferredDestination,
                    }
                  : {}),
              },
              conflictMessage: word('cancellationConflict'),
              forbiddenMessage: word('denied'),
            };
      current.current = command;
      setAction(command);
    })(event);
  }
  const request = data?.request && (!target || data.request.id === target) ? data.request : null;
  const copy = cancellationEditorMessages[locale];
  const refresh = () => setReload((n) => n + 1);
  const inlineRefresh =
    view?.action === 'request' && !request && data?.canRequest && !loading && !needsRead && !error;
  if (data && staff && !request && !view) return null;
  return (
    <section
      className={`${recordEditorSurface} flex flex-col gap-3 p-3 sm:p-4`}
      aria-label={word('cancellationRequestTitle')}
    >
      {!inlineRefresh && !renderReview && !needsRead && !error && (
        <div className="flex items-center justify-between gap-3">
          {(!view || !!request) && (
            <h4 className="font-medium">{word('cancellationRequestTitle')}</h4>
          )}
          <ListRefreshButton label={word('refresh')} disabled={busy} onClick={refresh} />
        </div>
      )}
      <CancellationReadNotice
        error={error ? copy.requestReadError : null}
        needsRead={needsRead}
        loading={loading}
        disabled={busy}
        reasonId={`request-reason-${id}`}
        onRefresh={refresh}
      />
      {denied ? (
        <p role="status">{word('denied')}</p>
      ) : error ? null : !data || loading ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {request ? (
            <div className="min-w-0 space-y-2 rounded-lg bg-muted/40 px-3 py-2.5">
              <StatusBadge
                label={word('cancellationRequest.' + request.status)}
                className="max-w-full whitespace-normal [overflow-wrap:anywhere]"
              />
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
            </div>
          ) : null}
          {target && !request && (
            <p role="status" className="text-sm text-muted-foreground">
              {copy.requestUnavailable}
            </p>
          )}
          {staff && request?.status === 'Pending' && !view ? (
            <>
              <p className="text-sm text-muted-foreground">
                {word('cancellationRequestReviewNotice')}
              </p>
              {renderAction ? (
                <div className="flex flex-wrap gap-2">
                  {renderAction(
                    { action: 'review-cancellation', requestId: request.id },
                    word('cancellationRequestReview'),
                    busy || needsRead || request.stale
                  )}
                  {renderAction(
                    { action: 'decline-cancellation', requestId: request.id },
                    word('cancellationRequestReject'),
                    busy || needsRead
                  )}
                </div>
              ) : (
                <Button
                  className="self-start"
                  variant="outline"
                  disabled={busy || needsRead || request.stale}
                  onClick={() => onReview(request)}
                >
                  {word('cancellationRequestReview')}
                </Button>
              )}
            </>
          ) : null}
          {renderReview &&
          request?.status === 'Pending' &&
          !request.stale &&
          request.versionId === versionId
            ? renderReview(request)
            : renderReview &&
              request && (
                <p role="status" className="text-sm text-muted-foreground">
                  {copy.requestUnavailable}
                </p>
              )}
          {view?.action === 'review-cancellation' &&
            request?.status === 'Pending' &&
            renderAction &&
            renderAction(
              { action: 'decline-cancellation', requestId: request.id },
              word('cancellationRequestReject'),
              busy || needsRead
            )}
          {!staff &&
            data.canRequest &&
            renderAction &&
            renderAction(
              { action: 'request' },
              word('cancellationRequestSubmit'),
              busy || needsRead
            )}
          {!renderAction &&
          !renderReview &&
          ((!staff && data.canRequest) || (staff && request?.status === 'Pending')) ? (
            <form
              onSubmit={choose}
              noValidate
              aria-busy={!!action || draft.form.formState.isSubmitting || undefined}
              className={inlineRefresh ? '-m-3 sm:-m-4' : '-mx-3 -mb-3 border-t sm:-mx-4 sm:-mb-4'}
            >
              <div className={view ? 'space-y-3 px-4 py-4 sm:px-6' : 'space-y-3 p-3 sm:p-4'}>
                {staff && !view && <h5 className="text-sm font-semibold">{copy.declineDetails}</h5>}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {view
                      ? staff
                        ? copy.declineHelp
                        : copy.requestHelp
                      : word(
                          staff ? 'cancellationRequestRejectNotice' : 'cancellationRequestNotice'
                        )}
                  </p>
                  {inlineRefresh && (
                    <ListRefreshButton label={word('refresh')} disabled={busy} onClick={refresh} />
                  )}
                </div>
                <div className={staff ? undefined : view ? 'space-y-3' : recordEditorGrid}>
                  <Field className="min-w-0 gap-1">
                    <FieldLabel htmlFor={'request-reason-' + id}>
                      {word(staff ? 'cancellationRequestRejectReason' : 'cancellationReason')}
                    </FieldLabel>
                    <Textarea
                      {...draft.bind('reason')}
                      disabled={busy || needsRead}
                      required
                      aria-required="true"
                      id={'request-reason-' + id}
                      value={reason}
                      maxLength={1000}
                      dir="auto"
                      rows={2}
                      placeholder={staff ? copy.declineExample : copy.requestExample}
                      className={`min-h-14 max-h-48 ${locale === 'fa' ? 'placeholder:text-right' : ''}`}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <p
                      id={draft.errorId('reason')}
                      role={draft.errors.reason ? 'alert' : undefined}
                      aria-hidden={!draft.errors.reason || undefined}
                      hidden={!draft.errors.reason}
                      className="text-sm text-destructive"
                    >
                      {draft.errors.reason?.message ?? word('cancellationReasonInvalid')}
                    </p>
                  </Field>
                  {!staff ? (
                    <Field className={view ? 'min-w-0 gap-1 sm:max-w-sm' : 'min-w-0 gap-1'}>
                      <FieldLabel htmlFor={'request-destination-' + id}>
                        {word('cancellationRequestPreference')}
                      </FieldLabel>
                      <NativeSelect
                        {...draft.bind('preferredDestination')}
                        disabled={busy || needsRead}
                        id={'request-destination-' + id}
                        value={destination}
                        className="w-full min-w-0"
                        onChange={(e) =>
                          setDestination(e.target.value as 'wallet' | 'external_bank')
                        }
                      >
                        <option value="wallet">{word('cancellation.wallet')}</option>
                        <option value="external_bank">{word('cancellation.external_bank')}</option>
                      </NativeSelect>
                      <p
                        id={draft.errorId('preferredDestination')}
                        role={draft.errors.preferredDestination ? 'alert' : undefined}
                        aria-hidden={!draft.errors.preferredDestination || undefined}
                        hidden={!draft.errors.preferredDestination}
                        className="text-sm text-destructive"
                      >
                        {draft.errors.preferredDestination?.message ??
                          word('cancellationDestinationInvalid')}
                      </p>
                    </Field>
                  ) : null}
                </div>
                {draft.errors.root?.validation ? (
                  <Alert variant="destructive">
                    <AlertDescription>{draft.errors.root.validation.message}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <RecordEditorActions>
                <Button
                  disabled={busy || needsRead}
                  type="submit"
                  variant={staff ? 'outline' : 'default'}
                  className={
                    staff
                      ? 'border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive'
                      : undefined
                  }
                >
                  {draft.form.formState.isSubmitting && (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                    />
                  )}
                  {word(staff ? 'cancellationRequestReject' : 'cancellationRequestSubmit')}
                </Button>
              </RecordEditorActions>
            </form>
          ) : null}
          {!staff && !request && !data.canRequest && (
            <p className="text-sm text-muted-foreground">{word('cancellationNoAction')}</p>
          )}
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          toastErrors={false}
          confirmationDisabled={unavailable || loading || error || denied}
          finalFocus={() => document.getElementById('request-reason-' + id)}
          onClose={() => {
            if (current.current === action) close();
          }}
          onDenied={() => {
            if (live.current && current.current === action) deny();
          }}
          onUnconfirmed={() => {
            if (!live.current || current.current !== action) return;
            unconfirmed.current = action;
            setNeedsRead(true);
            close();
          }}
          onValidationError={(fields) =>
            live.current && current.current === action && draft.applyServerErrors(fields)
          }
          onSuccess={async (result) => {
            if (!live.current || current.current !== action) return;
            const receipt = result as Partial<CancellationRequest> | null;
            const body = action.body;
            if (
              !receipt ||
              receipt.contractId !== id ||
              (staff
                ? !request ||
                  receipt.id !== request.id ||
                  receipt.versionId !== request.versionId ||
                  receipt.status !== 'Rejected' ||
                  receipt.resolutionReason !== body.reason
                : !receipt.id ||
                  receipt.versionId !== versionId ||
                  receipt.status !== 'Pending' ||
                  receipt.reason !== body.reason ||
                  receipt.preferredDestination !== body.preferredDestination)
            )
              throw new Error('Cancellation request acknowledgement mismatch');
            unconfirmed.current = null;
            close();
            draft.form.reset({ reason: '', preferredDestination: 'wallet' });
            setReload((n) => n + 1);
            onChanged();
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
