import {
  CalendarX as TableCalendarXIcon,
  History as TableHistoryIcon,
  Pencil as TablePencilIcon,
  Plus as TablePlusIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { Link } from '@tanstack/react-router';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { storagePolicyFormText } from '@barghsa/i18n/storage-policy-forms';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  policyDraft,
  policyInvalidFields,
  emptyPolicyDraft,
  mib,
  uploadSizeBytes,
  type UploadPolicyDraft,
} from '../lib/storage-policy-form.js';
import type { UploadPolicyCategory, UploadPolicyDto } from '@barghsa/shared/admin';
import {
  LoadingStatus,
  Badge,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  DateCell,
  TextCell,
  Alert,
} from '@barghsa/ui';
import { OperationalQueueTable, QueueRecordDetails } from '../components/OperationalQueueTable.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { toast } from '../lib/toast-api.js';
interface Limit {
  category: UploadPolicyCategory;
  allowedExtensions: string[];
  maxSizeBytes: number;
}
interface Editor {
  limit: Limit;
  basis: string;
}
interface UploadPolicyAction extends TeamAction {
  comparison?: { current: Limit; proposed: Limit };
}

function effectiveLimits(limit: Limit, current?: UploadPolicyDto): Limit {
  return {
    category: limit.category,
    allowedExtensions: (current?.allowedExtensions ?? limit.allowedExtensions).filter((ext) =>
      limit.allowedExtensions.includes(ext)
    ),
    maxSizeBytes: Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function extensions(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && v.startsWith('.'))
  );
}
function validLimits(value: unknown): value is Limit[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        record(v) &&
        ['document', 'image', 'video'].includes(String(v.category)) &&
        extensions(v.allowedExtensions) &&
        typeof v.maxSizeBytes === 'number' &&
        Number.isSafeInteger(v.maxSizeBytes) &&
        v.maxSizeBytes > 0
    )
  );
}
function validPolicies(value: unknown): value is UploadPolicyDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        record(v) &&
        typeof v.id === 'string' &&
        typeof v.category === 'string' &&
        ['document', 'image', 'video'].includes(v.category) &&
        extensions(v.allowedExtensions) &&
        typeof v.maxSizeBytes === 'number' &&
        Number.isSafeInteger(v.maxSizeBytes) &&
        v.maxSizeBytes > 0 &&
        typeof v.effectiveFrom === 'string' &&
        Number.isFinite(Date.parse(v.effectiveFrom)) &&
        (v.effectiveUntil === null ||
          (typeof v.effectiveUntil === 'string' &&
            Number.isFinite(Date.parse(v.effectiveUntil)))) &&
        typeof v.createdBy === 'string' &&
        ['current', 'scheduled', 'expired'].includes(String(v.status))
    )
  );
}
function basis(limit: Limit, policies: UploadPolicyDto[]) {
  return JSON.stringify({
    limit,
    current: policies.find((p) => p.category === limit.category && p.status === 'current') ?? null,
  });
}
const collectionPath = '/api/admin/upload-policies';
type UploadPolicyWorkspace =
  | { view: 'catalogue'; category?: never; versionId?: never }
  | {
      view: 'detail' | 'editor' | 'history';
      category: UploadPolicyCategory;
      versionId?: never;
      close: () => void;
      showVersion: (versionId: string) => void;
    }
  | { view: 'version'; category: UploadPolicyCategory; versionId: string };
