import { toast } from '../lib/toast-api.js';
import {
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  LoadingStatus,
  StatusBadge,
  cn,
} from '@barghsa/ui';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { t } from '@barghsa/i18n/app';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { historyContextText } from '../lib/history-context.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import { readAsyncResponse } from '../hooks/useAsyncData.js';
import { announceReadRetry } from '../lib/read-retry-feedback.js';
import { queryKeys } from '../lib/query-keys.js';
import { Link } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { contractText } from '@barghsa/i18n/contracts';
import { documentText } from '@barghsa/i18n/documents';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { DocumentResults, type DocumentFilters } from '../components/DocumentsWorkspace.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { SolarSiteDocumentEditor } from '../components/SolarSiteDocumentEditor.js';
import {
  relatedDocumentLocation,
  type RelatedDocumentEntry,
} from '../lib/related-document-route.js';
import { SolarPostalPanel } from '../components/SolarPostalPanel.js';
import { SolarStageProgress } from '../components/SolarStageProgress.js';
import type { SolarProgress } from '../lib/solar-progress.js';
import { parseProgress } from '../lib/solar-progress-form.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { hasSolarShipment, solarNextAction } from '../lib/solar-next-action.js';

interface SolarRequest {
  id: string;
  profile_id: string;
  status: string;
  status_reason: string | null;
  support_path: string | null;
  contract_id: string | null;
  contract_published: boolean;
  initial_invoice_id: string | null;
  initial_invoice_state: string | null;
  building_type: string;
  grid_type: string;
  bill_identifier: string | null;
  property_form: string | null;
  structural_frame: string | null;
  building_completion_date: string | null;
  total_units: number | null;
  site_category: string | null;
  installation_surface: string | null;
  usable_area_sqm: string | null;
  site_address: string | null;
  site_relationship: string | null;
  site_description: string | null;
  agreement_version: string;
  agreement_snapshot: string;
  agreement_accepted_at: string;
  submitted_at: string;
}

type SolarHistory = Array<{ event: string; at: string; actorContext?: string | null }>;

function readFailure(reason: unknown) {
  if (reason instanceof ServerQueryError) {
    if ([401, 403, 404].includes(reason.status)) return 'denied';
    if (reason.status === 0) return 'network';
  }
  return 'unavailable';
}

export function SolarRequestDetailPage({
  requestId,
  view = 'detail',
  receiptEditor = false,
  documentEntry = null,
  reviewDocuments = false,
}: {
  requestId: string;
  view?: 'detail' | 'documents' | 'shipment';
  receiptEditor?: boolean;
  documentEntry?: RelatedDocumentEntry | null;
  reviewDocuments?: boolean;
}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return (
    <SolarRequestDetail
      key={JSON.stringify([actor, profileRevision, requestId])}
      requestId={requestId}
      actor={actor}
      view={view}
      receiptEditor={receiptEditor}
      documentEntry={documentEntry}
      reviewDocuments={reviewDocuments}
      profileRevision={profileRevision}
    />
  );
}

