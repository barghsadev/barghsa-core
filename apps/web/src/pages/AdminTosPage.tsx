import { adminTosText } from './admin-tos-text.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { adminControlsText } from '@barghsa/i18n/admin-controls';
import { useLocale } from '../hooks/useLocale.js';
import { Dialog, DialogContent, DialogTitle } from '@barghsa/ui';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import type { FormEvent } from 'react';

const TosRichText = lazy(() => import('./TosRichText.js'));
const TosPreview = lazy(() => import('./TosPreview.js'));
const TosContent = lazy(() => import('../components/TosContent.js'));

type MessageKey = keyof ReturnType<typeof adminTosText>;
class TosUiError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly status?: number
  ) {
    super(key);
  }
}
function displayError(error: unknown, fallback: MessageKey): { key: MessageKey; status?: number } {
  return error instanceof TosUiError
    ? { key: error.key, ...(error.status ? { status: error.status } : {}) }
    : { key: fallback };
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('error' in body)) return;
  if (typeof body.error === 'string') return body.error;
  if (
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error &&
    typeof body.error.code === 'string'
  )
    return body.error.code;
  return undefined;
}

interface TosVersion {
  revision?: string;
  id: string;
  versionId: string;
  contentFa: string;
  contentEn: string;
  changeType: 'major' | 'minor' | null;
  status: 'draft' | 'published';
  isActive: boolean;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function isVersion(value: unknown): value is TosVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const date = (input: unknown) => typeof input === 'string' && Number.isFinite(Date.parse(input));
  return (
    (v.revision === undefined ||
      (typeof v.revision === 'string' && /^[a-f0-9]{64}$/.test(v.revision))) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.versionId === 'string' &&
    v.versionId.length > 0 &&
    typeof v.contentFa === 'string' &&
    typeof v.contentEn === 'string' &&
    (v.status === 'draft' || v.status === 'published') &&
    (v.changeType === null || v.changeType === 'major' || v.changeType === 'minor') &&
    typeof v.isActive === 'boolean' &&
    (!v.isActive || v.status === 'published') &&
    (v.createdBy === null || typeof v.createdBy === 'string') &&
    date(v.createdAt) &&
    date(v.updatedAt) &&
    (v.status === 'published' ? date(v.publishedAt) : v.publishedAt === null)
  );
}

/**
 * Admin TOS editor page (T-09.03.01) with version history (T-09.03.02).
 *
 * Lists all TOS versions with create, edit, publish, view, and discard actions.
 * Read-only version detail view shows full Persian and English content.
 */
