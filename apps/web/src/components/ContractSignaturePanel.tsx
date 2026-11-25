import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  ListRefreshButton,
  NativeSelect,
  PageLoading,
  buttonVariants,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
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
import { CompactFieldFeedback } from './CompactFieldFeedback.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
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
  navigation,
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
  navigation?: {
    search: Record<string, unknown>;
    operation?: 'request' | 'record';
    recordInSummary?: boolean;
  };
}) {
  const locale = useLocale(),
    time = useAccountTime(),
    actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const word = (key: string) => contractText(key, locale),
    copy = (key: string) => tContractReviewSignature(key, locale);
  const operation = navigation?.operation;
  const requestFormVisible = !navigation || operation === 'request';
  const recordFormVisible = !navigation || operation === 'record';
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
    operation,
    !!navigation,
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
  const [completed, setCompleted] = useState(false);
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
    setCompleted(false);
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
    setCompleted(false);
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
          (requestFormVisible && view.canRequest) || (recordFormVisible && view.canRecord)
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
      completed ||
      (request ? !requestFormVisible || !view.canRequest : !recordFormVisible || !view.canRecord)
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
          description:
            (request ? copy('signatureRequestHelp') : word('signatureNotice')) +
            ' ' +
            selected.originalName,
          path:
            contractBase(staff) + '/' + id + '/' + (request ? 'signature-request' : 'signature'),
          method: 'POST',
          body: { ...body, idempotencyKey: crypto.randomUUID(), expectedReviewHash: review.hash },
          responseDeadline: true,
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
  const requestLinkVisible = navigation && !operation && data?.canRequest;
  const recordLinkVisible =
    navigation &&
    !navigation.recordInSummary &&
    (!operation || (completed && operation === 'request')) &&
    data?.canRecord;
  const recordLocation = staff
    ? ({
        to: '/admin/contracts/$contractId/{-$action}/{-$item}',
        params: { contractId: id, action: undefined, item: undefined },
      } as const)
    : ({
        to: '/contracts/$contractId/{-$action}',
        params: { contractId: id, action: undefined },
      } as const);
  const signatureLink = (request: boolean) => (
    <Link
      {...(staff
        ? {
            to: '/admin/contracts/$contractId/{-$action}/{-$item}' as const,
            params: {
              contractId: id,
              action: request ? 'signature-request' : 'record-signature',
              item: versionId,
            },
          }
        : {
            to: '/contracts/$contractId/$operation/$versionId' as const,
            params: { contractId: id, operation: 'record-signature', versionId },
          })}
      search={navigation?.search ?? {}}
      className={buttonVariants({
        size: 'sm',
        variant: request && data?.canRecord ? 'outline' : 'default',
      })}
      aria-disabled={locked || preparing || coordination?.blocked() || undefined}
      onClick={(event) => {
        if (blocked()) event.preventDefault();
      }}
    >
      {word(request ? 'prepareSignature' : 'recordSignature')}
    </Link>
  );
  function fileDetails(doc: BusinessDocument | undefined) {
    if (!operation || !doc) return null;
    return (
      <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {doc.detectedMime && (
          <>
            <bdi>{doc.detectedMime.split('/').at(-1)?.toUpperCase()}</bdi> ·{' '}
          </>
        )}
        {copy('selectedFileDate').replace(
          '{date}',
          time.format(doc.createdAt, { dateStyle: 'medium' })
        )}
      </p>
    );
  }
  return (
    <section
      id="contract-signature"
      className="flex min-w-0 scroll-mt-28 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
      aria-label={word('signatureTitle')}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          {!operation && <h3 className="text-base font-semibold">{word('signatureTitle')}</h3>}
          <p className="text-sm text-muted-foreground">
            {operation === 'request' ? copy('signatureRequestHelp') : word('signatureNotice')}
          </p>
        </div>
        <ListRefreshButton
          label={word('refresh')}
          disabled={locked || preparing || coordination?.blocked()}
          onClick={() => {
            if (!blocked()) setReload((value) => value + 1);
          }}
        />
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      )}
      {!shown || !data ? (
        !error && <PageLoading label={word('loading')} />
      ) : (
        <>
          {data.request ? (
            <div className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium">
                  {word('signatureRequest')} {data.request.requestNumber.toLocaleString(locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {documentText(data.request.documentState, locale)} ·{' '}
                  <bdi>{time.format(data.request.requestedAt)}</bdi>
                </p>
              </div>
              <p className="wrap-anywhere">
                <bdi>{data.request.originalName}</bdi>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{word('noSignatureRequest')}</p>
          )}
          {data.signature ? (
            <div role="status" className="space-y-1 rounded-lg border px-3 py-2.5 text-sm">
              <p className="font-medium">{word('signatureRecorded')}</p>
              <p className="wrap-anywhere">
                <bdi>{data.signature.originalName}</bdi>
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <bdi>{time.format(data.signature.recordedAt)}</bdi>
                <span>
                  {word('recordedBy')}: {word(data.signature.recordedByType)}
                </span>
                <span>
                  {word('uploadedBy')}: {word(data.signature.uploadedByType)}
                </span>
              </div>
            </div>
          ) : null}
          {(requestLinkVisible || recordLinkVisible) && (
            <div className="flex flex-wrap gap-2">
              {requestLinkVisible && signatureLink(true)}
              {recordLinkVisible && signatureLink(false)}
            </div>
          )}
          {operation &&
            !completed &&
            !(operation === 'request' ? data.canRequest : data.canRecord) && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy('signatureActionUnavailable')}
              </p>
            )}
          {requestFormVisible && data.canRequest && !completed && (
            <Form {...requestForm}>
              <form
                data-testid="contract-signature-request-form"
                noValidate
                onSubmit={(event) => void choose(event, true)}
                className={recordEditorSurface}
              >
                <div className="space-y-2.5 px-4 py-3.5 sm:px-6">
                  <FormField
                    control={requestForm.control}
                    name="originalDocumentId"
                    render={({ field, fieldState }) => (
                      <FormItem id="signature-original">
                        <FormLabel>{word('approvedOriginal')}</FormLabel>
                        <FormControl>
                          <NativeSelect
                            {...field}
                            className="w-full"
                            aria-required="true"
                            disabled={locked}
                          >
                            <option value="">{word('selectDocument')}</option>
                            {originals.map((doc) => (
                              <option key={doc.id} value={doc.id}>
                                {doc.originalName}
                              </option>
                            ))}
                          </NativeSelect>
                        </FormControl>
                        {fileDetails(originals.find((doc) => doc.id === field.value))}
                        <CompactFieldFeedback
                          help={copy(originals.length ? 'documentHelp' : 'noOriginal')}
                          validationMessage={copy('documentInvalid')}
                          invalid={fieldState.invalid}
                        />
                      </FormItem>
                    )}
                  />
                  {requestForm.formState.errors.root && (
                    <p role="alert">{copy('validationUnavailable')}</p>
                  )}
                </div>
                <RecordEditorActions>
                  <Button
                    type="submit"
                    variant={data.request ? 'outline' : 'default'}
                    loading={preparing}
                    disabled={locked || preparing || loading || coordination?.blocked()}
                  >
                    {word('prepareSignature')}
                  </Button>
                </RecordEditorActions>
              </form>
            </Form>
          )}
          {recordFormVisible && data.canRecord && !completed && (
            <Form {...recordForm}>
              <form
                data-testid="contract-signature-record-form"
                noValidate
                onSubmit={(event) => void choose(event, false)}
                className={recordEditorSurface}
              >
                <div
                  className={`grid min-w-0 gap-3 px-4 py-3.5 sm:px-6 ${operation ? '' : 'lg:grid-cols-2'}`}
                >
                  <FormField
                    control={recordForm.control}
                    name="signedDocumentId"
                    render={({ field, fieldState }) => (
                      <FormItem id="signature-signed">
                        <FormLabel>{word('approvedSigned')}</FormLabel>
                        <FormControl>
                          <NativeSelect
                            {...field}
                            className="w-full"
                            aria-required="true"
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
                        {fileDetails(signed.find((doc) => doc.id === field.value))}
                        <CompactFieldFeedback
                          help={copy(signed.length ? 'documentHelp' : 'noSignedCopy')}
                          validationMessage={copy('documentInvalid')}
                          invalid={fieldState.invalid}
                        />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={recordForm.control}
                    name="acknowledged"
                    render={({ field }) => (
                      <FormItem id="signature-acknowledgement">
                        <FormLabel className="touch-label flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
                          <FormControl>
                            <input
                              type="checkbox"
                              aria-required="true"
                              name={field.name}
                              ref={field.ref}
                              checked={field.value}
                              onBlur={field.onBlur}
                              onChange={(event) => field.onChange(event.target.checked)}
                              disabled={locked}
                              className="size-4 shrink-0 accent-primary"
                            />
                          </FormControl>
                          <span>{word('signatureAcknowledgement')}</span>
                        </FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {recordForm.formState.errors.root && (
                    <p role="alert" className="col-span-full">
                      {copy('validationUnavailable')}
                    </p>
                  )}
                </div>
                <RecordEditorActions>
                  <Button
                    type="submit"
                    loading={preparing}
                    disabled={locked || preparing || loading || coordination?.blocked()}
                  >
                    {word('recordSignature')}
                  </Button>
                </RecordEditorActions>
              </form>
            </Form>
          )}
          {operation && !completed && !locked && !preparing ? (
            <Link
              {...recordLocation}
              search={{ ...navigation?.search, versionId }}
              hash="contract-documents"
              className="touch-action inline-flex w-fit items-center text-sm font-medium text-primary underline underline-offset-4"
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
            >
              {word('documents')}
            </Link>
          ) : !operation && (data.canRequest || data.canRecord) && !locked && !preparing ? (
            <a
              href="#contract-documents"
              className="touch-action inline-flex w-fit items-center text-sm font-medium text-primary underline underline-offset-4"
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
            >
              {word('documents')}
            </a>
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
          onCommandDispatch={(dispatched) => {
            if (current(captured)) captured.attempted = dispatched || captured.uncertain;
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
            if (operation) setCompleted(true);
            release();
            if (captured.request) requestForm.reset({ originalDocumentId: '' });
            else recordForm.reset({ signedDocumentId: '', acknowledged: false });
            dataRef.current = view;
            setData(view);
            callbacks.current.onStatus?.(view);
            callbacks.current.onChanged();
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
