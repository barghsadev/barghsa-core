import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  FinancialReviewSummary,
  Input,
  ListPage,
} from '@barghsa/ui';
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
import { tSolar } from '@barghsa/i18n/solar';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  confirmedSolarGuidance,
  emptySolarGuidance,
  solarGuidanceBody,
  solarGuidanceDraft,
  validSolarGuidance,
  type SolarGuidanceDraft,
  type SolarReviewDraft,
  type SolarReviewIntent,
} from '../lib/solar-document-form.js';
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

export function AdminSolarDocumentsPage(
  props: Parameters<typeof OwnedAdminSolarDocumentsPage>[0] = {}
) {
  const profileRevision = useProfileContextRevision();
  const actor = useAccountUser();
  return <OwnedAdminSolarDocumentsPage key={JSON.stringify([actor, profileRevision])} {...props} />;
}
function OwnedAdminSolarDocumentsPage({ queries }: { queries?: SolarDocumentQueries } = {}) {
  const readActor = useAccountUser();
  const readProfileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(readActor, readProfileRevision);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocumentRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const intent = useRef<SolarReviewIntent>('request_additional');
  const documentForm = useZodForm<SolarReviewDraft>(
    async () =>
      (await import('../lib/solar-document-form-schemas.js')).solarReviewSchema(
        intent.current,
        copy(intent.current === 'reject' ? 'documentReasonInvalid' : 'documentDescriptionInvalid')
      ),
    {
      defaultValues: { reason: '' },
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const guidanceMessages = {
    fa: copy('documentGuidanceInvalid'),
    en: copy('documentGuidanceInvalid'),
    faSuggestions: copy('documentSuggestionsInvalid'),
    enSuggestions: copy('documentSuggestionsInvalid'),
  };
  const guidanceForm = useZodForm<SolarGuidanceDraft>(
    async () =>
      (await import('../lib/solar-document-form-schemas.js')).solarGuidanceSchema(guidanceMessages),
    {
      defaultValues: emptySolarGuidance,
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const guidanceDirty = useRef(false);
  guidanceDirty.current = guidanceForm.formState.isDirty;
  const documentFields = useActionFieldErrors(
    documentForm,
    {
      reason: copy(
        intent.current === 'reject' ? 'documentReasonInvalid' : 'documentDescriptionInvalid'
      ),
    },
    copy('documentError')
  );
  const currentDocumentFields = useRef(documentFields);
  currentDocumentFields.current = documentFields;
  const guidanceFields = useActionFieldErrors(
    guidanceForm,
    guidanceMessages,
    copy('documentError')
  );
  const [guidanceUnconfirmed, setGuidanceUnconfirmed] = useState(false);
  const [guidanceDenied, setGuidanceDenied] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const preparingDecisionRef = useRef(false);
  const actionRef = useRef<NonNullable<typeof action> | null>(null);

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
  function busy() {
    return (
      !!actionRef.current ||
      commandPendingRef.current ||
      preparingDecisionRef.current ||
      documentForm.isSubmissionPending() ||
      guidanceForm.isSubmissionPending()
    );
  }
  function propose(next: NonNullable<typeof action>) {
    commandGeneration.current = ++reviewRequest.current;
    preparingDecisionRef.current = false;
    setPreparingDecision(false);
    actionRef.current = next;
    setAction(next);
  }
  function invalidateReview() {
    reviewRequest.current += 1;
    commandPendingRef.current = false;
    setCommandPending(false);
    actionRef.current = null;
    setAction(null);
    preparingDecisionRef.current = false;
    setPreparingDecision(false);
  }
  function selectRequest(id: string | null, documentId: string | null = null) {
    if (commandPendingRef.current) return;
    invalidateReview();
    if (selected !== id) {
      setDetail(null);
      setDetailError(false);
      documentForm.reset({ reason: '' });
      setError(false);
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
    void readStaff(
      'solar',
      'list',
      `/api/admin/solar/document-review-queue${beforeDocument ? `?before=${encodeURIComponent(beforeDocument)}` : ''}`,
      controller.signal
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
  }, [beforeDocument, revision, documentsRevision, readStaff]);
  useEffect(() => {
    const controller = new AbortController();
    setQueueError(false);
    setQueueDenied(false);
    setQueueLoading(true);
    void readStaff(
      'solar',
      'list',
      `/api/admin/solar/requests${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      controller.signal
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
  }, [before, revision, queueRevision, readStaff]);
  useEffect(() => {
    setDetailError(false);
    setDetail(null);
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void readStaff(
      'solar',
      'detail',
      `/api/admin/solar/requests/${selected}/documents`,
      controller.signal
    )
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
  }, [selected, revision, detailRevision, readStaff]);
  useEffect(() => {
    const controller = new AbortController();
    setGuidanceError(false);
    void readStaff('catalogue', 'detail', '/api/admin/solar/document-guidance', controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance');
        return response.json() as Promise<Guidance>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!validSolarGuidance(value)) throw new Error('guidance');
        setGuidance(value);
        if (!guidanceDirty.current) guidanceForm.reset(solarGuidanceDraft(value));
        setGuidanceUnconfirmed(false);
        setGuidanceDenied(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGuidanceError(true);
      });
    return () => controller.abort();
  }, [guidanceRevision, readStaff]);
  function saveGuidance(event: FormEvent<HTMLFormElement>) {
    if (busy() || guidanceUnconfirmed || guidanceDenied) {
      event.preventDefault();
      return;
    }
    const generation = reviewRequest.current;
    void guidanceForm.handleSubmit((draft) => {
      if (generation !== reviewRequest.current) return;
      propose({
        title: copy('saveGuidance'),
        description: copy('saveGuidance'),
        path: '/api/admin/solar/document-guidance',
        method: 'PUT',
        body: solarGuidanceBody(draft),
      });
    })(event);
  }
  function review(document: DocumentRow, decision: 'approve' | 'reject') {
    if (!selected || busy()) return;
    const requestId = selected,
      generation = reviewRequest.current;
    const submit = (value: string) => {
      if (generation !== reviewRequest.current) return;
      setError(false);
      propose({
        title: copy(decision),
        description: document.file_name,
        path: `/api/admin/solar/requests/${requestId}/documents/${document.document_id}/${decision}`,
        method: 'POST',
        body: {
          expectedRevision: document.revision,
          ...(decision === 'reject' ? { reason: value.trim() } : {}),
        },
      });
    };
    if (decision === 'approve') submit('');
    else {
      intent.current = 'reject';
      void documentForm.handleSubmit((draft) => submit(draft.reason))();
    }
  }
  function prepareSetDecision(decision: 'request_additional' | 'advance') {
    if (!selected || busy()) return;
    const requestId = selected,
      generation = reviewRequest.current;
    const prepare = async (description: string) => {
      if (generation !== reviewRequest.current) return;
      const request = ++reviewRequest.current;
      preparingDecisionRef.current = true;
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
              ...(decision === 'request_additional' ? { description: description.trim() } : {}),
            }),
          }
        );
        const value = await response.json().catch(() => null);
        if (request !== reviewRequest.current) return;
        if (!response.ok) {
          if (
            response.status === 400 &&
            value?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(value.error.fields) &&
            decision === 'request_additional' &&
            value.error.fields.length &&
            value.error.fields.every((field: unknown) => field === 'description') &&
            currentDocumentFields.current(['reason'])
          )
            return;
          throw new Error('review');
        }
        const setReview = value as SetReview;
        if (
          !setReview ||
          typeof setReview.hash !== 'string' ||
          !setReview.data ||
          setReview.data.requestId !== requestId ||
          !Array.isArray(setReview.data.documents) ||
          !Array.isArray(setReview.data.existingRequests)
        )
          throw new Error('review');
        propose({
          title: copy(decision === 'advance' ? 'advancePostal' : 'requestAdditional'),
          description: requestId,
          method: 'POST',
          path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/documents/${decision === 'advance' ? 'advance' : 'request-additional'}`,
          body: {
            ...(decision === 'request_additional' ? { description: description.trim() } : {}),
            expectedReviewHash: setReview.hash,
          },
          conflictMessage: copy('documentSetReviewChanged'),
          setReview,
        });
      } catch {
        if (request === reviewRequest.current) setError(true);
      } finally {
        if (request === reviewRequest.current) {
          preparingDecisionRef.current = false;
          setPreparingDecision(false);
        }
      }
    };
    if (decision === 'advance') void prepare('');
    else {
      intent.current = 'request_additional';
      void documentForm.handleSubmit((draft) => prepare(draft.reason))();
    }
  }
  const actionGeneration = commandGeneration.current;
  const editorLocked =
    commandPending ||
    !!action ||
    preparingDecision ||
    documentForm.formState.isSubmitting ||
    guidanceForm.formState.isSubmitting;
  const guidanceAction = action?.path === '/api/admin/solar/document-guidance';
  return (
    <div className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('staffTitle')}</h1>
      {time.notice}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{copy('documentError')}</AlertDescription>
        </Alert>
      )}
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
                    disabled={commandPending}
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
                    disabled={commandPending}
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
        <section
          role="group"
          aria-label={copy('staffDocuments')}
          className="space-y-4 rounded-xl border p-5"
        >
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
                        <Button
                          variant="outline"
                          disabled={editorLocked}
                          onClick={() => review(document, 'approve')}
                        >
                          {copy('approve')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => review(document, 'reject')}
                          loading={documentForm.formState.isSubmitting}
                          disabled={editorLocked}
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
          <Form {...documentForm}>
            {documentForm.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={documentForm.control}
              name="reason"
              render={({ field }) => (
                <FormItem id="solar-review-reason">
                  <FormLabel>{copy('reason')}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={editorLocked} />
                  </FormControl>
                  <FormDescription>{copy('documentReviewHelp')}</FormDescription>
                  <div className="grid">
                    {(['documentReasonInvalid', 'documentDescriptionInvalid'] as const).map(
                      (key) => (
                        <p
                          key={key}
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1 text-sm"
                        >
                          {copy(key)}
                        </p>
                      )
                    )}
                    <FormMessage className="col-start-1 row-start-1" />
                  </div>
                </FormItem>
              )}
            />
          </Form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={editorLocked}
              loading={preparingDecision || documentForm.formState.isSubmitting}
              onClick={() => void prepareSetDecision('request_additional')}
            >
              {copy('requestAdditional')}
            </Button>
            <Button
              disabled={editorLocked}
              loading={preparingDecision}
              onClick={() => void prepareSetDecision('advance')}
            >
              {copy('advancePostal')}
            </Button>
          </div>
        </section>
      )}
      {guidance && (
        <Form {...guidanceForm}>
          <div role="group" aria-label={copy('documentGuidance')}>
            <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance} noValidate>
              <h2 className="text-xl font-semibold">{copy('documentGuidance')}</h2>
              {guidanceForm.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                </Alert>
              )}
              {(guidanceUnconfirmed || guidanceDenied) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {copy(
                      guidanceDenied ? 'documentGuidanceForbidden' : 'documentGuidanceUnconfirmed'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {(
                [
                  ['fa', 'solar-guidance-fa', 'guidanceFa', 'documentGuidanceHelp'],
                  ['en', 'solar-guidance-en', 'guidanceEn', 'documentGuidanceHelp'],
                  [
                    'faSuggestions',
                    'solar-guidance-fa-suggestions',
                    'suggestionsFa',
                    'documentSuggestionsHelp',
                  ],
                  [
                    'enSuggestions',
                    'solar-guidance-en-suggestions',
                    'suggestionsEn',
                    'documentSuggestionsHelp',
                  ],
                ] as const
              ).map(([name, id, label, help]) => (
                <FormField
                  key={name}
                  control={guidanceForm.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem id={id}>
                      <FormLabel>{copy(label)}</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          disabled={editorLocked || guidanceDenied}
                          dir={name.startsWith('fa') ? 'rtl' : 'ltr'}
                          className="min-h-24 w-full rounded-md border bg-background p-2"
                        />
                      </FormControl>
                      <FormDescription>{copy(help)}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {guidanceMessages[name]}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={guidanceForm.formState.isSubmitting}
                  disabled={editorLocked || guidanceUnconfirmed || guidanceDenied}
                >
                  {copy('saveGuidance')}
                </Button>
                {(guidanceUnconfirmed || guidanceDenied) && (
                  <Button
                    id="solar-guidance-reload"
                    type="button"
                    variant="outline"
                    disabled={editorLocked}
                    onClick={() => setGuidanceRevision((value) => value + 1)}
                  >
                    {copy('documentGuidanceReload')}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={guidanceAction && (guidanceUnconfirmed || guidanceDenied)}
          onPendingChange={(pending) => {
            if (actionGeneration === reviewRequest.current) {
              commandPendingRef.current = pending;
              setCommandPending(pending);
            }
          }}
          onValidationError={(fields) => {
            if (actionGeneration !== reviewRequest.current) return false;
            if (guidanceAction) {
              const names = {
                fa: 'fa',
                en: 'en',
                suggestionsFa: 'faSuggestions',
                suggestionsEn: 'enSuggestions',
              } as const;
              if (
                !fields.length ||
                !fields.every((field) => typeof field === 'string' && Object.hasOwn(names, field))
              )
                return false;
              return guidanceFields(fields.map((field) => names[field as keyof typeof names]));
            }
            const expected = action.path.endsWith('/reject')
              ? 'reason'
              : action.path.endsWith('/request-additional')
                ? 'description'
                : null;
            return (
              !!expected &&
              !!fields.length &&
              fields.every((field) => field === expected) &&
              documentFields(['reason'])
            );
          }}
          onUnconfirmed={() => {
            if (actionGeneration === reviewRequest.current && guidanceAction)
              setGuidanceUnconfirmed(true);
          }}
          onDenied={() => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) setGuidanceDenied(true);
            else {
              invalidateReview();
              selectRequest(null);
              setDetail(null);
              setError(true);
            }
          }}
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
          onSuccess={async (receipt) => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) {
              const expected = action.body as Guidance;
              if (!confirmedSolarGuidance(receipt, expected)) {
                setGuidanceUnconfirmed(true);
                throw new Error('guidance receipt');
              }
              setGuidance(expected);
              guidanceForm.reset(solarGuidanceDraft(expected));
              setGuidanceUnconfirmed(false);
              invalidateReview();
            } else {
              documentForm.reset({ reason: '' });
              setPreview(null);
              refresh();
            }
          }}
        />
      )}
    </div>
  );
}