export default function AdminUploadPoliciesPage({
  workspace,
}: {
  workspace?: UploadPolicyWorkspace;
} = {}) {
  const readQuery = useStaffQueryRead('catalogue');
  const deniedRead = (reason: unknown) =>
    reason instanceof ServerQueryError && [401, 403].includes(reason.status);
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
  const text = (key: Parameters<typeof storagePolicyFormText>[0]) =>
    storagePolicyFormText(key, locale);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const category = workspace?.category;
  const versionId = workspace?.versionId;
  const view = workspace?.view;
  const routedRecord = !!category;
  useEffect(() => {
    if (routedRecord) heading.current?.focus({ preventScroll: true });
  }, [routedRecord]);
  const editorOpened = useRef(false);
  const [localHistory, setLocalHistory] = useState<string[]>([]);
  const limitRef = useRef<Limit | null>(null);
  const form = useWizardForm<UploadPolicyDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<UploadPolicyDraft>(
        { extensions: text('extensions'), size: text('size'), sizeUnit: text('sizeUnit') },
        (draft) => policyInvalidFields(draft, limitRef.current)
      );
    },
    emptyPolicyDraft,
    text('unavailable')
  );
  const resetPolicy = form.form.reset,
    registerPolicy = form.form.register;
  const extensionsRef = useCallback(
    (node: HTMLFieldSetElement | null) => {
      registerPolicy('extensions').ref(
        node ? { focus: () => node.querySelector('input')?.focus() } : null
      );
    },
    [registerPolicy]
  );
  const fieldErrors = useActionFieldErrors(
    form.form,
    { extensions: text('extensions'), size: text('size') },
    text('invalid')
  );
  const [limits, setLimits] = useState<Limit[]>([]),
    [policies, setPolicies] = useState<UploadPolicyDto[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [missing, setMissing] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [needsReset, setNeedsReset] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [recoveryReady, setRecoveryReady] = useState(false);
  const validationBusy = useRef(false),
    dialogBusy = useRef(false);
  const [dialogPending, setDialogPending] = useState(false);
  const onPendingChange = useCallback((pending: boolean) => {
    dialogBusy.current = pending;
    setDialogPending(pending);
  }, []);
  const [action, setAction] = useState<UploadPolicyAction | null>(null),
    [notice, setNotice] = useState(false);
  const [accessRevision, setAccessRevision] = useState(0);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState(false);
  const [accessVersion, setAccessVersion] = useState(0);
  const accepted = useRef(false);
  const accessRequest = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const actionBasis = useRef<{ category: string; basis: string } | null>(null);
  const generation = useRef(0);
  const actionGeneration = useRef(0);
  const actionRef = useRef<UploadPolicyAction | null>(null);
  const withdraw = useCallback(() => {
    generation.current++;
    validationBusy.current = false;
    form.setValidationPending(false);
    actionRef.current = null;
    setAction(null);
    actionBasis.current = null;
    onPendingChange(false);
  }, [form.setValidationPending, onPendingChange]);
  const clearWork = useCallback(() => {
    withdraw();
    editorOpened.current = false;
    setEditor(null);
    limitRef.current = null;
    resetPolicy(emptyPolicyDraft());
    setNeedsReset(false);
    setUncertain(false);
    setRecoveryReady(false);
    setNotice(false);
  }, [withdraw, resetPolicy]);
  const deny = useCallback(() => {
    accessRequest.current?.abort();
    listRequest.current?.abort();
    accepted.current = false;
    setCanEdit(false);
    setLimits([]);
    setPolicies([]);
    setLocalHistory([]);
    setAccessLoading(false);
    setAccessError(false);
    setLoading(false);
    setError(false);
    setMissing(false);
    editorOpened.current = false;
    clearWork();
  }, [clearWork]);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    accessRequest.current = controller;
    setAccessLoading(true);
    setAccessError(false);
    void (async () => {
      try {
        const permission = await readQuery(
          '/api/admin/upload-policies/access',
          'detail',
          controller.signal,
          staffQueryJson,
          accessRevision
        );
        if (controller.signal.aborted) return;
        if (!record(permission) || typeof permission.canEdit !== 'boolean')
          throw new Error('Invalid access');
        if (!permission.canEdit) {
          deny();
          return;
        }
        setCanEdit(true);
        setAccessVersion((v) => v + 1);
      } catch (reason) {
        if (!controller.signal.aborted) {
          if (deniedRead(reason)) deny();
          else setAccessError(true);
        }
      } finally {
        if (!controller.signal.aborted) setAccessLoading(false);
      }
    })();
    return () => controller.abort();
  }, [accessRevision, deny, readQuery]);
  useEffect(() => {
    if (!canEdit || accessLoading || accessError) return;
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setError(false);
    setMissing(false);
    void (async () => {
      try {
        const read = (path: string, kind: 'list' | 'detail' = 'list') =>
          readQuery(
            path,
            kind,
            controller.signal,
            async (res) => {
              if (controller.signal.aborted) throw new Error('Obsolete read');
              if (res.status === 401 || res.status === 403) {
                deny();
                throw new Error('Denied');
              }
              return staffQueryJson(res);
            },
            accessVersion
          );
        const path =
          versionId && category
            ? `${collectionPath}/${category}/versions/${encodeURIComponent(versionId)}`
            : category
              ? `${collectionPath}?category=${category}`
              : collectionPath;
        const [response, boundaries] = await Promise.all([
          read(path, versionId ? 'detail' : 'list'),
          read('/api/admin/upload-policies/limits'),
        ]);
        if (controller.signal.aborted) return;
        const versions = versionId ? [response] : response;
        if (
          !validPolicies(versions) ||
          !validLimits(boundaries) ||
          (category && versions.some((item) => item.category !== category)) ||
          (versionId && versions[0]?.id !== versionId)
        )
          throw new Error('Invalid response');
        const work = editorRef.current ?? actionBasis.current;
        if (work) {
          const category = 'limit' in work ? work.limit.category : work.category;
          const limit = boundaries.find((item) => item.category === category);
          if (!limit) clearWork();
          else if (basis(limit, versions) !== work.basis) {
            withdraw();
            if (editorRef.current) setNeedsReset(true);
          }
        }
        accepted.current = true;
        setPolicies(versions);
        setLimits(
          category ? boundaries.filter((limit) => limit.category === category) : boundaries
        );
        setRecoveryReady(true);
      } catch (reason) {
        if (!controller.signal.aborted) {
          if (versionId && reason instanceof ServerQueryError && reason.status === 404) {
            setMissing(true);
            setPolicies([]);
          } else setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    revision,
    canEdit,
    accessVersion,
    accessLoading,
    accessError,
    deny,
    clearWork,
    withdraw,
    readQuery,
    category,
    versionId,
  ]);
  const disabled = !canEdit || loading || error || accessLoading || accessError;
  useEffect(() => {
    const limit = limits[0];
    if (view !== 'editor' || disabled || editorOpened.current || !limit) return;
    editorOpened.current = true;
    edit(
      limit,
      policies.find((policy) => policy.status === 'current')
    );
  }, [view, limits, policies, disabled]);
  const refresh = () => {
    if (dialogBusy.current) return;
    if (validationBusy.current || uncertain) withdraw();
    setRecoveryReady(false);
    setAccessRevision((v) => v + 1);
  };
  const size = (bytes: number) =>
    `${numbers.number(bytes / mib, { maximumFractionDigits: 6 })} ${label('mib')}`;
  const bytesText = (bytes: number) => label('bytes').replace('{count}', numbers.number(bytes));
  const date = (value: string | null) => (value ? time.format(value) : label('openEnded'));
  const errors = {
    UPLOAD_POLICY_INVALID_EFFECTIVE_FROM: label('scheduleConflict'),
    UPLOAD_POLICY_WINDOW_OVERLAP: label('scheduleConflict'),
    UPLOAD_POLICY_SIZE_INVALID: label('invalid'),
    UPLOAD_POLICY_EXTENSION_NOT_DEPLOYMENT_PERMITTED: label('invalid'),
  };
  const recoveryControls = (
    <div className="space-y-2">
      <ListRefreshButton
        label={t('admin.jobs.refresh', locale)}
        refreshing={accessLoading || loading}
        disabled={dialogPending}
        onClick={refresh}
      />
      {(accessLoading || loading) && <LoadingStatus>{t('common.loading', locale)}</LoadingStatus>}
      {accessError && (
        <div role="alert">
          <p>{label('accessError')}</p>
          <Button type="button" onClick={refresh}>
            {label('accessRetry')}
          </Button>
        </div>
      )}
      {error && (
        <div role="alert">
          <p>{label('loadError')}</p>
          <Button type="button" onClick={() => setRevision((v) => v + 1)}>
            {t('admin.jobs.reload', locale)}
          </Button>
        </div>
      )}
    </div>
  );
  function edit(limit: Limit, current: UploadPolicyDto | undefined) {
    if (disabled || uncertain || actionRef.current || validationBusy.current) return;
    withdraw();
    setNeedsReset(false);
    setNotice(false);
    limitRef.current = limit;
    resetPolicy(policyDraft(limit, current));
    setEditor({
      limit,
      basis: basis(limit, policies),
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !editor ||
      disabled ||
      needsReset ||
      uncertain ||
      validationBusy.current ||
      actionRef.current
    )
      return;
    const epoch = generation.current;
    validationBusy.current = true;
    form.setValidationPending(true);
    try {
      let captured: UploadPolicyDraft | undefined;
      await form.form.handleSubmit((value) => {
        captured = value;
      })();
      if (!captured || epoch !== generation.current || disabled) return;
      const maxSizeBytes = uploadSizeBytes(captured);
      if (maxSizeBytes === null) return;
      const proposed = {
        category: editor.limit.category,
        allowedExtensions: captured.extensions,
        maxSizeBytes,
      };
      const current = policies.find(
        (policy) => policy.category === proposed.category && policy.status === 'current'
      );
      actionBasis.current = { category: editor.limit.category, basis: editor.basis };
      actionGeneration.current = generation.current;
      const next: UploadPolicyAction = {
        title: label('save'),
        description: label('applyOnConfirmation'),
        path: '/api/admin/upload-policies',
        method: 'POST',
        body: proposed,
        comparison: { current: effectiveLimits(editor.limit, current), proposed },
        conflictMessage: label('scheduleConflict'),
        forbiddenMessage: label('forbidden'),
        errorMessages: errors,
        successStatus: 201,
      };
      actionRef.current = next;
      setAction(next);
    } finally {
      if (epoch === generation.current) {
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
  }
  function end(policy: UploadPolicyDto, limit: Limit) {
    if (disabled || uncertain || validationBusy.current || actionRef.current || needsReset) return;
    generation.current++;
    setEditor(null);
    actionBasis.current = { category: limit.category, basis: basis(limit, policies) };
    actionGeneration.current = generation.current;
    setNotice(false);
    const next: TeamAction = {
      risk: 'destructive',
      title: label('end'),
      description: `${label('endConfirm')} ${label(`category.${limit.category}`)}: ${limit.allowedExtensions.join(', ')} · ${size(limit.maxSizeBytes)}`,
      path: `/api/admin/upload-policies/${policy.id}/end`,
      method: 'POST',
      body: {},
      conflictMessage: label('scheduleConflict'),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
      successStatus: 200,
    };
    actionRef.current = next;
    setAction(next);
  }
  function resetSaved() {
    if (
      disabled ||
      !recoveryReady ||
      dialogBusy.current ||
      validationBusy.current ||
      actionRef.current
    )
      return;
    if (editor) {
      const limit = limits.find((item) => item.category === editor.limit.category);
      if (!limit) {
        clearWork();
        return;
      }
      limitRef.current = limit;
      resetPolicy(
        policyDraft(
          limit,
          policies.find((item) => item.category === limit.category && item.status === 'current')
        )
      );
      setEditor({ limit, basis: basis(limit, policies) });
    }
    setNeedsReset(false);
    setUncertain(false);
  }
  function unconfirmed() {
    listRequest.current?.abort();
    accessRequest.current?.abort();
    setUncertain(true);
    setRecoveryReady(false);
    setAccessRevision((value) => value + 1);
  }
  function cancelEditor() {
    withdraw();
    setEditor(null);
    limitRef.current = null;
    resetPolicy(emptyPolicyDraft());
    setNeedsReset(false);
    if (workspace?.view === 'editor') workspace.close();
  }
  function toggleHistory(category: string) {
    setLocalHistory((values) =>
      values.includes(category)
        ? values.filter((value) => value !== category)
        : [...values, category]
    );
  }
  const categoryLabel = category ? label(`category.${category}`) : '';
  const scopedLimit = category ? limits[0] : undefined;
  const selectedVersion = versionId ? policies[0] : undefined;
  const currentVersion = category
    ? policies.find((policy) => policy.status === 'current')
    : undefined;
  const effectivePolicy = scopedLimit && effectiveLimits(scopedLimit, currentVersion);
  const title = category
    ? `${view === 'history' ? label('history') : view === 'editor' ? label(currentVersion ? 'edit' : 'create') : view === 'version' ? label('version') : label('details')} · ${categoryLabel}`
    : label('title');
  const versionRoute = (policy: UploadPolicyDto) => ({
    to: '/admin/upload-policies/$category/versions/$versionId' as const,
    params: { category: policy.category, versionId: policy.id },
  });
  const categoryRoute = (value: UploadPolicyCategory, action?: 'history' | 'edit' | 'new') => ({
    to: '/admin/upload-policies/$category/{-$action}' as const,
    params: { category: value, action },
  });
  const subAction = buttonVariants({ variant: 'outline', className: 'min-h-11' });
  const valuesSummary = (extensions: string[], bytes: number) => (
    <dl className="grid gap-3 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{label('formats')}</dt>
        <dd className="mt-1 font-medium [overflow-wrap:anywhere]">
          <span className="flex flex-wrap gap-1.5">
            {extensions.length
              ? extensions.map((extension) => (
                  <Badge variant="outline" key={extension}>
                    <bdi dir="ltr">{extension}</bdi>
                  </Badge>
                ))
              : '—'}
          </span>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{label('maxSize')}</dt>
        <dd className="mt-1 text-lg font-semibold">
          {Number.isSafeInteger(bytes) && bytes > 0 ? size(bytes) : '—'}
        </dd>
        {Number.isSafeInteger(bytes) && bytes > 0 && (
          <dd className="text-muted-foreground">{bytesText(bytes)}</dd>
        )}
      </div>
    </dl>
  );
  const versionMetadata = (policy: UploadPolicyDto) => (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">{label('status')}</dt>
        <dd className="mt-1">
          <Badge variant="secondary">{label(`status.${policy.status}`)}</Badge>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{label('from')}</dt>
        <dd>
          <DateCell value={policy.effectiveFrom} format={() => date(policy.effectiveFrom)} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{label('until')}</dt>
        <dd>
          {policy.effectiveUntil ? (
            <DateCell value={policy.effectiveUntil} format={() => date(policy.effectiveUntil)} />
          ) : (
            label('openEnded')
          )}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{label('actor')}</dt>
        <dd className="[overflow-wrap:anywhere]">
          <bdi>{policy.createdBy}</bdi>
        </dd>
      </div>
    </dl>
  );
  const EditorActions = workspace ? RecordEditorActions : DialogFooter;
  const enteredBytes = editor ? uploadSizeBytes(form.values) : null;
  const sizeUnit = form.values.sizeUnit;
  const editorSize = sizeUnit === 'mib' ? size : bytesText;
  const draftLocked = disabled || needsReset || uncertain || form.pending || !!action;
  const editorForm = editor && (
    <form
      noValidate
      aria-busy={form.pending || undefined}
      onSubmit={submit}
      className={workspace ? recordEditorSurface : 'space-y-4'}
      aria-label={title}
    >
      <div className={workspace ? 'space-y-3 px-4 py-4 sm:px-6' : 'space-y-3'}>
        {workspace ? (
          <>
            {effectivePolicy && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
                <p className="text-muted-foreground">{label('currentEffective')}</p>
                <p className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  <bdi>{effectivePolicy.allowedExtensions.join(', ') || '—'}</bdi>
                  <span aria-hidden="true"> · </span>
                  {editorSize(effectivePolicy.maxSizeBytes)}
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{label('warning')}</p>
          </>
        ) : (
          recoveryControls
        )}
        {(needsReset || uncertain) && (
          <>
            <Alert variant="destructive">{text(uncertain ? 'unverified' : 'changed')}</Alert>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !recoveryReady || form.pending}
              onClick={resetSaved}
            >
              {text('reset')}
            </Button>
          </>
        )}
        {catalogueRootMessage(form.errors) && (
          <Alert variant="destructive">{catalogueRootMessage(form.errors)}</Alert>
        )}
        <fieldset
          ref={extensionsRef}
          className="m-0 min-w-0 space-y-2 border-0 p-0"
          disabled={draftLocked}
          aria-invalid={form.bind('extensions')['aria-invalid']}
          aria-describedby={
            form.bind('extensions')['aria-describedby'] ?? 'upload-policy-formats-help'
          }
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              form.bind('extensions').onBlur();
          }}
        >
          <legend className="font-medium">{label('formats')}</legend>
          {!form.errors.extensions && (
            <p id="upload-policy-formats-help" className="text-sm text-muted-foreground">
              {text('extensions')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {editor.limit.allowedExtensions.map((ext) => (
              <label
                key={ext}
                className="touch-label flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-sm has-[:checked]:border-primary/45 has-[:checked]:bg-primary/5"
              >
                <input
                  type="checkbox"
                  checked={form.values.extensions.includes(ext)}
                  onChange={(event) =>
                    form.field('extensions')[1](
                      event.target.checked
                        ? [...form.values.extensions, ext]
                        : form.values.extensions.filter((value) => value !== ext)
                    )
                  }
                />
                <bdi>{ext}</bdi>
              </label>
            ))}
          </div>
        </fieldset>
        <CatalogueFieldFeedback
          id={form.errorId('extensions')}
          error={form.errors.extensions}
          message={text('extensions')}
          compact
        />
        <div className={recordEditorField}>
          <Label htmlFor="upload-policy-size">
            {label('maxSize')}
            <span className="sr-only">
              {' '}
              ({sizeUnit === 'mib' ? label('mib') : text('sizeUnitBytes')})
            </span>
          </Label>
          <div className="flex w-72 max-w-full items-center gap-2">
            <Input
              {...form.bind('size')}
              id="upload-policy-size"
              inputMode={sizeUnit === 'mib' ? 'decimal' : 'numeric'}
              maxLength={32}
              dir="ltr"
              className="min-w-0 flex-1 tabular-nums"
              required
              aria-required="true"
              aria-describedby={[
                form.bind('size')['aria-describedby'],
                'upload-policy-size-ceiling',
                sizeUnit === 'mib' && enteredBytes !== null && 'upload-policy-size-preview',
              ]
                .filter(Boolean)
                .join(' ')}
              value={form.values.size}
              disabled={draftLocked}
              onChange={(event) => form.field('size')[1](event.target.value)}
            />
            <NativeSelect
              id="upload-policy-size-unit"
              aria-label={text('sizeUnit')}
              value={sizeUnit}
              disabled={draftLocked}
              onChange={(event) => {
                const unit = event.target.value === 'bytes' ? 'bytes' : 'mib';
                form.form.setValue('sizeUnit', unit, { shouldDirty: true });
                form.field('size')[1](
                  enteredBytes === null
                    ? form.values.size
                    : String(unit === 'mib' ? enteredBytes / mib : enteredBytes)
                );
              }}
            >
              <option value="mib">{label('mib')}</option>
              <option value="bytes">{text('sizeUnitBytes')}</option>
            </NativeSelect>
          </div>
          {sizeUnit === 'mib' && enteredBytes !== null && (
            <p id="upload-policy-size-preview" className="text-sm text-muted-foreground">
              {text('sizeExact').replace('{count}', numbers.number(enteredBytes))}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2">
            <p id="upload-policy-size-ceiling" className="text-sm text-muted-foreground">
              {label('ceiling')} {editorSize(editor.limit.maxSizeBytes)}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-primary"
              disabled={draftLocked || enteredBytes === editor.limit.maxSizeBytes}
              onClick={() =>
                form.field('size')[1](
                  String(
                    sizeUnit === 'mib' ? editor.limit.maxSizeBytes / mib : editor.limit.maxSizeBytes
                  )
                )
              }
            >
              {text('sizeUseCeiling')}
            </Button>
          </div>
        </div>
        <CatalogueFieldFeedback
          id={form.errorId('size')}
          error={form.errors.size}
          message={text('size')}
          compact
        />
      </div>
      <EditorActions>
        <Button type="button" variant="outline" onClick={() => cancelEditor()}>
          {label('cancel')}
        </Button>
        <CatalogueSaveButton label={label('save')} pending={form.pending} disabled={draftLocked} />
      </EditorActions>
    </form>
  );
  return (
    <section
      className={view === 'editor' ? 'mx-auto w-full max-w-3xl space-y-4' : 'min-w-0 space-y-5'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          {category && (
            <nav
              aria-label={label('title')}
              className="mb-2 flex flex-wrap gap-2 text-sm text-primary"
            >
              <Link to="/admin/upload-policies" className="underline-offset-4 hover:underline">
                {label('title')}
              </Link>
              {view !== 'detail' && (
                <>
                  <span aria-hidden="true">/</span>
                  <Link {...categoryRoute(category)} className="underline-offset-4 hover:underline">
                    {categoryLabel}
                  </Link>
                </>
              )}
            </nav>
          )}
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {title}
          </h1>
          {(!category || view === 'detail') && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
          )}
        </div>
        {view === 'editor' && (
          <ListRefreshButton
            label={t('admin.jobs.refresh', locale)}
            ref={refreshButton}
            disabled={accessLoading || loading || dialogPending}
            onClick={refresh}
          />
        )}
      </header>
      <CommandFeedback message={notice ? label('saved') : null} />
      {uncertain && !editor && (
        <div className="space-y-2">
          <Alert variant="destructive">{text('unverified')}</Alert>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !recoveryReady || !!action || dialogPending}
            onClick={resetSaved}
          >
            {text('reset')}
          </Button>
        </div>
      )}
      <ListPage>
        {view !== 'editor' && (
          <ListPage.Toolbar>
            <ListRefreshButton
              label={t('admin.jobs.refresh', locale)}
              ref={refreshButton}
              disabled={accessLoading || loading || dialogPending}
              onClick={refresh}
            />
          </ListPage.Toolbar>
        )}
        {accessLoading && <LoadingStatus>{label('accessLoading')}</LoadingStatus>}
        {accessError && (
          <div role="alert" className="space-y-2">
            <p>{label('accessError')}</p>
            <Button onClick={refresh}>{label('accessRetry')}</Button>
          </div>
        )}
        {!accessLoading && !accessError && !canEdit && <p role="alert">{label('forbidden')}</p>}
        {missing && <Alert variant="destructive">{label('versionMissing')}</Alert>}
        {canEdit && (
          <ListPage.Content
            loading={loading}
            error={error}
            empty={limits.length === 0}
            retainContent={accepted.current && limits.length > 0}
            loadingView={
              routedRecord && view !== 'history' ? (
                <RecordDetailSkeleton label={t('admin.jobs.loading', locale)} />
              ) : (
                <RecordListSkeleton
                  label={t('admin.jobs.loading', locale)}
                  view="card"
                  headings={[]}
                />
              )
            }
            errorView={
              <div role="alert" className="space-y-2">
                <p>{label('loadError')}</p>
                <Button onClick={() => setRevision((v) => v + 1)}>
                  {t('admin.jobs.reload', locale)}
                </Button>
              </div>
            }
            emptyView={<p>{label('empty')}</p>}
          >
            {category && scopedLimit && view === 'detail' && effectivePolicy && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {!disabled && (
                    <Link
                      {...categoryRoute(category, currentVersion ? 'edit' : 'new')}
                      className={buttonVariants({ className: 'min-h-11' })}
                    >
                      {label(currentVersion ? 'edit' : 'create')}
                    </Link>
                  )}
                  <Link {...categoryRoute(category, 'history')} className={subAction}>
                    {label('history')}
                  </Link>
                  {currentVersion && (
                    <Link {...versionRoute(currentVersion)} className={subAction}>
                      {label('version')}
                    </Link>
                  )}
                </div>
                <section
                  aria-label={label('catalogue')}
                  className="space-y-3 rounded-xl border bg-card p-4 sm:p-6"
                >
                  <h2 className="text-lg font-semibold">{label('catalogue')}</h2>
                  {valuesSummary(effectivePolicy.allowedExtensions, effectivePolicy.maxSizeBytes)}
                  {currentVersion ? (
                    versionMetadata(currentVersion)
                  ) : (
                    <p className="text-sm text-muted-foreground">{label('deployment')}</p>
                  )}
                </section>
                <section
                  aria-label={label('ceiling')}
                  className="space-y-3 rounded-xl border bg-card p-4 sm:p-6"
                >
                  <h2 className="font-semibold">{label('ceiling')}</h2>
                  {valuesSummary(scopedLimit.allowedExtensions, scopedLimit.maxSizeBytes)}
                </section>
              </div>
            )}
            {category &&
              view === 'history' &&
              (policies.length ? (
                <ol aria-label={label('history')} className="divide-y rounded-xl border bg-card">
                  {policies.map((policy) => (
                    <li key={policy.id} className="min-w-0 space-y-3 p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          <Badge variant="secondary">{label(`status.${policy.status}`)}</Badge>{' '}
                          <time
                            className="text-sm font-normal text-muted-foreground"
                            dateTime={policy.effectiveFrom}
                          >
                            {date(policy.effectiveFrom)}
                          </time>
                        </p>
                        <Link {...versionRoute(policy)} className={subAction}>
                          {label('version')}
                        </Link>
                      </div>
                      {valuesSummary(policy.allowedExtensions, policy.maxSizeBytes)}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border bg-card p-4">{label('noHistory')}</p>
              ))}
            {category && scopedLimit && selectedVersion && view === 'version' && (
              <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
                {valuesSummary(selectedVersion.allowedExtensions, selectedVersion.maxSizeBytes)}
                <div className="border-t pt-4">{versionMetadata(selectedVersion)}</div>
                <div className="flex flex-wrap gap-2">
                  <Link {...categoryRoute(category, 'history')} className={subAction}>
                    {label('history')}
                  </Link>
                  {selectedVersion.status === 'current' &&
                    selectedVersion.effectiveUntil === null && (
                      <>
                        {!disabled && (
                          <Link {...categoryRoute(category, 'edit')} className={subAction}>
                            {label('edit')}
                          </Link>
                        )}
                        <Button
                          variant="outline"
                          disabled={disabled || uncertain || !!action}
                          onClick={() => end(selectedVersion, scopedLimit)}
                        >
                          {label('end')}
                        </Button>
                      </>
                    )}
                </div>
              </div>
            )}
            {!routedRecord && (
              <OperationalQueueTable
                locale={locale}
                rows={limits.map((limit) => ({
                  limit,
                  id: limit.category,
                  current: policies.find(
                    (policy) => policy.category === limit.category && policy.status === 'current'
                  ),
                }))}
                caption={label('catalogue')}
                scrollLabel={label('catalogue')}
                nameHeader={label('category')}
                renderName={({ limit }) =>
                  workspace && !disabled ? (
                    <Link
                      {...categoryRoute(limit.category)}
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {label(`category.${limit.category}`)}
                    </Link>
                  ) : (
                    <TextCell value={label(`category.${limit.category}`)} />
                  )
                }
                fields={[
                  {
                    id: 'formats',
                    label: label('formats'),
                    render: ({ current, limit }) => (
                      <span dir="ltr">
                        <TextCell
                          value={(current?.allowedExtensions ?? limit.allowedExtensions)
                            .filter((ext) => limit.allowedExtensions.includes(ext))
                            .join(', ')}
                        />
                      </span>
                    ),
                  },
                  {
                    id: 'maxSize',
                    label: label('maxSize'),
                    render: ({ current, limit }) =>
                      size(
                        Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes)
                      ),
                  },
                  {
                    id: 'source',
                    label: label('source'),
                    render: ({ current }) => (
                      <Badge variant={current ? 'secondary' : 'outline'}>
                        {label(current ? 'configured' : 'deployment')}
                      </Badge>
                    ),
                  },
                ]}
                actionHeader={label('actions')}
                renderActions={({ current, limit }) => (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {workspace && !disabled ? (
                        <>
                          <Link
                            {...categoryRoute(limit.category, current ? 'edit' : 'new')}
                            className={subAction}
                            aria-label={`${label(current ? 'edit' : 'create')} ${label(`category.${limit.category}`)}`}
                            data-table-action-tooltip={label(current ? 'edit' : 'create')}
                          >
                            <TableActionIcon icon={current ? TablePencilIcon : TablePlusIcon}>
                              {label(current ? 'edit' : 'create')}
                            </TableActionIcon>
                          </Link>
                          <Link
                            {...categoryRoute(limit.category, 'history')}
                            className={subAction}
                            aria-label={`${label('history')} · ${label(`category.${limit.category}`)}`}
                            data-table-action-tooltip={label('history')}
                          >
                            <TableActionIcon icon={TableHistoryIcon}>
                              {label('history')}
                            </TableActionIcon>
                          </Link>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={disabled || uncertain || form.pending || !!action}
                          onClick={() => edit(limit, current)}
                          aria-label={`${label('edit')} ${label(`category.${limit.category}`)}`}
                          data-table-action-tooltip={label('edit')}
                        >
                          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
                        </Button>
                      )}
                      {current?.effectiveUntil === null && (
                        <Button
                          variant="outline"
                          disabled={disabled || uncertain || form.pending || !!action}
                          onClick={() => end(current, limit)}
                          aria-label={`${label('end')} ${label(`category.${limit.category}`)}`}
                          data-table-action-tooltip={label('end')}
                        >
                          <TableActionIcon icon={TableCalendarXIcon}>
                            {label('end')}
                          </TableActionIcon>
                        </Button>
                      )}
                    </div>
                    {!workspace && (
                      <QueueRecordDetails
                        label={label('history')}
                        open={localHistory.includes(limit.category)}
                        onToggle={() => toggleHistory(limit.category)}
                      >
                        <ol className="mt-2 space-y-3">
                          {policies
                            .filter((policy) => policy.category === limit.category)
                            .map((policy) => (
                              <li key={policy.id} className="rounded border p-2">
                                <p>
                                  {label(`status.${policy.status}`)} ·{' '}
                                  <bdi>{policy.allowedExtensions.join(', ')}</bdi> ·{' '}
                                  {size(policy.maxSizeBytes)}
                                </p>
                                <p>
                                  {label('from')}:{' '}
                                  <DateCell
                                    value={policy.effectiveFrom}
                                    format={() => date(policy.effectiveFrom)}
                                  />
                                </p>
                                <p>
                                  {label('until')}:{' '}
                                  {policy.effectiveUntil ? (
                                    <DateCell
                                      value={policy.effectiveUntil}
                                      format={() => date(policy.effectiveUntil)}
                                    />
                                  ) : (
                                    label('openEnded')
                                  )}
                                </p>
                                <p>
                                  {label('actor')}: <bdi>{policy.createdBy}</bdi>
                                </p>
                              </li>
                            ))}
                        </ol>
                        {!policies.some((policy) => policy.category === limit.category) && (
                          <p>{label('noHistory')}</p>
                        )}
                      </QueueRecordDetails>
                    )}
                  </>
                )}
                cardHeading="h2"
                loading={loading}
                emptyMessage={label('empty')}
              />
            )}
          </ListPage.Content>
        )}
      </ListPage>
      {workspace?.view === 'editor' && editorForm}
      {!workspace && editor && !action && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancelEditor();
          }}
        >
          <DialogContent
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            finalFocus={() => (accessLoading || loading ? heading.current : refreshButton.current)}
          >
            <DialogHeader>
              <DialogTitle>
                {label('edit')} {label(`category.${editor.limit.category}`)}
              </DialogTitle>
              <DialogDescription>{label('warning')}</DialogDescription>
            </DialogHeader>
            {editorForm}
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={disabled || uncertain || needsReset}
          onDenied={deny}
          onUnconfirmed={unconfirmed}
          onPendingChange={onPendingChange}
          onValidationError={(fields) => {
            if (
              action.path !== '/api/admin/upload-policies' ||
              !fields.length ||
              !fields.every((field) => field === 'allowedExtensions' || field === 'maxSizeBytes')
            )
              return false;
            return fieldErrors(
              fields.map((field) => (field === 'allowedExtensions' ? 'extensions' : 'size'))
            );
          }}
          summary={
            <>
              {action.comparison && (
                <section aria-label={label('comparison')} className="space-y-2">
                  <p className="text-sm font-medium">
                    {label(`category.${action.comparison.proposed.category}`)}
                  </p>
                  <div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-lg border">
                    <div className="min-w-0 space-y-2 px-3 py-2.5">
                      <h3 className="text-sm font-semibold">{label('currentEffective')}</h3>
                      {valuesSummary(
                        action.comparison.current.allowedExtensions,
                        action.comparison.current.maxSizeBytes
                      )}
                    </div>
                    <div className="min-w-0 space-y-2 border-s bg-primary/5 px-3 py-2.5">
                      <h3 className="text-sm font-semibold">{label('nextVersion')}</h3>
                      {valuesSummary(
                        action.comparison.proposed.allowedExtensions,
                        action.comparison.proposed.maxSizeBytes
                      )}
                    </div>
                  </div>
                </section>
              )}
              {recoveryControls}
            </>
          }
          onClose={withdraw}
          onSuccess={(() => {
            const commandGeneration = actionGeneration.current;
            return async (result: unknown) => {
              if (commandGeneration !== generation.current || actionRef.current !== action) return;
              if (!validPolicies([result])) throw new Error('Invalid policy receipt');
              const receipt = result as UploadPolicyDto;
              if (action.path === '/api/admin/upload-policies') {
                const expected = action.body as {
                  category: string;
                  allowedExtensions: string[];
                  maxSizeBytes: number;
                };
                if (
                  receipt.category !== expected.category ||
                  receipt.maxSizeBytes !== expected.maxSizeBytes ||
                  receipt.status !== 'current' ||
                  JSON.stringify([...receipt.allowedExtensions].sort()) !==
                    JSON.stringify([...expected.allowedExtensions].sort())
                )
                  throw new Error('Unmatched policy receipt');
              } else if (
                receipt.id !== action.path.split('/').at(-2) ||
                receipt.status !== 'expired' ||
                !receipt.effectiveUntil
              )
                throw new Error('Unmatched ending receipt');
              if (workspace?.view === 'editor' && action.path === collectionPath) {
                toast.success(label('saved'));
                workspace.showVersion(receipt.id);
                return;
              }
              clearWork();
              setNotice(true);
              refresh();
            };
          })()}
        />
      )}
    </section>
  );
}
