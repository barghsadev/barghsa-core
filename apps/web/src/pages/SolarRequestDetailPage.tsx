import { useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { DocumentResults, type DocumentFilters } from '../components/DocumentsWorkspace.js';
import { SolarPostalPanel } from '../components/SolarPostalPanel.js';
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
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [request, setRequest] = useState<SolarRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/solar/requests/${encodeURIComponent(requestId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('request');
        return response.json() as Promise<{ request: SolarRequest }>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setRequest(result.request);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestId]);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void fetch(`/api/solar/requests/${encodeURIComponent(requestId)}/documents`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('documents');
        return response.json() as Promise<NonNullable<typeof documentsInfo>>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setDocumentsInfo(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDocumentError(true);
      });
    return () => controller.abort();
  }, [requestId, request?.id]);

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
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <a className="text-sm underline" href="/solar/requests">
        {copy('back')}
      </a>
      <h1 className="text-3xl font-semibold">{copy('details')}</h1>
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('notFound')}</p>}
      {request && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={copy(`status_${request.status}`)}
            happened={
              request.status_reason ??
              `${copy('submitted')}: ${new Intl.DateTimeFormat(locale).format(new Date(request.submitted_at))}`
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
                  <a
                    className="underline"
                    href={`/contracts?contractId=${encodeURIComponent(request.contract_id)}`}
                  >
                    {copy('solarViewContract')}
                  </a>
                ) : (
                  <span>{copy('solarContractAwaitingPublication')}</span>
                )}
                {request.initial_invoice_id && (
                  <a
                    className="underline"
                    href={`/invoices/${encodeURIComponent(request.initial_invoice_id)}`}
                  >
                    {copy('solarViewInvoice')}
                  </a>
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
            {request.site_address && (
              <div>
                <dt>{copy('address')}</dt>
                <dd>{request.site_address}</dd>
              </div>
            )}
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
              <dd>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(request.agreement_accepted_at))}
              </dd>
            </div>
            <div>
              <dt>{copy('agreement')}</dt>
              <dd>{request.agreement_snapshot}</dd>
            </div>
          </dl>
        </>
      )}
    </main>
  );
}