function SolarRequestDetail({
  requestId,
  view,
  receiptEditor,
  documentEntry,
  reviewDocuments,
  actor,
  profileRevision,
}: {
  requestId: string;
  view: 'detail' | 'documents' | 'shipment';
  receiptEditor: boolean;
  documentEntry: RelatedDocumentEntry | null;
  reviewDocuments: boolean;
  actor: string | null;
  profileRevision: number;
}) {
  const reader = useId();
  const client = useQueryClient();
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const documents = view === 'documents';
  const [request, setRequest] = useState<SolarRequest | null>(null);
  const [history, setHistory] = useState<SolarHistory>([]);
  const [progress, setProgress] = useState<SolarProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<ReturnType<typeof readFailure> | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [documentReadError, setDocumentReadError] = useState<ReturnType<typeof readFailure> | null>(
    null
  );
  const detailPending = useRef(false);
  const documentsPending = useRef(false);
  const [documentsInfo, setDocumentsInfo] = useState<{
    guidance: { fa: string; en: string; suggestions: Array<{ fa: string; en: string }> };
    requestedDocuments: Array<{ id: string; description: string }>;
  } | null>(null);
  const [allUploaded, setAllUploaded] = useState(false);
  const [siteUploadState, setSiteUploadState] = useState<'Available' | 'PendingScan' | null>(null);
  const [documentOutcome, setDocumentOutcome] = useState<
    'reviewSent' | 'documentError' | 'documentUnconfirmed' | null
  >(null);
  const [sendingDocuments, setSendingDocuments] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const completionPending = useRef<AbortController | null>(null);
  const completionKey = useRef<string | null>(null);
  useEffect(() => () => completionPending.current?.abort(), []);
  useEffect(() => {
    if (!reviewDocuments) {
      setAllUploaded(false);
      setDocumentOutcome(null);
    } else {
      reviewHeading.current?.focus();
    }
  }, [reviewDocuments]);
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'solar_request',
      state: '',
      category: '',
      query: '',
      profileId: '',
      businessRecordId: requestId,
    }),
    [requestId]
  );
  const detailQueryKey = queryKeys.solar.detail(
    {
      context: 'account',
      ownerId: actor?.trim() ? actor : reader,
      accountId: actor,
      revision: profileRevision,
    },
    JSON.stringify([reader, requestId, 'request', detailVersion])
  );
  const detailQuery = useServerDetailQuery<{
    request: SolarRequest;
    progress: SolarProgress | null;
    history: SolarHistory;
  }>({
    queryKey: detailQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await readAsyncResponse(
        `/api/solar/requests/${encodeURIComponent(requestId)}`,
        signal
      );
      if (!response.ok) throw new ServerQueryError(response.status);
      const result = (await response.json()) as {
        request?: SolarRequest;
        history?: SolarHistory | null;
        progress?: unknown;
      } | null;
      const request = result?.request;
      const history = result?.history ?? [];
      const progress = result?.progress == null ? null : parseProgress(result.progress);
      if (
        !request ||
        request.id !== requestId ||
        typeof request.profile_id !== 'string' ||
        !request.profile_id.trim() ||
        typeof request.status !== 'string' ||
        typeof request.submitted_at !== 'string' ||
        !Array.isArray(history) ||
        !history.every(
          (item) =>
            item &&
            typeof item.event === 'string' &&
            typeof item.at === 'string' &&
            (item.actorContext == null || typeof item.actorContext === 'string')
        ) ||
        (result?.progress != null &&
          (!progress ||
            progress.requestId !== requestId ||
            progress.profileId !== request.profile_id))
      )
        throw new Error('request');
      return { request, history, progress };
    },
  });
  const showDocuments =
    documents &&
    request &&
    ['submitted', 'uploading_documents', 'documents_under_review', 'changes_requested'].includes(
      request.status
    );
  const documentsQueryKey =
    showDocuments && request
      ? queryKeys.solar.detail(
          {
            context: 'customer',
            ownerId: request.profile_id,
            accountId: actor,
            revision: profileRevision,
          },
          JSON.stringify([reader, requestId, 'documents', documentsVersion])
        )
      : null;
  const documentsQuery = useServerDetailQuery<NonNullable<typeof documentsInfo>>({
    queryKey: documentsQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await readAsyncResponse(
        `/api/solar/requests/${encodeURIComponent(requestId)}/documents`,
        signal
      );
      if (!response.ok) throw new ServerQueryError(response.status);
      return response.json();
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    detailPending.current = true;
    setRequest(null);
    setProgress(null);
    setHistory([]);
    setDocumentsInfo(null);
    setLoading(true);
    setDetailError(null);
    void detailQuery
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted) return;
        if (!reply.isSuccess || !reply.data) throw reply.error ?? new Error('request');
        const result = reply.data;
        setRequest(result.request);
        setProgress(result.progress);
        setHistory(result.history);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          detailPending.current = false;
          setDetailError(readFailure(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          detailPending.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: detailQueryKey, exact: true });
    };
  }, [requestId, detailVersion]);
  useEffect(() => {
    if (!request || !documentsQueryKey) return;
    const controller = new AbortController();
    documentsPending.current = true;
    setDocumentsInfo(null);
    setDocumentReadError(null);
    void documentsQuery
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted) return;
        if (!reply.isSuccess || !reply.data) throw reply.error ?? new Error('documents');
        const value = reply.data;
        if (
          !value.guidance ||
          typeof value.guidance.fa !== 'string' ||
          typeof value.guidance.en !== 'string' ||
          !Array.isArray(value.guidance.suggestions) ||
          !value.guidance.suggestions.every(
            (item) => item && typeof item.fa === 'string' && typeof item.en === 'string'
          ) ||
          !Array.isArray(value.requestedDocuments) ||
          !value.requestedDocuments.every(
            (item) => item && typeof item.id === 'string' && typeof item.description === 'string'
          )
        )
          throw new Error('documents');
        setDocumentsInfo(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          documentsPending.current = false;
          const failure = readFailure(reason);
          if (failure === 'denied') {
            setRequest(null);
            setProgress(null);
            setHistory([]);
            setDocumentsInfo(null);
            setDetailError(failure);
          } else {
            setDocumentReadError(failure);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) documentsPending.current = false;
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: documentsQueryKey, exact: true });
    };
  }, [requestId, request?.id, showDocuments, documentsVersion]);

  async function completeDocuments(retry = false) {
    if (
      !reviewDocuments ||
      !allUploaded ||
      !documentsInfo ||
      detailPending.current ||
      documentsPending.current ||
      completionPending.current ||
      retry !== (completionKey.current !== null)
    )
      return;
    const idempotencyKey = completionKey.current ?? crypto.randomUUID();
    const controller = new AbortController();
    completionKey.current = idempotencyKey;
    completionPending.current = controller;
    setSendingDocuments(true);
    const isCurrent = () =>
      !controller.signal.aborted && getProfileContextRevision() === profileRevision;
    function settle(outcome: NonNullable<typeof documentOutcome>) {
      if (!isCurrent()) return;
      setDocumentOutcome(outcome);
      if (outcome === 'reviewSent') {
        setAllUploaded(false);
        detailPending.current = true;
        setDetailVersion((value) => value + 1);
        toast.success(copy(outcome), { id: reader });
      } else {
        toast.error(copy(outcome), { id: reader });
      }
    }
    try {
      const { status, receipt } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(
          `/api/solar/requests/${encodeURIComponent(requestId)}/documents/complete`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ allDocumentsUploaded: true, idempotencyKey }),
            signal,
          }
        );
        const receipt: unknown = response.status === 200 ? await response.json() : null;
        return { status: response.status, receipt };
      });
      if (!isCurrent()) return;
      if ([401, 403, 404].includes(status)) {
        completionKey.current = null;
        setRequest(null);
        setProgress(null);
        setHistory([]);
        setDocumentsInfo(null);
        setDetailError('denied');
        return;
      }
      if (!retry && [400, 409, 429].includes(status)) {
        completionKey.current = null;
        settle('documentError');
        return;
      }
      if (
        !receipt ||
        typeof receipt !== 'object' ||
        !('status' in receipt) ||
        receipt.status !== 'documents_under_review' ||
        !('requestId' in receipt) ||
        receipt.requestId !== requestId ||
        !('idempotencyKey' in receipt) ||
        receipt.idempotencyKey !== idempotencyKey
      )
        throw new Error('Unconfirmed document submission');
      completionKey.current = null;
      settle('reviewSent');
    } catch {
      settle('documentUnconfirmed');
    } finally {
      completionPending.current = null;
      if (isCurrent()) setSendingDocuments(false);
    }
  }
  const stages = ['requestStage', 'uploadStage', 'verifyStage', 'postalStage', 'finalStage'];
  const currentStage = request
    ? ['submitted', 'uploading_documents', 'changes_requested'].includes(request.status)
      ? 1
      : request.status === 'documents_under_review'
        ? 2
        : request.status === 'waiting_for_postal_submission'
          ? 3
          : 4
    : 1;
  const action = request ? solarNextAction(request, locale) : null;
  const shipmentAvailable = view === 'shipment' && request && hasSolarShipment(request.status);
  const documentChangeBlocked = sendingDocuments || documentOutcome === 'documentUnconfirmed';
  const siteDocumentEditorReady =
    !!documentEntry && !!showDocuments && !!documentsInfo && !documentChangeBlocked;
  const editorTitle =
    documentEntry?.mode === 'detail' || documentEntry?.mode === 'decision'
      ? documentText(documentEntry.mode === 'decision' ? documentEntry.decision : 'details', locale)
      : copy(
          documentEntry?.mode === 'replace'
            ? 'siteDocumentReplace'
            : documentEntry?.mode === 'upload'
              ? 'siteDocumentNew'
              : reviewDocuments
                ? 'reviewDocumentSet'
                : receiptEditor
                  ? 'postalUploadReceipt'
                  : documents
                    ? 'documentUploadTitle'
                    : 'shipmentPageTitle'
        );
  const documentReadFailure = documentReadError && (
    <Alert variant="destructive">
      <AlertDescription>{copy('documentReadError')}</AlertDescription>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sendingDocuments}
        onClick={() => {
          if (documentsPending.current || completionPending.current) return;
          documentsPending.current = true;
          if (documentReadError === 'network') announceReadRetry(locale);
          setDocumentsVersion((value) => value + 1);
        }}
      >
        {copy('retry')}
      </Button>
    </Alert>
  );
  const editorHeader = (disabled: boolean) => (
    <header className="space-y-1" data-toast-anchor>
      <Link
        {...(documentEntry?.mode === 'replace' || documentEntry?.mode === 'decision'
          ? relatedDocumentLocation(
              { kind: 'solar_request', id: requestId },
              documentEntry.documentId
            )
          : {
              to:
                documentEntry || reviewDocuments
                  ? '/solar/requests/$requestId/documents'
                  : receiptEditor
                    ? '/solar/requests/$requestId/shipment'
                    : '/solar/requests/$requestId',
              params: { requestId },
            })}
        disabled={disabled}
        className="touch-action inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline aria-disabled:opacity-60"
      >
        {documentEntry?.mode === 'replace' || documentEntry?.mode === 'decision'
          ? documentText('backToDocument', locale)
          : copy(
              documentEntry || reviewDocuments
                ? 'backToSolarDocuments'
                : receiptEditor
                  ? 'postalBackToShipment'
                  : 'backToSolarRequest'
            )}
      </Link>
      {!siteDocumentEditorReady && (
        <h1
          ref={reviewDocuments ? reviewHeading : undefined}
          tabIndex={reviewDocuments ? -1 : undefined}
          className="w-fit rounded-sm text-2xl font-semibold"
        >
          {editorTitle}
        </h1>
      )}
    </header>
  );
  return (
    <div
      className={
        view === 'detail'
          ? 'mx-auto w-full max-w-5xl min-w-0 space-y-4'
          : `mx-auto max-w-3xl space-y-4 px-4 pb-4 sm:pb-5 ${documentEntry ? 'pt-2 sm:pt-4' : 'pt-4 sm:pt-5'}`
      }
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {documents && <RecordCommandGuard blocked={() => completionKey.current !== null} />}
      {view === 'detail' ? (
        <header className="space-y-2">
          <Link
            className="touch-action inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4"
            to="/solar/requests"
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
            <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
            {copy('back')}
          </Link>
          <div className={loading ? 'sr-only' : 'space-y-3 rounded-xl border bg-card p-4 sm:p-6'}>
            <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">{copy('details')}</h1>
            {request && (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {t('historySearch.reference', locale)}
                  </dt>
                  <dd className="mt-1 font-medium wrap-anywhere">
                    <bdi>{request.id}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('submitted')}</dt>
                  <dd className="mt-1 font-medium">
                    <time dateTime={request.submitted_at}>{time.format(request.submitted_at)}</time>
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </header>
      ) : shipmentAvailable ? null : (
        editorHeader(documentChangeBlocked)
      )}
      {time.notice}
      {loading && (
        <RecordDetailSkeleton
          label={copy('loading')}
          layout={view === 'detail' ? 'order' : 'thread'}
        />
      )}
      {detailError && (
        <div className="space-y-2">
          <p role="alert">
            {detailError === 'denied' ? loadingText('recordUnavailable', locale) : copy('notFound')}
          </p>
          {detailError !== 'denied' && (
            <button
              type="button"
              className="rounded-md border px-4 py-2"
              onClick={() => {
                if (detailPending.current) return;
                detailPending.current = true;
                if (detailError === 'network') announceReadRetry(locale);
                setDetailVersion((value) => value + 1);
              }}
            >
              {copy('retry')}
            </button>
          )}
        </div>
      )}
      {request &&
        request.id === requestId &&
        (view === 'shipment' ? (
          shipmentAvailable ? (
            <SolarPostalPanel
              requestId={requestId}
              profileId={request.profile_id}
              receiptView={receiptEditor ? 'upload' : 'shipment'}
              siteAddress={request.site_address}
              editorHeader={(blocked, disabled) => (
                <>
                  <RecordCommandGuard blocked={blocked} />
                  {editorHeader(disabled)}
                </>
              )}
            />
          ) : (
            <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
              {copy('shipmentPageUnavailable')}
            </p>
          )
        ) : documents ? (
          documentEntry ? (
            siteDocumentEditorReady && documentsInfo ? (
              documentEntry.mode === 'detail' || documentEntry.mode === 'decision' ? (
                <DocumentDetail
                  id={documentEntry.documentId}
                  staff={false}
                  profileId={request.profile_id}
                  solarCustomer
                  related={{ kind: 'solar_request', id: requestId }}
                  decision={documentEntry.mode === 'decision' ? documentEntry.decision : undefined}
                />
              ) : (
                <SolarSiteDocumentEditor
                  key={documentEntry.mode === 'replace' ? documentEntry.documentId : 'new'}
                  requestId={requestId}
                  profileId={request.profile_id}
                  replacementId={documentEntry.mode === 'replace' ? documentEntry.documentId : null}
                  siteAddress={request.site_address}
                  guidance={documentsInfo.guidance[locale]}
                  requested={documentsInfo.requestedDocuments}
                  suggested={documentsInfo.guidance.suggestions.map((item) => item[locale])}
                  onUploaded={(document) => {
                    setAllUploaded(false);
                    setSiteUploadState(
                      document.state === 'Available' ? 'Available' : 'PendingScan'
                    );
                  }}
                />
              )
            ) : (
              (documentReadFailure ??
              (showDocuments && !documentsInfo ? (
                <LoadingStatus>{copy('loading')}</LoadingStatus>
              ) : (
                <p role="status">{copy('documentStageUnavailable')}</p>
              )))
            )
          ) : reviewDocuments && documentOutcome === 'reviewSent' ? (
            <div className={recordEditorSurface}>
              <RecordEditorSection
                title={copy('reviewSent')}
                description={copy('documentReviewNext')}
              >
                <p className="text-sm font-medium">{copy(`status_${request.status}`)}</p>
                <Link
                  to="/solar/requests/$requestId"
                  params={{ requestId }}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {copy('backToSolarRequest')}
                </Link>
              </RecordEditorSection>
              <span role="status" className="sr-only">
                {copy('reviewSent')}
              </span>
            </div>
          ) : showDocuments ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm sm:px-6">
                <StatusBadge
                  label={copy(`status_${request.status}`)}
                  tone={statusFilterTone(request.status)}
                />
                {request.site_address && (
                  <p dir="auto" className="text-muted-foreground wrap-anywhere">
                    {request.site_address}
                  </p>
                )}
                {request.status_reason?.trim() && (
                  <p
                    dir="auto"
                    className="basis-full border-s-2 border-warning/45 ps-3 whitespace-pre-wrap wrap-anywhere"
                  >
                    {request.status_reason}
                  </p>
                )}
              </div>
              <section
                id="solar-documents"
                className={recordEditorSurface}
                aria-label={copy(reviewDocuments ? 'reviewDocumentSet' : 'documentGuidance')}
              >
                {!reviewDocuments && (
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b bg-muted/25 px-4 py-3 sm:px-6">
                    <h2 className="text-base font-semibold">{copy('documentGuidance')}</h2>
                    {documentsInfo && (
                      <p className="basis-full text-sm whitespace-pre-wrap wrap-anywhere text-muted-foreground">
                        {documentsInfo.guidance[locale]}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-4 px-4 py-4 sm:px-6">
                  {!documentsInfo && !documentReadError && (
                    <LoadingStatus>{copy('loading')}</LoadingStatus>
                  )}
                  {documentReadFailure}
                  {documentsInfo &&
                    (documentsInfo.requestedDocuments.length > 0 ||
                      (!reviewDocuments && documentsInfo.guidance.suggestions.length > 0)) && (
                      <div
                        className={
                          !reviewDocuments &&
                          documentsInfo.requestedDocuments.length &&
                          documentsInfo.guidance.suggestions.length
                            ? 'grid gap-3 sm:grid-cols-2'
                            : 'space-y-3'
                        }
                      >
                        {!!documentsInfo.requestedDocuments.length && (
                          <div className="min-w-0 space-y-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm">
                            {reviewDocuments ? (
                              <h2 className="font-semibold">{copy('requestedDocuments')}</h2>
                            ) : (
                              <h3 className="font-semibold">{copy('requestedDocuments')}</h3>
                            )}
                            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                              {documentsInfo.requestedDocuments.map((item) => (
                                <li key={item.id} className="wrap-anywhere">
                                  <bdi>{item.description}</bdi>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!reviewDocuments && !!documentsInfo.guidance.suggestions.length && (
                          <div className="min-w-0 space-y-1 rounded-lg border px-3 py-2.5 text-sm">
                            <h3 className="font-semibold">{copy('suggestedDocuments')}</h3>
                            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                              {documentsInfo.guidance.suggestions.map((item, index) => (
                                <li key={index} className="wrap-anywhere">
                                  {item[locale]}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  <fieldset className="contents" disabled={documentChangeBlocked}>
                    {!reviewDocuments && siteUploadState && (
                      <p role="status" className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        {documentText(
                          siteUploadState === 'Available' ? 'uploadComplete' : 'PendingScan',
                          locale
                        )}
                      </p>
                    )}
                    <DocumentResults
                      staff={false}
                      filters={filters}
                      profileId={request.profile_id}
                      association={{
                        businessRecordType: 'solar_request',
                        businessRecordId: requestId,
                      }}
                      embedded
                      {...(reviewDocuments && { summaryLabel: copy('uploadedDocumentSet') })}
                      relatedLinks={{
                        context: { kind: 'solar_request', id: requestId },
                        disabled: documentChangeBlocked || !documentsInfo,
                        blocked: () => completionKey.current !== null,
                      }}
                    />
                  </fieldset>
                  {reviewDocuments && documentsInfo?.guidance[locale].trim() && (
                    <details className="text-sm">
                      <summary className="touch-action min-h-11 cursor-pointer py-2.5 font-medium text-primary">
                        {copy('documentGuidance')}
                      </summary>
                      <p className="pb-2 whitespace-pre-wrap wrap-anywhere">
                        {documentsInfo.guidance[locale]}
                      </p>
                    </details>
                  )}
                </div>
                {reviewDocuments ? (
                  <form
                    aria-label={copy('confirmDocumentSet')}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void completeDocuments();
                    }}
                  >
                    <div className="space-y-2.5 border-t px-4 py-3 sm:px-6">
                      <label className="touch-label flex items-start gap-2 rounded-lg bg-muted/45 px-3 py-2.5 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={allUploaded}
                          disabled={sendingDocuments || documentOutcome === 'documentUnconfirmed'}
                          onChange={(e) => setAllUploaded(e.target.checked)}
                        />
                        <span>{copy('allUploaded')}</span>
                      </label>
                      <p className="text-sm text-muted-foreground">{copy('documentReviewNext')}</p>
                      {documentOutcome && (
                        <p className="text-sm text-destructive" role="alert">
                          {copy(documentOutcome)}
                        </p>
                      )}
                    </div>
                    <RecordEditorActions className="max-sm:justify-start">
                      {documentOutcome === 'documentUnconfirmed' && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={sendingDocuments || !documentsInfo}
                          onClick={() => void completeDocuments(true)}
                        >
                          {copy('retryDocumentSubmission')}
                        </Button>
                      )}
                      <Button
                        type="submit"
                        loading={sendingDocuments}
                        disabled={
                          !allUploaded ||
                          !documentsInfo ||
                          sendingDocuments ||
                          documentOutcome === 'documentUnconfirmed'
                        }
                      >
                        {copy('sendReview')}
                      </Button>
                    </RecordEditorActions>
                  </form>
                ) : (
                  <RecordEditorActions className="max-sm:justify-start">
                    <Link
                      to="/solar/requests/$requestId/documents/review"
                      params={{ requestId }}
                      disabled={!documentsInfo || documentChangeBlocked}
                      className={buttonVariants()}
                    >
                      {copy('reviewDocumentSet')}
                    </Link>
                  </RecordEditorActions>
                )}
              </section>
            </>
          ) : (
            <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
              {copy('documentStageUnavailable')}
            </p>
          )
        ) : (
          <>
            <WorkflowStatusBanner
              locale={locale}
              status={copy(`status_${request.status}`)}
              statusSummary={
                <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="text-muted-foreground">{copy('status')}</dt>
                    <dd>
                      <StatusBadge
                        label={copy(`status_${request.status}`)}
                        tone={statusFilterTone(request.status)}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="text-muted-foreground">{copy('currentStage')}</dt>
                    <dd className="font-medium">{copy(stages[currentStage]!)}</dd>
                  </div>
                </dl>
              }
              happened={request.status_reason ?? copy(`status_${request.status}`)}
              nextAction={action!.text}
              owner={action!.owner}
              actionHref={action?.href}
              supportHref={request.support_path ?? '/tickets'}
            />
            {(request.status === 'submitted' || request.contract_id) && (
              <div className="rounded-xl border bg-card px-4 py-3 text-sm sm:px-6">
                {request.status === 'submitted' && (
                  <p className="text-muted-foreground">{copy('noContract')}</p>
                )}
                {request.contract_id && (
                  <div className="flex flex-wrap gap-4">
                    {request.contract_published ? (
                      <Link
                        className="touch-action font-medium text-primary hover:underline underline-offset-4"
                        to="/contracts/$contractId/{-$action}"
                        params={{ contractId: request.contract_id }}
                      >
                        {copy('solarViewContract')}
                      </Link>
                    ) : (
                      <span>{copy('solarContractAwaitingPublication')}</span>
                    )}
                    {request.initial_invoice_id && (
                      <Link
                        className="touch-action font-medium text-primary hover:underline underline-offset-4"
                        to="/invoices/$invoiceId"
                        params={{ invoiceId: request.initial_invoice_id }}
                      >
                        {copy('solarViewInvoice')}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}
            {hasSolarShipment(request.status) &&
              request.status !== 'waiting_for_postal_submission' && (
                <Link
                  to="/solar/requests/$requestId/shipment"
                  params={{ requestId }}
                  className="touch-action w-fit text-sm text-primary underline underline-offset-4"
                >
                  {copy('openShipment')}
                </Link>
              )}
            <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{copy('stages')}</h2>
              <ol className="grid list-inside list-decimal gap-2 text-sm sm:grid-cols-5">
                {stages.map((stage, index) => (
                  <li
                    key={stage}
                    aria-current={index === currentStage ? 'step' : undefined}
                    className={cn(
                      'rounded-md px-3 py-2',
                      index === currentStage
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'bg-muted/35 text-muted-foreground'
                    )}
                  >
                    {copy(stage)}
                  </li>
                ))}
              </ol>
            </section>
            {progress && progress.requestId === requestId && (
              <SolarStageProgress progress={progress} />
            )}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-6">
                <h2 className="font-semibold">{copy('wizardProperty')}</h2>
                <dl className="grid gap-3 text-sm sm:grid-cols-2 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:wrap-anywhere">
                  <div>
                    <dt>{t('historyView.type', locale)}</dt>
                    <dd>
                      {copy(
                        request.building_type === 'non_household' ? 'nonHousehold' : 'building'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy('gridType')}</dt>
                    <dd>{copy(request.grid_type === 'off_grid' ? 'offGrid' : 'onGrid')}</dd>
                  </div>
                  {request.bill_identifier && (
                    <div>
                      <dt>{copy('billIdentifier')}</dt>
                      <dd>
                        <bdi>{request.bill_identifier}</bdi>
                      </dd>
                    </div>
                  )}
                  {request.property_form && (
                    <div>
                      <dt>{copy('propertyForm')}</dt>
                      <dd>{copy(request.property_form)}</dd>
                    </div>
                  )}
                  {request.structural_frame && (
                    <div>
                      <dt>{copy('structuralFrame')}</dt>
                      <dd>{copy(request.structural_frame)}</dd>
                    </div>
                  )}
                  {request.building_completion_date && (
                    <div>
                      <dt>{copy('completionDate')}</dt>
                      <dd>{request.building_completion_date}</dd>
                    </div>
                  )}
                  {request.total_units && (
                    <div>
                      <dt>{copy('totalUnits')}</dt>
                      <dd>{request.total_units}</dd>
                    </div>
                  )}
                  {request.site_category && (
                    <div>
                      <dt>{copy('siteCategory')}</dt>
                      <dd>{copy(request.site_category)}</dd>
                    </div>
                  )}
                  {request.installation_surface && (
                    <div>
                      <dt>{copy('installationSurface')}</dt>
                      <dd>{copy(request.installation_surface)}</dd>
                    </div>
                  )}
                  {request.usable_area_sqm && (
                    <div>
                      <dt>{copy('usableArea')}</dt>
                      <dd>{request.usable_area_sqm}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{copy('address')}</dt>
                    <dd>
                      <bdi>{request.site_address || copy('addressNotRecorded')}</bdi>
                    </dd>
                  </div>
                  {request.site_relationship && (
                    <div>
                      <dt>{copy('relationship')}</dt>
                      <dd>
                        {copy(
                          request.site_relationship === 'authorized_operator'
                            ? 'authorizedOperator'
                            : request.site_relationship
                        )}
                      </dd>
                    </div>
                  )}
                  {request.site_description && (
                    <div>
                      <dt>{copy('description')}</dt>
                      <dd>{request.site_description}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{copy('acceptedVersion')}</dt>
                    <dd>{request.agreement_version}</dd>
                  </div>
                  <div>
                    <dt>{copy('acceptedAt')}</dt>
                    <dd>{time.format(request.agreement_accepted_at)}</dd>
                  </div>
                  <div className="sm:col-span-full">
                    <dt>{contractText('terms', locale)}</dt>
                    <dd>{request.agreement_snapshot}</dd>
                  </div>
                </dl>
              </section>
              <section
                className="space-y-2.5 rounded-xl border bg-card px-4 py-3 sm:px-5"
                aria-label={copy('historyTitle')}
              >
                <h2 className="text-base font-semibold">{copy('historyTitle')}</h2>
                <ol className="space-y-3">
                  {(history.length
                    ? history
                    : [{ event: 'solar.request.submitted', at: request.submitted_at }]
                  ).map((item, index) => (
                    <li key={`${item.at}-${index}`} className="border-s-2 border-primary/30 ps-3">
                      <p>{copy(`history_${item.event}`)}</p>
                      <p className="text-sm text-muted-foreground">
                        {historyContextText(item.actorContext, locale)}
                      </p>
                      <time className="text-sm text-muted-foreground" dateTime={item.at}>
                        {time.format(item.at)}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </>
        ))}
    </div>
  );
}
