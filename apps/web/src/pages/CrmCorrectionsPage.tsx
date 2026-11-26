import { CommandFeedback } from '../components/CommandFeedback.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/crm';
import { tCrmForm } from '@barghsa/i18n/crm-forms';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { validateLegalNationalIdentifier, validateNationalId } from '@barghsa/shared/validation';
import {
  LoadingStatus,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  StatusBadge,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { VerificationEvidencePicker } from '../components/VerificationEvidencePicker.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { formatRelativeTime } from '../lib/relative-time.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { QueueEmptyState, statusAlternatives } from '../components/QueueEmptyState.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { crmCorrectionQueryOptions, crmCorrectionSearch } from '../lib/crm-correction-query.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import {
  uploadVerificationEvidence,
  isAllowedInvoiceReceiptFile,
} from '../lib/invoice-bank-receipt-upload.js';
type Status = 'Open' | 'Under Review' | 'Approved' | 'Rejected';
type ReviewDecision = Exclude<Status, 'Open'>;
const correctionRoute = '/admin/crm/corrections/$caseId/{-$section}';
function reviewChoices(status: Status): readonly ReviewDecision[] {
  if (status === 'Open') return ['Under Review', 'Rejected'];
  return status === 'Under Review' ? ['Approved', 'Rejected'] : [];
}
interface CorrectionAction extends TeamAction {
  expected: { profileId: string; status: Status; id?: string };
}
interface Case {
  assignedName?: string | null;
  id: string;
  profileId: string;
  fieldName: string;
  requestedValue: string;
  reason: string;
  status: Status;
  createdBy: string;
  createdAt?: string;
}
interface Detail extends Case {
  currentValue: string | null;
  evidenceUrls: string[];
  evidenceDownloadUrls?: string[];
  reviewerNotes: string | null;
  viewer?: { userId: string; canReview: boolean };
}
interface Queue {
  cases: Case[];
  total: number;
  viewer: { userId: string; canCreate: boolean; canReview: boolean };
}
const statuses = ['Open', 'Under Review', 'Approved', 'Rejected'];
const fieldsFor = (type: string | null) =>
  type === 'LEGAL'
    ? ['legal_name', 'national_identifier']
    : ['first_name', 'last_name', 'national_id'];
const caseBasis = (item: Case) =>
  JSON.stringify([
    item.id,
    item.profileId,
    item.fieldName,
    item.requestedValue,
    item.reason,
    item.status,
    item.createdBy,
  ]);
const detailBasis = (item: Detail) =>
  JSON.stringify([
    caseBasis(item),
    item.currentValue,
    item.evidenceUrls,
    !!item.evidenceUrls.length && item.evidenceDownloadUrls?.length === item.evidenceUrls.length,
    item.reviewerNotes,
    item.viewer,
  ]);
function validCase(item: Case) {
  return (
    !!item &&
    ['id', 'profileId', 'fieldName', 'requestedValue', 'reason', 'createdBy'].every(
      (key) => typeof item[key as keyof Case] === 'string'
    ) &&
    statuses.includes(item.status)
  );
}
function validQueue(value: Queue) {
  return (
    !!value &&
    Array.isArray(value.cases) &&
    value.cases.every(validCase) &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    !!value.viewer &&
    typeof value.viewer.userId === 'string' &&
    typeof value.viewer.canReview === 'boolean' &&
    typeof value.viewer.canCreate === 'boolean'
  );
}
interface CorrectionProfile {
  profile: { id: string; profileType: string; archived: boolean };
  viewerPermissions: { canEditIdentity: boolean };
}
const profileBasis = (data: CorrectionProfile) =>
  JSON.stringify([
    data.profile.id,
    data.profile.profileType,
    data.profile.archived,
    data.viewerPermissions.canEditIdentity,
  ]);
export function CrmCorrectionsRoutePage() {
  const search = useSearch({ from: '/admin/crm/corrections/' });
  const navigate = useNavigate({ from: '/admin/crm/corrections/' });
  const queries = useListQuery(crmCorrectionQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => crmCorrectionSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <CrmCorrectionsPage queries={queries} recordSearch={search} />;
}
export default function CrmCorrectionsPage({
  queries,
  caseId,
  recordSearch,
  expectedProfileId,
  newProfileId,
  reviewing = false,
}: {
  queries?: ListQueryBinding;
  caseId?: string;
  recordSearch?: Record<string, unknown>;
  expectedProfileId?: string;
  newProfileId?: string;
  reviewing?: boolean;
} = {}) {
  const { profileId, fieldName } = crmCorrectionSearch(useSearch({ strict: false }));
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <Corrections
      key={JSON.stringify([
        actor,
        revision,
        profileId,
        fieldName,
        caseId,
        expectedProfileId,
        newProfileId,
        reviewing,
      ])}
      profileId={caseId ? undefined : (newProfileId ?? profileId)}
      initialField={fieldName}
      {...(queries ? { queries } : {})}
      {...(caseId ? { caseId } : {})}
      {...(recordSearch ? { recordSearch } : {})}
      {...(expectedProfileId ? { expectedProfileId } : {})}
      creating={Boolean(newProfileId)}
      reviewing={reviewing}
    />
  );
}
function CorrectionNavigationGuard({ locked }: { locked: boolean }) {
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: () => locked });
  return null;
}
function Corrections({
  profileId,
  initialField,
  queries,
  caseId,
  recordSearch,
  expectedProfileId,
  creating,
  reviewing,
}: {
  profileId: string | undefined;
  initialField: string | undefined;
  queries?: ListQueryBinding;
  caseId?: string;
  recordSearch?: Record<string, unknown>;
  expectedProfileId?: string;
  creating: boolean;
  reviewing: boolean;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const read = useManualServerRead();
  const generation = useRef(0),
    workGeneration = useRef(0),
    uploading = useRef<AbortController | null>(null);
  const queueController = useRef<AbortController | null>(null);
  const [localStatus, setLocalStatus] = useState<Status>('Open'),
    [localOffset, setLocalOffset] = useState(0);
  const queryRef = useRef(queries);
  queryRef.current = queries;
  const status = queries ? (queries.query.filters.status as Status) : localStatus;
  const offset = queries ? (queries.query.page - 1) * 20 : localOffset;
  const setOffset = useCallback(
    (next: number | ((previous: number) => number), replace = false) => {
      if (queryRef.current) {
        const previous = (queryRef.current.query.page - 1) * 20;
        const value = typeof next === 'function' ? next(previous) : next;
        queryRef.current.setQuery({ page: Math.floor(value / 20) + 1 }, replace);
      } else setLocalOffset(next);
    },
    []
  );
  const criteria = JSON.stringify([profileId, status]);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    offset: number;
    data: Queue;
    readAttempt: number;
  } | null>(null);
  const [selected, setSelected] = useState<{ criteria: string; offset: number; item: Case } | null>(
    null
  );
  const [loading, setLoading] = useState(!caseId && !creating),
    [busy, setBusy] = useState(false);
  const [queueError, setQueueError] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [queueForbidden, setQueueForbidden] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const [field, setField] = useState('first_name'),
    [value, setValue] = useState(''),
    [reason, setReason] = useState('');
  const [valueBlurred, setValueBlurred] = useState(false);
  const [fileVersion, setFileVersion] = useState(0),
    [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState(''),
    [decision, setDecision] = useState<ReviewDecision>('Under Review');
  const [action, setAction] = useState<CorrectionAction | null>(null);
  const [creationRecovery, setCreationRecovery] = useState<{
    action: CorrectionAction;
    profileAttempt: number | null;
  } | null>(null);
  const [reviewRecovery, setReviewRecovery] = useState<{
    queueAttempt: number | null;
    detailAttempt: number | null;
  } | null>(null);
  const actionRef = useRef<CorrectionAction | null>(null),
    selectedRef = useRef(selected);
  actionRef.current = action;
  selectedRef.current = selected;
  const frozenBasis = useRef<string | null>(null);
  const completionFocus = useRef<'create' | 'review' | null>(null);
  const viewerRef = useRef<Queue['viewer'] | null>(null),
    profileRef = useRef<CorrectionProfile | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null),
    createButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldSelect = useRef<HTMLSelectElement>(null),
    statusSelect = useRef<HTMLSelectElement>(null);
  const clearReview = useCallback(() => {
    setSelected(null);
    selectedRef.current = null;
    setNotes('');
    setReviewRecovery(null);
    if (actionRef.current?.expected.id) {
      ++workGeneration.current;
      actionRef.current = null;
      setAction(null);
      frozenBasis.current = null;
    }
  }, []);
  const clearCreation = useCallback(() => {
    setValue('');
    setValueBlurred(false);
    setReason('');
    setFiles([]);
    setFileVersion((v) => v + 1);
    setCreationRecovery(null);
    setField(fieldsFor(profileRef.current?.profile.profileType ?? null)[0]!);
    if ((actionRef.current && !actionRef.current.expected.id) || uploading.current) {
      ++workGeneration.current;
      actionRef.current = null;
      setAction(null);
      frozenBasis.current = null;
      uploading.current?.abort();
      uploading.current = null;
      setBusy(false);
    }
  }, []);
  const clearAll = useCallback(() => {
    ++generation.current;
    ++workGeneration.current;
    queueController.current?.abort();
    clearReview();
    clearCreation();
    setAccepted(null);
    setCreatedCaseId(null);
    setSaved(false);
    setError(false);
    setLoading(false);
    completionFocus.current = null;
    profileRef.current = null;
    viewerRef.current = null;
  }, [clearReview, clearCreation]);
  const scope = useCatalogueScope(clearAll);
  const { live, version, denied, deny } = scope;
  const queue =
    !denied && !queueForbidden && accepted?.criteria === criteria ? accepted.data : null;
  const validateProfile = useCallback(
    (value: unknown): value is CorrectionProfile => {
      const data = value as CorrectionProfile | null;
      return (
        !!data &&
        data.profile?.id === profileId &&
        ['LEGAL', 'INDIVIDUAL'].includes(data.profile.profileType) &&
        typeof data.profile.archived === 'boolean' &&
        typeof data.viewerPermissions?.canEditIdentity === 'boolean'
      );
    },
    [profileId]
  );
  const profileRead = useCatalogueResource(
    scope,
    profileId && (creating || !recordSearch)
      ? `/api/crm/profiles/${encodeURIComponent(profileId)}`
      : null,
    validateProfile
  );
  const profileType = profileRead.data?.profile.profileType ?? null;
  const canCreate =
    profileRead.data?.viewerPermissions.canEditIdentity === true &&
    profileRead.data.profile.archived === false;
  const selectedItem =
    selected?.criteria === criteria && selected.offset === offset && !queueForbidden
      ? selected.item
      : null;
  const validateDetail = useCallback(
    (value: unknown): value is Detail => {
      const data = value as Detail | null;
      return (
        !!data &&
        validCase(data) &&
        (caseId
          ? data.id === caseId &&
            isInvoiceUuid(data.profileId) &&
            (!expectedProfileId || data.profileId === expectedProfileId) &&
            typeof data.viewer?.userId === 'string' &&
            (!accountId || data.viewer.userId === accountId) &&
            typeof data.viewer.canReview === 'boolean'
          : !!selectedItem &&
            data.id === selectedItem.id &&
            data.profileId === selectedItem.profileId &&
            data.fieldName === selectedItem.fieldName &&
            data.requestedValue === selectedItem.requestedValue &&
            data.createdBy === selectedItem.createdBy) &&
        (data.currentValue === null || typeof data.currentValue === 'string') &&
        (data.reviewerNotes === null || typeof data.reviewerNotes === 'string') &&
        Array.isArray(data.evidenceUrls) &&
        data.evidenceUrls.every((key) => typeof key === 'string') &&
        (data.evidenceDownloadUrls === undefined ||
          (Array.isArray(data.evidenceDownloadUrls) &&
            data.evidenceDownloadUrls.every((url) => typeof url === 'string')))
      );
    },
    [caseId, accountId, expectedProfileId, selectedItem]
  );
  const selectedCaseId = caseId ?? selectedItem?.id;
  const detailRead = useCatalogueResource(
    scope,
    selectedCaseId ? `/api/crm/verification-cases/${encodeURIComponent(selectedCaseId)}` : null,
    validateDetail
  );
  const detail = detailRead.data;
  const reviewer = caseId ? detail?.viewer : queue?.viewer;
  const load = useCallback(async () => {
    if (caseId || creating) return;
    const current = ++generation.current;
    queueController.current?.abort();
    const controller = new AbortController();
    queueController.current = controller;
    if (denied) return;
    const isCurrent = () =>
      current === generation.current && live.current === version && !controller.signal.aborted;
    setLoading(true);
    setQueueError(false);
    const params = new URLSearchParams({
      status,
      limit: '20',
      offset: String(offset),
      ...(profileId ? { profileId } : {}),
    });
    try {
      const endpoint = '/api/crm/verification-cases';
      const key = queryKeys.operations.queue(
        {
          context: 'staff',
          ownerId: profileId ?? accountId ?? 'staff-session',
          accountId,
          revision: profileRevision,
        },
        endpoint,
        params,
        version,
        current
      );
      const data = await read(key, controller.signal, async (signal) => {
        const response = await fetch(`${endpoint}?${params}`, { credentials: 'include', signal });
        if (response.status === 401 || response.status === 403) return response.status;
        if (!response.ok) throw new Error('Queue unavailable');
        const value = (await response.json()) as Queue;
        if (!validQueue(value)) throw new Error('Invalid queue');
        return value;
      });
      if (!isCurrent()) return;
      if (data === 401) {
        deny();
        return;
      }
      if (data === 403) {
        setQueueForbidden(true);
        setAccepted(null);
        clearReview();
        return;
      }
      if (viewerRef.current && viewerRef.current.userId !== data.viewer.userId) {
        clearReview();
        clearCreation();
        setSaved(false);
        profileRead.retry();
      } else if (viewerRef.current?.canReview && !data.viewer.canReview) clearReview();
      viewerRef.current = data.viewer;
      const target = selectedRef.current?.criteria === criteria ? selectedRef.current.item : null;
      if (target && selectedRef.current?.offset === offset) {
        const fresh = data.cases.find((item) => item.id === target.id);
        if (!fresh || caseBasis(fresh) !== caseBasis(target)) clearReview();
      }
      setQueueForbidden(false);
      if (offset > 0 && offset >= data.total) {
        setOffset(Math.max(0, Math.ceil(data.total / 20) - 1) * 20, true);
        return;
      }
      setAccepted({ criteria, offset, data, readAttempt: current });
    } catch {
      if (isCurrent()) setQueueError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [
    caseId,
    creating,
    profileId,
    status,
    offset,
    criteria,
    denied,
    live,
    version,
    deny,
    clearReview,
    clearCreation,
    profileRead.retry,
    read,
    accountId,
    profileRevision,
  ]);
  const queueRead = useRef(load);
  queueRead.current = load;
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      queueController.current?.abort();
    };
  }, [load]);
  useEffect(() => clearReview(), [criteria, offset, clearReview]);
  useEffect(
    () => () => {
      ++workGeneration.current;
      uploading.current?.abort();
    },
    []
  );
  useEffect(() => {
    const next = profileRead.data;
    if (!next) return;
    if (!profileRef.current || profileBasis(next) !== profileBasis(profileRef.current)) {
      clearCreation();
      const fields = fieldsFor(next.profile.profileType);
      setField(initialField && fields.includes(initialField) ? initialField : fields[0]!);
    }
    profileRef.current = next;
  }, [profileRead.data, initialField, clearCreation]);
  useEffect(() => {
    if (!detail) return;
    const choices = reviewChoices(detail.status);
    setDecision((current) => (choices.includes(current) ? current : (choices[0] ?? current)));
    if (actionRef.current?.expected.id && frozenBasis.current !== detailBasis(detail)) {
      ++workGeneration.current;
      setAction(null);
      actionRef.current = null;
      frozenBasis.current = null;
    }
  }, [detail]);
  useEffect(() => {
    if (action || !completionFocus.current) return;
    const target = completionFocus.current;
    const frame = requestAnimationFrame(() => {
      if (actionRef.current || completionFocus.current !== target) return;
      completionFocus.current = null;
      (target === 'review'
        ? (statusSelect.current ?? heading.current)
        : fieldSelect.current
      )?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [action]);
  function select(item: Case) {
    if (selectedItem?.id === item.id) detailRead.retry();
    clearReview();
    setError(false);
    setSelected({ criteria, offset, item });
    setDecision(item.status === 'Open' ? 'Under Review' : 'Approved');
  }
  function captured(next: CorrectionAction) {
    ++workGeneration.current;
    if (next.expected.id) setReviewRecovery(null);
    frozenBasis.current =
      next.expected.id && detail
        ? detailBasis(detail)
        : profileRead.data
          ? profileBasis(profileRead.data)
          : null;
    setSaved(false);
    const command: CorrectionAction = {
      ...next,
      responseDeadline: true,
      successStatus: next.expected.id ? 200 : 201,
      forbiddenMessage: t('crm.corrections.self', locale),
      conflictMessage: t('crm.profile.conflict', locale),
    };
    actionRef.current = command;
    setAction(command);
  }
  function refreshProfile() {
    const requested = profileRead.retry();
    setCreationRecovery((current) => current && { ...current, profileAttempt: requested });
  }
  const canRetryCreation =
    !creationRecovery ||
    (creationRecovery.profileAttempt !== null &&
      creationRecovery.profileAttempt === profileRead.readAttempt);
  const canRetryReview =
    !reviewRecovery ||
    ((caseId ||
      (reviewRecovery.queueAttempt !== null &&
        reviewRecovery.queueAttempt === accepted?.readAttempt)) &&
      reviewRecovery.detailAttempt !== null &&
      reviewRecovery.detailAttempt === detailRead.readAttempt);
  function changeQueueStatus(value: string) {
    if (busy || action || !canRetryReview) return;
    if (queries) queries.setQuery({ filters: { status: value } });
    else {
      setLocalStatus(value as Status);
      setLocalOffset(0);
    }
  }
  function refreshCorrection() {
    if (caseId) {
      const detailAttempt = detailRead.retry();
      setReviewRecovery((current) => current && { ...current, detailAttempt });
      return;
    }
    refreshProfile();
    const detailAttempt = selectedItem ? detailRead.retry() : null;
    const queueAttempt = generation.current + 1;
    setReviewRecovery((current) => current && { queueAttempt, detailAttempt });
    void load();
  }
  const invalidEvidence =
    files.length > 5 || files.some((file) => !isAllowedInvoiceReceiptFile(file));
  const isNationalId = field === 'national_id';
  const isCompanyIdentifier = field === 'national_identifier';
  const isIdentifier = isNationalId || isCompanyIdentifier;
  const requestedValue = isIdentifier ? normalizeProfileDigits(value.trim()) : value.trim();
  const invalidIdentifier = isNationalId
    ? !validateNationalId(requestedValue)
    : isCompanyIdentifier && !validateLegalNationalIdentifier(requestedValue);
  const valueError =
    valueBlurred && requestedValue && invalidIdentifier
      ? tSettingsForms(isNationalId ? 'nationalIdInvalid' : 'nationalIdentifierInvalid', locale)
      : undefined;
  const readyToUpload =
    !!requestedValue &&
    !invalidIdentifier &&
    !!reason.trim() &&
    files.length > 0 &&
    !invalidEvidence;
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      !profileId ||
      !canCreate ||
      profileRead.loading ||
      profileRead.error ||
      denied ||
      actionRef.current ||
      uploading.current
    )
      return;
    if (creationRecovery) {
      if (canRetryCreation) captured(creationRecovery.action);
      return;
    }
    if (!readyToUpload) return;
    const current = ++workGeneration.current;
    const transport = new AbortController();
    uploading.current = transport;
    setBusy(true);
    setError(false);
    try {
      const keys: string[] = [];
      for (const file of files) {
        const key = await uploadVerificationEvidence(file, profileId, transport.signal);
        if (!key) throw new Error();
        if (current !== workGeneration.current) return;
        keys.push(key);
      }
      uploading.current = null;
      setBusy(false);
      captured({
        title: t('crm.corrections.request', locale),
        description: `${profileId} · ${t(`crm.corrections.${field}`, locale)} · ${requestedValue} · ${reason.trim()}`,
        path: `/api/crm/profiles/${encodeURIComponent(profileId)}/verification-cases`,
        method: 'POST',
        expected: { profileId, status: 'Open' },
        body: {
          fieldName: field,
          requestedValue,
          reason: reason.trim(),
          evidenceUrls: keys,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    } catch {
      if (current === workGeneration.current) setError(true);
    } finally {
      if (current === workGeneration.current) {
        uploading.current = null;
        setBusy(false);
      }
    }
  }
  const evidence = (detail?.evidenceDownloadUrls ?? []).filter((url) => {
    try {
      return ['https:', 'http:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  });
  const hasEvidence =
    !!detail?.evidenceUrls.length && evidence.length === detail.evidenceUrls.length;
  const choices = detail ? reviewChoices(detail.status) : [];
  const canReview = Boolean(
    detail && reviewer?.canReview && reviewer.userId !== detail.createdBy && choices.length
  );
  const reviewBlocked =
    denied ||
    !canReview ||
    !choices.includes(decision) ||
    loading ||
    queueError ||
    detailRead.loading ||
    detailRead.error ||
    !canRetryReview ||
    busy ||
    !!action ||
    (decision === 'Rejected' && !notes.trim()) ||
    (decision === 'Approved' && !hasEvidence);
  function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!detail || reviewBlocked || actionRef.current) return;
    const reviewerNotes = notes.trim();
    captured({
      title: t(`crm.corrections.${decision}`, locale),
      description: `${detail.id} · ${detail.requestedValue}${reviewerNotes ? ` · ${reviewerNotes}` : ''}`,
      path: `/api/crm/verification-cases/${detail.id}/status`,
      method: 'PUT',
      expected: { id: detail.id, profileId: detail.profileId, status: decision },
      body: { decision, ...(reviewerNotes ? { reviewerNotes } : {}) },
    });
  }
  const actionGeneration = workGeneration.current;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (caseId || creating) heading.current?.focus({ preventScroll: true });
  }, [caseId, creating]);
  return (
    <section
      data-testid="crm-corrections-workspace"
      className={caseId || creating ? 'mx-auto max-w-3xl space-y-3' : 'mx-auto max-w-5xl space-y-5'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {(caseId || creating) && (
        <CorrectionNavigationGuard
          locked={busy || !!action || !!reviewRecovery || !!creationRecovery}
        />
      )}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {caseId ? (
            <Link
              to="/admin/crm/corrections"
              search={recordSearch ?? {}}
              className="touch-action text-sm text-primary underline underline-offset-4"
            >
              {t('crm.corrections.backToQueue', locale)}
            </Link>
          ) : creating && profileId ? (
            <Link
              to="/admin/crm/profiles/$profileId"
              params={{ profileId }}
              className="touch-action text-sm text-primary underline underline-offset-4"
            >
              {t('crm.corrections.backToProfile', locale)}
            </Link>
          ) : (
            <Link
              to="/admin/crm/recovery"
              className="touch-action text-sm text-primary underline underline-offset-4"
            >
              {t('crm.corrections.recovery', locale)}
            </Link>
          )}
          <h1
            ref={heading}
            tabIndex={caseId || creating ? -1 : undefined}
            className={
              caseId || creating ? 'text-xl font-semibold outline-none' : 'text-2xl font-semibold'
            }
          >
            {caseId && !reviewing
              ? tCrmForm('crm.corrections.caseDetails', locale)
              : t(
                  caseId
                    ? 'crm.corrections.details'
                    : creating
                      ? 'crm.corrections.request'
                      : 'crm.corrections.title',
                  locale
                )}
          </h1>
          {!caseId && !creating && (
            <p className="text-sm text-muted-foreground">
              {t('crm.corrections.description', locale)}
            </p>
          )}
        </div>
        {(creating || caseId) && !denied && (
          <div className="flex flex-wrap items-center gap-2">
            {caseId && reviewing && detail && (
              <Link
                to={correctionRoute}
                params={{ caseId, section: undefined }}
                search={recordSearch ?? {}}
                state={{ crmCorrectionProfileId: detail.profileId }}
                className={buttonVariants({ variant: 'ghost' })}
                disabled={busy || !!action || !!reviewRecovery}
              >
                {tCrmForm('crm.corrections.caseDetails', locale)}
              </Link>
            )}
            <ListRefreshButton
              label={t('crm.list.refresh', locale)}
              refreshing={caseId ? detailRead.loading : profileRead.loading}
              disabled={busy || !!action}
              onClick={caseId ? refreshCorrection : refreshProfile}
            />
          </div>
        )}
      </header>
      {recordSearch && profileId && !creating && (
        <Link
          to="/admin/crm/profiles/$profileId/corrections/new"
          params={{ profileId }}
          className={buttonVariants({ className: 'min-h-11' })}
        >
          {t('crm.corrections.request', locale)}
        </Link>
      )}
      {creating && profileRead.data && !canCreate && (
        <p role="alert">{t('crm.profile.error.accessDenied', locale)}</p>
      )}
      {!profileId && !caseId && (
        <p>
          <a className="text-foreground underline" href="/admin/crm">
            {t('crm.corrections.chooseProfile', locale)}
          </a>
        </p>
      )}
      {denied && <p role="alert">{t('crm.profile.error.accessDenied', locale)}</p>}
      {!denied && (
        <>
          {profileRead.error && (
            <div role="alert">
              <p>{t('crm.profile.error.generic', locale)}</p>
              <Button onClick={refreshProfile}>{t('crm.corrections.profileRetry', locale)}</Button>
            </div>
          )}
          {profileId && profileRead.loading && (
            <LoadingStatus>{t('crm.profile.loading', locale)}</LoadingStatus>
          )}
          {profileId && profileType && canCreate && (
            <form onSubmit={(event) => void create(event)} className={recordEditorSurface}>
              <fieldset disabled={busy || !!action || !!creationRecovery}>
                <RecordEditorSection title={tCrmForm('crm.corrections.changeDetails', locale)}>
                  <div className={recordEditorGrid}>
                    <div className={recordEditorField}>
                      <Label htmlFor="correction-field">{t('crm.corrections.field', locale)}</Label>
                      <NativeSelect
                        ref={fieldSelect}
                        id="correction-field"
                        aria-required="true"
                        value={field}
                        onChange={(event) => {
                          setField(event.target.value);
                          setValue('');
                          setValueBlurred(false);
                        }}
                        className="w-full"
                      >
                        {fieldsFor(profileType).map((key) => (
                          <option key={key} value={key}>
                            {t(`crm.corrections.${key}`, locale)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className={recordEditorField}>
                      <Label htmlFor="correction-value">
                        {t(`crm.corrections.${field}`, locale)}
                      </Label>
                      <Input
                        id="correction-value"
                        required
                        aria-required="true"
                        maxLength={512}
                        inputMode={isIdentifier ? 'numeric' : undefined}
                        dir={isIdentifier ? 'ltr' : 'auto'}
                        className={isIdentifier ? 'max-w-56' : undefined}
                        aria-invalid={valueError ? true : undefined}
                        aria-describedby={isIdentifier ? 'correction-value-help' : undefined}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onBlur={() => setValueBlurred(true)}
                      />
                      {isIdentifier && (
                        <div id="correction-value-help">
                          <p className="text-sm text-muted-foreground">
                            {tSettingsForms(
                              isNationalId ? 'nationalIdHelp' : 'nationalIdentifierHelp',
                              locale
                            )}
                          </p>
                          <p aria-live="polite" className="text-sm text-destructive">
                            {valueError}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={recordEditorField}>
                    <Label htmlFor="correction-reason">{t('crm.corrections.reason', locale)}</Label>
                    <Textarea
                      id="correction-reason"
                      required
                      aria-required="true"
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={2}
                      placeholder={tCrmForm('crm.corrections.reasonExample', locale)}
                      className="min-h-14 resize-y"
                    />
                  </div>
                </RecordEditorSection>
                <RecordEditorSection title={tCrmForm('crm.corrections.attachments', locale)}>
                  <VerificationEvidencePicker
                    key={fileVersion}
                    id="correction-files"
                    pickerId="correction-file-picker"
                    locale={locale}
                    inputRef={fileInput}
                    accept="application/pdf,image/jpeg,image/png"
                    instructions={t('crm.corrections.files', locale)}
                    chooseLabel={t('crm.corrections.chooseFiles', locale)}
                    emptyLabel={t('crm.corrections.noFiles', locale)}
                    files={files}
                    error={invalidEvidence ? t('crm.corrections.invalidFiles', locale) : undefined}
                    onChange={(files) => {
                      setFiles(files);
                      setError(false);
                    }}
                  />
                </RecordEditorSection>
                <RecordEditorActions>
                  <Button
                    ref={createButton}
                    type="submit"
                    disabled={profileRead.loading || profileRead.error || !readyToUpload}
                  >
                    {t(busy ? 'crm.corrections.uploading' : 'crm.corrections.upload', locale)}
                  </Button>
                </RecordEditorActions>
              </fieldset>
              {creationRecovery && !action && (
                <div className="space-y-2 px-4 py-3 sm:px-6">
                  <p role="alert">{confirmationText('unconfirmed', locale)}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={profileRead.loading}
                    onClick={refreshProfile}
                  >
                    {t('crm.corrections.profileRetry', locale)}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canRetryCreation || profileRead.loading || profileRead.error}
                  >
                    {t('crm.corrections.request', locale)}
                  </Button>
                </div>
              )}
            </form>
          )}
          {!creating && !caseId && (
            <div className="flex flex-wrap items-center gap-3">
              {!queueForbidden && (
                <>
                  <Label htmlFor="case-status">{t('crm.corrections.status', locale)}</Label>
                  <NativeSelect
                    ref={statusSelect}
                    id="case-status"
                    disabled={busy || !!action || !canRetryReview}
                    value={status}
                    onChange={(event) => changeQueueStatus(event.target.value)}
                    className="max-w-full rounded-lg bg-background text-foreground"
                  >
                    {(['Open', 'Under Review', 'Approved', 'Rejected'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`crm.corrections.${value}`, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                </>
              )}
              <Button
                variant="outline"
                disabled={
                  loading || busy || Boolean(recordSearch && (action || detailRead.loading))
                }
                onClick={refreshCorrection}
              >
                {t('crm.list.refresh', locale)}
              </Button>
            </div>
          )}
          <CommandFeedback message={saved ? t('crm.corrections.saved', locale) : null} />
          {createdCaseId && profileId && (
            <Link
              to={correctionRoute}
              params={{ caseId: createdCaseId, section: undefined }}
              search={{ profileId }}
              state={{ crmCorrectionProfileId: profileId }}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('crm.corrections.details', locale)}
            </Link>
          )}
          {reviewRecovery && <p role="alert">{confirmationText('unconfirmed', locale)}</p>}
          {error && <p role="alert">{t('crm.corrections.error', locale)}</p>}
          {!caseId &&
            !creating &&
            (queueForbidden ? (
              <p>{t('crm.corrections.queueForbidden', locale)}</p>
            ) : (
              <ListPage>
                <ListPage.Content
                  loading={loading}
                  error={queueError}
                  empty={!queue?.cases.length}
                  retainContent={!!queue?.cases.length}
                  loadingView={
                    <RecordListSkeleton
                      label={t('crm.list.loading', locale)}
                      view="card"
                      headings={[]}
                    />
                  }
                  emptyView={
                    offset === 0 ? (
                      <QueueEmptyState
                        locale={locale}
                        message={t('crm.corrections.empty', locale)}
                        status={t(`crm.corrections.${status}`, locale)}
                        alternatives={statusAlternatives(
                          statuses,
                          status,
                          (value) => t(`crm.corrections.${value}`, locale),
                          '/api/crm/verification-cases',
                          profileId ? { profileId } : {}
                        )}
                        hasResults={(body, value) =>
                          validQueue(body as Queue) &&
                          (body as Queue).cases.some(
                            (item) =>
                              item.status === value && (!profileId || item.profileId === profileId)
                          )
                        }
                        select={changeQueueStatus}
                        disabled={busy || !!action || !canRetryReview}
                      />
                    ) : (
                      <p>{t('crm.corrections.empty', locale)}</p>
                    )
                  }
                  errorView={
                    <div role="alert">
                      <p>{t('crm.corrections.error', locale)}</p>
                      <Button onClick={() => void load()}>
                        {t('crm.corrections.queueRetry', locale)}
                      </Button>
                    </div>
                  }
                >
                  {!!queue?.cases.length && (
                    <ul className="space-y-3">
                      {queue.cases.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 text-card-foreground"
                        >
                          <div className="grid min-w-0 gap-1 break-words">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">
                                {t(`crm.corrections.${item.fieldName}`, locale)}
                              </span>
                              <StatusBadge
                                state={item.status}
                                label={t(`crm.corrections.${item.status}`, locale)}
                              />
                            </div>
                            <p className="text-sm">
                              <bdi>{item.requestedValue}</bdi>
                            </p>
                            {recordSearch && (
                              <span className="text-sm text-muted-foreground">
                                {item.assignedName ?? t('tickets.unassigned', locale)}
                                {item.createdAt && (
                                  <>
                                    {' '}
                                    ·{' '}
                                    {formatRelativeTime(item.createdAt, locale) ||
                                      time.format(item.createdAt)}
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                          {recordSearch &&
                          !queueError &&
                          !loading &&
                          accepted?.offset === offset ? (
                            <Link
                              to={correctionRoute}
                              params={{
                                caseId: item.id,
                                section:
                                  queue.viewer.canReview &&
                                  queue.viewer.userId !== item.createdBy &&
                                  reviewChoices(item.status).length
                                    ? 'review'
                                    : undefined,
                              }}
                              search={recordSearch}
                              state={{ crmCorrectionProfileId: item.profileId }}
                              className={buttonVariants({
                                variant: 'outline',
                                className: 'min-h-11',
                              })}
                            >
                              {t('crm.corrections.details', locale)}
                            </Link>
                          ) : (
                            <Button
                              variant="outline"
                              disabled={
                                !!action ||
                                busy ||
                                loading ||
                                queueError ||
                                !canRetryReview ||
                                accepted?.offset !== offset
                              }
                              onClick={() => select(item)}
                            >
                              {t('crm.corrections.details', locale)}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </ListPage.Content>
              </ListPage>
            ))}
          {queue && (
            <nav className="flex gap-2" aria-label={t('crm.corrections.title', locale)}>
              <Button
                variant="outline"
                disabled={loading || busy || !!action || !canRetryReview || offset === 0}
                onClick={() => setOffset((previous) => Math.max(0, previous - 20))}
              >
                {t('crm.list.previous', locale)}
              </Button>
              <Button
                variant="outline"
                disabled={
                  loading ||
                  queueError ||
                  busy ||
                  !!action ||
                  !canRetryReview ||
                  !queue ||
                  offset + 20 >= queue.total
                }
                onClick={() => setOffset((previous) => previous + 20)}
              >
                {t('crm.list.next', locale)}
              </Button>
            </nav>
          )}
          {detailRead.loading && <RecordDetailSkeleton label={t('crm.list.loading', locale)} />}
          {detailRead.error && (
            <div role="alert">
              <p>{t('crm.corrections.error', locale)}</p>
              <Button onClick={caseId ? refreshCorrection : detailRead.retry}>
                {t('crm.corrections.detailRetry', locale)}
              </Button>
            </div>
          )}
          {detail && (
            <article className="space-y-4 rounded-xl border bg-card text-card-foreground p-4 break-words sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {t(`crm.corrections.${detail.fieldName}`, locale)}
                </h2>
                {caseId && (
                  <StatusBadge
                    state={detail.status}
                    label={t(`crm.corrections.${detail.status}`, locale)}
                  />
                )}
              </div>
              {caseId && (
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 sm:p-4">
                  <div className="min-w-0">
                    <dt className="text-sm text-muted-foreground">
                      {t('crm.corrections.currentValue', locale)}
                    </dt>
                    <dd className="mt-1 wrap-anywhere">
                      <bdi>{detail.currentValue ?? '—'}</bdi>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm text-muted-foreground">
                      {t('crm.corrections.newValue', locale)}
                    </dt>
                    <dd className="mt-1 wrap-anywhere font-semibold">
                      <bdi>{detail.requestedValue}</bdi>
                    </dd>
                  </div>
                </dl>
              )}
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {[
                  ...(!reviewing
                    ? [
                        ['profile', detail.profileId],
                        ['creator', detail.createdBy],
                        ['assignee', detail.assignedName ?? t('tickets.unassigned', locale)],
                      ]
                    : []),
                  ...(!caseId
                    ? [
                        ['currentValue', detail.currentValue ?? '—'],
                        ['newValue', detail.requestedValue],
                        ['status', t(`crm.corrections.${detail.status}`, locale)],
                      ]
                    : []),
                  ...(caseId && !reviewing && detail.createdAt
                    ? [['createdAt', time.format(detail.createdAt)]]
                    : []),
                  ['reason', detail.reason],
                ].map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm text-muted-foreground">
                      {t(`crm.corrections.${key}`, locale)}
                    </dt>
                    <dd className="whitespace-pre-wrap">
                      {caseId && key === 'profile' ? (
                        <Link
                          to="/admin/crm/profiles/$profileId"
                          params={{ profileId: detail.profileId }}
                          className="touch-action break-all text-primary underline underline-offset-4"
                        >
                          <bdi>{value}</bdi>
                        </Link>
                      ) : (
                        <bdi>{value}</bdi>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {evidence.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {evidence.map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      {t('crm.corrections.evidence', locale)} {index + 1}
                    </a>
                  ))}
                </div>
              )}
              {!hasEvidence && <p role="status">{t('crm.corrections.legacy', locale)}</p>}
              {detail.reviewerNotes && <p>{detail.reviewerNotes}</p>}
              {reviewer?.userId === detail.createdBy && <p>{t('crm.corrections.self', locale)}</p>}
              {reviewing && !canReview && reviewer?.userId !== detail.createdBy && (
                <p role="status">{tCrmForm('crm.corrections.reviewUnavailable', locale)}</p>
              )}
              {caseId && !reviewing && canReview && (
                <Link
                  to={correctionRoute}
                  params={{ caseId, section: 'review' }}
                  search={recordSearch ?? {}}
                  state={{ crmCorrectionProfileId: detail.profileId }}
                  className={buttonVariants()}
                  disabled={detailRead.loading || detailRead.error}
                >
                  {t('crm.corrections.details', locale)}
                </Link>
              )}
            </article>
          )}
          {canReview && (reviewing || !caseId) && (
            <form
              className={recordEditorSurface}
              aria-labelledby="case-review-heading"
              onSubmit={submitReview}
            >
              <RecordEditorSection
                anchorId="case-review-heading"
                title={tCrmForm('crm.corrections.decision', locale)}
              >
                <fieldset id="case-decision" disabled={busy || !!action}>
                  <legend className="sr-only">
                    {tCrmForm('crm.corrections.decision', locale)}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {choices.map((value) => (
                      <label
                        key={value}
                        className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted/35 has-checked:border-primary has-checked:bg-primary/5"
                      >
                        <input
                          type="radio"
                          name="case-decision"
                          value={value}
                          checked={decision === value}
                          onChange={() => setDecision(value)}
                          tabIndex={decision === value ? 0 : -1}
                          required
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span>
                          <span className="block font-medium">
                            {tCrmForm(`crm.corrections.decision.${value}`, locale)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {tCrmForm(`crm.corrections.decisionHelp.${value}`, locale)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className={recordEditorField}>
                  <Label htmlFor="case-notes">
                    {tCrmForm(
                      decision === 'Rejected'
                        ? 'crm.corrections.rejectionNote'
                        : 'crm.corrections.optionalNote',
                      locale
                    )}
                  </Label>
                  <Textarea
                    disabled={busy || !!action}
                    id="case-notes"
                    aria-required={decision === 'Rejected' || undefined}
                    required={decision === 'Rejected'}
                    maxLength={1000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={2}
                    placeholder={tCrmForm(
                      decision === 'Rejected'
                        ? 'crm.corrections.rejectionExample'
                        : 'crm.corrections.noteExample',
                      locale
                    )}
                    dir="auto"
                    className="min-h-14 resize-y"
                  />
                </div>
              </RecordEditorSection>
              <RecordEditorActions>
                <Button type="submit" ref={reviewButton} disabled={reviewBlocked}>
                  {t('crm.corrections.save', locale)}
                </Button>
              </RecordEditorActions>
            </form>
          )}
        </>
      )}
      {denied && (
        <Button variant="outline" onClick={scope.recover}>
          {t('crm.list.refresh', locale)}
        </Button>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          toastErrors={!reviewing}
          key={workGeneration.current}
          confirmationDisabled={
            denied ||
            (action.expected.id
              ? loading ||
                queueError ||
                queueForbidden ||
                !detail ||
                detailRead.loading ||
                detailRead.error ||
                !reviewer?.canReview ||
                reviewer.userId === detail.createdBy ||
                (action.expected.status === 'Approved' && !hasEvidence)
              : !canCreate || profileRead.loading || profileRead.error || !canRetryCreation)
          }
          summary={
            <div className="space-y-2">
              {action.expected.id ? (
                <>
                  {!caseId && (
                    <Button variant="outline" disabled={loading} onClick={() => void load()}>
                      {t('crm.corrections.queueRetry', locale)}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={detailRead.loading}
                    onClick={detailRead.retry}
                  >
                    {t('crm.corrections.detailRetry', locale)}
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={profileRead.loading} onClick={refreshProfile}>
                  {t('crm.corrections.profileRetry', locale)}
                </Button>
              )}
            </div>
          }
          finalFocus={() =>
            action.expected.id
              ? (reviewButton.current ?? statusSelect.current ?? heading.current)
              : createButton.current?.disabled
                ? fieldSelect.current
                : createButton.current
          }
          onClose={() => {
            if (actionGeneration !== workGeneration.current) return;
            ++workGeneration.current;
            actionRef.current = null;
            setAction(null);
            frozenBasis.current = null;
          }}
          {...(caseId || creating ? { onDenied: deny } : {})}
          onUnconfirmed={() => {
            if (actionGeneration !== workGeneration.current || actionRef.current !== action) return;
            setSaved(false);
            if (action.expected.id) {
              setReviewRecovery({ queueAttempt: null, detailAttempt: null });
              ++workGeneration.current;
              actionRef.current = null;
              setAction(null);
              frozenBasis.current = null;
            } else {
              setCreationRecovery({ action, profileAttempt: null });
            }
          }}
          onSuccess={((current) => async (value) => {
            if (current !== workGeneration.current) return;
            const result = value as {
              success?: unknown;
              id?: unknown;
              profileId?: unknown;
              status?: unknown;
            } | null;
            if (
              !result ||
              result.success !== true ||
              result.profileId !== action.expected.profileId ||
              result.status !== action.expected.status ||
              typeof result.id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                result.id
              ) ||
              (action.expected.id !== undefined && result.id !== action.expected.id)
            )
              throw new Error('Invalid correction acknowledgement');
            completionFocus.current = action.expected.id ? 'review' : 'create';
            if (action.expected.id) clearReview();
            else {
              clearCreation();
              if (creating) setCreatedCaseId(result.id);
            }
            setSaved(true);
            if (caseId) detailRead.retry();
            else await queueRead.current();
          })(workGeneration.current)}
        />
      )}
    </section>
  );
}
