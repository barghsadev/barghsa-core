import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n';
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
  extensions: string[];
  size: string;
}
const mib = 1024 * 1024;
export default function AdminUploadPoliciesPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.uploadPolicies.${key}`, locale);
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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const access = await fetch('/api/admin/upload-policies/access', {
          signal: controller.signal,
        });
        if (!access.ok) throw new Error('Unavailable');
        const permission = (await access.json()) as { canEdit: boolean };
        if (controller.signal.aborted) return;
        setCanEdit(permission.canEdit);
        if (!permission.canEdit) {
          setPolicies([]);
          setLimits([]);
          return;
        }
        const responses = await Promise.all([
          fetch('/api/admin/upload-policies', { signal: controller.signal }),
          fetch('/api/admin/upload-policies/limits', { signal: controller.signal }),
        ]);
        if (responses.some((response) => !response.ok)) throw new Error('Unavailable');
        const [versions, boundaries] = await Promise.all(
          responses.map((response) => response.json())
        );
        if (!Array.isArray(versions) || !Array.isArray(boundaries))
          throw new Error('Invalid response');
        if (!controller.signal.aborted) {
          setPolicies(versions);
          setLimits(boundaries);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  const size = (bytes: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(bytes / mib)} ${label('mib')}`;
  const date = (value: string | null) => (value ? time.format(value) : label('openEnded'));
  const errors = {
    UPLOAD_POLICY_INVALID_EFFECTIVE_FROM: label('scheduleConflict'),
    UPLOAD_POLICY_WINDOW_OVERLAP: label('scheduleConflict'),
    UPLOAD_POLICY_SIZE_INVALID: label('invalid'),
    UPLOAD_POLICY_EXTENSION_NOT_DEPLOYMENT_PERMITTED: label('invalid'),
  };
  function edit(limit: Limit, current: UploadPolicyDto | undefined) {
    setFormError(false);
    setNotice(false);
    setEditor({
      limit,
      extensions: (current?.allowedExtensions ?? limit.allowedExtensions).filter((ext) =>
        limit.allowedExtensions.includes(ext)
      ),
      size: String(Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes) / mib),
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
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
    setEditor(null);
  }
  function end(policy: UploadPolicyDto, limit: Limit) {
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
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {t('admin.jobs.refresh', locale)}
        </Button>
      </header>
      {notice && <p role="status">{label('saved')}</p>}
      {loading && <p role="status">{t('admin.jobs.loading', locale)}</p>}
      {error && (
        <div role="alert">
          <p>{label('loadError')}</p>
          <Button onClick={() => setRevision((v) => v + 1)}>
            {t('admin.jobs.reload', locale)}
          </Button>
        </div>
      )}
      {!loading && !error && !canEdit && <p role="alert">{label('forbidden')}</p>}
      {!loading && !error && canEdit && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-start text-sm">
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
                        Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes)
                      )}
                    </td>
                    <td className="p-3">{label(current ? 'configured' : 'deployment')}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => edit(limit, current)}
                          aria-label={`${label('edit')} ${label(`category.${limit.category}`)}`}
                        >
                          {label('edit')}
                        </Button>
                        {current?.effectiveUntil === null && (
                          <Button
                            variant="outline"
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
        </div>
      )}
      {editor && (
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
                <Button type="submit">{label('save')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setNotice(true);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
