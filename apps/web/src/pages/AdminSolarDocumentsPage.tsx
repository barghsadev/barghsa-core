import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, FinancialReviewSummary, Input, Label, ListPage } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import type { SolarDocumentQueries } from '../lib/solar-staff-query.js';

interface RequestRow {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  building_type: string;
  document_count: number;
  created_at: string;
}
interface PendingDocumentRow {
  id: string;
  request_id: string;
  document_id: string;
  file_name: string;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
  staff_status: string;
}
interface DocumentRow {
  id: string;
  document_id: string;
  file_name: string;
  staff_status: string;
  staff_reason: string | null;
  uploaded_by: string;
  uploaded_at: string;
  state: string;
  revision: number;
}
interface Detail {
  request: Pick<RequestRow, 'id' | 'profile_id' | 'status'>;
  documents: DocumentRow[];
  requestedDocuments: Array<{ id: string; description: string }>;
}
interface Guidance {
  fa: string;
  en: string;
  suggestions: Array<{ fa: string; en: string }>;
}
interface SetReview {
  hash: string;
  data: {
    requestId: string;
    currentStatus: string;
    documents: Array<{
      documentId: string;
      fileName: string;
      staffStatus: string;
      state: string;
    }>;
    existingRequests: Array<{ id: string; description: string }>;
    description: string | null;
    nextStatus: string;
  };
}

