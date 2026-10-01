import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
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
  ScrollArea,
} from '@barghsa/ui';
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
  extensions: string[];
  size: string;
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
  const [limits, setLimits] = useState<Limit[]>([]),
    [policies, setPolicies] = useState<UploadPolicyDto[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null),
    [formError, setFormError] = useState(false);
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
  const clearWork = useCallback(() => {
    generation.current++;
    setEditor(null);
    setAction(null);
    actionBasis.current = null;
    setFormError(false);
    setNotice(false);
  }, []);
  const deny = useCallback(() => {
    accessRequest.current?.abort();
    listRequest.current?.abort();
    accepted.current = false;
    setCanEdit(false);
    setLimits([]);
    setPolicies([]);
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
          if (!limit || basis(limit, versions) !== work.basis) clearWork();
        }
        accepted.current = true;
        setPolicies(versions);
        setLimits(boundaries);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision, canEdit, accessVersion, accessLoading, accessError, deny, clearWork]);
  const disabled = !canEdit || loading || error || accessLoading || accessError;
  const refresh = () => setAccessRevision((v) => v + 1);
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
      <Button type="button" variant="outline" disabled={accessLoading || loading} onClick={refresh}>
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
    if (disabled) return;
    generation.current++;
    setFormError(false);
    setNotice(false);
    setEditor({
      limit,
      basis: basis(limit, policies),
      extensions: (current?.allowedExtensions ?? limit.allowedExtensions).filter((ext) =>
        limit.allowedExtensions.includes(ext)
      ),
      size: String(Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes) / mib),
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || disabled) return;
    const bytes = Number(editor.size) * mib;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > editor.limit.maxSizeBytes ||
      editor.extensions.length === 0
    ) {
      setFormError(true);
      return;
    }
    actionBasis.current = { category: editor.limit.category, basis: editor.basis };
    actionGeneration.current = generation.current;
    setAction({
      title: label('save'),
      description: `${label('confirm')} ${label(`category.${editor.limit.category}`)}: ${editor.extensions.join(', ')} · ${size(bytes)}`,
      path: '/api/admin/upload-policies',
      method: 'POST',
      body: {
        category: editor.limit.category,
        allowedExtensions: editor.extensions,
        maxSizeBytes: bytes,
      },
      conflictMessage: label('scheduleConflict'),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  function end(policy: UploadPolicyDto, limit: Limit) {
    if (disabled) return;
    generation.current++;
    setEditor(null);
    actionBasis.current = { category: limit.category, basis: basis(limit, policies) };
    actionGeneration.current = generation.current;
    setNotice(false);
    setAction({
      title: label('end'),
      description: `${label('endConfirm')} ${label(`category.${limit.category}`)}: ${limit.allowedExtensions.join(', ')} · ${size(limit.maxSizeBytes)}`,
      path: `/api/admin/upload-policies/${policy.id}/end`,
      method: 'POST',
      body: {},
      conflictMessage: label('scheduleConflict'),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  return (
    <section className="min-w-0 space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
        </div>
      </header>
      {notice && <p role="status">{label('saved')}</p>}
      <ListPage>
        <ListPage.Toolbar>
          <Button variant="outline" disabled={accessLoading || loading} onClick={refresh}>
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
            <ScrollArea
              scrollbarOrientation="horizontal"
              role="region"
              aria-label={label('title')}
              className="max-w-full min-w-0 rounded-lg border bg-card text-card-foreground"
            >
              <table className="w-full min-w-[48rem] text-start text-sm">
                <caption className="sr-only">{label('title')}</caption>
                <thead>
                  <tr>
                    {['category', 'formats', 'maxSize', 'source', 'actions'].map((key) => (
                      <th scope="col" className="p-3 text-start" key={key}>
                        {label(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {limits.map((limit) => {
                    const current = policies.find(
                      (policy) => policy.category === limit.category && policy.status === 'current'
                    );
                    return (
                      <tr key={limit.category} className="border-t align-top">
                        <th scope="row" className="p-3 text-start">
                          {label(`category.${limit.category}`)}
                        </th>
                        <td className="p-3">
                          <bdi>
                            {(current?.allowedExtensions ?? limit.allowedExtensions)
                              .filter((ext) => limit.allowedExtensions.includes(ext))
                              .join(', ')}
                          </bdi>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {size(
                            Math.min(
                              current?.maxSizeBytes ?? limit.maxSizeBytes,
                              limit.maxSizeBytes
                            )
                          )}
                        </td>
                        <td className="p-3">{label(current ? 'configured' : 'deployment')}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => edit(limit, current)}
                              aria-label={`${label('edit')} ${label(`category.${limit.category}`)}`}
                            >
                              {label('edit')}
                            </Button>
                            {current?.effectiveUntil === null && (
                              <Button
                                variant="outline"
                                disabled={disabled}
                                onClick={() => end(current, limit)}
                                aria-label={`${label('end')} ${label(`category.${limit.category}`)}`}
                              >
                                {label('end')}
                              </Button>
                            )}
                          </div>
                          <details className="mt-3">
                            <summary className="cursor-pointer">{label('history')}</summary>
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
                                      {label('from')}: {date(policy.effectiveFrom)}
                                    </p>
                                    <p>
                                      {label('until')}: {date(policy.effectiveUntil)}
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
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </ListPage.Content>
        )}
      </ListPage>
      {editor && !action && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
        >
          <DialogContent dir={locale === 'fa' ? 'rtl' : 'ltr'}>
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>
                  {label('edit')} {label(`category.${editor.limit.category}`)}
                </DialogTitle>
                <DialogDescription>{label('warning')}</DialogDescription>
              </DialogHeader>
              {recoveryControls}
              <fieldset className="space-y-2">
                <legend className="font-medium">{label('formats')}</legend>
                <div className="flex flex-wrap gap-3">
                  {editor.limit.allowedExtensions.map((ext) => (
                    <label key={ext} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editor.extensions.includes(ext)}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            extensions: event.target.checked
                              ? [...editor.extensions, ext]
                              : editor.extensions.filter((value) => value !== ext),
                          })
                        }
                      />
                      <bdi>{ext}</bdi>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="upload-policy-size">
                  {label('maxSize')} ({label('mib')})
                </Label>
                <Input
                  id="upload-policy-size"
                  type="number"
                  min={1 / mib}
                  max={editor.limit.maxSizeBytes / mib}
                  step="any"
                  required
                  value={editor.size}
                  onChange={(event) => setEditor({ ...editor, size: event.target.value })}
                />
                <p className="text-sm text-muted-foreground">
                  {label('ceiling')}: {size(editor.limit.maxSizeBytes)}
                </p>
              </div>
              {formError && <p role="alert">{label('invalid')}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                  {label('cancel')}
                </Button>
                <Button type="submit" disabled={disabled}>
                  {label('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={disabled}
          summary={recoveryControls}
          onClose={() => {
            generation.current++;
            setAction(null);
            actionBasis.current = null;
          }}
          onSuccess={(() => {
            const commandGeneration = actionGeneration.current;
            return async () => {
              if (commandGeneration !== generation.current) return;
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
