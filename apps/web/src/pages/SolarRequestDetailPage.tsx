import { historyContextText } from '../lib/history-context.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { Link, useParams } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { DocumentResults, type DocumentFilters } from '../components/DocumentsWorkspace.js';
import { SolarPostalPanel } from '../components/SolarPostalPanel.js';
import { SolarStageProgress } from '../components/SolarStageProgress.js';
import type { SolarProgress } from '../lib/solar-progress.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { solarNextAction } from '../lib/solar-next-action.js';

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

export function SolarRequestDetailPage() {
  const { requestId } = useParams({ from: '/_app/solar/requests/$requestId' });
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return (
    <SolarRequestDetail
      key={JSON.stringify([actor, profileRevision, requestId])}
      requestId={requestId}
      actor={actor}
      profileRevision={profileRevision}
    />
  );
}

function SolarRequestDetail({
  requestId,
  actor,
  profileRevision,
}: {
  requestId: string;
  actor: string | null;
  profileRevision: number;
}) {
  const reader = useId();
  const client = useQueryClient();
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [request, setRequest] = useState<SolarRequest | null>(null);
  const [history, setHistory] = useState<
    Array<{ event: string; at: string; actorContext?: string | null }>
  >([]);
  const [progress, setProgress] = useState<SolarProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [readDenied, setReadDenied] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [documentReadError, setDocumentReadError] = useState(false);
  const detailPending = useRef(false);
  const documentsPending = useRef(false);
  const [documentsInfo, setDocumentsInfo] = useState<{
    guidance: { fa: string; en: string; suggestions: Array<{ fa: string; en: string }> };
    requestedDocuments: Array<{ id: string; description: string }>;
  } | null>(null);
  const [allUploaded, setAllUploaded] = useState(false);
  const [documentError, setDocumentError] = useState(false);
  const [documentSent, setDocumentSent] = useState(false);
  const [sendingDocuments, setSendingDocuments] = useState(false);
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
    progress?: SolarProgress;
    history?: Array<{ event: string; at: string; actorContext?: string | null }>;
  }>({
    queryKey: detailQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/solar/requests/${encodeURIComponent(requestId)}`, {
        credentials: 'include',
        signal,
      });
      if ([401, 403, 404].includes(response.status)) throw new Error('forbidden');
      if (!response.ok) throw new Error('request');
      return response.json();
    },
  });
  const showDocuments =
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
      const response = await fetch(
        `/api/solar/requests/${encodeURIComponent(requestId)}/documents`,
        {
          credentials: 'include',
          signal,
        }
      );
      if ([401, 403, 404].includes(response.status)) throw new Error('forbidden');
      if (!response.ok) throw new Error('documents');
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
    setError(false);
    setReadDenied(false);
    void detailQuery
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted) return;
        if (!reply.isSuccess || !reply.data) throw reply.error ?? new Error('request');
        const result = reply.data;
        if (
          !result.request ||
          result.request.id !== requestId ||
          typeof result.request.profile_id !== 'string' ||
          !result.request.profile_id.trim()
        )
          throw new Error('request');
        setRequest(result.request);
        setProgress(result.progress ?? null);
        setHistory(result.history ?? []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          detailPending.current = false;
          setReadDenied(reason instanceof Error && reason.message === 'forbidden');
          setError(true);
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
    setDocumentReadError(false);
    setDocumentError(false);
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
          if (reason instanceof Error && reason.message === 'forbidden') {
            setRequest(null);
            setProgress(null);
            setHistory([]);
            setDocumentsInfo(null);
            setReadDenied(true);
            setError(true);
          } else {
            setDocumentReadError(true);
            setDocumentError(true);
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

  async function completeDocuments() {
    if (!allUploaded || sendingDocuments) return;
    setSendingDocuments(true);
    setDocumentError(false);
    try {
      const response = await fetch(
        `/api/solar/requests/${encodeURIComponent(requestId)}/documents/complete`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ allDocumentsUploaded: true }),
        }
      );
      if (!response.ok) throw new Error('documents');
      setRequest((current) => (current ? { ...current, status: 'documents_under_review' } : null));
      setDocumentSent(true);
    } catch {
      setDocumentError(true);
    } finally {
      setSendingDocuments(false);
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
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Link className="text-sm underline" to="/solar/requests">
        {copy('back')}
      </Link>
      <h1 className="text-3xl font-semibold">{copy('details')}</h1>
      {time.notice}
      {loading && <p role="status">{copy('loading')}</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert">{copy('notFound')}</p>
          {!readDenied && (
            <button
              type="button"
              className="rounded-md border px-4 py-2"
              onClick={() => {
                if (detailPending.current) return;
                detailPending.current = true;
                setDetailVersion((value) => value + 1);
              }}
            >
              {copy('retry')}
            </button>
          )}
        </div>
      )}
      {request && request.id === requestId && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={copy(`status_${request.status}`)}
            happened={
              request.status_reason ??
              `${copy('submitted')}: ${time.format(request.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}`
            }
            nextAction={action!.text}
            owner={action!.owner}
            actionHref={action?.href}
            supportHref={request.support_path ?? '/tickets'}
          />
          <div className="rounded-xl border p-5">
            <p>
              {copy('currentStage')}: <strong>{copy(stages[currentStage]!)}</strong>
            </p>
            {request.status === 'submitted' && (
              <p className="text-sm text-muted-foreground">{copy('noContract')}</p>
            )}
            {request.contract_id && (
              <div className="flex flex-wrap gap-4 text-sm">
                {request.contract_published ? (
                  <Link
                    className="underline"
                    to="/contracts"
                    search={{ contractId: request.contract_id }}
                  >
                    {copy('solarViewContract')}
                  </Link>
                ) : (
                  <span>{copy('solarContractAwaitingPublication')}</span>
                )}
                {request.initial_invoice_id && (
                  <Link
                    className="underline"
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: request.initial_invoice_id }}
                  >
                    {copy('solarViewInvoice')}
                  </Link>
                )}
              </div>
            )}
          </div>
          <section className="space-y-3 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">{copy('stages')}</h2>
            <ol className="list-inside list-decimal space-y-2">
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className={index === currentStage ? 'font-semibold text-primary' : ''}
                >
                  {copy(stage)}
                </li>
              ))}
            </ol>
          </section>
          {progress && progress.requestId === requestId && (
            <SolarStageProgress progress={progress} />
          )}
          <section className="space-y-3 rounded-xl border p-5" aria-label={copy('historyTitle')}>
            <h2 className="text-xl font-semibold">{copy('historyTitle')}</h2>
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
          {[
            'submitted',
            'uploading_documents',
            'documents_under_review',
            'changes_requested',
          ].includes(request.status) && (
            <section
              id="solar-documents"
              className="space-y-4 rounded-xl border p-5"
              aria-label={copy('documentGuidance')}
            >
              <h2 className="text-xl font-semibold">{copy('documentGuidance')}</h2>
              {documentsInfo && (
                <>
                  <p>{documentsInfo.guidance[locale]}</p>
                  {!!documentsInfo.guidance.suggestions.length && (
                    <>
                      <h3 className="font-medium">{copy('suggestedDocuments')}</h3>
                      <ul className="list-inside list-disc">
                        {documentsInfo.guidance.suggestions.map((item, index) => (
                          <li key={index}>{item[locale]}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {!!documentsInfo.requestedDocuments.length && (
                    <>
                      <h3 className="font-medium">{copy('requestedDocuments')}</h3>
                      <ul className="list-inside list-disc">
                        {documentsInfo.requestedDocuments.map((item) => (
                          <li key={item.id}>{item.description}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              <DocumentResults
                staff={false}
                filters={filters}
                profileId={request.profile_id}
                association={{ businessRecordType: 'solar_request', businessRecordId: requestId }}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allUploaded}
                  onChange={(e) => setAllUploaded(e.target.checked)}
                />
                {copy('allUploaded')}
              </label>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
                disabled={!allUploaded || sendingDocuments}
                onClick={() => void completeDocuments()}
              >
                {copy('sendReview')}
              </button>
              {documentSent && <p role="status">{copy('reviewSent')}</p>}
              {documentError && <p role="alert">{copy('documentError')}</p>}
              {documentReadError && (
                <button
                  type="button"
                  className="rounded-md border px-4 py-2"
                  disabled={sendingDocuments}
                  onClick={() => {
                    if (documentsPending.current || sendingDocuments) return;
                    documentsPending.current = true;
                    setDocumentsVersion((value) => value + 1);
                  }}
                >
                  {copy('retry')}
                </button>
              )}
            </section>
          )}
          {[
            'waiting_for_postal_submission',
            'postal_documents_received',
            'final_review',
            'contract_created',
          ].includes(request.status) && (
            <div id="solar-postal">
              <SolarPostalPanel requestId={requestId} profileId={request.profile_id} />
            </div>
          )}
          <dl className="grid gap-3 rounded-xl border p-5 sm:grid-cols-2">
            <div>
              <dt>{copy('instruction')}</dt>
              <dd>
                {copy(request.building_type === 'non_household' ? 'nonHousehold' : 'building')}
              </dd>
            </div>
            <div>
              <dt>{copy('gridType')}</dt>
              <dd>{copy(request.grid_type === 'off_grid' ? 'offGrid' : 'onGrid')}</dd>
            </div>
            {request.bill_identifier && (
              <div>
                <dt>{copy('billIdentifier')}</dt>
                <dd dir="ltr">{request.bill_identifier}</dd>
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
              <dd>{request.site_address || copy('addressNotRecorded')}</dd>
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
            <div>
              <dt>{copy('agreement')}</dt>
              <dd>{request.agreement_snapshot}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
