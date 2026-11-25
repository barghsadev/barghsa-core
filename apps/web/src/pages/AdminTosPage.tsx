import {
  Eye as TableEyeIcon,
  Pencil as TablePencilIcon,
  Trash2 as TableTrash2Icon,
  Upload as TableUploadIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
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
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { adminControlsText } from '@barghsa/i18n/admin-controls';
import { useLocale } from '../hooks/useLocale.js';
import { Link } from '@tanstack/react-router';
import {
  Button,
  Input,
  Label,
  ListRefreshButton,
  buttonVariants,
  ListPage,
  Dialog,
  DialogContent,
  DialogTitle,
  DateCell,
  TextCell,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react';
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
type TosAddress = { editing: string | null; viewing: string | null; publishing: string | null };
export type TosWorkspace = TosAddress & {
  set: (patch: Partial<TosAddress>, replace?: boolean) => void;
};

export default function AdminTosPage({ workspace }: { workspace?: TosWorkspace } = {}) {
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
  const address = useRef<string | null>(null);
  const requested = useRef<{ id: string | null; restore: boolean }>({ id: null, restore: false });
  const requestedEdit = workspace?.editing;
  const changeAddress = workspace?.set;
  const requestedPublish = workspace?.publishing;
  const exactId = workspace?.viewing ?? (requestedEdit !== 'new' ? requestedEdit : null);
  const recordRoute = !!(workspace?.viewing || requestedEdit || requestedPublish);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (recordRoute) heading.current?.focus({ preventScroll: true });
  }, [recordRoute]);
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
  const [localView, setViewVersion] = useState<TosVersion | null>(null);
  const viewVersion = workspace
    ? (versions.find((version) => version.id === workspace.viewing) ?? null)
    : localView;
  const [detailLocale, setDetailLocale] = useState<'fa' | 'en'>(locale);
  const openedPublication = useRef(false);

  const resetEditorBusy = useCallback(() => {
    busyTokens.current.save++;
    saveInFlight.current = false;
    setSaving(false);
    editor.setValidationPending(false);
  }, [editor.setValidationPending]);
  const clearPrivate = useCallback(() => {
    openedPublication.current = false;
    address.current = null;
    requested.current = { id: null, restore: false };
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
      const collection = '/api/admin/tos/versions';
      const path = exactId ? `${collection}/${encodeURIComponent(exactId)}` : collection;
      const owner = {
        context: 'staff' as const,
        ownerId: accountId ?? scope.identity,
        accountId,
        revision: profileRevision,
      };
      const key = exactId
        ? queryKeys.catalogue.detail(owner, JSON.stringify([path, epoch]))
        : queryKeys.catalogue.list(
            owner,
            new URLSearchParams({ endpoint: path, permission: String(epoch) })
          );
      const data = await read(key, controller.signal, async (signal) => {
        const res = await fetch(path, { signal });
        if (res.status === 401 || res.status === 403) return null;
        if (exactId && res.status === 404) throw new TosUiError('versionMissing');
        if (!res.ok) throw new TosUiError('historyFailed', res.status);
        const value: unknown = await res.json();
        if (exactId) {
          if (!isVersion(value) || value.id !== exactId) throw new TosUiError('invalidHistory');
          return [value];
        }
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
        if (requestedPublish) setError({ key: 'previewChanged' });
        refreshButton.current?.focus();
      }
      setVersions(data);
      setHistoryAccepted(true);
      setHistoryReady(true);
    } catch (err) {
      if (current()) {
        if (err instanceof TosUiError && err.key === 'versionMissing') {
          setVersions([]);
          setHistoryAccepted(false);
          setShowEditor(false);
        }
        setError(displayError(err, 'historyFailed'));
      }
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
    exactId,
    requestedPublish,
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

  function navigateEditor(id: string | null, replace = false) {
    address.current = id;
    requested.current.restore = false;
    changeAddress?.({ editing: id }, replace);
  }

  function resetEditor() {
    editorGeneration.current++;
    resetEditorBusy();
    draftController.current?.abort();
    setShowEditor(false);
    setEditId(null);
    setEditRevision(null);
    setEditConflict(false);
    setUncertainSave(false);
    resetTerms(emptyTermsDraft());
  }

  function openCreate(publish = true) {
    if (!historyReady || loading) return;
    editorGeneration.current++;
    resetEditorBusy();
    setEditId(null);
    setEditRevision(null);
    setEditConflict(false);
    resetTerms(emptyTermsDraft());
    setUncertainSave(false);
    setShowEditor(true);
    if (publish) navigateEditor('new');
  }

  function openEdit(v: TosVersion, publish = true) {
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
    if (publish) navigateEditor(v.id);
  }

  function openView(v: TosVersion, trigger: HTMLButtonElement) {
    if (!historyReady || loading || scope.denied) return;
    viewTrigger.current = trigger;
    if (changeAddress) changeAddress({ viewing: v.id });
    else setViewVersion(v);
    setDetailLocale(locale);
  }

  function closeView() {
    if (changeAddress) changeAddress({ viewing: null });
    else setViewVersion(null);
  }

  useLayoutEffect(() => {
    if (requestedEdit === undefined || scope.denied) return;
    if (requested.current.id !== requestedEdit) {
      const restore = address.current !== requestedEdit;
      if (restore) resetEditor();
      requested.current = { id: requestedEdit, restore };
    }
    if (!requested.current.restore || !historyReady || loading) return;
    requested.current.restore = false;
    address.current = requestedEdit;
    if (requestedEdit === 'new' && !savedDraft) openCreate(false);
    else if (savedDraft && savedDraft.id === requestedEdit) openEdit(savedDraft, false);
    else if (requestedEdit !== null)
      setError({ key: requestedEdit === 'new' ? 'createConflict' : 'draftChanged' });
  }, [requestedEdit, historyReady, loading, savedDraft, scope.denied]);

  function openPublication(version: TosVersion) {
    publishBaseline.current = versions.find((v) => v.isActive)?.revision ?? null;
    publishGeneration.current++;
    setPublishVersion(version);
    setPreviewLocale(locale);
    setChangeType('minor');
    setPreviewReady(false);
    if (!version.revision) setError({ key: 'previewRequired' });
  }

  useLayoutEffect(() => {
    if (!requestedPublish || openedPublication.current || !historyReady || loading || scope.denied)
      return;
    openedPublication.current = true;
    if (savedDraft?.id === requestedPublish) openPublication(savedDraft);
    else setError({ key: 'publishUnavailable' });
  }, [requestedPublish, historyReady, loading, savedDraft, scope.denied]);

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
      if (changeAddress) changeAddress({ viewing: body.id }, true);
      else {
        navigateEditor(null, true);
        await fetchVersions();
      }
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
        if (changeAddress) changeAddress({ viewing: result.id }, true);
        else {
          navigateEditor(null, true);
          await fetchVersions();
        }
        return;
      }
      openEdit(result, false);
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
      if (changeAddress) changeAddress({ viewing: result.id }, true);
      else await fetchVersions();
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
      if (workspace?.viewing) changeAddress?.({}, true);
      else await fetchVersions();
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

  const recordTitle = requestedPublish
    ? text.publishTitle
    : requestedEdit === 'new'
      ? text.createNewDraft
      : requestedEdit
        ? text.editDraft
        : workspace?.viewing
          ? text.versionTitle
          : text.title;
  const openRecord = (id: string, action?: 'edit' | 'publish') => ({
    to: '/admin/tos/versions/$versionId/{-$action}' as const,
    params: { versionId: id, action },
  });
  const activeVersion = versions.find((version) => version.isActive);
  const versionDetails = viewVersion && (
    <div className="space-y-5">
      <dl className="grid gap-4 rounded-xl border bg-muted/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{text.status}</dt>
          <dd className="font-medium">
            {text[viewVersion.status]}
            {viewVersion.isActive && (
              <span className="ms-2 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">
                {text.active}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{text.change}</dt>
          <dd className="font-medium">
            {viewVersion.changeType ? text[viewVersion.changeType] : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{text.author}</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">
            <bdi>{viewVersion.createdBy ?? '—'}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {viewVersion.publishedAt ? text.published : text.created}
          </dt>
          <dd className="font-medium">
            {time.format(viewVersion.publishedAt ?? viewVersion.createdAt)}
          </dd>
        </div>
      </dl>
      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {(['fa', 'en'] as const).map((language) => (
            <Button
              key={language}
              type="button"
              variant={detailLocale === language ? 'secondary' : 'outline'}
              aria-pressed={detailLocale === language}
              lang={language}
              onClick={() => setDetailLocale(language)}
            >
              {language === 'fa' ? 'فارسی' : 'English'}
            </Button>
          ))}
        </div>
        <Suspense fallback={<p role="status">{text.previewLoading}</p>}>
          <TosContent
            content={detailLocale === 'fa' ? viewVersion.contentFa : viewVersion.contentEn}
            language={detailLocale}
          />
        </Suspense>
      </section>
    </div>
  );

  return (
    <div
      className={recordRoute ? 'mx-auto w-full max-w-4xl space-y-4' : 'space-y-6'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {recordRoute && (
            <Link
              to="/admin/tos"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {text.history}
            </Link>
          )}
          <h1
            ref={heading}
            tabIndex={recordRoute ? -1 : undefined}
            className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {recordTitle}
            {workspace?.viewing && viewVersion && (
              <>
                {' '}
                <bdi>{viewVersion.versionId}</bdi>
              </>
            )}
          </h1>
        </div>
        {recordRoute && (
          <ListRefreshButton
            ref={refreshButton}
            label={text.refresh}
            onClick={() => (scope.denied ? scope.recover() : void fetchVersions())}
          />
        )}
        {!recordRoute &&
          !hasDraft &&
          !showEditor &&
          (workspace && historyReady && !loading ? (
            <Link {...openRecord('new')} className={buttonVariants({ className: 'min-h-11' })}>
              {text.newDraft}
            </Link>
          ) : (
            <Button
              onClick={() => openCreate()}
              disabled={!historyReady || loading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded"
            >
              {text.newDraft}
            </Button>
          ))}
      </div>
      {!recordRoute && workspace && activeVersion && !scope.denied && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{text.currentVersion}</p>
            <p className="font-medium">
              <bdi>{activeVersion.versionId}</bdi>
            </p>
            {activeVersion.publishedAt && (
              <p className="text-sm text-muted-foreground">
                {time.format(activeVersion.publishedAt)}
              </p>
            )}
          </div>
          <Link
            {...openRecord(activeVersion.id)}
            className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
          >
            {text.view}
          </Link>
        </div>
      )}

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
        {!recordRoute && (
          <ListPage.Toolbar>
            <ListRefreshButton
              ref={refreshButton}
              label={text.refresh}
              onClick={() => (scope.denied ? scope.recover() : void fetchVersions())}
            />
          </ListPage.Toolbar>
        )}
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
                <form noValidate onSubmit={handleSave} className={recordEditorSurface}>
                  <div className="space-y-2 px-4 py-4 sm:px-6">
                    {!recordRoute && (
                      <h2 className="text-lg font-semibold">
                        {editId ? text.editDraft : text.createNewDraft}
                      </h2>
                    )}

                    {catalogueRootMessage(editor.errors) && (
                      <Alert variant="destructive">{catalogueRootMessage(editor.errors)}</Alert>
                    )}
                    {uncertainSave && <Alert variant="destructive">{formText('unverified')}</Alert>}
                    {uncertainSave && historyReady && !loading && !hasDraft && !editId && (
                      <Button type="button" variant="outline" onClick={() => openCreate()}>
                        {formText('reset')}
                      </Button>
                    )}
                    <fieldset
                      disabled={saving || !historyReady || loading || editConflict || uncertainSave}
                      className="m-0 min-w-0 space-y-3 border-0 p-0"
                    >
                      <div className={recordEditorField}>
                        <Label htmlFor="admintospage-field-1">
                          {text.versionId}{' '}
                          <span aria-hidden="true" className="text-destructive">
                            *
                          </span>
                        </Label>
                        <Input
                          {...editor.bind('versionId')}
                          dir="ltr"
                          autoComplete="off"
                          id="admintospage-field-1"
                          type="text"
                          value={versionId}
                          onChange={(e) => editor.field('versionId')[1](e.target.value)}
                          className="max-w-40"
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
                        <div className="grid min-w-0 items-start gap-4 border-t pt-3 lg:grid-cols-2">
                          <div className="min-w-0 space-y-2">
                            <p className="text-sm font-semibold">
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
                          <div className="min-w-0 space-y-2">
                            <p className="text-sm font-semibold">
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
                            {editor.errors.contentEn && (
                              <p
                                id={editor.errorId('contentEn')}
                                role="alert"
                                className="text-sm text-destructive"
                              >
                                {editor.errors.contentEn.message}
                              </p>
                            )}
                          </div>
                        </div>
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
                  </div>
                  <RecordEditorActions>
                    <Button
                      type="button"
                      onClick={() => {
                        resetEditor();
                        if (changeAddress && editId) changeAddress({ viewing: editId });
                        else navigateEditor(null);
                      }}
                      disabled={saving}
                      variant="outline"
                    >
                      {text.cancel}
                    </Button>
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
                  </RecordEditorActions>
                </form>
              )}

              {/* Publish dialog */}
              {publishVersion && (
                <div role="region" aria-label={text.publishTitle} className={recordEditorSurface}>
                  <div className="space-y-3 px-4 py-4 sm:px-6">
                    {!recordRoute && <h3 className="font-semibold">{text.publishTitle}</h3>}
                    <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">{text.currentVersion}</dt>
                        <dd>
                          {activeVersion ? <bdi>{activeVersion.versionId}</bdi> : text.noCurrent}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{text.proposedVersion}</dt>
                        <dd>
                          <bdi>{publishVersion.versionId}</bdi>
                        </dd>
                      </div>
                    </dl>
                    <p className="text-sm text-muted-foreground">{text.effectiveOnPublish}</p>
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
                          className="aria-pressed:bg-muted"
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
                          previewLocale === 'fa'
                            ? publishVersion.contentFa
                            : publishVersion.contentEn
                        }
                        language={previewLocale}
                        onReady={markPreviewReady}
                      />
                    </Suspense>
                    <label className="touch-label flex cursor-pointer items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={changeType === 'major'}
                        disabled={publishing}
                        onChange={(event) =>
                          setChangeType(event.target.checked ? 'major' : 'minor')
                        }
                      />
                      {text.materialChange}
                    </label>
                  </div>
                  <RecordEditorActions>
                    <Button
                      disabled={publishing}
                      onClick={() => {
                        setPublishVersion(null);
                        if (changeAddress) changeAddress({ viewing: publishVersion.id });
                        else void fetchVersions();
                      }}
                      type="button"
                      variant="outline"
                    >
                      {text.cancel}
                    </Button>
                    <Button
                      onClick={handlePublish}
                      disabled={publishing || !historyReady || loading || !previewReady}
                      type="button"
                    >
                      {publishing ? text.publishing : text.publish}
                    </Button>
                  </RecordEditorActions>
                </div>
              )}

              {workspace?.viewing && viewVersion && (
                <div className="space-y-4">
                  {viewVersion.status === 'published' && (
                    <Link
                      to="/terms/$version"
                      params={{ version: viewVersion.id }}
                      search={{ lang: detailLocale }}
                      className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                    >
                      {text.publicVersion}
                    </Link>
                  )}
                  {viewVersion.status === 'draft' && historyReady && !loading && (
                    <div className="flex flex-wrap gap-2">
                      <Link
                        {...openRecord(viewVersion.id, 'edit')}
                        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                      >
                        {text.editDraft}
                      </Link>
                      <Link
                        {...openRecord(viewVersion.id, 'publish')}
                        className={buttonVariants({ className: 'min-h-11' })}
                      >
                        {text.publish}
                      </Link>
                      <Button
                        variant="outline"
                        disabled={discarding}
                        onClick={() => handleDiscard(viewVersion)}
                      >
                        {text.discard}
                      </Button>
                    </div>
                  )}
                  {versionDetails}
                </div>
              )}
              {!workspace && viewVersion && (
                <Dialog
                  open
                  onOpenChange={(open) => {
                    if (!open) closeView();
                  }}
                >
                  <DialogContent
                    showCloseButton={false}
                    finalFocus={() =>
                      viewTrigger.current?.isConnected &&
                      viewTrigger.current.getClientRects().length > 0 &&
                      !viewTrigger.current.disabled
                        ? viewTrigger.current
                        : refreshButton.current
                    }
                    dir={locale === 'fa' ? 'rtl' : 'ltr'}
                    className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <DialogTitle>
                        {text.versionTitle} <bdi>{viewVersion.versionId}</bdi>
                      </DialogTitle>
                      <Button
                        type="button"
                        onClick={closeView}
                        aria-label={text.close}
                        variant="ghost"
                      >
                        ✕
                      </Button>
                    </div>
                    {versionDetails}
                  </DialogContent>
                </Dialog>
              )}
              {requestedEdit === 'new' && savedDraft && !showEditor && historyReady && (
                <Link
                  {...openRecord(savedDraft.id, 'edit')}
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                >
                  {text.editDraft}
                </Link>
              )}
              {requestedPublish && !publishVersion && historyReady && (
                <Link
                  {...openRecord(requestedPublish)}
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                >
                  {text.view}
                </Link>
              )}

              {!recordRoute && (
                <OperationalQueueTable
                  locale={locale}
                  rows={versions}
                  caption={text.history}
                  scrollLabel={text.history}
                  nameHeader={text.version}
                  renderName={(v) =>
                    workspace && historyReady && !loading ? (
                      <Link
                        {...openRecord(v.id)}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{v.versionId}</bdi>
                      </Link>
                    ) : (
                      <TextCell value={v.versionId} />
                    )
                  }
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
                            <span className="text-success text-sm font-medium">
                              ✓ {text.active}
                            </span>
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
                      {workspace && historyReady && !loading ? (
                        <Link
                          {...openRecord(v.id)}
                          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                          data-table-action-tooltip={text.view}
                        >
                          <TableActionIcon icon={TableEyeIcon}>{text.view}</TableActionIcon>
                        </Link>
                      ) : (
                        <Button
                          onClick={(event) => openView(v, event.currentTarget)}
                          variant="outline"
                          disabled={!historyReady || loading}
                          data-table-action-tooltip={text.view}
                        >
                          <TableActionIcon icon={TableEyeIcon}>{text.view}</TableActionIcon>
                        </Button>
                      )}
                      {v.status === 'draft' && (
                        <>
                          {workspace && historyReady && !loading ? (
                            <>
                              <Link
                                {...openRecord(v.id, 'edit')}
                                className={buttonVariants({
                                  variant: 'outline',
                                  className: 'min-h-11',
                                })}
                                data-table-action-tooltip={text.edit}
                              >
                                <TableActionIcon icon={TablePencilIcon}>
                                  {text.edit}
                                </TableActionIcon>
                              </Link>
                              <Link
                                {...openRecord(v.id, 'publish')}
                                className={buttonVariants({
                                  variant: 'outline',
                                  className: 'min-h-11',
                                })}
                                data-table-action-tooltip={text.publish}
                              >
                                <TableActionIcon icon={TableUploadIcon}>
                                  {text.publish}
                                </TableActionIcon>
                              </Link>
                            </>
                          ) : (
                            <>
                              <Button
                                onClick={() => openEdit(v)}
                                disabled={
                                  !historyReady ||
                                  loading ||
                                  showEditor ||
                                  !!publishVersion ||
                                  discarding
                                }
                                variant="outline"
                                data-table-action-tooltip={text.edit}
                              >
                                <TableActionIcon icon={TablePencilIcon}>
                                  {text.edit}
                                </TableActionIcon>
                              </Button>
                              <Button
                                onClick={() => openPublication(v)}
                                disabled={
                                  !historyReady ||
                                  loading ||
                                  showEditor ||
                                  !!publishVersion ||
                                  discarding
                                }
                                variant="outline"
                                data-table-action-tooltip={text.publish}
                              >
                                <TableActionIcon icon={TableUploadIcon}>
                                  {text.publish}
                                </TableActionIcon>
                              </Button>
                            </>
                          )}
                          <Button
                            onClick={() => handleDiscard(v)}
                            disabled={
                              !historyReady ||
                              loading ||
                              showEditor ||
                              !!publishVersion ||
                              discarding
                            }
                            variant="outline"
                            className="text-destructive hover:underline disabled:opacity-40"
                            data-table-action-tooltip={text.discard}
                          >
                            <TableActionIcon icon={TableTrash2Icon}>{text.discard}</TableActionIcon>
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
              )}
            </>
          )}
        </ListPage.Content>
      </ListPage>
    </div>
  );
}
