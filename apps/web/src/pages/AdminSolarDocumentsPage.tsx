import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { Link } from '@tanstack/react-router';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  FinancialReviewSummary,
  Input,
  ListPage,
  ListRefreshButton,
  PageHeader,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFieldArray,
  useZodForm,
} from '@barghsa/ui/form';
import { tSolar } from '@barghsa/i18n/solar';
import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { SolarGuidanceField, SolarGuidanceItems } from '../components/SolarGuidanceFields.js';
import { SolarStaffRecordHeader } from '../components/SolarStaffRecordHeader.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { toast } from '../lib/toast-api.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  confirmedSolarGuidance,
  guidanceErrorPaths,
  emptySolarGuidance,
  solarGuidanceBody,
  solarGuidanceDraft,
  validSolarGuidance,
  type SolarGuidanceDraft,
  type SolarReviewDraft,
  type SolarReviewIntent,
} from '../lib/solar-document-form.js';
import type { SolarDocumentQueries, SolarDocumentSearch } from '../lib/solar-staff-query.js';
import { readWithDeadline } from '../lib/server-query-client.js';

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
  request: Pick<RequestRow, 'id' | 'profile_id' | 'status'> &
    Partial<Pick<RequestRow, 'profile_name' | 'building_type' | 'created_at'>>;
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
  scope: { action: string; profileId: string; resourceId: string };
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
    decision: string;
    description: string | null;
    nextStatus: string;
    createsContract: boolean;
    createsInvoice: boolean;
  };
}

type ReviewDecision = {
  requestId: string;
  profileId: string;
  outcome:
    | {
        kind: 'document';
        id: string;
        revision: number;
        state: 'Approved' | 'Rejected';
        reason: string | null;
      }
    | {
        kind: 'set';
        status: 'changes_requested' | 'waiting_for_postal_submission';
        description: string | null;
        previousRequests: string[];
      };
};
type ReviewAction = TeamAction & { setReview?: SetReview; decision?: ReviewDecision };

type SolarDocumentEditor =
  | { operation: 'approve' | 'reject'; documentId: string }
  | { operation: 'request-additional' | 'advance-postal'; documentId?: undefined };

const decisionCopy = {
  approve: { title: 'approve', help: 'approveFileHelp' },
  reject: { title: 'reject', help: 'rejectFileHelp' },
  'request-additional': { title: 'requestAdditional', help: 'requestFileHelp' },
  'advance-postal': { title: 'advancePostal', help: 'advanceDocumentsHelp' },
} as const;