export default function AdminTosPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const text = adminTosText(locale);
  const historyRequest = useRef(0);
  const saveInFlight = useRef(false);
  const [versions, setVersions] = useState<TosVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState<{ key: MessageKey; status?: number } | null>(null);

  // Draft editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRevision, setEditRevision] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const discardInFlight = useRef(false);
  const [versionId, setVersionId] = useState('');
  const [contentFa, setContentFa] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [saving, setSaving] = useState(false);

  // Publish dialog state
  const [publishVersion, setPublishVersion] = useState<TosVersion | null>(null);
  const [previewLocale, setPreviewLocale] = useState<'fa' | 'en'>(locale);
  const [previewReady, setPreviewReady] = useState(false);
  const publishInFlight = useRef(false);
  const markPreviewReady = useCallback(
    () => setPreviewReady(!!publishVersion?.revision),
    [publishVersion?.revision]
  );
  const [changeType, setChangeType] = useState<'major' | 'minor'>('minor');
  const [publishing, setPublishing] = useState(false);

  // Version detail view state (T-09.03.02)
  const [viewVersion, setViewVersion] = useState<TosVersion | null>(null);
  const [detailLocale, setDetailLocale] = useState<'fa' | 'en'>('fa');

  const fetchVersions = useCallback(async () => {
    const request = ++historyRequest.current;
    try {
      setLoading(true);
      setHistoryReady(false);
      setError(null);
      const res = await fetch('/api/admin/tos/versions');
      if (!res.ok) throw new TosUiError('historyFailed', res.status);
      const data: unknown = await res.json();
      if (request !== historyRequest.current) return;
      if (
        !Array.isArray(data) ||
        !data.every(isVersion) ||
        new Set(data.map((v) => v.id)).size !== data.length ||
        data.filter((v) => v.status === 'draft').length > 1 ||
        data.filter((v) => v.isActive).length > 1
      ) {
        throw new TosUiError('invalidHistory');
      }
      setVersions(data);
      setHistoryReady(true);
    } catch (err) {
      if (request === historyRequest.current) setError(displayError(err, 'historyFailed'));
    } finally {
      if (request === historyRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersions();
    return () => {
      historyRequest.current++;
    };
  }, [fetchVersions]);

  // Check if a draft already exists
  const savedDraft = versions.find((v) => v.status === 'draft');
  const hasDraft = !!savedDraft;

  function openCreate() {
    if (!historyReady || loading) return;
    setEditId(null);
    setEditRevision(null);
    setEditConflict(false);
    setVersionId('');
    setContentFa('');
    setContentEn('');
    setShowEditor(true);
  }

  function openEdit(v: TosVersion) {
    if (!historyReady || loading) return;
    if (!v.revision) {
      setError({ key: 'previewRequired' });
      return;
    }
    setEditId(v.id);
    setEditRevision(v.revision);
    setEditConflict(false);
    setVersionId(v.versionId);
    setContentFa(v.contentFa);
    setContentEn(v.contentEn);
    setShowEditor(true);
  }

  function openView(v: TosVersion) {
    setViewVersion(v);
    setDetailLocale(locale);
  }

  function closeView() {
    setViewVersion(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saveInFlight.current || !historyReady || loading || editConflict || (!editId && hasDraft))
      return;
    if (!contentFa.trim() || !contentEn.trim()) {
      setError({ key: 'requiredContent' });
      return;
    }
    saveInFlight.current = true;
    setSaving(true);

    try {
      if (editId) {
        // Update existing draft
        if (!editRevision) throw new TosUiError('previewRequired');
        const body: Record<string, string> = { expectedRevision: editRevision };
        if (versionId) body.versionId = versionId;
        if (contentFa) body.contentFa = contentFa;
        if (contentEn) body.contentEn = contentEn;

        const res = await fetch(`/api/admin/tos/versions/${editId}`, {
          method: 'PUT',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          setEditConflict(true);
          throw new TosUiError('draftChanged');
        }
        if (!res.ok) {
          throw new TosUiError('saveFailed', res.status);
        }
        const result: unknown = await res.json().catch(() => null);
        if (
          !isVersion(result) ||
          !result.revision ||
          result.status !== 'draft' ||
          result.versionId !== versionId ||
          result.contentFa !== contentFa ||
          result.contentEn !== contentEn ||
          (editId && result.id !== editId)
        ) {
          setHistoryReady(false);
          throw new TosUiError('unconfirmedWrite');
        }
      } else {
        // Create new draft
        const res = await fetch('/api/admin/tos/versions', {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ versionId, contentFa, contentEn }),
        });
        if (res.status === 409) {
          if ((await responseCode(res)) === 'TOS_VERSION_ID_TAKEN') {
            throw new TosUiError('versionIdTaken');
          }
          setHistoryReady(false);
          throw new TosUiError('createConflict');
        }
        if (!res.ok) {
          throw new TosUiError('saveFailed', res.status);
        }
        const result: unknown = await res.json().catch(() => null);
        if (
          !isVersion(result) ||
          !result.revision ||
          result.status !== 'draft' ||
          result.versionId !== versionId ||
          result.contentFa !== contentFa ||
          result.contentEn !== contentEn ||
          (editId && result.id !== editId)
        ) {
          setHistoryReady(false);
          throw new TosUiError('unconfirmedWrite');
        }
      }

      setShowEditor(false);
      await fetchVersions();
    } catch (err) {
      setError(displayError(err, 'saveFailed'));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function reloadDraft() {
    if (!editId || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tos/versions/${editId}`);
      const result: unknown = await response.json();
      if (!response.ok || !isVersion(result) || result.id !== editId || !result.revision)
        throw new TosUiError('unconfirmedWrite');
      if (result.status !== 'draft') {
        setShowEditor(false);
        await fetchVersions();
        return;
      }
      openEdit(result);
      setError(null);
    } catch (error) {
      setError(displayError(error, 'historyFailed'));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!publishVersion || !historyReady || loading || publishInFlight.current || !previewReady)
      return;
    if (!publishVersion.revision) {
      setError({ key: 'previewRequired' });
      return;
    }
    publishInFlight.current = true;
    setPublishing(true);

    try {
      const res = await fetch(`/api/admin/tos/versions/${publishVersion.id}/publish`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ changeType, expectedRevision: publishVersion.revision }),
      });
      if (res.status === 409) {
        setPreviewReady(false);
        throw new TosUiError('previewChanged');
      }
      if (!res.ok) {
        throw new TosUiError('publishFailed', res.status);
      }

      const result: unknown = await res.json().catch(() => null);
      if (
        !isVersion(result) ||
        result.id !== publishVersion.id ||
        result.status !== 'published' ||
        !result.isActive ||
        result.changeType !== changeType ||
        result.versionId !== publishVersion.versionId ||
        result.contentFa !== publishVersion.contentFa ||
        result.contentEn !== publishVersion.contentEn
      ) {
        setPreviewReady(false);
        throw new TosUiError('unconfirmedWrite');
      }
      setPublishVersion(null);
      await fetchVersions();
    } catch (err) {
      setError(displayError(err, 'publishFailed'));
    } finally {
      publishInFlight.current = false;
      setPublishing(false);
    }
  }

  async function handleDiscard(version: TosVersion) {
    if (!historyReady || loading || discardInFlight.current) return;
    if (!version.revision) {
      setError({ key: 'previewRequired' });
      return;
    }
    if (!window.confirm(text.confirmDiscard)) return;

    discardInFlight.current = true;
    setDiscarding(true);
    try {
      const res = await fetch(
        `/api/admin/tos/versions/${version.id}?expectedRevision=${encodeURIComponent(version.revision)}`,
        {
          headers: withCsrf(),
          method: 'DELETE',
        }
      );
      if (res.status === 409) {
        setHistoryReady(false);
        throw new TosUiError('draftChanged');
      }
      if (res.status !== 204) {
        throw new TosUiError('discardFailed', res.status);
      }
      await fetchVersions();
    } catch (err) {
      setError(displayError(err, 'discardFailed'));
    } finally {
      discardInFlight.current = false;
      setDiscarding(false);
    }
  }

  if (loading && versions.length === 0) {
    return <div className="p-4 text-muted-foreground">{text.loading}</div>;
  }

  return (
    <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{text.title}</h1>
        {!hasDraft && !showEditor && (
          <button
            onClick={openCreate}
            disabled={!historyReady || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {text.newDraft}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded relative"
        >
          {text[error.key]}
          {error.status ? ` (HTTP ${error.status})` : ''}
          <button
            aria-label={adminControlsText('dismissError', locale)}
            onClick={() => setError(null)}
            className="absolute top-2 end-2 text-destructive hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {!historyReady && !loading && (
        <button type="button" onClick={fetchVersions} className="rounded border px-4 py-2">
          {text.retry}
        </button>
      )}

      {/* Draft editor */}
      {showEditor && (
        <form
          onSubmit={handleSave}
          className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold">{editId ? text.editDraft : text.createNewDraft}</h2>

          <div>
            <label
              htmlFor="admintospage-field-1"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {text.versionId} <span className="text-destructive">*</span>
            </label>
            <input
              id="admintospage-field-1"
              type="text"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className="w-full border border-input rounded px-3 py-2"
              placeholder={text.versionExample}
              maxLength={50}
              required
              disabled={!!editId || saving}
            />
          </div>

          <Suspense fallback={<p role="status">{text.editorLoading}</p>}>
            <div className="space-y-2">
              <p className="font-medium">{text.persian} *</p>
              <TosRichText
                key={`${editId ?? 'new'}-${editRevision}-fa`}
                value={contentFa}
                onChange={setContentFa}
                label={text.persian}
                language="fa"
                locale={locale}
                disabled={saving || !historyReady || loading}
              />
            </div>
            <div className="space-y-2">
              <p className="font-medium">{text.english} *</p>
              <TosRichText
                key={`${editId ?? 'new'}-${editRevision}-en`}
                value={contentEn}
                onChange={setContentEn}
                label={text.english}
                language="en"
                locale={locale}
                disabled={saving || !historyReady || loading}
              />
            </div>
          </Suspense>

          {!editId && savedDraft && historyReady && (
            <div className="space-y-2">
              <p role="status">{text.createConflict}</p>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  openEdit(savedDraft);
                  setError(null);
                }}
                className="rounded border px-4 py-2"
              >
                {text.openSavedDraft}
              </button>
            </div>
          )}
          {editConflict && editId && (
            <button
              type="button"
              onClick={reloadDraft}
              disabled={saving}
              className="rounded border px-4 py-2"
            >
              {text.reloadDraft}
            </button>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving || !historyReady || loading || editConflict || (!editId && hasDraft)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? text.saving : editId ? text.updateDraft : text.createDraft}
            </button>
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              disabled={saving}
              className="px-4 py-2 border border-input rounded hover:bg-muted"
            >
              {text.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Publish dialog */}
      {publishVersion && (
        <div
          role="region"
          aria-label={text.publishTitle}
          className="bg-warning-soft border border-warning/20 rounded-lg p-4 space-y-3"
        >
          <h3 className="font-semibold">{text.publishTitle}</h3>
          <p className="text-sm text-muted-foreground">{text.materialHelp}</p>
          <div className="flex gap-2">
            {(['fa', 'en'] as const).map((language) => (
              <button
                type="button"
                key={language}
                aria-pressed={previewLocale === language}
                disabled={publishing}
                onClick={() => setPreviewLocale(language)}
                className="rounded border px-3 py-1 aria-pressed:bg-blue-100"
              >
                {language === 'fa' ? text.persian : text.english}
              </button>
            ))}
          </div>
          <Suspense fallback={<p role="status">{text.previewLoading}</p>}>
            <TosPreview
              current={
                (previewLocale === 'fa'
                  ? versions.find((v) => v.isActive)?.contentFa
                  : versions.find((v) => v.isActive)?.contentEn) ?? ''
              }
              proposed={
                previewLocale === 'fa' ? publishVersion.contentFa : publishVersion.contentEn
              }
              locale={locale}
              language={previewLocale}
              onReady={markPreviewReady}
            />
          </Suspense>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={changeType === 'major'}
              disabled={publishing}
              onChange={(event) => setChangeType(event.target.checked ? 'major' : 'minor')}
            />
            {text.materialChange}
          </label>
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={publishing || !historyReady || loading || !previewReady}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {publishing ? text.publishing : text.publish}
            </button>
            <button
              disabled={publishing}
              onClick={() => {
                setPublishVersion(null);
                void fetchVersions();
              }}
              className="px-4 py-2 border border-input rounded hover:bg-muted"
            >
              {text.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Version detail modal (T-09.03.02) */}
      {viewVersion && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeView();
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="bg-card text-card-foreground rounded-lg shadow-xl sm:max-w-3xl w-full max-h-[85vh] flex flex-col p-0 gap-0"
          >
            {time.notice}
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {text.versionTitle} {viewVersion.versionId}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {text[viewVersion.status]} ·
                  {viewVersion.changeType && (
                    <span
                      className={`ms-1 inline-block px-2 py-0.5 text-xs rounded ${
                        viewVersion.changeType === 'major'
                          ? 'bg-danger-soft text-destructive'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {text[viewVersion.changeType]}
                    </span>
                  )}
                  {viewVersion.isActive && (
                    <span className="ms-2 text-success text-sm font-medium">✓ {text.active}</span>
                  )}
                </p>
              </div>
              <button
                onClick={closeView}
                aria-label={text.close}
                className="text-muted-foreground hover:text-muted-foreground text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Metadata */}
            <div className="px-6 py-3 bg-muted/40 border-b border-border grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{text.versionId}:</span>{' '}
                <span className="font-medium">{viewVersion.versionId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{text.author}:</span>{' '}
                <span className="font-medium">{viewVersion.createdBy ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{text.published}:</span>{' '}
                <span className="font-medium">{time.format(viewVersion.publishedAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{text.created}:</span>{' '}
                <span className="font-medium">{time.format(viewVersion.createdAt)}</span>
              </div>
            </div>

            {/* Locale toggle */}
            <div className="px-6 py-3 border-b border-border flex gap-2">
              <button
                onClick={() => setDetailLocale('fa')}
                className={`px-3 py-1 text-sm rounded ${
                  detailLocale === 'fa'
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted text-foreground hover:bg-accent'
                }`}
              >
                فارسی
              </button>
              <button
                onClick={() => setDetailLocale('en')}
                className={`px-3 py-1 text-sm rounded ${
                  detailLocale === 'en'
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted text-foreground hover:bg-accent'
                }`}
              >
                English
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <Suspense fallback={<p role="status">{text.previewLoading}</p>}>
                <TosContent
                  content={detailLocale === 'fa' ? viewVersion.contentFa : viewVersion.contentEn}
                  language={detailLocale}
                />
              </Suspense>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Version list */}
      <div className="bg-card text-card-foreground rounded-lg border border-border overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <caption className="sr-only">{text.history}</caption>
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.version}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.status}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.change}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.active}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.published}
              </th>
              <th className="px-4 py-3 text-start text-xs font-medium text-muted-foreground uppercase">
                {text.author}
              </th>
              <th className="px-4 py-3 text-end text-xs font-medium text-muted-foreground uppercase">
                {text.actions}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {historyReady && versions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {text.empty}
                </td>
              </tr>
            )}
            {versions.map((v) => (
              <tr key={v.id} className="hover:bg-muted">
                <td className="px-4 py-3 text-sm font-medium">{v.versionId}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      v.status === 'draft'
                        ? 'bg-warning-soft text-warning'
                        : 'bg-success-soft text-success'
                    }`}
                  >
                    {text[v.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {v.status === 'published' ? (
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded ${
                        v.changeType === 'major'
                          ? 'bg-danger-soft text-destructive'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {v.changeType ? text[v.changeType] : text.notRecorded}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {v.isActive ? (
                    <span className="text-success text-sm font-medium">✓ {text.active}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {time.format(v.publishedAt)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {v.createdBy ? (
                    <span className="font-mono text-xs" title={v.createdBy}>
                      {v.createdBy}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-end text-sm [&_button]:ms-2">
                  <button
                    onClick={() => openView(v)}
                    className="text-indigo-600 hover:text-indigo-800"
                  >
                    {text.view}
                  </button>
                  {v.status === 'draft' && (
                    <>
                      <button
                        onClick={() => openEdit(v)}
                        disabled={
                          !historyReady || loading || showEditor || !!publishVersion || discarding
                        }
                        className="text-blue-600 hover:text-blue-800 disabled:opacity-40"
                      >
                        {text.edit}
                      </button>
                      <button
                        onClick={() => {
                          setPublishVersion(v);
                          setPreviewLocale(locale);
                          setChangeType('minor');
                          setPreviewReady(false);
                          if (!v.revision) setError({ key: 'previewRequired' });
                        }}
                        disabled={
                          !historyReady || loading || showEditor || !!publishVersion || discarding
                        }
                        className="text-success hover:text-green-800 disabled:opacity-40"
                      >
                        {text.publish}
                      </button>
                      <button
                        onClick={() => handleDiscard(v)}
                        disabled={
                          !historyReady || loading || showEditor || !!publishVersion || discarding
                        }
                        className="text-destructive hover:text-red-800 disabled:opacity-40"
                      >
                        {text.discard}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
