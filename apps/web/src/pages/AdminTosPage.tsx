import { toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useDestructiveConfirm } from '../hooks/useDestructiveConfirm.js';
import { contentFormText } from '@barghsa/i18n/content-forms';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { emptyTermsDraft, termsInvalidFields, type TermsDraft } from '../lib/content-form.js';
import {
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { LoadingStatus, Alert } from '@barghsa/ui';
import { adminTosText } from './admin-tos-text.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { adminControlsText } from '@barghsa/i18n/admin-controls';
import { useLocale } from '../hooks/useLocale.js';
import {
  Button,
  ListPage,
  Dialog,
  DialogContent,
  DialogTitle,
  DateCell,
  TextCell,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
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

function responseCode(body: unknown): string | undefined {
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

import { isVersion, type TosVersion } from '../lib/content-catalogues.js';
/**
 * Admin TOS editor page (T-09.03.01) with version history (T-09.03.02).
 *
 * Lists all TOS versions with create, edit, publish, view, and discard actions.
 * Read-only version detail view shows full Persian and English content.
 */
export default function AdminTosPage() {
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const read = useManualServerRead();
  const time = useAccountTime();
  const locale = useLocale();
  const text = adminTosText(locale);
  const formText = (key: Parameters<typeof contentFormText>[0]) => contentFormText(key, locale);
  const messages = {
    versionId: formText('versionId'),
    contentFa: formText('contentFa'),
    contentEn: formText('contentEn'),
  };
  const editor = useWizardForm<TermsDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, termsInvalidFields);
    },
    emptyTermsDraft,
    formText('validationUnavailable')
  );
  const resetTerms = editor.form.reset;
  const applyFieldErrors = useActionFieldErrors(editor.form, messages, formText('invalid'));
  const [uncertainSave, setUncertainSave] = useState(false);

  const historyRequest = useRef(0);
  const historyController = useRef<AbortController | null>(null);
  const draftController = useRef<AbortController | null>(null);
  const writeRequests = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  const publishBaseline = useRef<string | null>(null);
  const saveInFlight = useRef(false);
  const [versions, setVersions] = useState<TosVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyAccepted, setHistoryAccepted] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const editorGeneration = useRef(0);
  const publishGeneration = useRef(0);
  const busyTokens = useRef({ save: 0, publish: 0, discard: 0 });
  const [error, setError] = useState<{ key: MessageKey; status?: number } | null>(null);

  // Draft editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRevision, setEditRevision] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const discardInFlight = useRef(false);
  const [versionId] = editor.field('versionId');
  const [contentFa, setContentFa] = editor.field('contentFa');
  const [contentEn, setContentEn] = editor.field('contentEn');
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
  const viewTrigger = useRef<HTMLButtonElement>(null);
  const [viewVersion, setViewVersion] = useState<TosVersion | null>(null);
  const [detailLocale, setDetailLocale] = useState<'fa' | 'en'>('fa');

  const resetEditorBusy = useCallback(() => {
    busyTokens.current.save++;
    saveInFlight.current = false;
    setSaving(false);
    editor.setValidationPending(false);
  }, [editor.setValidationPending]);
  const clearPrivate = useCallback(() => {
    resetEditorBusy();
    busyTokens.current.publish++;
    busyTokens.current.discard++;
    publishInFlight.current = false;
    discardInFlight.current = false;
    setPublishing(false);
    setDiscarding(false);
    historyRequest.current++;
    historyController.current?.abort();
    draftController.current?.abort();
    for (const request of writeRequests.current) request.abort();
    editorGeneration.current++;
    publishGeneration.current++;
    setVersions([]);
    setHistoryReady(false);
    setHistoryAccepted(false);
    setLoading(false);
    setShowEditor(false);
    setEditId(null);
    setEditRevision(null);
    setEditConflict(false);
    resetTerms(emptyTermsDraft());
    setUncertainSave(false);
    setPublishVersion(null);
    setPreviewReady(false);
    setViewVersion(null);
    setError({ key: 'denied' });
  }, [resetEditorBusy, resetTerms]);
  const scope = useCatalogueScope(clearPrivate);
  const confirmDestruction = useDestructiveConfirm(locale, scope.version);
  useEffect(() => {
    mounted.current = true;
    const writes = writeRequests.current;
    return () => {
      mounted.current = false;
      draftController.current?.abort();
      for (const request of writes) request.abort();
      editorGeneration.current++;
      publishGeneration.current++;
    };
  }, []);
  const currentEditor = useRef({ editId, editRevision });
  currentEditor.current = { editId, editRevision };
  const currentPublish = useRef(publishVersion);
  currentPublish.current = publishVersion;
  const fetchVersions = useCallback(async () => {
    if (scope.denied) return;
    if (editor.isPending()) {
      editorGeneration.current++;
      resetEditorBusy();
    }
    const epoch = scope.version,
      request = ++historyRequest.current;
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    const current = () =>
      mounted.current &&
      scope.live.current === epoch &&
      request === historyRequest.current &&
      !controller.signal.aborted;
    try {
      setLoading(true);
      setHistoryReady(false);
      setError(null);
      const path = '/api/admin/tos/versions';
      const key = queryKeys.catalogue.list(
        {
          context: 'staff',
          ownerId: accountId ?? scope.identity,
          accountId,
          revision: profileRevision,
        },
        new URLSearchParams({ endpoint: path, permission: String(epoch) })
      );
      const data = await read(key, controller.signal, async (signal) => {
        const res = await fetch(path, { signal });
        if (res.status === 401 || res.status === 403) return null;
        if (!res.ok) throw new TosUiError('historyFailed', res.status);
        const value: unknown = await res.json();
        if (
          !Array.isArray(value) ||
          !value.every(isVersion) ||
          new Set(value.map((v) => v.id)).size !== value.length ||
          value.filter((v) => v.status === 'draft').length > 1 ||
          value.filter((v) => v.isActive).length > 1
        )
          throw new TosUiError('invalidHistory');
        return value;
      });
      if (!current()) return;
      if (!data) {
        scope.deny();
        return;
      }
      const edited = currentEditor.current;
      if (
        edited.editId &&
        !data.some(
          (v) =>
            v.id === edited.editId && v.status === 'draft' && v.revision === edited.editRevision
        )
      ) {
        editorGeneration.current++;
        resetEditorBusy();
        setEditConflict(true);
        setError({ key: 'draftChanged' });
      }
      const preview = currentPublish.current;
      if (
        preview &&
        (!data.some(
          (v) => v.id === preview.id && v.status === 'draft' && v.revision === preview.revision
        ) ||
          (data.find((v) => v.isActive)?.revision ?? null) !== publishBaseline.current)
      ) {
        publishGeneration.current++;
        busyTokens.current.publish++;
        publishInFlight.current = false;
        setPublishing(false);
        setPublishVersion(null);
        setPreviewReady(false);
        refreshButton.current?.focus();
      }
      setVersions(data);
      setHistoryAccepted(true);
      setHistoryReady(true);
    } catch (err) {
      if (current()) setError(displayError(err, 'historyFailed'));
    } finally {
      if (current()) setLoading(false);
      if (historyController.current === controller) historyController.current = null;
    }
  }, [
    scope.denied,
    scope.version,
    scope.live,
    scope.deny,
    scope.identity,
    resetEditorBusy,
    editor.isPending,
    read,
    accountId,
    profileRevision,
  ]);

  useEffect(() => {
    void fetchVersions();
    return () => {
      historyRequest.current++;
      historyController.current?.abort();
      draftController.current?.abort();
    };
  }, [fetchVersions]);

  // Check if a draft already exists
  const savedDraft = versions.find((v) => v.status === 'draft');
  const hasDraft = !!savedDraft;

  function openCreate() {
    if (!historyReady || loading) return;
    editorGeneration.current++;
    resetEditorBusy();
    setEditId(null);
    setEditRevision(null);
    setEditConflict(false);
    resetTerms(emptyTermsDraft());
    setUncertainSave(false);
    setShowEditor(true);
  }

  function openEdit(v: TosVersion) {
    if (!historyReady || loading) return;
    if (!v.revision) {
      setError({ key: 'previewRequired' });
      return;
    }
    editorGeneration.current++;
    resetEditorBusy();
    setEditId(v.id);
    setEditRevision(v.revision);
    setEditConflict(false);
    resetTerms({ versionId: v.versionId, contentFa: v.contentFa, contentEn: v.contentEn });
    setUncertainSave(false);
    setShowEditor(true);
  }

  function openView(v: TosVersion, trigger: HTMLButtonElement) {
    if (!historyReady || loading || scope.denied) return;
    viewTrigger.current = trigger;
    setViewVersion(v);
    setDetailLocale(locale);
  }

  function closeView() {
    setViewVersion(null);
  }

  async function writeVersion(path: string, init: RequestInit) {
    const controller = new AbortController();
    writeRequests.current.add(controller);
    try {
      return await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(path, { ...init, signal });
        const { ok, status } = response;
        const body: unknown =
          (ok && status !== 204) || status === 400 || status === 409
            ? await response.json().catch(() => null)
            : null;
        return { ok, status, body };
      });
    } finally {
      writeRequests.current.delete(controller);
    }
  }

  function requireCurrentHistory() {
    historyRequest.current++;
    historyController.current?.abort();
    setLoading(false);
    setHistoryReady(false);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (
      saveInFlight.current ||
      !historyReady ||
      loading ||
      editConflict ||
      uncertainSave ||
      (!editId && hasDraft)
    )
      return;
    const epoch = scope.version,
      generation = editorGeneration.current;
    const current = () =>
      mounted.current && scope.live.current === epoch && generation === editorGeneration.current;
    const token = ++busyTokens.current.save;
    saveInFlight.current = true;
    setSaving(true);
    editor.setValidationPending(true);

    let requestSent = false;
    try {
      let captured: TermsDraft | undefined;
      await editor.form.handleSubmit((value) => {
        captured = value;
      })();
      if (!current() || !captured) return;
      editor.setValidationPending(false);
      const { versionId, contentFa, contentEn } = captured;
      editor.form.clearErrors('root');
      setError(null);
      if (editId && !editRevision) throw new TosUiError('previewRequired');
      const command = editId
        ? {
            expectedRevision: editRevision,
            ...(versionId ? { versionId } : {}),
            ...(contentFa ? { contentFa } : {}),
            ...(contentEn ? { contentEn } : {}),
          }
        : { versionId, contentFa, contentEn };
      requestSent = true;
      const { ok, status, body } = await writeVersion(
        editId ? `/api/admin/tos/versions/${editId}` : '/api/admin/tos/versions',
        {
          method: editId ? 'PUT' : 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(command),
        }
      );
      if (!current()) return;
      if (status === 401 || status === 403) {
        scope.deny();
        return;
      }
      if (status >= 500) throw new TosUiError('unconfirmedWrite', status);
      requestSent = ok;
      if (status === 409) {
        if (editId) {
          setEditConflict(true);
          throw new TosUiError('draftChanged');
        }
        if (responseCode(body) === 'TOS_VERSION_ID_TAKEN') throw new TosUiError('versionIdTaken');
        setHistoryReady(false);
        throw new TosUiError('createConflict');
      }
      if (!ok) {
        if (status === 400) {
          const fields =
            body &&
            typeof body === 'object' &&
            'error' in body &&
            body.error &&
            typeof body.error === 'object' &&
            'fields' in body.error
              ? body.error.fields
              : null;
          if (Array.isArray(fields) && applyFieldErrors(fields)) return;
        }
        throw new TosUiError('saveFailed', status);
      }
      if (
        !isVersion(body) ||
        !body.revision ||
        body.status !== 'draft' ||
        body.versionId !== versionId ||
        body.contentFa !== contentFa ||
        body.contentEn !== contentEn ||
        (editId && body.id !== editId)
      )
        throw new TosUiError('unconfirmedWrite');
      requestSent = false;
      historyRequest.current++;
      setVersions((previous) => [body, ...previous.filter((version) => version.id !== body.id)]);

      if (!current()) return;
      setShowEditor(false);
      toast.success(confirmationText('recorded', locale));
      await fetchVersions();
    } catch (err) {
      if (current()) {
        if (requestSent) {
          requireCurrentHistory();
          setUncertainSave(true);
        }
        const fallback = requestSent ? 'unconfirmedWrite' : 'saveFailed';
        setError(displayError(err, fallback));
        if (!requestSent && !(err instanceof TosUiError))
          editor.form.setError('root', { type: 'server', message: text.saveFailed });
      }
    } finally {
      if (token === busyTokens.current.save) {
        saveInFlight.current = false;
        setSaving(false);
        editor.setValidationPending(false);
      }
    }
  }

  async function reloadDraft() {
    if (!editId || saveInFlight.current || scope.denied || !historyReady || loading) return;
    const epoch = scope.version,
      generation = editorGeneration.current;
    const controller = new AbortController();
    draftController.current?.abort();
    draftController.current = controller;
    const current = () =>
      mounted.current && scope.live.current === epoch && generation === editorGeneration.current;
    const token = ++busyTokens.current.save;
    saveInFlight.current = true;
    setSaving(true);
    try {
      const path = `/api/admin/tos/versions/${editId}`;
      const key = queryKeys.catalogue.detail(
        {
          context: 'staff',
          ownerId: accountId ?? scope.identity,
          accountId,
          revision: profileRevision,
        },
        JSON.stringify([path, epoch])
      );
      const result = await read(key, controller.signal, async (signal) => {
        const response = await fetch(path, { signal });
        if (response.status === 401 || response.status === 403) return null;
        const value: unknown = await response.json();
        if (!response.ok || !isVersion(value) || value.id !== editId || !value.revision)
          throw new TosUiError('unconfirmedWrite');
        return value;
      });
      if (!current()) return;
      if (!result) {
        scope.deny();
        return;
      }
      if (result.status !== 'draft') {
        setShowEditor(false);
        await fetchVersions();
        return;
      }
      openEdit(result);
      setError(null);
    } catch (error) {
      if (current()) setError(displayError(error, 'historyFailed'));
    } finally {
      if (draftController.current === controller) draftController.current = null;
      if (token === busyTokens.current.save) {
        saveInFlight.current = false;
        setSaving(false);
      }
    }
  }

  async function handlePublish() {
    if (!publishVersion || !historyReady || loading || publishInFlight.current || !previewReady)
      return;
    if (!publishVersion.revision) {
      setError({ key: 'previewRequired' });
      return;
    }
    const epoch = scope.version,
      generation = publishGeneration.current;
    const current = () =>
      mounted.current && scope.live.current === epoch && generation === publishGeneration.current;
    const token = ++busyTokens.current.publish;
    publishInFlight.current = true;
    setPublishing(true);

    try {
      const {
        ok,
        status,
        body: result,
      } = await writeVersion(`/api/admin/tos/versions/${publishVersion.id}/publish`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ changeType, expectedRevision: publishVersion.revision }),
      });
      if (!current()) return;
      if (status === 401 || status === 403) {
        scope.deny();
        return;
      }
      if (status === 409) {
        setPreviewReady(false);
        throw new TosUiError('previewChanged');
      }
      if (status >= 500) throw new TosUiError('unconfirmedWrite', status);
      if (!ok) throw new TosUiError('publishFailed', status);
      if (
        !isVersion(result) ||
        result.id !== publishVersion.id ||
        result.status !== 'published' ||
        !result.isActive ||
        result.changeType !== changeType ||
        result.versionId !== publishVersion.versionId ||
        result.contentFa !== publishVersion.contentFa ||
        result.contentEn !== publishVersion.contentEn
      )
        throw new TosUiError('unconfirmedWrite');
      historyRequest.current++;
      setVersions((previous) => [
        result,
        ...previous.filter((v) => v.id !== result.id).map((v) => ({ ...v, isActive: false })),
      ]);
      setPublishVersion(null);
      toast.success(confirmationText('recorded', locale));
      await fetchVersions();
    } catch (err) {
      if (current()) {
        if (!(err instanceof TosUiError) || err.key === 'unconfirmedWrite') {
          requireCurrentHistory();
          setPublishVersion(null);
          setPreviewReady(false);
        }
        setError(displayError(err, 'unconfirmedWrite'));
      }
    } finally {
      if (token === busyTokens.current.publish) {
        publishInFlight.current = false;
        setPublishing(false);
      }
    }
  }

  async function handleDiscard(version: TosVersion) {
    if (!historyReady || loading || discardInFlight.current) return;
    if (!version.revision) {
      setError({ key: 'previewRequired' });
      return;
    }

    const epoch = scope.version;
    const current = () => mounted.current && scope.live.current === epoch;
    const historyOwner = historyRequest.current;
    const token = ++busyTokens.current.discard;
    discardInFlight.current = true;
    setDiscarding(true);
    let requestSent = false;
    try {
      if (
        !(await confirmDestruction(text.confirmDiscard, text.confirmDiscard)) ||
        !current() ||
        historyOwner !== historyRequest.current
      )
        return;
      requestSent = true;
      const { ok, status } = await writeVersion(
        `/api/admin/tos/versions/${version.id}?expectedRevision=${encodeURIComponent(version.revision)}`,
        {
          headers: withCsrf(),
          method: 'DELETE',
        }
      );
      if (!current()) return;
      if (status === 401 || status === 403) {
        scope.deny();
        return;
      }
      if (status === 409) {
        setHistoryReady(false);
        throw new TosUiError('draftChanged');
      }
      if (status >= 500 || (ok && status !== 204)) throw new TosUiError('unconfirmedWrite', status);
      if (status !== 204) throw new TosUiError('discardFailed', status);
      requestSent = false;
      historyRequest.current++;
      setVersions((previous) => previous.filter((v) => v.id !== version.id));
      toast.success(confirmationText('recorded', locale));
      await fetchVersions();
    } catch (err) {
      if (current()) {
        const unconfirmed =
          requestSent && (!(err instanceof TosUiError) || err.key === 'unconfirmedWrite');
        if (unconfirmed) requireCurrentHistory();
        setError(displayError(err, unconfirmed ? 'unconfirmedWrite' : 'discardFailed'));
      }
    } finally {
      if (token === busyTokens.current.discard) {
        discardInFlight.current = false;
        setDiscarding(false);
      }
    }
  }

  return (
    <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{text.title}</h1>
        {!hasDraft && !showEditor && (
          <Button
            onClick={openCreate}
            disabled={!historyReady || loading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded"
          >
            {text.newDraft}
          </Button>
        )}
      </div>

      {!scope.denied && error && (
        <div
          role="alert"
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded relative"
        >
          {text[error.key]}
          {error.status ? ` (HTTP ${error.status})` : ''}
          <Button
            aria-label={adminControlsText('dismissError', locale)}
            onClick={() => setError(null)}
            variant="ghost"
            className="absolute top-2 end-2 text-destructive"
          >
            ✕
          </Button>
        </div>
      )}

      {!scope.denied && !historyReady && !loading && (
        <Button type="button" onClick={fetchVersions} className="rounded border px-4 py-2">
          {text.retry}
        </Button>
      )}

      <ListPage>
        <ListPage.Toolbar>
          <Button
            ref={refreshButton}
            type="button"
            variant="outline"
            onClick={() => (scope.denied ? scope.recover() : void fetchVersions())}
          >
            {text.refresh}
          </Button>
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={!historyReady && !!error}
          empty={false}
          emptyView={null}
          retainContent={historyAccepted}
          loadingView={<LoadingStatus>{text.loading}</LoadingStatus>}
          errorView={scope.denied ? <p role="alert">{text.denied}</p> : null}
        >
          {historyAccepted && !scope.denied && (
            <>
              {/* Draft editor */}
              {showEditor && (
                <form
                  noValidate
                  onSubmit={handleSave}
                  className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
                >
                  <h2 className="text-lg font-semibold">
                    {editId ? text.editDraft : text.createNewDraft}
                  </h2>

                  {catalogueRootMessage(editor.errors) && (
                    <Alert variant="destructive">{catalogueRootMessage(editor.errors)}</Alert>
                  )}
                  {uncertainSave && <Alert variant="destructive">{formText('unverified')}</Alert>}
                  {uncertainSave && historyReady && !loading && !hasDraft && !editId && (
                    <Button type="button" variant="outline" onClick={openCreate}>
                      {formText('reset')}
                    </Button>
                  )}
                  <fieldset
                    disabled={saving || !historyReady || loading || editConflict || uncertainSave}
                    className="space-y-4"
                  >
                    <div>
                      <label
                        htmlFor="admintospage-field-1"
                        className="block text-sm font-medium text-foreground mb-1"
                      >
                        {text.versionId}{' '}
                        <span aria-hidden="true" className="text-destructive">
                          *
                        </span>
                      </label>
                      <input
                        {...editor.bind('versionId')}
                        id="admintospage-field-1"
                        type="text"
                        value={versionId}
                        onChange={(e) => editor.field('versionId')[1](e.target.value)}
                        className="w-full border border-input rounded px-3 py-2"
                        placeholder={text.versionExample}
                        maxLength={50}
                        required
                        aria-required="true"
                        disabled={!!editId || saving}
                      />
                      {editor.errors.versionId && (
                        <p
                          id={editor.errorId('versionId')}
                          role="alert"
                          className="text-sm text-destructive"
                        >
                          {editor.errors.versionId.message}
                        </p>
                      )}
                    </div>

                    <Suspense fallback={<p role="status">{text.editorLoading}</p>}>
                      <div className="space-y-2">
                        <p className="font-medium">
                          {text.persian} <span aria-hidden="true">*</span>
                        </p>
                        <TosRichText
                          text={text}
                          key={`${editId ?? 'new'}-${editRevision}-${editorGeneration.current}-fa`}
                          binding={editor.bind('contentFa')}
                          value={contentFa}
                          onChange={setContentFa}
                          label={text.persian}
                          language="fa"
                          disabled={
                            saving || !historyReady || loading || editConflict || uncertainSave
                          }
                        />
                        {editor.errors.contentFa && (
                          <p
                            id={editor.errorId('contentFa')}
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {editor.errors.contentFa.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="font-medium">
                          {text.english} <span aria-hidden="true">*</span>
                        </p>
                        <TosRichText
                          text={text}
                          key={`${editId ?? 'new'}-${editRevision}-${editorGeneration.current}-en`}
                          binding={editor.bind('contentEn')}
                          value={contentEn}
                          onChange={setContentEn}
                          label={text.english}
                          language="en"
                          disabled={
                            saving || !historyReady || loading || editConflict || uncertainSave
                          }
                        />
                      </div>
                      {editor.errors.contentEn && (
                        <p
                          id={editor.errorId('contentEn')}
                          role="alert"
                          className="text-sm text-destructive"
                        >
                          {editor.errors.contentEn.message}
                        </p>
                      )}
                    </Suspense>
                  </fieldset>

                  {!editId && savedDraft && historyReady && (
                    <div className="space-y-2">
                      <p role="status">{text.createConflict}</p>
                      <Button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          openEdit(savedDraft);
                          setError(null);
                        }}
                        className="rounded border px-4 py-2"
                      >
                        {text.openSavedDraft}
                      </Button>
                    </div>
                  )}
                  {(editConflict || uncertainSave) && editId && (
                    <Button
                      type="button"
                      onClick={reloadDraft}
                      disabled={saving || !historyReady || loading}
                      className="rounded border px-4 py-2"
                    >
                      {text.reloadDraft}
                    </Button>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <CatalogueSaveButton
                      pending={saving}
                      label={saving ? text.saving : editId ? text.updateDraft : text.createDraft}
                      disabled={
                        saving ||
                        !historyReady ||
                        loading ||
                        editConflict ||
                        uncertainSave ||
                        (!editId && hasDraft)
                      }
                    />
                    <Button
                      type="button"
                      onClick={() => {
                        editorGeneration.current++;
                        setShowEditor(false);
                      }}
                      disabled={saving}
                      className="px-4 py-2 border border-input rounded hover:bg-muted"
                    >
                      {text.cancel}
                    </Button>
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
                      <Button
                        type="button"
                        key={language}
                        aria-pressed={previewLocale === language}
                        disabled={publishing}
                        onClick={() => setPreviewLocale(language)}
                        variant="outline"
                        className="rounded border px-3 py-1 aria-pressed:bg-muted"
                      >
                        {language === 'fa' ? text.persian : text.english}
                      </Button>
                    ))}
                  </div>
                  <Suspense fallback={<p role="status">{text.previewLoading}</p>}>
                    <TosPreview
                      text={text}
                      current={
                        (previewLocale === 'fa'
                          ? versions.find((v) => v.isActive)?.contentFa
                          : versions.find((v) => v.isActive)?.contentEn) ?? ''
                      }
                      proposed={
                        previewLocale === 'fa' ? publishVersion.contentFa : publishVersion.contentEn
                      }
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
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={handlePublish}
                      disabled={publishing || !historyReady || loading || !previewReady}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
                    >
                      {publishing ? text.publishing : text.publish}
                    </Button>
                    <Button
                      disabled={publishing}
                      onClick={() => {
                        setPublishVersion(null);
                        void fetchVersions();
                      }}
                      className="px-4 py-2 border border-input rounded hover:bg-muted"
                    >
                      {text.cancel}
                    </Button>
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
                    finalFocus={() =>
                      viewTrigger.current?.isConnected && !viewTrigger.current.disabled
                        ? viewTrigger.current
                        : refreshButton.current
                    }
                    dir={locale === 'fa' ? 'rtl' : 'ltr'}
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
                            <span className="ms-2 text-success text-sm font-medium">
                              ✓ {text.active}
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        onClick={closeView}
                        aria-label={text.close}
                        variant="ghost"
                        className="text-muted-foreground text-xl leading-none"
                      >
                        ✕
                      </Button>
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
                      <Button
                        onClick={() => setDetailLocale('fa')}
                        className={`px-3 py-1 text-sm rounded ${
                          detailLocale === 'fa'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        فارسی
                      </Button>
                      <Button
                        onClick={() => setDetailLocale('en')}
                        className={`px-3 py-1 text-sm rounded ${
                          detailLocale === 'en'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        English
                      </Button>
                    </div>

                    {/* Content */}
                    <div className="px-6 py-4 overflow-y-auto flex-1">
                      <Suspense fallback={<p role="status">{text.previewLoading}</p>}>
                        <TosContent
                          content={
                            detailLocale === 'fa' ? viewVersion.contentFa : viewVersion.contentEn
                          }
                          language={detailLocale}
                        />
                      </Suspense>
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              <OperationalQueueTable
                locale={locale}
                rows={versions}
                caption={text.history}
                scrollLabel={text.history}
                nameHeader={text.version}
                renderName={(v) => <TextCell value={v.versionId} />}
                fields={[
                  {
                    id: 'status',
                    label: text.status,
                    render: (v) => (
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded ${
                          v.status === 'draft'
                            ? 'bg-warning-soft text-warning'
                            : 'bg-success-soft text-success'
                        }`}
                      >
                        {text[v.status]}
                      </span>
                    ),
                  },
                  {
                    id: 'change',
                    label: text.change,
                    render: (v) => (
                      <>
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
                      </>
                    ),
                  },
                  {
                    id: 'active',
                    label: text.active,
                    render: (v) => (
                      <>
                        {v.isActive ? (
                          <span className="text-success text-sm font-medium">✓ {text.active}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </>
                    ),
                  },
                  {
                    id: 'published',
                    label: text.published,
                    render: (v) => (
                      <DateCell value={v.publishedAt} format={() => time.format(v.publishedAt)} />
                    ),
                  },
                  {
                    id: 'author',
                    label: text.author,
                    render: (v) => (
                      <span dir="ltr" className="font-mono text-xs">
                        <TextCell value={v.createdBy} />
                      </span>
                    ),
                  },
                ]}
                actionHeader={text.actions}
                renderActions={(v) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={(event) => openView(v, event.currentTarget)}
                      variant="outline"
                      className="text-foreground hover:underline"
                    >
                      {text.view}
                    </Button>
                    {v.status === 'draft' && (
                      <>
                        <Button
                          onClick={() => openEdit(v)}
                          disabled={
                            !historyReady || loading || showEditor || !!publishVersion || discarding
                          }
                          variant="outline"
                          className="text-foreground hover:underline disabled:opacity-40"
                        >
                          {text.edit}
                        </Button>
                        <Button
                          onClick={() => {
                            publishBaseline.current =
                              versions.find((v) => v.isActive)?.revision ?? null;
                            publishGeneration.current++;
                            setPublishVersion(v);
                            setPreviewLocale(locale);
                            setChangeType('minor');
                            setPreviewReady(false);
                            if (!v.revision) setError({ key: 'previewRequired' });
                          }}
                          disabled={
                            !historyReady || loading || showEditor || !!publishVersion || discarding
                          }
                          variant="outline"
                          className="text-foreground hover:underline disabled:opacity-40"
                        >
                          {text.publish}
                        </Button>
                        <Button
                          onClick={() => handleDiscard(v)}
                          disabled={
                            !historyReady || loading || showEditor || !!publishVersion || discarding
                          }
                          variant="outline"
                          className="text-destructive hover:underline disabled:opacity-40"
                        >
                          {text.discard}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                cardHeading="h2"
                loading={loading}
                emptyMessage={text.empty}
                tableClassName="min-w-[64rem]"
              />
            </>
          )}
        </ListPage.Content>
      </ListPage>
    </div>
  );
}