function SolarDecisionLink({
  requestId,
  editor,
  search,
  disabled,
  back,
  children,
}: {
  requestId: string;
  editor: SolarDocumentEditor;
  search: SolarDocumentSearch;
  disabled: boolean;
  back?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to="/admin/solar-requests/$requestId/{-$operation}/{-$documentId}"
      params={{
        requestId,
        operation: back ? undefined : editor.operation,
        documentId: back ? undefined : editor.documentId,
      }}
      search={search}
      className={
        back
          ? 'touch-action text-sm text-primary underline underline-offset-4'
          : buttonVariants({
              variant: editor.operation === 'advance-postal' ? 'default' : 'outline',
              size: 'sm',
              className: 'h-auto min-h-9 max-w-full whitespace-normal text-start',
            })
      }
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}

function confirmsDecision(value: unknown, decision: ReviewDecision) {
  if (!value || typeof value !== 'object') return false;
  const { requestId, profileId, outcome } = decision;
  if (outcome.kind === 'set') return 'status' in value && value.status === outcome.status;
  const receipt = value as {
    id?: unknown;
    businessRecordType?: unknown;
    businessRecordId?: unknown;
    profileId?: unknown;
    revision?: unknown;
    state?: unknown;
    rejectionReason?: unknown;
  };
  return (
    receipt.id === outcome.id &&
    receipt.businessRecordType === 'solar_request' &&
    receipt.businessRecordId === requestId &&
    receipt.profileId === profileId &&
    receipt.revision === outcome.revision &&
    receipt.state === outcome.state &&
    receipt.rejectionReason === outcome.reason
  );
}

function recordedDecision(detail: Detail, decision: ReviewDecision) {
  const { outcome } = decision;
  if (outcome.kind === 'document')
    return detail.documents.some(
      (document) =>
        document.document_id === outcome.id &&
        document.revision === outcome.revision &&
        document.state === outcome.state &&
        document.staff_status === (outcome.state === 'Approved' ? 'approved' : 'rejected') &&
        document.staff_reason === outcome.reason
    );
  return (
    detail.request.status === outcome.status &&
    (outcome.description === null ||
      detail.requestedDocuments.some(
        (item) =>
          item.description === outcome.description && !outcome.previousRequests.includes(item.id)
      ))
  );
}

function usesReason(decision: ReviewDecision) {
  const { outcome } = decision;
  return outcome.kind === 'document' ? outcome.reason !== null : outcome.description !== null;
}

function SolarQueueRecord({
  id,
  fileId,
  search,
  disabled,
  open,
  children,
}: {
  id: string;
  fileId?: string;
  search?: SolarDocumentSearch | undefined;
  disabled: boolean;
  open: () => void;
  children: ReactNode;
}) {
  const className = 'block min-h-11 w-full rounded-md border p-3 text-start hover:bg-muted';
  return search ? (
    <Link
      to="/admin/solar-requests/$requestId/{-$operation}/{-$documentId}"
      params={{ requestId: id, operation: undefined, documentId: undefined }}
      search={search}
      {...(fileId ? { hash: `solar-document-${fileId}` } : {})}
      className={className}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
    >
      {children}
    </Link>
  ) : (
    <button type="button" disabled={disabled} className={className} onClick={open}>
      {children}
    </button>
  );
}

export function AdminSolarDocumentsPage(
  props: Parameters<typeof OwnedAdminSolarDocumentsPage>[0] = {}
) {
  const profileRevision = useProfileContextRevision();
  const actor = useAccountUser();
  return <OwnedAdminSolarDocumentsPage key={JSON.stringify([actor, profileRevision])} {...props} />;
}
function OwnedAdminSolarDocumentsPage({
  queries,
  recordId,
  queueSearch,
  selectedFile,
  editor,
  guidanceEditor = false,
}: {
  queries?: SolarDocumentQueries;
  recordId?: string;
  queueSearch?: SolarDocumentSearch;
  selectedFile?: string;
  editor?: SolarDocumentEditor | undefined;
  guidanceEditor?: boolean;
} = {}) {
  const readActor = useAccountUser();
  const readProfileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(readActor, readProfileRevision);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocumentRow[]>([]);
  const [localSelected, setSelected] = useState<string | null>(null);
  const selected = recordId ?? localSelected;
  const showQueue = !recordId && !guidanceEditor;
  const loadGuidance = guidanceEditor || (showQueue && queueSearch === undefined);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const intent = useRef<SolarReviewIntent>(
    editor?.operation === 'reject' ? 'reject' : 'request_additional'
  );
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
    items: tSolarStaffRecord('guidancePairInvalid', locale),
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
  const guidanceItems = useFieldArray({ control: guidanceForm.control, name: 'items' });
  const guidanceFields = useActionFieldErrors(
    guidanceForm,
    {
      ...guidanceMessages,
      'items.0.fa': guidanceMessages.items,
      'items.0.en': guidanceMessages.items,
    },
    copy('documentError')
  );
  const [guidanceUnconfirmed, setGuidanceUnconfirmed] = useState(false);
  const [guidanceDenied, setGuidanceDenied] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const preparingDecisionRef = useRef(false);
  const actionRef = useRef<ReviewAction | null>(null);

  const [preview, setPreview] = useState<string | null>(selectedFile || null);
  useEffect(() => {
    if (recordId) setPreview(selectedFile || null);
  }, [recordId, selectedFile]);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [recoveries, setRecoveries] = useState(() => new Map<string, ReviewDecision>());
  const latestRecoveries = useRef(recoveries);
  latestRecoveries.current = recoveries;
  const recovery = selected ? recoveries.get(selected) : undefined;
  const [unmatchedRecovery, setUnmatchedRecovery] = useState<string | null>(null);
  const [decisionRecorded, setDecisionRecorded] = useState(false);
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
  const previewAbort = useRef<AbortController | null>(null);
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
  function propose(next: ReviewAction) {
    commandGeneration.current = ++reviewRequest.current;
    preparingDecisionRef.current = false;
    setPreparingDecision(false);
    if (next.decision) setUnmatchedRecovery(null);
    actionRef.current = next;
    setAction(next);
  }
  function invalidateReview() {
    reviewRequest.current += 1;
    previewAbort.current?.abort();
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
      setUnmatchedRecovery(null);
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
    if (!showQueue) return;
    invalidateReview();
    if (extendingScope.current !== queryScope) selectRequest(null);
    extendingScope.current = null;
  }, [queryScope, showQueue]);
  useEffect(
    () => () => {
      ++reviewRequest.current;
      previewAbort.current?.abort();
    },
    []
  );
  const refresh = () => {
    setError(false);
    invalidateReview();
    if (recordId) {
      setDetailRevision((value) => value + 1);
    } else if (queries) {
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
    if (!showQueue) return;
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
  }, [beforeDocument, revision, documentsRevision, readStaff, showQueue]);
  useEffect(() => {
    if (!showQueue) return;
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
  }, [before, revision, queueRevision, readStaff, showQueue]);
  useEffect(() => {
    setDetailError(false);
    setDetail(null);
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    const recovery = latestRecoveries.current.get(selected);
    void readStaff(
      'solar',
      'detail',
      `/api/admin/solar/requests/${selected}/documents`,
      controller.signal
    )
      .then(async (response) => {
        if (controller.signal.aborted) return null;
        if (recordId && [401, 403, 404].includes(response.status)) {
          setPreview(null);
          documentForm.reset({ reason: '' });
          setRecoveries((current) => {
            if (!current.has(selected)) return current;
            const next = new Map(current);
            next.delete(selected);
            return next;
          });
        }
        if (!response.ok) throw new Error('details');
        const result = (await response.json()) as Detail | null;
        if (
          result?.request?.id !== selected ||
          typeof result.request.profile_id !== 'string' ||
          !result.request.profile_id.trim() ||
          typeof result.request.status !== 'string' ||
          !Array.isArray(result.documents) ||
          !result.documents.every(
            (row) =>
              row &&
              typeof row.document_id === 'string' &&
              Number.isSafeInteger(row.revision) &&
              typeof row.state === 'string'
          ) ||
          !Array.isArray(result.requestedDocuments) ||
          !result.requestedDocuments.every(
            (row) => row && typeof row.id === 'string' && typeof row.description === 'string'
          ) ||
          (recovery && result.request.profile_id !== recovery.profileId)
        )
          throw new Error('details');
        return result;
      })
      .then((result) => {
        if (controller.signal.aborted || !result) return;
        setDetail(result);
        if (!recovery || latestRecoveries.current.get(selected) !== recovery) return;
        setRecoveries((current) => {
          const next = new Map(current);
          next.delete(selected);
          return next;
        });
        if (recordedDecision(result, recovery)) {
          if (editor) setDecisionRecorded(true);
          if (usesReason(recovery)) documentForm.reset({ reason: '' });
          toast.success(confirmationText('recorded', locale));
        } else setUnmatchedRecovery(selected);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selected, revision, detailRevision, readStaff, recordId, editor]);
  useEffect(() => {
    if (!loadGuidance) return;
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
  }, [guidanceRevision, readStaff, loadGuidance]);
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
        description: tSolarStaffRecord('documentGuidanceAudience', locale),
        path: '/api/admin/solar/document-guidance',
        method: 'PUT',
        body: solarGuidanceBody(draft),
      });
    })(event);
  }
  function review(document: DocumentRow, decision: 'approve' | 'reject') {
    if (!selected || detail?.request.id !== selected || !canReview || recovery || busy()) return;
    const requestId = selected,
      profileId = detail.request.profile_id,
      generation = reviewRequest.current;
    const submit = (value: string) => {
      if (generation !== reviewRequest.current) return;
      setError(false);
      propose({
        ...(decision === 'reject' ? { risk: 'destructive' as const } : {}),
        title: copy(decision),
        description: document.file_name,
        path: `/api/admin/solar/requests/${requestId}/documents/${document.document_id}/${decision}`,
        method: 'POST',
        body: {
          expectedRevision: document.revision,
          ...(decision === 'reject' ? { reason: value.trim() } : {}),
        },
        decision: {
          requestId,
          profileId,
          outcome: {
            kind: 'document',
            id: document.document_id,
            revision: document.revision + 1,
            state: decision === 'approve' ? 'Approved' : 'Rejected',
            reason: decision === 'reject' ? value.trim() : null,
          },
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
    if (!selected || detail?.request.id !== selected || !canReview || recovery || busy()) return;
    const requestId = selected,
      profileId = detail.request.profile_id,
      status = decision === 'advance' ? 'waiting_for_postal_submission' : 'changes_requested',
      generation = reviewRequest.current;
    const prepare = async (description: string) => {
      if (generation !== reviewRequest.current) return;
      const reason = decision === 'request_additional' ? description.trim() : null;
      const request = ++reviewRequest.current;
      preparingDecisionRef.current = true;
      setPreparingDecision(true);
      setError(false);
      const previewController = new AbortController();
      previewAbort.current = previewController;
      try {
        const { response, value } = await readWithDeadline(
          previewController.signal,
          async (signal) => {
            const response = await fetch(
              `/api/admin/solar/requests/${encodeURIComponent(requestId)}/documents/review-set-decision`,
              {
                signal,
                method: 'POST',
                credentials: 'include',
                headers: withCsrf({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                  decision,
                  ...(reason === null ? {} : { description: reason }),
                }),
              }
            );
            const value = await response.json().catch(() => null);
            return { response, value };
          }
        );
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
          !/^[0-9a-f]{64}$/.test(setReview.hash) ||
          setReview.scope?.action !== `solar.documents.${decision}` ||
          setReview.scope.resourceId !== requestId ||
          setReview.scope.profileId !== profileId ||
          !setReview.data ||
          setReview.data.requestId !== requestId ||
          setReview.data.decision !== decision ||
          setReview.data.description !== reason ||
          setReview.data.nextStatus !== status ||
          setReview.data.createsContract !== false ||
          setReview.data.createsInvoice !== false ||
          !Array.isArray(setReview.data.documents) ||
          !setReview.data.documents.every(
            (item) =>
              item &&
              typeof item.documentId === 'string' &&
              typeof item.fileName === 'string' &&
              typeof item.state === 'string' &&
              typeof item.staffStatus === 'string'
          ) ||
          !Array.isArray(setReview.data.existingRequests) ||
          !setReview.data.existingRequests.every(
            (item) => item && typeof item.id === 'string' && typeof item.description === 'string'
          )
        )
          throw new Error('review');
        propose({
          title: copy(decision === 'advance' ? 'advancePostal' : 'requestAdditional'),
          description: requestId,
          method: 'POST',
          path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/documents/${decision === 'advance' ? 'advance' : 'request-additional'}`,
          body: {
            ...(reason === null ? {} : { description: reason }),
            expectedReviewHash: setReview.hash,
          },
          conflictMessage: copy('documentSetReviewChanged'),
          setReview,
          decision: {
            requestId,
            profileId,
            outcome: {
              kind: 'set',
              status,
              description: reason,
              previousRequests: setReview.data.existingRequests.map((item) => item.id),
            },
          },
        });
      } catch {
        if (request === reviewRequest.current) setError(true);
      } finally {
        if (previewAbort.current === previewController) previewAbort.current = null;
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
  const reasonError = documentForm.formState.errors.reason;
  const focusDocumentField = documentForm.setFocus;
  useEffect(() => {
    if (!editor || editorLocked || !reasonError) return;
    const frame = requestAnimationFrame(() => focusDocumentField('reason'));
    return () => cancelAnimationFrame(frame);
  }, [editor, editorLocked, reasonError, focusDocumentField]);
  const guidanceAction = action?.path === '/api/admin/solar/document-guidance';
  const documentLocked = editorLocked || !!recovery;
  const canReview = ['documents_under_review', 'changes_requested'].includes(
    detail?.request.status ?? ''
  );
  const navigationBlocked = () =>
    commandPendingRef.current ||
    !!actionRef.current ||
    (recordId !== undefined && latestRecoveries.current.has(recordId));
  const ownedPreview = preview && detail?.documents.some((row) => row.document_id === preview);
  const operation = editor?.operation;
  const decision = operation && decisionCopy[operation];
  const file = editor?.documentId
    ? detail?.documents.find((row) => row.document_id === editor.documentId)
    : undefined;
  const requiresText = operation === 'reject' || operation === 'request-additional';
  const canExecute =
    canReview &&
    (!editor?.documentId || (!!file && ['Available', 'SubmittedForReview'].includes(file.state)));
  const recoveryNotice = recovery && (
    <div role="alert" className="space-y-2">
      <p>{copy('documentDecisionUnconfirmed')}</p>
      <Button
        type="button"
        variant="outline"
        disabled={editorLocked}
        onClick={() => setDetailRevision((value) => value + 1)}
      >
        {copy('documentDecisionReload')}
      </Button>
    </div>
  );
  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canExecute || decisionRecorded) return;
    if (operation === 'approve' || operation === 'reject') {
      if (file) review(file, operation);
    } else if (operation) {
      prepareSetDecision(operation === 'advance-postal' ? 'advance' : 'request_additional');
    }
  }
  return (
    <div
      data-slot={
        guidanceEditor ? 'solar-staff-guidance' : recordId ? 'solar-staff-request' : undefined
      }
      className={recordId || guidanceEditor ? 'mx-auto max-w-3xl space-y-3' : 'space-y-5'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {recordId || guidanceEditor ? (
        <SolarStaffRecordHeader
          stage="documents"
          search={queueSearch ?? {}}
          blocked={navigationBlocked}
          {...(guidanceEditor
            ? { headingText: tSolarStaffRecord('editDocumentGuidance', locale) }
            : decision && { headingText: copy(decision.title) })}
          backLink={
            editor &&
            recordId && (
              <SolarDecisionLink
                requestId={recordId}
                editor={editor}
                search={queueSearch ?? {}}
                disabled={navigationBlocked()}
                back
              >
                {tSolarStaffRecord('backToDocumentReview', locale)}
              </SolarDecisionLink>
            )
          }
          reference={
            guidanceEditor
              ? tSolarStaffRecord('documentGuidanceAudience', locale)
              : !editor &&
                detail && (
                  <>
                    {typeof detail.request.profile_name === 'string' && (
                      <bdi>{detail.request.profile_name}</bdi>
                    )}
                    <bdi dir="ltr">{detail.request.id}</bdi>
                  </>
                )
          }
          action={
            !editor &&
            detail && (
              <ListRefreshButton
                label={tSolarStaffRecord('refresh', locale)}
                onClick={refresh}
                disabled={editorLocked || !!recovery}
              />
            )
          }
        />
      ) : (
        <PageHeader
          title={copy('staffTitle')}
          actions={
            queueSearch && (
              <Link
                to="/admin/solar-requests/$requestId/{-$operation}/{-$documentId}"
                params={{ requestId: 'guidance', operation: undefined, documentId: undefined }}
                search={queueSearch}
                className={buttonVariants({ variant: 'outline' })}
              >
                {tSolarStaffRecord('editDocumentGuidance', locale)}
              </Link>
            )
          }
        />
      )}
      {time.notice}
      {recordId &&
        !editor &&
        detail &&
        [
          'waiting_for_postal_submission',
          'postal_documents_received',
          'final_review',
          'approved',
        ].includes(detail.request.status) && (
          <Link
            to="/admin/solar-requests/$requestId/postal/{-$operation}"
            params={{ requestId: recordId, operation: undefined }}
            className="touch-action text-sm text-primary underline underline-offset-4"
            aria-disabled={navigationBlocked() || undefined}
            onClick={(event) => {
              if (navigationBlocked()) event.preventDefault();
            }}
          >
            {tSolarStaffRecord('openPostal', locale)}
          </Link>
        )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{copy('documentError')}</AlertDescription>
        </Alert>
      )}
      {showQueue && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{copy('staffPendingFiles')}</h2>
            <ListPage>
              <ListPage.Content
                loading={documentsLoading}
                error={documentsError || documentsDenied}
                empty={!pendingDocuments.length}
                retainContent={!!pendingDocuments.length && !documentsDenied}
                loadingView={
                  <RecordListSkeleton label={copy('loading')} view="card" headings={[]} />
                }
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
                emptyView={
                  <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
                    {copy('staffNoPendingFiles')}
                  </p>
                }
              >
                <ul className="space-y-2">
                  {pendingDocuments.map((document) => (
                    <li key={document.id}>
                      <SolarQueueRecord
                        id={document.request_id}
                        fileId={document.document_id}
                        search={queueSearch}
                        disabled={commandPending}
                        open={() => selectRequest(document.request_id, document.document_id)}
                      >
                        <span className="flex flex-wrap items-start justify-between gap-2">
                          <bdi className="min-w-0 wrap-anywhere font-semibold">
                            {document.file_name}
                          </bdi>
                          <StatusBadge label={copy('staffPending')} tone="warning" />
                        </span>
                        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <bdi>{document.uploaded_by_name}</bdi>
                          <time dateTime={document.uploaded_at}>
                            {time.format(document.uploaded_at)}
                          </time>
                        </span>
                        <span className="mt-1 block wrap-anywhere text-xs text-muted-foreground">
                          {copy('staffRequest')} <bdi dir="ltr">{document.request_id}</bdi>
                        </span>
                      </SolarQueueRecord>
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
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{copy('staffQueue')}</h2>
            <ListPage>
              <ListPage.Content
                loading={queueLoading}
                error={queueError || queueDenied}
                empty={!requests.length}
                retainContent={!!requests.length && !queueDenied}
                loadingView={
                  <RecordListSkeleton label={copy('loading')} view="card" headings={[]} />
                }
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
                      <SolarQueueRecord
                        id={row.id}
                        search={queueSearch}
                        disabled={commandPending}
                        open={() => selectRequest(row.id)}
                      >
                        <span className="flex flex-wrap items-start justify-between gap-2">
                          <bdi className="min-w-0 wrap-anywhere font-semibold">
                            {row.profile_name}
                          </bdi>
                          <StatusBadge state={row.status} label={copy(`status_${row.status}`)} />
                        </span>
                        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>
                            {copy(
                              row.building_type === 'non_household' ? 'nonHousehold' : 'building'
                            )}
                          </span>
                          <span>
                            {copy('staffDocuments')} <bdi>{numbers.number(row.document_count)}</bdi>
                          </span>
                          <time dateTime={row.created_at}>
                            {time.format(row.created_at, { dateStyle: 'medium' })}
                          </time>
                        </span>
                        <span className="mt-1 block wrap-anywhere text-xs text-muted-foreground">
                          {copy('staffRequest')} <bdi dir="ltr">{row.id}</bdi>
                        </span>
                      </SolarQueueRecord>
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
                    (nextBefore !== before &&
                      (!queries || queries.requests.canAdvance(nextBefore))))
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
        </>
      )}
      {selected &&
        !detail &&
        !detailError &&
        (editor ? (
          <LoadingStatus>{copy('loading')}</LoadingStatus>
        ) : (
          <RecordDetailSkeleton label={copy('loading')} />
        ))}
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
      {guidanceEditor && !guidance && !guidanceError && (
        <LoadingStatus>{copy('loading')}</LoadingStatus>
      )}
      {guidanceError && (
        <div role="alert" className="space-y-2">
          <p>{copy('staffGuidanceLoadError')}</p>
          <Button variant="outline" onClick={() => setGuidanceRevision((v) => v + 1)}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {detail && selected && editor && decision && (
        <Form {...documentForm}>
          <form
            aria-label={copy(decision.title)}
            className={recordEditorSurface}
            onSubmit={submitDecision}
            noValidate
          >
            <RecordEditorSection
              title={tSolarStaffRecord(file ? 'fileDecision' : 'requestDecision', locale)}
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3">
                <div className="min-w-0 space-y-1">
                  <p className="wrap-anywhere font-medium" dir="auto">
                    {file?.file_name ?? detail.request.profile_name ?? detail.request.id}
                  </p>
                  <p className="wrap-anywhere text-sm text-muted-foreground">
                    {file
                      ? documentText(file.state, locale)
                      : copy(`status_${detail.request.status}`)}
                    {file && detail.request.profile_name && (
                      <>
                        {' '}
                        · <bdi>{detail.request.profile_name}</bdi>
                      </>
                    )}
                  </p>
                </div>
                {file && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={documentLocked}
                    onClick={() => setPreview(file.document_id)}
                  >
                    {copy('preview')}
                  </Button>
                )}
              </div>
              {recoveryNotice}
              {unmatchedRecovery === selected && (
                <p role="alert">{copy('documentDecisionNotFound')}</p>
              )}
              {decisionRecorded ? (
                <p role="status" className="text-sm font-medium">
                  {confirmationText('recorded', locale)}
                </p>
              ) : !canExecute ? (
                <p role="alert" className="text-sm">
                  {tSolarStaffRecord('decisionUnavailable', locale)}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {tSolarStaffRecord(decision.help, locale)}
                  </p>
                  {documentForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  {requiresText && (
                    <FormField
                      control={documentForm.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem id="solar-review-reason" className={recordEditorField}>
                          <FormLabel>
                            {tSolarStaffRecord(
                              operation === 'reject' ? 'rejectFileLabel' : 'requestFileLabel',
                              locale
                            )}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              rows={2}
                              className="max-h-36 overflow-y-auto"
                              dir="auto"
                              required
                              disabled={!!recovery || commandPending}
                            />
                          </FormControl>
                          <FormDescription>
                            {tSolarStaffRecord(
                              operation === 'reject'
                                ? 'rejectFileExample'
                                : 'documentDecisionExample',
                              locale
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}
            </RecordEditorSection>
            {canExecute && !decisionRecorded && (
              <RecordEditorActions>
                <Button
                  type="submit"
                  disabled={documentLocked}
                  loading={preparingDecision || documentForm.formState.isSubmitting}
                >
                  {tSolarStaffRecord('reviewDecision', locale)}
                </Button>
              </RecordEditorActions>
            )}
          </form>
        </Form>
      )}
      {detail && selected && !editor && (
        <section role="group" aria-label={copy('staffDocuments')} className="space-y-3">
          <div className={recordEditorSurface}>
            <RecordEditorSection title={copy('staffDocuments')}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <StatusBadge
                  state={detail.request.status}
                  label={copy(`status_${detail.request.status}`)}
                />
                {detail.request.building_type && (
                  <span className="text-muted-foreground">
                    {copy(
                      detail.request.building_type === 'non_household' ? 'nonHousehold' : 'building'
                    )}
                  </span>
                )}
                {typeof detail.request.created_at === 'string' && (
                  <time dateTime={detail.request.created_at} className="text-muted-foreground">
                    {time.format(detail.request.created_at, { dateStyle: 'medium' })}
                  </time>
                )}
              </div>
              {recoveryNotice}
              {unmatchedRecovery === selected && (
                <p role="alert">{copy('documentDecisionNotFound')}</p>
              )}
              {!!detail.requestedDocuments.length && (
                <div>
                  <h3 className="font-medium">{copy('requestedDocuments')}</h3>
                  <ul className="list-inside list-disc">
                    {detail.requestedDocuments.map((item) => (
                      <li key={item.id} dir="auto" className="break-words">
                        {item.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {recordId && detail.documents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {tSolarStaffRecord('noFiles', locale)}
                </p>
              )}
              <ul className="space-y-3">
                {detail.documents.map((document) => (
                  <li
                    key={document.id}
                    id={`solar-document-${document.document_id}`}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1 basis-64 space-y-1">
                      <p className="wrap-anywhere font-medium" dir="auto">
                        {document.file_name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                        <StatusBadge
                          state={document.staff_status}
                          label={copy(`documentReview_${document.staff_status}`)}
                        />
                        <span className="text-muted-foreground">
                          {documentText(document.state, locale)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <bdi>{document.uploaded_by}</bdi> ·{' '}
                        <time dateTime={document.uploaded_at}>
                          {time.format(document.uploaded_at)}
                        </time>
                      </p>
                      {document.staff_reason && (
                        <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                          {document.staff_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!recovery}
                        onClick={() => setPreview(document.document_id)}
                      >
                        {copy('preview')}
                      </Button>
                      {['Available', 'SubmittedForReview'].includes(document.state) &&
                        canReview &&
                        (recordId ? (
                          <>
                            {(['approve', 'reject'] as const).map((operation) => (
                              <SolarDecisionLink
                                key={operation}
                                requestId={recordId}
                                editor={{ operation, documentId: document.document_id }}
                                search={queueSearch ?? {}}
                                disabled={documentLocked}
                              >
                                {copy(operation)}
                              </SolarDecisionLink>
                            ))}
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={documentLocked}
                              onClick={() => review(document, 'approve')}
                            >
                              {copy('approve')}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => review(document, 'reject')}
                              loading={documentForm.formState.isSubmitting}
                              disabled={documentLocked}
                            >
                              {copy('reject')}
                            </Button>
                          </>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            </RecordEditorSection>
          </div>
          {recordId ? (
            canReview && (
              <div className={recordEditorSurface}>
                <RecordEditorSection title={tSolarStaffRecord('documentDecision', locale)}>
                  <div className="flex flex-wrap gap-2">
                    {(['request-additional', 'advance-postal'] as const).map((operation) => (
                      <SolarDecisionLink
                        key={operation}
                        requestId={recordId}
                        editor={{ operation }}
                        search={queueSearch ?? {}}
                        disabled={documentLocked}
                      >
                        {copy(decisionCopy[operation].title)}
                      </SolarDecisionLink>
                    ))}
                  </div>
                </RecordEditorSection>
              </div>
            )
          ) : (
            <div className={recordEditorSurface}>
              <RecordEditorSection
                title={tSolarStaffRecord('documentDecision', locale)}
                description={tSolarStaffRecord('documentDecisionHelp', locale)}
              >
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
                      <FormItem id="solar-review-reason" className={recordEditorField}>
                        <FormLabel>{tSolarStaffRecord('documentDecisionField', locale)}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={tSolarStaffRecord('documentDecisionExample', locale)}
                            disabled={documentLocked || !canReview}
                          />
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
              </RecordEditorSection>
              <RecordEditorActions>
                <Button
                  variant="outline"
                  disabled={documentLocked || !canReview}
                  loading={preparingDecision || documentForm.formState.isSubmitting}
                  onClick={() => void prepareSetDecision('request_additional')}
                >
                  {copy('requestAdditional')}
                </Button>
                <Button
                  className="h-auto min-h-11 max-w-full whitespace-normal"
                  disabled={documentLocked || !canReview}
                  loading={preparingDecision}
                  onClick={() => void prepareSetDecision('advance')}
                >
                  {copy('advancePostal')}
                </Button>
              </RecordEditorActions>
            </div>
          )}
        </section>
      )}
      {preview && ownedPreview && !recovery && (
        <DocumentDetail
          id={preview}
          staff
          onClose={() => setPreview(null)}
          onPrevious={setPreview}
          onChanged={refresh}
          allowReplacement={false}
          previewOnly={!!recordId}
        />
      )}
      {guidance && (
        <Form {...guidanceForm}>
          <div
            role="group"
            aria-label={copy('documentGuidance')}
            className="mx-auto w-full max-w-3xl"
          >
            <form className={recordEditorSurface} onSubmit={saveGuidance} noValidate>
              {(!guidanceEditor ||
                guidanceForm.formState.errors.root ||
                guidanceUnconfirmed ||
                guidanceDenied) && (
                <div className="space-y-2 border-b px-4 py-3 sm:px-6">
                  {!guidanceEditor && (
                    <h2 className="text-base font-semibold">{copy('documentGuidance')}</h2>
                  )}
                  {guidanceForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  {(guidanceUnconfirmed || guidanceDenied) && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {copy(
                          guidanceDenied
                            ? 'documentGuidanceForbidden'
                            : 'documentGuidanceUnconfirmed'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <RecordEditorSection title={tSolarStaffRecord('customerInstructions', locale)}>
                <div className={recordEditorGrid}>
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="fa"
                    id="solar-guidance-fa"
                    label={copy('guidanceFa')}
                    direction="rtl"
                    help={copy('documentGuidanceHelp')}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="en"
                    id="solar-guidance-en"
                    label={copy('guidanceEn')}
                    direction="ltr"
                    help={copy('documentGuidanceHelp')}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                </div>
              </RecordEditorSection>
              <SolarGuidanceItems
                title={tSolarStaffRecord('suggestedDocuments', locale)}
                rows={guidanceItems.fields}
                disabled={editorLocked || guidanceDenied}
                error={
                  guidanceForm.formState.errors.items?.root?.message ??
                  guidanceForm.formState.errors.items?.message
                }
                onAdd={() =>
                  guidanceItems.append(
                    { fa: '', en: '' },
                    { focusName: `items.${guidanceItems.fields.length}.${locale}` }
                  )
                }
                onRemove={guidanceItems.remove}
                renderField={(index, language, label) => (
                  <SolarGuidanceField
                    form={guidanceForm}
                    name={`items.${index}.${language}`}
                    id={`solar-guidance-item-${index}-${language}`}
                    label={label}
                    direction={language === 'fa' ? 'rtl' : 'ltr'}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                )}
              />
              <RecordEditorActions>
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
              </RecordEditorActions>
            </form>
          </div>
        </Form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={
            guidanceEditor && guidanceAction
              ? () =>
                  document.querySelector<HTMLElement>(
                    '[data-slot="solar-staff-guidance"] [aria-invalid="true"]'
                  ) ?? true
              : editor && !guidanceAction
                ? () =>
                    document.querySelector<HTMLElement>(
                      '#solar-review-reason[aria-invalid="true"]'
                    ) ?? true
                : undefined
          }
          confirmationDisabled={guidanceAction ? guidanceUnconfirmed || guidanceDenied : !!recovery}
          onPendingChange={(pending) => {
            if (actionGeneration === reviewRequest.current) {
              commandPendingRef.current = pending;
              setCommandPending(pending);
            }
          }}
          onValidationError={(fields) => {
            if (actionGeneration !== reviewRequest.current) return false;
            if (guidanceAction)
              return guidanceFields(
                guidanceErrorPaths(fields, 'suggestions', !!guidanceItems.fields.length)
              );
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
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) setGuidanceUnconfirmed(true);
            const decision = action.decision;
            if (decision)
              setRecoveries((current) => new Map(current).set(decision.requestId, decision));
          }}
          onDenied={() => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) setGuidanceDenied(true);
            else {
              invalidateReview();
              selectRequest(null);
              setDetail(null);
              if (recordId) setDetailError(true);
              else setError(true);
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
            ) : action.decision?.outcome.kind === 'document' && action.decision.outcome.reason ? (
              <p className="whitespace-pre-wrap wrap-anywhere text-sm" dir="auto">
                {action.decision.outcome.reason}
              </p>
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
              return confirmationText('recorded', locale);
            }
            const decision = action.decision;
            if (!decision || !confirmsDecision(receipt, decision))
              throw new Error('Unconfirmed solar document decision');
            if (editor) setDecisionRecorded(true);
            if (usesReason(decision)) documentForm.reset({ reason: '' });
            setPreview(null);
            refresh();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </div>
  );
}
