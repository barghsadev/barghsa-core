import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/crm';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { crmCorrectionQueryOptions, crmCorrectionSearch } from '../lib/crm-correction-query.js';
import {
  uploadVerificationEvidence,
  isAllowedInvoiceReceiptFile,
} from '../lib/invoice-bank-receipt-upload.js';
type Status = 'Open' | 'Under Review' | 'Approved' | 'Rejected';
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
}
interface Detail extends Case {
  currentValue: string | null;
  evidenceUrls: string[];
  evidenceDownloadUrls?: string[];
  reviewerNotes: string | null;
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
  const search = useSearch({ from: '/admin/crm/corrections' });
  const navigate = useNavigate({ from: '/admin/crm/corrections' });
  const queries = useListQuery(crmCorrectionQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => crmCorrectionSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <CrmCorrectionsPage queries={queries} />;
}
export default function CrmCorrectionsPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const { profileId, fieldName } = useSearch({ from: '/admin/crm/corrections' });
  return (
    <Corrections
      key={(profileId ?? 'queue') + ':' + (fieldName ?? '')}
      profileId={profileId}
      initialField={fieldName}
      {...(queries ? { queries } : {})}
    />
  );
}
function Corrections({
  profileId,
  initialField,
  queries,
}: {
  profileId: string | undefined;
  initialField: string | undefined;
  queries?: ListQueryBinding;
}) {
  const locale = useLocale();
  const generation = useRef(0),
    workGeneration = useRef(0),
    uploading = useRef(false);
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
  } | null>(null);
  const [selected, setSelected] = useState<{ criteria: string; offset: number; item: Case } | null>(
    null
  );
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [queueError, setQueueError] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [queueForbidden, setQueueForbidden] = useState(false);
  const [field, setField] = useState('first_name'),
    [value, setValue] = useState(''),
    [reason, setReason] = useState('');
  const [fileVersion, setFileVersion] = useState(0),
    [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState(''),
    [decision, setDecision] = useState<Status>('Under Review');
  const [action, setAction] = useState<CorrectionAction | null>(null);
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
    if (actionRef.current?.expected.id) {
      ++workGeneration.current;
      actionRef.current = null;
      setAction(null);
      frozenBasis.current = null;
    }
  }, []);
  const clearCreation = useCallback(() => {
    setValue('');
    setReason('');
    setFiles([]);
    setFileVersion((v) => v + 1);
    setField(fieldsFor(profileRef.current?.profile.profileType ?? null)[0]!);
    if ((actionRef.current && !actionRef.current.expected.id) || uploading.current) {
      ++workGeneration.current;
      actionRef.current = null;
      setAction(null);
      frozenBasis.current = null;
      uploading.current = false;
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
    profileId ? `/api/crm/profiles/${encodeURIComponent(profileId)}` : null,
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
        !!selectedItem &&
        validCase(data) &&
        data.id === selectedItem.id &&
        data.profileId === selectedItem.profileId &&
        data.fieldName === selectedItem.fieldName &&
        data.requestedValue === selectedItem.requestedValue &&
        data.createdBy === selectedItem.createdBy &&
        (data.currentValue === null || typeof data.currentValue === 'string') &&
        (data.reviewerNotes === null || typeof data.reviewerNotes === 'string') &&
        Array.isArray(data.evidenceUrls) &&
        data.evidenceUrls.every((key) => typeof key === 'string') &&
        (data.evidenceDownloadUrls === undefined ||
          (Array.isArray(data.evidenceDownloadUrls) &&
            data.evidenceDownloadUrls.every((url) => typeof url === 'string')))
      );
    },
    [selectedItem]
  );
  const detailRead = useCatalogueResource(
    scope,
    selectedItem ? `/api/crm/verification-cases/${selectedItem.id}` : null,
    validateDetail
  );
  const detail = detailRead.data;
  const load = useCallback(async () => {
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
      const response = await fetch(`/api/crm/verification-cases?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (response.status === 401) {
        deny();
        return;
      }
      if (response.status === 403) {
        setQueueForbidden(true);
        setAccepted(null);
        clearReview();
        return;
      }
      if (!response.ok) throw new Error('Queue unavailable');
      const data = (await response.json()) as Queue;
      if (!isCurrent()) return;
      if (!validQueue(data)) throw new Error('Invalid queue');
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
      setAccepted({ criteria, offset, data });
    } catch {
      if (isCurrent()) setQueueError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [
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
    setDecision((current) =>
      (detail.status === 'Open' ? ['Under Review', 'Rejected'] : ['Approved', 'Rejected']).includes(
        current
      )
        ? current
        : detail.status === 'Open'
          ? 'Under Review'
          : 'Approved'
    );
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
      (target === 'review' ? statusSelect.current : fieldSelect.current)?.focus();
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
    frozenBasis.current =
      next.expected.id && detail
        ? detailBasis(detail)
        : profileRead.data
          ? profileBasis(profileRead.data)
          : null;
    setSaved(false);
    const command = {
      ...next,
      forbiddenMessage: t('crm.corrections.self', locale),
      conflictMessage: t('crm.profile.conflict', locale),
    };
    actionRef.current = command;
    setAction(command);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      !profileId ||
      !canCreate ||
      profileRead.loading ||
      profileRead.error ||
      denied ||
      !files.length ||
      files.length > 5 ||
      files.some((file) => !isAllowedInvoiceReceiptFile(file)) ||
      uploading.current
    )
      return;
    const current = ++workGeneration.current;
    uploading.current = true;
    setBusy(true);
    setError(false);
    try {
      const keys: string[] = [];
      for (const file of files) {
        const key = await uploadVerificationEvidence(file, profileId);
        if (!key) throw new Error();
        if (current !== workGeneration.current) return;
        keys.push(key);
      }
      uploading.current = false;
      setBusy(false);
      captured({
        title: t('crm.corrections.request', locale),
        description: `${profileId} · ${t(`crm.corrections.${field}`, locale)} · ${value.trim()} · ${reason.trim()}`,
        path: `/api/crm/profiles/${encodeURIComponent(profileId)}/verification-cases`,
        method: 'POST',
        expected: { profileId, status: 'Open' },
        body: {
          fieldName: field,
          requestedValue: value.trim(),
          reason: reason.trim(),
          evidenceUrls: keys,
        },
      });
    } catch {
      if (current === workGeneration.current) setError(true);
    } finally {
      if (current === workGeneration.current) {
        uploading.current = false;
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
  const actionGeneration = workGeneration.current;
  return (
    <section className="space-y-5 max-w-5xl mx-auto" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{t('crm.corrections.title', locale)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('crm.corrections.description', locale)}
        </p>
      </header>
      {!profileId && (
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
              <Button onClick={profileRead.retry}>
                {t('crm.corrections.profileRetry', locale)}
              </Button>
            </div>
          )}
          {profileId && profileRead.loading && (
            <p role="status">{t('crm.profile.loading', locale)}</p>
          )}
          {profileId && profileType && canCreate && (
            <form
              onSubmit={(event) => void create(event)}
              className="space-y-3 rounded border bg-card text-card-foreground p-4"
            >
              <h2 className="font-semibold">{t('crm.corrections.request', locale)}</h2>
              <fieldset disabled={busy || !!action} className="space-y-3">
                <div>
                  <Label htmlFor="correction-field">{t('crm.corrections.field', locale)}</Label>
                  <select
                    ref={fieldSelect}
                    id="correction-field"
                    value={field}
                    onChange={(event) => setField(event.target.value)}
                    className="block rounded border bg-background text-foreground p-2"
                  >
                    {(profileType === 'LEGAL'
                      ? ['legal_name', 'national_identifier']
                      : ['first_name', 'last_name', 'national_id']
                    ).map((key) => (
                      <option key={key} value={key}>
                        {t(`crm.corrections.${key}`, locale)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="correction-value">{t('crm.corrections.newValue', locale)}</Label>
                  <Input
                    id="correction-value"
                    required
                    maxLength={512}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="correction-reason">{t('crm.corrections.reason', locale)}</Label>
                  <textarea
                    id="correction-reason"
                    required
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="block w-full rounded border bg-background text-foreground p-2"
                  />
                </div>
                <div>
                  <Label htmlFor="correction-file-picker">
                    {t('crm.corrections.files', locale)}
                  </Label>
                  <Input
                    key={fileVersion}
                    ref={fileInput}
                    hidden
                    id="correction-files"
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(event) => {
                      const next = Array.from(event.target.files ?? []);
                      setFiles(next);
                      setError(
                        next.length > 5 || next.some((file) => !isAllowedInvoiceReceiptFile(file))
                      );
                    }}
                  />
                  <Button
                    id="correction-file-picker"
                    type="button"
                    variant="outline"
                    onClick={() => fileInput.current?.click()}
                    aria-describedby="correction-files-selected"
                  >
                    {t('crm.corrections.chooseFiles', locale)}
                  </Button>
                  <p
                    id="correction-files-selected"
                    className="mt-2 break-all text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {files.length
                      ? files.map((file, index) => (
                          <span key={index}>
                            {index > 0 && ' · '}
                            <bdi>{file.name}</bdi>
                          </span>
                        ))
                      : t('crm.corrections.noFiles', locale)}
                  </p>
                </div>
                <Button
                  ref={createButton}
                  type="submit"
                  disabled={
                    profileRead.loading ||
                    profileRead.error ||
                    !value.trim() ||
                    !reason.trim() ||
                    !files.length ||
                    files.length > 5 ||
                    files.some((file) => !isAllowedInvoiceReceiptFile(file))
                  }
                >
                  {t(busy ? 'crm.corrections.uploading' : 'crm.corrections.upload', locale)}
                </Button>
              </fieldset>
            </form>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!queueForbidden && (
              <>
                <Label htmlFor="case-status">{t('crm.corrections.status', locale)}</Label>
                <select
                  ref={statusSelect}
                  id="case-status"
                  disabled={busy || !!action}
                  value={status}
                  onChange={(event) => {
                    if (queries) queries.setQuery({ filters: { status: event.target.value } });
                    else {
                      setLocalStatus(event.target.value as Status);
                      setLocalOffset(0);
                    }
                  }}
                  className="rounded border bg-background text-foreground p-2"
                >
                  {(['Open', 'Under Review', 'Approved', 'Rejected'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`crm.corrections.${value}`, locale)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={() => {
                profileRead.retry();
                if (selectedItem) detailRead.retry();
                void load();
              }}
            >
              {t('crm.list.refresh', locale)}
            </Button>
          </div>
          {saved && <p role="status">{t('crm.corrections.saved', locale)}</p>}
          {error && <p role="alert">{t('crm.corrections.error', locale)}</p>}
          {queueForbidden ? (
            <p>{t('crm.corrections.queueForbidden', locale)}</p>
          ) : (
            <ListPage>
              <ListPage.Content
                loading={loading}
                error={queueError}
                empty={!queue?.cases.length}
                retainContent={!!queue?.cases.length}
                loadingView={<p role="status">{t('crm.list.loading', locale)}</p>}
                emptyView={<p>{t('crm.corrections.empty', locale)}</p>}
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
                  <ul className="space-y-2">
                    {queue.cases.map((item) => (
                      <li
                        key={item.id}
                        className="rounded border bg-card text-card-foreground p-3 flex flex-wrap items-center justify-between gap-3"
                      >
                        <span className="min-w-0 break-words">
                          {t(`crm.corrections.${item.fieldName}`, locale)} ·{' '}
                          <bdi>{item.requestedValue}</bdi>
                        </span>
                        <Button
                          variant="outline"
                          disabled={
                            !!action || busy || loading || queueError || accepted?.offset !== offset
                          }
                          onClick={() => select(item)}
                        >
                          {t('crm.corrections.details', locale)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </ListPage.Content>
            </ListPage>
          )}
          {queue && (
            <nav className="flex gap-2" aria-label={t('crm.corrections.title', locale)}>
              <Button
                variant="outline"
                disabled={loading || busy || !!action || offset === 0}
                onClick={() => setOffset((previous) => Math.max(0, previous - 20))}
              >
                {t('crm.list.previous', locale)}
              </Button>
              <Button
                variant="outline"
                disabled={
                  loading || queueError || busy || !!action || !queue || offset + 20 >= queue.total
                }
                onClick={() => setOffset((previous) => previous + 20)}
              >
                {t('crm.list.next', locale)}
              </Button>
            </nav>
          )}
          {detailRead.loading && <p role="status">{t('crm.list.loading', locale)}</p>}
          {detailRead.error && (
            <div role="alert">
              <p>{t('crm.corrections.error', locale)}</p>
              <Button onClick={detailRead.retry}>{t('crm.corrections.detailRetry', locale)}</Button>
            </div>
          )}
          {detail && (
            <article className="space-y-3 rounded border bg-card text-card-foreground p-4 break-words">
              <h2 className="font-semibold">{t(`crm.corrections.${detail.fieldName}`, locale)}</h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ['profile', detail.profileId],
                  ['creator', detail.createdBy],
                  ['assignee', detail.assignedName ?? t('tickets.unassigned', locale)],
                  ['currentValue', detail.currentValue ?? '—'],
                  ['newValue', detail.requestedValue],
                  ['reason', detail.reason],
                  ['status', t(`crm.corrections.${detail.status}`, locale)],
                ].map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm text-muted-foreground">
                      {t(`crm.corrections.${key}`, locale)}
                    </dt>
                    <dd className="whitespace-pre-wrap">
                      <bdi>{value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              {evidence.map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-foreground underline"
                >
                  {t('crm.corrections.evidence', locale)} {index + 1}
                </a>
              ))}
              {!hasEvidence && <p role="status">{t('crm.corrections.legacy', locale)}</p>}
              {detail.reviewerNotes && <p>{detail.reviewerNotes}</p>}
              {queue?.viewer.userId === detail.createdBy ? (
                <p>{t('crm.corrections.self', locale)}</p>
              ) : (
                queue?.viewer.canReview &&
                ['Open', 'Under Review'].includes(detail.status) && (
                  <div className="space-y-3">
                    <Label htmlFor="case-decision">{t('crm.corrections.save', locale)}</Label>
                    <select
                      disabled={busy || !!action}
                      id="case-decision"
                      value={decision}
                      onChange={(event) => setDecision(event.target.value as Status)}
                      className="block rounded border bg-background text-foreground p-2"
                    >
                      {(detail.status === 'Open'
                        ? ['Under Review', 'Rejected']
                        : ['Approved', 'Rejected']
                      ).map((value) => (
                        <option key={value} value={value}>
                          {t(`crm.corrections.${value}`, locale)}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor="case-notes">{t('crm.corrections.notes', locale)}</Label>
                    <textarea
                      disabled={busy || !!action}
                      id="case-notes"
                      maxLength={1000}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="block rounded border bg-background text-foreground p-2 w-full"
                    />
                    <Button
                      ref={reviewButton}
                      disabled={
                        loading ||
                        queueError ||
                        detailRead.loading ||
                        detailRead.error ||
                        busy ||
                        !!action ||
                        (decision === 'Rejected' && !notes.trim()) ||
                        (decision === 'Approved' && !hasEvidence)
                      }
                      onClick={() =>
                        captured({
                          title: t(`crm.corrections.${decision}`, locale),
                          description: `${detail.id} · ${detail.requestedValue} · ${notes.trim()}`,
                          path: `/api/crm/verification-cases/${detail.id}/status`,
                          method: 'PUT',
                          expected: {
                            id: detail.id,
                            profileId: detail.profileId,
                            status: decision,
                          },
                          body: {
                            decision,
                            ...(notes.trim() ? { reviewerNotes: notes.trim() } : {}),
                          },
                        })
                      }
                    >
                      {t('crm.corrections.save', locale)}
                    </Button>
                  </div>
                )
              )}
            </article>
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
                !queue?.viewer.canReview ||
                queue.viewer.userId === detail.createdBy ||
                (action.expected.status === 'Approved' && !hasEvidence)
              : !canCreate || profileRead.loading || profileRead.error)
          }
          summary={
            <div className="space-y-2">
              {action.expected.id ? (
                <>
                  <Button variant="outline" disabled={loading} onClick={() => void load()}>
                    {t('crm.corrections.queueRetry', locale)}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={detailRead.loading}
                    onClick={detailRead.retry}
                  >
                    {t('crm.corrections.detailRetry', locale)}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={profileRead.loading}
                  onClick={profileRead.retry}
                >
                  {t('crm.corrections.profileRetry', locale)}
                </Button>
              )}
            </div>
          }
          finalFocus={() =>
            action.expected.id
              ? (reviewButton.current ?? statusSelect.current)
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
            else clearCreation();
            setSaved(true);
            await queueRead.current();
          })(workGeneration.current)}
        />
      )}
    </section>
  );
}