export function AdminSolarDocumentsPage({ queries }: { queries?: SolarDocumentQueries } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocumentRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [fa, setFa] = useState(''),
    [en, setEn] = useState('');
  const [faSuggestions, setFaSuggestions] = useState(''),
    [enSuggestions, setEnSuggestions] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [action, setAction] = useState<(TeamAction & { setReview?: SetReview }) | null>(null);
  const [preparingDecision, setPreparingDecision] = useState(false);
  const [revision, setRevision] = useState(0);
  const [localBefore, setBefore] = useState<string | null>(null);
  const before = queries ? queries.requests.query.cursor || null : localBefore;
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const acceptedCursor = useRef<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [localBeforeDocument, setBeforeDocument] = useState<string | null>(null);
  const beforeDocument = queries ? queries.files.query.cursor || null : localBeforeDocument;
  const [nextBeforeDocument, setNextBeforeDocument] = useState<string | null>(null);
  const acceptedDocumentCursor = useRef<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [queueDenied, setQueueDenied] = useState(false);
  const [documentsError, setDocumentsError] = useState(false);
  const [documentsDenied, setDocumentsDenied] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [guidanceError, setGuidanceError] = useState(false);
  const [queueRevision, setQueueRevision] = useState(0);
  const [documentsRevision, setDocumentsRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const reviewRequest = useRef(0);
  const commandGeneration = useRef(0);
  function propose(next: NonNullable<typeof action>) {
    commandGeneration.current = ++reviewRequest.current;
    setPreparingDecision(false);
    setAction(next);
  }
  function invalidateReview() {
    reviewRequest.current += 1;
    setAction(null);
    setPreparingDecision(false);
  }
  function selectRequest(id: string | null, documentId: string | null = null) {
    invalidateReview();
    if (selected !== id) {
      setDetail(null);
      setDetailError(false);
      setReason('');
    }
    setSelected(id);
    setPreview(documentId);
  }
  const extendingScope = useRef<string | null>(null);
  const queryScope = JSON.stringify([before, beforeDocument]);
  const previousScope = useRef(queryScope);
  if (previousScope.current !== queryScope) {
    previousScope.current = queryScope;
    ++reviewRequest.current;
  }
  useEffect(() => {
    invalidateReview();
    if (extendingScope.current !== queryScope) selectRequest(null);
    extendingScope.current = null;
  }, [queryScope]);
  useEffect(
    () => () => {
      ++reviewRequest.current;
    },
    []
  );
  const refresh = () => {
    setError(false);
    invalidateReview();
    if (queries) {
      queries.reset();
      if (!before) setQueueRevision((value) => value + 1);
      if (!beforeDocument) setDocumentsRevision((value) => value + 1);
      setDetailRevision((value) => value + 1);
    } else {
      setBefore(null);
      setBeforeDocument(null);
      setRevision((value) => value + 1);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setDocumentsLoading(true);
    setDocumentsError(false);
    setDocumentsDenied(false);
    void fetch(
      `/api/admin/solar/document-review-queue${beforeDocument ? `?before=${encodeURIComponent(beforeDocument)}` : ''}`,
      { credentials: 'include', signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{
          documents: PendingDocumentRow[];
          nextBefore: string | null;
        }>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        const extending =
          !!beforeDocument &&
          nextBeforeDocument === beforeDocument &&
          acceptedDocumentCursor.current !== beforeDocument;
        setPendingDocuments((current) => {
          if (!extending) return result.documents;
          const shown = new Set(current.map((document) => document.id));
          return [...current, ...result.documents.filter((document) => !shown.has(document.id))];
        });
        acceptedDocumentCursor.current = beforeDocument;
        setNextBeforeDocument(result.nextBefore);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) {
          setPendingDocuments([]);
          setNextBeforeDocument(null);
          selectRequest(null);
          setDetail(null);
          setDocumentsDenied(true);
        } else setDocumentsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentsLoading(false);
      });
    return () => controller.abort();
  }, [beforeDocument, revision, documentsRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setQueueError(false);
    setQueueDenied(false);
    setQueueLoading(true);
    void fetch(
      `/api/admin/solar/requests${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      {
        credentials: 'include',
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ requests: RequestRow[]; nextBefore: string | null }>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        const extending = !!before && nextBefore === before && acceptedCursor.current !== before;
        setRequests((current) => {
          if (!extending) return result.requests;
          const shown = new Set(current.map((request) => request.id));
          return [...current, ...result.requests.filter((request) => !shown.has(request.id))];
        });
        acceptedCursor.current = before;
        setNextBefore(result.nextBefore);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) {
          setRequests([]);
          setNextBefore(null);
          selectRequest(null);
          setDetail(null);
          setQueueDenied(true);
        } else setQueueError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [before, revision, queueRevision]);
  useEffect(() => {
    setDetailError(false);
    setDetail(null);
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/admin/solar/requests/${selected}/documents`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('details');
        return response.json() as Promise<Detail>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selected, revision, detailRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setGuidanceError(false);
    void fetch('/api/admin/solar/document-guidance', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance');
        return response.json() as Promise<Guidance>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setGuidance(value);
        setFa(value.fa);
        setEn(value.en);
        setFaSuggestions(value.suggestions.map((item) => item.fa).join('\n'));
        setEnSuggestions(value.suggestions.map((item) => item.en).join('\n'));
      })
      .catch(() => {
        if (!controller.signal.aborted) setGuidanceError(true);
      });
    return () => controller.abort();
  }, [guidanceRevision]);
  function saveGuidance(event: FormEvent) {
    event.preventDefault();
    const persian = faSuggestions
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const english = enSuggestions
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!fa.trim() || !en.trim() || persian.length !== english.length) {
      setError(true);
      return;
    }
    propose({
      title: copy('saveGuidance'),
      description: copy('saveGuidance'),
      path: '/api/admin/solar/document-guidance',
      method: 'PUT',
      body: {
        fa: fa.trim(),
        en: en.trim(),
        suggestions: persian.map((item, index) => ({ fa: item, en: english[index] })),
      },
    });
  }
  function review(document: DocumentRow, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) return;
    propose({
      title: copy(decision),
      description: document.file_name,
      path: `/api/admin/solar/requests/${selected}/documents/${document.document_id}/${decision}`,
      method: 'POST',
      body: {
        expectedRevision: document.revision,
        ...(decision === 'reject' ? { reason: reason.trim() } : {}),
      },
    });
  }
  async function prepareSetDecision(decision: 'request_additional' | 'advance') {
    if (!selected || preparingDecision) return;
    const requestId = selected;
    const description = reason.trim();
    if (decision === 'request_additional' && !description) {
      setError(true);
      return;
    }
    const request = ++reviewRequest.current;
    setPreparingDecision(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/solar/requests/${encodeURIComponent(requestId)}/documents/review-set-decision`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            decision,
            ...(decision === 'request_additional' ? { description } : {}),
          }),
        }
      );
      if (!response.ok) throw new Error('review');
      const setReview = (await response.json()) as SetReview;
      if (request !== reviewRequest.current) return;
      propose({
        title: copy(decision === 'advance' ? 'advancePostal' : 'requestAdditional'),
        description: requestId,
        method: 'POST',
        path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/documents/${decision === 'advance' ? 'advance' : 'request-additional'}`,
        body: {
          ...(decision === 'request_additional' ? { description } : {}),
          expectedReviewHash: setReview.hash,
        },
        conflictMessage: copy('documentSetReviewChanged'),
        setReview,
      });
    } catch {
      if (request === reviewRequest.current) setError(true);
    } finally {
      if (request === reviewRequest.current) setPreparingDecision(false);
    }
  }
  const actionGeneration = commandGeneration.current;
  return (
    <div className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('staffTitle')}</h1>
      {time.notice}
      {error && <p role="alert">{copy('documentError')}</p>}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('staffPendingFiles')}</h2>
        <ListPage>
          <ListPage.Content
            loading={documentsLoading}
            error={documentsError || documentsDenied}
            empty={!pendingDocuments.length}
            retainContent={!!pendingDocuments.length && !documentsDenied}
            loadingView={<p role="status">{copy('loading')}</p>}
            errorView={
              documentsDenied ? (
                <p role="alert">{copy('staffQueueForbidden')}</p>
              ) : (
                <div className="space-y-2">
                  <p role="alert">{copy('staffFilesLoadError')}</p>
                  <Button variant="outline" onClick={() => setDocumentsRevision((v) => v + 1)}>
                    {copy('retry')}
                  </Button>
                </div>
              )
            }
            emptyView={<p>{copy('staffNoPendingFiles')}</p>}
          >
            <ul className="space-y-2">
              {pendingDocuments.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border p-3 text-start"
                    onClick={() => {
                      selectRequest(document.request_id, document.document_id);
                    }}
                  >
                    <span className="block font-medium">{document.file_name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {copy('staffUploader')}: {document.uploaded_by_name} ·{' '}
                      {time.format(document.uploaded_at)} · {copy('staffPending')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy('staffRequest')}: <bdi>{document.request_id}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ListPage.Content>
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!nextBeforeDocument &&
              !documentsError &&
              !documentsDenied &&
              (acceptedDocumentCursor.current !== beforeDocument ||
                (nextBeforeDocument !== beforeDocument &&
                  (!queries || queries.files.canAdvance(nextBeforeDocument))))
            }
            loading={documentsLoading}
            label={copy('staffPendingFiles')}
            nextLabel={copy('moreFiles')}
            onNext={() => {
              extendingScope.current = JSON.stringify([before, nextBeforeDocument]);
              if (queries && nextBeforeDocument) queries.files.next(nextBeforeDocument);
              else setBeforeDocument(nextBeforeDocument);
            }}
          />
        </ListPage>
      </section>
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('staffQueue')}</h2>
        <ListPage>
          <ListPage.Content
            loading={queueLoading}
            error={queueError || queueDenied}
            empty={!requests.length}
            retainContent={!!requests.length && !queueDenied}
            loadingView={<p role="status">{copy('loading')}</p>}
            errorView={
              queueDenied ? (
                <p role="alert">{copy('staffQueueForbidden')}</p>
              ) : (
                <div className="space-y-2">
                  <p role="alert">{copy('staffQueueLoadError')}</p>
                  <Button variant="outline" onClick={() => setQueueRevision((v) => v + 1)}>
                    {copy('retry')}
                  </Button>
                </div>
              )
            }
            emptyView={<p>{copy('staffEmpty')}</p>}
          >
            <ul className="space-y-2">
              {requests.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md border p-3 text-start ${selected === row.id ? 'border-primary' : ''}`}
                    onClick={() => {
                      selectRequest(row.id);
                    }}
                  >
                    <span className="block font-medium">{row.profile_name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building')} ·{' '}
                      {copy(`status_${row.status}`)} · {row.document_count} ·{' '}
                      {time.format(row.created_at, { dateStyle: 'medium' })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy('staffRequest')}: <bdi>{row.id}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ListPage.Content>
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!nextBefore &&
              !queueError &&
              !queueDenied &&
              (acceptedCursor.current !== before ||
                (nextBefore !== before && (!queries || queries.requests.canAdvance(nextBefore))))
            }
            loading={queueLoading}
            label={copy('staffQueue')}
            nextLabel={copy('moreRequests')}
            onNext={() => {
              extendingScope.current = JSON.stringify([nextBefore, beforeDocument]);
              if (queries && nextBefore) queries.requests.next(nextBefore);
              else setBefore(nextBefore);
            }}
          />
        </ListPage>
      </section>
      {selected && !detail && !detailError && <p role="status">{copy('loading')}</p>}
      {selected && detailError && (
        <div role="alert" className="space-y-2">
          <p>{copy('staffDetailLoadError')}</p>
          <Button
            variant="outline"
            onClick={() => {
              invalidateReview();
              setDetailRevision((v) => v + 1);
            }}
          >
            {copy('retry')}
          </Button>
        </div>
      )}
      {guidanceError && (
        <div role="alert" className="space-y-2">
          <p>{copy('staffGuidanceLoadError')}</p>
          <Button variant="outline" onClick={() => setGuidanceRevision((v) => v + 1)}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {detail && selected && (
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{copy('staffDocuments')}</h2>
          <p>
            {copy('status')}: {copy(`status_${detail.request.status}`)}
          </p>
          <ul className="space-y-3">
            {detail.documents.map((document) => (
              <li key={document.id} className="rounded-md border p-3">
                <p className="font-medium">{document.file_name}</p>
                <p className="text-sm text-muted-foreground">
                  {document.uploaded_by} · {time.format(document.uploaded_at)} ·{' '}
                  {documentText(document.state, locale)} ·{' '}
                  {copy(`documentReview_${document.staff_status}`)}
                </p>
                {document.staff_reason && <p>{document.staff_reason}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setPreview(document.document_id)}>
                    {copy('preview')}
                  </Button>
                  {['Available', 'SubmittedForReview'].includes(document.state) &&
                    ['documents_under_review', 'changes_requested'].includes(
                      detail.request.status
                    ) && (
                      <>
                        <Button variant="outline" onClick={() => review(document, 'approve')}>
                          {copy('approve')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => review(document, 'reject')}
                          disabled={!reason.trim()}
                        >
                          {copy('reject')}
                        </Button>
                      </>
                    )}
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <DocumentDetail
              id={preview}
              staff
              onClose={() => setPreview(null)}
              onPrevious={setPreview}
              onChanged={refresh}
              onReplace={() => {}}
              allowReplacement={false}
            />
          )}
          <div>
            <Label htmlFor="solar-review-reason">{copy('reason')}</Label>
            <Input
              id="solar-review-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!reason.trim() || preparingDecision}
              onClick={() => void prepareSetDecision('request_additional')}
            >
              {copy('requestAdditional')}
            </Button>
            <Button disabled={preparingDecision} onClick={() => void prepareSetDecision('advance')}>
              {copy('advancePostal')}
            </Button>
          </div>
        </section>
      )}
      {guidance && (
        <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance}>
          <h2 className="text-xl font-semibold">{copy('documentGuidance')}</h2>
          {(
            [
              [copy('guidanceFa'), fa, setFa],
              [copy('guidanceEn'), en, setEn],
              [copy('suggestionsFa'), faSuggestions, setFaSuggestions],
              [copy('suggestionsEn'), enSuggestions, setEnSuggestions],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label} className="block space-y-1">
              <span>{label}</span>
              <textarea
                className="min-h-24 w-full rounded-md border bg-background p-2"
                value={value}
                onChange={(e) => setter(e.target.value)}
              />
            </label>
          ))}
          <Button type="submit">{copy('saveGuidance')}</Button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => {
            if (actionGeneration === reviewRequest.current) invalidateReview();
          }}
          summary={
            action.setReview ? (
              <FinancialReviewSummary
                title={copy('documentSetReviewTitle')}
                rows={[
                  {
                    id: 'request',
                    label: copy('staffRequest'),
                    value: action.setReview.data.requestId,
                  },
                  {
                    id: 'current-status',
                    label: copy('status'),
                    value: copy(`status_${action.setReview.data.currentStatus}`),
                  },
                  ...action.setReview.data.documents.map((document) => ({
                    id: document.documentId,
                    label: document.fileName,
                    value: `${documentText(document.state, locale)} · ${copy(`documentReview_${document.staffStatus}`)}`,
                  })),
                  ...action.setReview.data.existingRequests.map((request) => ({
                    id: request.id,
                    label: copy('requestedDocuments'),
                    value: request.description,
                  })),
                  ...(action.setReview.data.description
                    ? [
                        {
                          id: 'new-description',
                          label: copy('requestAdditional'),
                          value: action.setReview.data.description,
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('solarFinalOutcome'),
                  value: copy(`status_${action.setReview.data.nextStatus}`),
                }}
                notice={copy('solarFinalNoFinancialChange')}
              />
            ) : undefined
          }
          onSuccess={async () => {
            if (actionGeneration !== reviewRequest.current) return;
            setAction(null);
            setReason('');
            setPreview(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
