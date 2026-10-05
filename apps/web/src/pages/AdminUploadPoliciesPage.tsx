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
  type UploadPolicyDraft,
} from '../lib/storage-policy-form.js';
import type { UploadPolicyDto } from '@barghsa/shared/admin';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  ListPage,
  DateCell,
  TextCell,
  Alert,
} from '@barghsa/ui';
import { OperationalQueueTable, QueueRecordDetails } from '../components/OperationalQueueTable.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Limit {
  category: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
}
interface Editor {
  limit: Limit;
  basis: string;
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
const mib = 1024 * 1024;
export default function AdminUploadPoliciesPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
  const text = (key: Parameters<typeof storagePolicyFormText>[0]) =>
    storagePolicyFormText(key, locale);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [expandedHistory, setExpandedHistory] = useState<string[]>([]);
  const limitRef = useRef<Limit | null>(null);
  const form = useWizardForm<UploadPolicyDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<UploadPolicyDraft>(
        { extensions: text('extensions'), size: text('size') },
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
  const [action, setAction] = useState<TeamAction | null>(null),
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
  const actionRef = useRef<TeamAction | null>(null);
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
    setExpandedHistory([]);
    setAccessLoading(false);
    setAccessError(false);
    setLoading(false);
    setError(false);
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
        const res = await fetch('/api/admin/upload-policies/access', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (res.status === 401 || res.status === 403) {
          deny();
          return;
        }
        if (!res.ok) throw new Error('Unavailable');
        const permission: unknown = await res.json();
        if (controller.signal.aborted) return;
        if (!record(permission) || typeof permission.canEdit !== 'boolean')
          throw new Error('Invalid access');
        if (!permission.canEdit) {
          deny();
          return;
        }
        setCanEdit(true);
        setAccessVersion((v) => v + 1);
      } catch {
        if (!controller.signal.aborted) setAccessError(true);
      } finally {
        if (!controller.signal.aborted) setAccessLoading(false);
      }
    })();
    return () => controller.abort();
  }, [accessRevision, deny]);
  useEffect(() => {
    if (!canEdit || accessLoading || accessError) return;
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const read = async (path: string) => {
          const res = await fetch(path, { signal: controller.signal });
          if (controller.signal.aborted) throw new Error('Obsolete read');
          if (res.status === 401 || res.status === 403) {
            deny();
            throw new Error('Denied');
          }
          if (!res.ok) throw new Error('Unavailable');
          return res.json() as Promise<unknown>;
        };
        const [versions, boundaries] = await Promise.all([
          read('/api/admin/upload-policies'),
          read('/api/admin/upload-policies/limits'),
        ]);
        if (controller.signal.aborted) return;
        if (!validPolicies(versions) || !validLimits(boundaries))
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
        setLimits(boundaries);
        setRecoveryReady(true);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision, canEdit, accessVersion, accessLoading, accessError, deny, clearWork, withdraw]);
  const disabled = !canEdit || loading || error || accessLoading || accessError;
  const refresh = () => {
    if (dialogBusy.current) return;
    if (validationBusy.current || uncertain) withdraw();
    setRecoveryReady(false);
    setAccessRevision((v) => v + 1);
  };
  const size = (bytes: number) =>
    `${numbers.number(bytes / mib, { maximumFractionDigits: 6 })} ${label('mib')}`;
  const date = (value: string | null) => (value ? time.format(value) : label('openEnded'));
  const errors = {
    UPLOAD_POLICY_INVALID_EFFECTIVE_FROM: label('scheduleConflict'),
    UPLOAD_POLICY_WINDOW_OVERLAP: label('scheduleConflict'),
    UPLOAD_POLICY_SIZE_INVALID: label('invalid'),
    UPLOAD_POLICY_EXTENSION_NOT_DEPLOYMENT_PERMITTED: label('invalid'),
  };
  const recoveryControls = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={accessLoading || loading || dialogPending}
        onClick={refresh}
      >
        {t('admin.jobs.refresh', locale)}
      </Button>
      {(accessLoading || loading) && <p role="status">{t('common.loading', locale)}</p>}
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
      const bytes = Number(captured.size) * mib;
      actionBasis.current = { category: editor.limit.category, basis: editor.basis };
      actionGeneration.current = generation.current;
      const next: TeamAction = {
        title: label('save'),
        description: `${label('confirm')} ${label(`category.${editor.limit.category}`)}: ${captured.extensions.join(', ')} · ${size(bytes)}`,
        path: '/api/admin/upload-policies',
        method: 'POST',
        body: {
          category: editor.limit.category,
          allowedExtensions: captured.extensions,
          maxSizeBytes: bytes,
        },
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
  }
  return (
    <section className="min-w-0 space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
            {label('title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
        </div>
      </header>
      {notice && <p role="status">{label('saved')}</p>}
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
        <ListPage.Toolbar>
          <Button
            ref={refreshButton}
            variant="outline"
            disabled={accessLoading || loading || dialogPending}
            onClick={refresh}
          >
            {t('admin.jobs.refresh', locale)}
          </Button>
        </ListPage.Toolbar>
        {accessLoading && <p role="status">{label('accessLoading')}</p>}
        {accessError && (
          <div role="alert" className="space-y-2">
            <p>{label('accessError')}</p>
            <Button onClick={refresh}>{label('accessRetry')}</Button>
          </div>
        )}
        {!accessLoading && !accessError && !canEdit && <p role="alert">{label('forbidden')}</p>}
        {canEdit && (
          <ListPage.Content
            loading={loading}
            error={error}
            empty={limits.length === 0}
            retainContent={accepted.current && limits.length > 0}
            loadingView={<p role="status">{t('admin.jobs.loading', locale)}</p>}
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
              renderName={({ limit }) => <TextCell value={label(`category.${limit.category}`)} />}
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
                    size(Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes)),
                },
                {
                  id: 'source',
                  label: label('source'),
                  render: ({ current }) => label(current ? 'configured' : 'deployment'),
                },
              ]}
              actionHeader={label('actions')}
              renderActions={({ current, limit }) => (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={disabled || uncertain || form.pending || !!action}
                      onClick={() => edit(limit, current)}
                      aria-label={`${label('edit')} ${label(`category.${limit.category}`)}`}
                    >
                      {label('edit')}
                    </Button>
                    {current?.effectiveUntil === null && (
                      <Button
                        variant="outline"
                        disabled={disabled || uncertain || form.pending || !!action}
                        onClick={() => end(current, limit)}
                        aria-label={`${label('end')} ${label(`category.${limit.category}`)}`}
                      >
                        {label('end')}
                      </Button>
                    )}
                  </div>
                  <QueueRecordDetails
                    label={label('history')}
                    open={expandedHistory.includes(limit.category)}
                    onToggle={() =>
                      setExpandedHistory((values) =>
                        values.includes(limit.category)
                          ? values.filter((value) => value !== limit.category)
                          : [...values, limit.category]
                      )
                    }
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
                </>
              )}
              cardHeading="h2"
              loading={loading}
              emptyMessage={label('empty')}
            />
          </ListPage.Content>
        )}
      </ListPage>
      {editor && !action && (
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
            <form
              noValidate
              aria-busy={form.pending || undefined}
              onSubmit={submit}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>
                  {label('edit')} {label(`category.${editor.limit.category}`)}
                </DialogTitle>
                <DialogDescription>{label('warning')}</DialogDescription>
              </DialogHeader>
              {recoveryControls}
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
                className="space-y-2"
                disabled={disabled || needsReset || uncertain || form.pending}
                aria-invalid={form.bind('extensions')['aria-invalid']}
                aria-describedby={form.bind('extensions')['aria-describedby']}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    form.bind('extensions').onBlur();
                }}
              >
                <legend className="font-medium">{label('formats')}</legend>
                <div className="flex flex-wrap gap-3">
                  {editor.limit.allowedExtensions.map((ext) => (
                    <label key={ext} className="flex items-center gap-2">
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
              />
              <div className="space-y-2">
                <Label htmlFor="upload-policy-size">
                  {label('maxSize')} ({label('mib')})
                </Label>
                <Input
                  {...form.bind('size')}
                  id="upload-policy-size"
                  type="number"
                  min={1 / mib}
                  max={editor.limit.maxSizeBytes / mib}
                  step="any"
                  required
                  value={form.values.size}
                  disabled={disabled || needsReset || uncertain || form.pending}
                  onChange={(event) => form.field('size')[1](event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {label('ceiling')}: {size(editor.limit.maxSizeBytes)}
                </p>
              </div>
              <CatalogueFieldFeedback
                id={form.errorId('size')}
                error={form.errors.size}
                message={text('size')}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={cancelEditor}>
                  {label('cancel')}
                </Button>
                <CatalogueSaveButton
                  label={label('save')}
                  pending={form.pending}
                  disabled={disabled || needsReset || uncertain || form.pending}
                />
              </DialogFooter>
            </form>
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
          summary={recoveryControls}
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
