import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { useCancellationRequestForm } from '../hooks/useCancellationForm.js';
import { DocumentRequestError } from '../lib/documents.js';
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
type RequestPanelProps = {
  id: string;
  versionId: string;
  staff: boolean;
  unavailable?: boolean;
  onChanged: () => void;
  onReview: (request: CancellationRequest) => void;
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
      if (!captured || (staff ? captured.request?.status !== 'Pending' : !captured.canRequest))
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
  const request = data?.request;
  if (data && staff && !request) return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4"
      aria-label={word('cancellationRequestTitle')}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium">{word('cancellationRequestTitle')}</h4>
        <Button variant="ghost" disabled={busy} onClick={() => setReload((n) => n + 1)}>
          {needsRead ? confirmationText('checkStatus', locale) : word('refresh')}
        </Button>
      </div>
      {needsRead && (
        <Alert variant="destructive">
          <AlertDescription>{confirmationText('unconfirmed', locale)}</AlertDescription>
        </Alert>
      )}
      {denied ? (
        <p role="status">{word('denied')}</p>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !data || loading ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {request ? (
            <>
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
                disabled={busy || needsRead || request.stale}
                onClick={() => onReview(request)}
              >
                {word('cancellationRequestReview')}
              </Button>
            </>
          ) : null}
          {(!staff && data.canRequest) || (staff && request?.status === 'Pending') ? (
            <form
              onSubmit={choose}
              noValidate
              aria-busy={!!action || draft.form.formState.isSubmitting || undefined}
              className="flex flex-col gap-3"
            >
              {!staff ? (
                <p className="text-sm text-muted-foreground">{word('cancellationRequestNotice')}</p>
              ) : null}
              <Field>
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
                  onChange={(e) => setReason(e.target.value)}
                />
                <p
                  id={draft.errorId('reason')}
                  role={draft.errors.reason ? 'alert' : undefined}
                  aria-hidden={!draft.errors.reason || undefined}
                  className={`text-sm text-destructive${draft.errors.reason ? '' : ' invisible'}`}
                >
                  {draft.errors.reason?.message ?? word('cancellationReasonInvalid')}
                </p>
              </Field>
              {!staff ? (
                <Field>
                  <FieldLabel htmlFor={'request-destination-' + id}>
                    {word('cancellationRequestPreference')}
                  </FieldLabel>
                  <NativeSelect
                    {...draft.bind('preferredDestination')}
                    disabled={busy || needsRead}
                    id={'request-destination-' + id}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value as 'wallet' | 'external_bank')}
                  >
                    <option value="wallet">{word('cancellation.wallet')}</option>
                    <option value="external_bank">{word('cancellation.external_bank')}</option>
                  </NativeSelect>
                  <p
                    id={draft.errorId('preferredDestination')}
                    role={draft.errors.preferredDestination ? 'alert' : undefined}
                    aria-hidden={!draft.errors.preferredDestination || undefined}
                    className={`text-sm text-destructive${draft.errors.preferredDestination ? '' : ' invisible'}`}
                  >
                    {draft.errors.preferredDestination?.message ??
                      word('cancellationDestinationInvalid')}
                  </p>
                </Field>
              ) : null}
              {draft.errors.root?.validation ? (
                <Alert variant="destructive">
                  <AlertDescription>{draft.errors.root.validation.message}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                disabled={busy || needsRead}
                type="submit"
                variant={staff ? 'outline' : 'default'}
                className="self-start"
              >
                {draft.form.formState.isSubmitting && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {word(staff ? 'cancellationRequestReject' : 'cancellationRequestSubmit')}
              </Button>
            </form>
          ) : null}
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
