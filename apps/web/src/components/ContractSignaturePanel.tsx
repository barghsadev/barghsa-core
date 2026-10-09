import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, Button, NativeSelect, PageLoading } from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import { contractBase, type ContractSignatureData } from '../lib/contracts.js';
import { documentBase, DocumentRequestError, type BusinessDocument } from '../lib/documents.js';
import {
  contractSignatureView,
  signatureDocumentPage,
  signingDocuments,
  matchedSignatureReview,
  matchedSignatureReceipt,
  contractFormRejection,
  type ContractFormCoordination,
  type ContractSigningSource,
  type SignatureRequestDraft,
  type SignatureRecordDraft,
} from '../lib/contract-review-signature-form.js';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import type { TeamAction } from './TeamActionDialog.js';

function documentsPath(
  id: string,
  versionId: string,
  profileId: string,
  staff: boolean,
  before?: string
) {
  const query = new URLSearchParams({
    businessRecordType: 'contract',
    businessRecordId: id,
    contractVersionId: versionId,
    state: 'Approved',
    limit: '100',
  });
  if (staff) query.set('profileId', profileId);
  if (before) query.set('before', before);
  return documentBase(staff) + '?' + query;
}
interface Command {
  action: TeamAction;
  review: ContractFinancialReview;
  view: ContractSignatureData;
  document: BusinessDocument;
  request: boolean;
  actor: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
export function ContractSignaturePanel({
  id,
  versionId,
  profileId,
  staff,
  onChanged,
  onStatus,
  onDenied,
  coordination,
  source,
}: {
  id: string;
  versionId: string;
  profileId: string;
  staff: boolean;
  onChanged: () => void;
  onStatus?: (data: ContractSignatureData | null) => void;
  onDenied?: () => void;
  coordination?: ContractFormCoordination;
  source?: ContractSigningSource;
}) {
  const locale = useLocale(),
    time = useAccountTime(),
    actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const word = (key: string) => contractText(key, locale),
    copy = (key: string) => tContractReviewSignature(key, locale);
  const scopeKey = JSON.stringify([
    actor,
    profileRevision,
    id,
    versionId,
    profileId,
    staff,
    source?.contract.serviceType,
    source?.version.versionNumber,
    source?.version.content,
    source?.version.publishedAt,
  ]);
  const readContract = useOwnedContractRead(actor, profileRevision, profileId, scopeKey);
  const scope = useRef(scopeKey),
    generation = useRef(0),
    owner = useRef<object>({});
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const callbacks = useRef({ onChanged, onStatus, onDenied, coordination });
  callbacks.current = { onChanged, onStatus, onDenied, coordination };
  const [reload, setReload] = useState(0),
    [data, setData] = useState<ContractSignatureData | null>(null),
    dataRef = useRef<ContractSignatureData | null>(null);
  const [documents, setDocuments] = useState<BusinessDocument[]>([]),
    documentsRef = useRef<BusinessDocument[]>([]);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(false),
    [moreError, setMoreError] = useState(false),
    [action, setAction] = useState<TeamAction | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [preparing, setPreparing] = useState(false),
    preparingRef = useRef(false);
  const command = useRef<Command | null>(null),
    controller = useRef<AbortController | null>(null),
    readEpoch = useRef(0);
  const shown = acceptedScope === scopeKey;
  const requestForm = useZodForm<SignatureRequestDraft>(
    async () => {
      const token = generation.current;
      const schemas = await import('../lib/contract-review-signature-form-schemas.js');
      return token === generation.current && scope.current === scopeKey
        ? schemas.signatureRequestSchema(
            copy('documentInvalid'),
            dataRef.current
              ? signingDocuments(documentsRef.current, dataRef.current, profileId, true).map(
                  (doc) => doc.id
                )
              : []
          )
        : schemas.inactiveSignatureRequestSchema;
    },
    {
      defaultValues: { originalDocumentId: '' },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const recordForm = useZodForm<SignatureRecordDraft>(
    async () => {
      const token = generation.current;
      const schemas = await import('../lib/contract-review-signature-form-schemas.js');
      return token === generation.current && scope.current === scopeKey
        ? schemas.signatureRecordSchema(
            copy('documentInvalid'),
            copy('acknowledgementInvalid'),
            dataRef.current
              ? signingDocuments(documentsRef.current, dataRef.current, profileId, false).map(
                  (doc) => doc.id
                )
              : []
          )
        : schemas.inactiveSignatureRecordSchema;
    },
    {
      defaultValues: { signedDocumentId: '', acknowledged: false },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const requestFields = useActionFieldErrors(
    requestForm,
    { originalDocumentId: copy('documentInvalid') },
    word('error')
  );
  const recordFields = useActionFieldErrors(
    recordForm,
    { signedDocumentId: copy('documentInvalid') },
    word('error')
  );
  function release() {
    callbacks.current.coordination?.release(owner.current);
  }
  function withdraw() {
    ++generation.current;
    ++readEpoch.current;
    controller.current?.abort();
    command.current = null;
    dataRef.current = null;
    documentsRef.current = [];
    setData(null);
    setDocuments([]);
    setAcceptedScope(null);
    setNext(null);
    setAction(null);
    setUncertain(false);
    setLoading(false);
    setError(true);
    requestForm.reset({ originalDocumentId: '' });
    recordForm.reset({ signedDocumentId: '', acknowledged: false });
    preparingRef.current = false;
    setPreparing(false);
    busyRef.current = false;
    setBusy(false);
    release();
    callbacks.current.onStatus?.(null);
    callbacks.current.onDenied?.();
  }
  useEffect(() => {
    dataRef.current = null;
    documentsRef.current = [];
    setData(null);
    setDocuments([]);
    setAcceptedScope(null);
    setNext(null);
    command.current = null;
    setAction(null);
    setUncertain(false);
    requestForm.reset({ originalDocumentId: '' });
    recordForm.reset({ signedDocumentId: '', acknowledged: false });
    preparingRef.current = false;
    setPreparing(false);
    busyRef.current = false;
    setBusy(false);
    release();
    callbacks.current.onStatus?.(null);
    return () => {
      ++generation.current;
      ++readEpoch.current;
      controller.current?.abort();
      release();
    };
  }, [scopeKey]);
  useEffect(() => {
    if (!actor || command.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const token = generation.current,
      read = ++readEpoch.current,
      parentRevision = callbacks.current.coordination?.revision?.();
    const fresh = () =>
      !abort.signal.aborted &&
      token === generation.current &&
      scope.current === scopeKey &&
      read === readEpoch.current &&
      parentRevision === callbacks.current.coordination?.revision?.() &&
      !command.current &&
      !preparingRef.current;
    setLoading(true);
    setError(false);
    setMoreError(false);
    void readContract<unknown>(
      contractBase(staff) + '/' + id + '/signature?versionId=' + encodeURIComponent(versionId),
      { signal: abort.signal }
    )
      .then(async (value) => {
        if (!fresh()) return;
        const view = contractSignatureView(value, staff);
        if (!view || view.contractId !== id || view.versionId !== versionId)
          throw new Error('signature');
        const page =
          view.canRequest || view.canRecord
            ? signatureDocumentPage(
                await readContract<unknown>(documentsPath(id, versionId, profileId, staff), {
                  signal: abort.signal,
                }),
                profileId,
                id,
                versionId
              )
            : { documents: [], nextBefore: null };
        if (!fresh()) return;
        if (!page) throw new Error('documents');
        dataRef.current = view;
        documentsRef.current = page.documents;
        setData(view);
        setDocuments(page.documents);
        setNext(page.nextBefore);
        setAcceptedScope(scopeKey);
        callbacks.current.onStatus?.(view);
      })
      .catch((failure) => {
        if (!fresh()) return;
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)) {
          withdraw();
          return;
        }
        setError(true);
      })
      .finally(() => {
        if (fresh()) setLoading(false);
      });
    return () => abort.abort();
  }, [scopeKey, reload, readContract]);
  function blocked() {
    return (
      scope.current !== scopeKey ||
      !!command.current ||
      preparingRef.current ||
      requestForm.isSubmissionPending() ||
      recordForm.isSubmissionPending() ||
      callbacks.current.coordination?.blocked()
    );
  }
  async function more() {
    if (blocked() || !next || busyRef.current || !controller.current) return;
    const abort = controller.current,
      token = generation.current,
      read = readEpoch.current,
      parentRevision = callbacks.current.coordination?.revision?.();
    busyRef.current = true;
    setBusy(true);
    setMoreError(false);
    const fresh = () =>
      !abort.signal.aborted &&
      scope.current === scopeKey &&
      token === generation.current &&
      read === readEpoch.current &&
      parentRevision === callbacks.current.coordination?.revision?.() &&
      !command.current &&
      !preparingRef.current;
    try {
      const raw = await readContract<unknown>(
        documentsPath(id, versionId, profileId, staff, next),
        { signal: abort.signal }
      );
      if (!fresh()) return;
      const page = signatureDocumentPage(raw, profileId, id, versionId);
      if (!page) throw new Error('documents');
      const merged = [
        ...documentsRef.current,
        ...page.documents.filter((item) => !documentsRef.current.some((old) => old.id === item.id)),
      ];
      documentsRef.current = merged;
      setDocuments(merged);
      setNext(page.nextBefore);
    } catch (failure) {
      if (fresh()) {
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          withdraw();
        else setMoreError(true);
      }
    } finally {
      if (fresh()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const current = (captured: Command) =>
    scope.current === scopeKey &&
    captured === command.current &&
    captured.generation === generation.current;
  function close(captured: Command) {
    if (!current(captured)) return;
    setAction(null);
    if (captured.attempted && (!captured.rejected || captured.uncertain)) {
      captured.uncertain = true;
      setUncertain(true);
    } else {
      command.current = null;
      setUncertain(false);
      release();
    }
  }
  function fields(value: unknown, request: boolean) {
    const rejection = contractFormRejection(value),
      name = request ? 'originalDocumentId' : 'signedDocumentId';
    return rejection?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(rejection.fields) &&
      rejection.fields.length &&
      rejection.fields.every((field) => field === name)
      ? request
        ? requestFields([name])
        : recordFields([name])
      : false;
  }
  function decorate(captured: Command): TeamAction {
    const mapped = (value: unknown) => {
      if (!current(captured)) return word('error');
      const rejection = contractFormRejection(value);
      if (rejection?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
        withdraw();
        return word('error');
      }
      if (rejection && !captured.uncertain) {
        captured.rejected = true;
        if (fields(value, captured.request)) close(captured);
      }
      return word('error');
    };
    return {
      ...captured.action,
      errorMessages: Object.fromEntries(
        [
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          'VALIDATION:PARSE:ZOD_ERROR',
          ErrorCodes.CONFLICT_STATE.code,
          ErrorCodes.CONFLICT_VERSION.code,
          ErrorCodes.NOT_FOUND_RESOURCE.code,
        ].map((code) => [code, mapped])
      ),
    };
  }
  async function choose(event: FormEvent<HTMLFormElement>, request: boolean) {
    event.preventDefault();
    const view = dataRef.current;
    if (
      event.target !== event.currentTarget ||
      blocked() ||
      !actor ||
      !shown ||
      !view ||
      (request ? !view.canRequest : !view.canRecord)
    )
      return;
    if (callbacks.current.coordination && !callbacks.current.coordination.acquire(owner.current))
      return;
    preparingRef.current = true;
    setPreparing(true);
    setError(false);
    ++readEpoch.current;
    controller.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setLoading(false);
    const token = generation.current,
      raw = JSON.stringify(request ? requestForm.getValues() : recordForm.getValues()),
      options = documentsRef.current;
    const fresh = () =>
      scope.current === scopeKey &&
      token === generation.current &&
      view === dataRef.current &&
      options === documentsRef.current &&
      raw === JSON.stringify(request ? requestForm.getValues() : recordForm.getValues());
    const prepare = async (documentId: string) => {
      if (!fresh()) return;
      const selected = signingDocuments(options, view, profileId, request).find(
        (doc) => doc.id === documentId
      );
      if (!selected) return;
      const selection = request
        ? {
            action: 'request',
            expectedVersionId: versionId,
            originalDocumentId: documentId,
            expectedRequestId: view.request?.id ?? null,
          }
        : {
            action: 'record',
            expectedVersionId: versionId,
            signedDocumentId: documentId,
            requestId: view.request?.id,
          };
      const { response, value } = await readContract(
        contractBase(staff) + '/' + id + '/signature/review',
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(selection),
        },
        async (path, options) => {
          const response = await fetch(path, options);
          const value: unknown = await response.json().catch(() => null);
          return { response, value };
        }
      );
      if (scope.current !== scopeKey || token !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) {
        withdraw();
        return;
      }
      if (!fresh()) return;
      if (response.status !== 200) {
        if (response.status === 400 && fields(value, request)) return;
        throw new Error('review');
      }
      const review = await matchedSignatureReview(
        value,
        view,
        profileId,
        selected,
        request,
        source,
        options
      );
      if (!fresh()) return;
      if (!review) throw new Error('review');
      const { action: _, ...body } = selection;
      const captured: Command = {
        action: {
          title: word(request ? 'prepareSignature' : 'recordSignature'),
          description: word('signatureNotice') + ' ' + selected.originalName,
          path:
            contractBase(staff) + '/' + id + '/' + (request ? 'signature-request' : 'signature'),
          method: 'POST',
          body: { ...body, idempotencyKey: crypto.randomUUID(), expectedReviewHash: review.hash },
          successStatus: 200,
          conflictMessage: word('signatureConflict'),
          forbiddenMessage: word('denied'),
        },
        review,
        view,
        document: selected,
        request,
        actor,
        generation: token,
        attempted: false,
        uncertain: false,
        rejected: false,
      };
      command.current = captured;
      setAction(decorate(captured));
    };
    try {
      if (request) await requestForm.handleSubmit((values) => prepare(values.originalDocumentId))();
      else await recordForm.handleSubmit((values) => prepare(values.signedDocumentId))();
    } catch {
      if (fresh()) setError(true);
    } finally {
      if (scope.current === scopeKey && token === generation.current) {
        preparingRef.current = false;
        setPreparing(false);
        if (!command.current) release();
      }
    }
  }
  const captured = command.current,
    locked = !!captured;
  const originals = data ? signingDocuments(documents, data, profileId, true) : [],
    signed = data ? signingDocuments(documents, data, profileId, false) : [];
  return (
    <section
      id="contract-signature"
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('signatureTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('signatureTitle')}</h3>
        <Button
          variant="ghost"
          disabled={locked || preparing || coordination?.blocked()}
          onClick={() => {
            if (!blocked()) setReload((value) => value + 1);
          }}
        >
          {word('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{word('signatureNotice')}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      )}
      {!shown || !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {data.request ? (
            <div>
              <p>
                {word('signatureRequest')} {data.request.requestNumber.toLocaleString(locale)}:{' '}
                {data.request.originalName}
              </p>
              <p className="text-sm">
                {time.format(data.request.requestedAt)}:{' '}
                {documentText(data.request.documentState, locale)}
              </p>
            </div>
          ) : (
            <p>{word('noSignatureRequest')}</p>
          )}
          {data.signature ? (
            <div role="status">
              <p>
                {word('signatureRecorded')}: {data.signature.originalName}
              </p>
              <p>{time.format(data.signature.recordedAt)}</p>
              <p>
                {word('recordedBy')}: {word(data.signature.recordedByType)}
              </p>
              <p>
                {word('uploadedBy')}: {word(data.signature.uploadedByType)}
              </p>
            </div>
          ) : null}
          {data.canRequest && (
            <Form {...requestForm}>
              <form
                data-testid="contract-signature-request-form"
                noValidate
                onSubmit={(event) => void choose(event, true)}
                className="space-y-3"
              >
                <FormField
                  control={requestForm.control}
                  name="originalDocumentId"
                  render={({ field }) => (
                    <FormItem id="signature-original">
                      <FormLabel>{word('approvedOriginal')}</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={locked}>
                          <option value="">{word('selectDocument')}</option>
                          {originals.map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.originalName}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormDescription>{copy('documentHelp')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {requestForm.formState.errors.root && (
                  <p role="alert">{copy('validationUnavailable')}</p>
                )}
                <Button
                  type="submit"
                  loading={preparing}
                  disabled={locked || preparing || loading || coordination?.blocked()}
                >
                  {word('prepareSignature')}
                </Button>
              </form>
            </Form>
          )}
          {data.canRecord && (
            <Form {...recordForm}>
              <form
                data-testid="contract-signature-record-form"
                noValidate
                onSubmit={(event) => void choose(event, false)}
                className="space-y-3"
              >
                <FormField
                  control={recordForm.control}
                  name="signedDocumentId"
                  render={({ field }) => (
                    <FormItem id="signature-signed">
                      <FormLabel>{word('approvedSigned')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          disabled={locked}
                          onChange={(event) => {
                            field.onChange(event);
                            recordForm.setValue('acknowledged', false, { shouldDirty: true });
                          }}
                        >
                          <option value="">{word('selectDocument')}</option>
                          {signed.map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.originalName}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormDescription>{copy('documentHelp')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={recordForm.control}
                  name="acknowledged"
                  render={({ field }) => (
                    <FormItem id="signature-acknowledgement">
                      <FormLabel>{word('signatureAcknowledgement')}</FormLabel>
                      <FormControl>
                        <input
                          type="checkbox"
                          name={field.name}
                          ref={field.ref}
                          checked={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) => field.onChange(event.target.checked)}
                          disabled={locked}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {recordForm.formState.errors.root && (
                  <p role="alert">{copy('validationUnavailable')}</p>
                )}
                <Button
                  type="submit"
                  loading={preparing}
                  disabled={locked || preparing || loading || coordination?.blocked()}
                >
                  {word('recordSignature')}
                </Button>
              </form>
            </Form>
          )}
          {data.canRequest || data.canRecord ? (
            <p className="text-sm text-muted-foreground">{word('signatureDocumentHint')}</p>
          ) : null}
          {moreError ? <p role="alert">{word('error')}</p> : null}
          {next ? (
            <Button
              variant="outline"
              disabled={busy || locked || preparing || coordination?.blocked()}
              onClick={() => void more()}
            >
              {word('next')}
            </Button>
          ) : null}
          {uncertain && (
            <Alert variant="destructive">
              <AlertDescription>{copy('uncertain')}</AlertDescription>
            </Alert>
          )}
          {uncertain && (
            <Button
              variant="outline"
              data-testid="contract-signature-retry"
              disabled={!!action}
              onClick={() => {
                if (captured && current(captured)) setAction(decorate(captured));
              }}
            >
              {copy('retryCaptured')}
            </Button>
          )}
        </>
      )}
      {action && captured && current(captured) && shown ? (
        <ContractFinancialReviewDialog
          action={action}
          review={captured.review}
          profileId={profileId}
          contractId={id}
          time={time}
          onClose={() => close(captured)}
          onPendingChange={(pending) => {
            if (current(captured) && pending) captured.attempted = true;
          }}
          onUnconfirmed={() => {
            if (current(captured)) {
              captured.uncertain = true;
              setUncertain(true);
              setAction(null);
            }
          }}
          onDenied={() => {
            if (current(captured)) withdraw();
          }}
          onSuccess={async (value) => {
            if (!current(captured)) return;
            const view = await matchedSignatureReceipt(
              value,
              captured.review,
              captured.view,
              captured.document,
              staff,
              captured.actor
            );
            if (!current(captured)) return;
            if (!view) throw new Error('signature receipt');
            command.current = null;
            setAction(null);
            setUncertain(false);
            release();
            if (captured.request) requestForm.reset({ originalDocumentId: '' });
            else recordForm.reset({ signedDocumentId: '', acknowledged: false });
            dataRef.current = view;
            setData(view);
            callbacks.current.onStatus?.(view);
            callbacks.current.onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
