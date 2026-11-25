import {
  Eye as TableEyeIcon,
  FileUp,
  Pencil as TablePencilIcon,
  Trash2 as TableTrash2Icon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { Link } from '@tanstack/react-router';
import { contentFormText } from '@barghsa/i18n/content-forms';
import { LoadingStatus, Alert } from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  emptyContractTemplateDraft,
  contractTemplateInvalidFields,
  type ContractTemplateDraft,
} from '../lib/content-form.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  DateCell,
  TextCell,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
  recordFilePicker,
  recordFilePickerAction,
  recordFilePickerHelp,
} from '../components/RecordEditorLayout.js';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { extractContractTemplatePlaceholders } from '@barghsa/shared/admin';
import type {
  ContractTemplateDto,
  ContractTemplateDetailDto,
  ContractTemplateVersionDto,
} from '@barghsa/shared/admin';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  contractTemplateRoutes as routes,
  type ContractTemplateView,
} from '../lib/template-catalogue-routes.js';
type Draft = ContractTemplateDraft;
type Upload = { fileName: string; contentType: string; content: string };
type UploadReview = Upload & { placeholders: string[] };
const MAX_BYTES = 10 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
function validVersion(value: unknown): value is ContractTemplateVersionDto {
  return (
    record(value) &&
    integer(value.versionNumber, 1) &&
    typeof value.storageKey === 'string' &&
    typeof value.fileName === 'string' &&
    (value.contentType === null || typeof value.contentType === 'string') &&
    (value.fileSize === null || integer(value.fileSize)) &&
    Array.isArray(value.placeholders) &&
    value.placeholders.every((item) => typeof item === 'string') &&
    typeof value.createdBy === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}
function validTemplate(value: unknown): value is ContractTemplateDto {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) &&
    typeof value.name === 'string' &&
    (value.description === null || typeof value.description === 'string') &&
    (value.status === 'active' || value.status === 'inactive') &&
    integer(value.versionCount) &&
    (value.latestVersion === null || validVersion(value.latestVersion))
  );
}
const validList = (value: unknown): value is ContractTemplateDto[] =>
  Array.isArray(value) &&
  value.every(validTemplate) &&
  new Set(value.map((row) => row.id)).size === value.length;
const validDetail = (value: unknown): value is ContractTemplateDetailDto =>
  validTemplate(value) &&
  record(value) &&
  Array.isArray(value.versions) &&
  value.versions.every(validVersion) &&
  value.versions.length === value.versionCount &&
  new Set(value.versions.map((v) => v.versionNumber)).size === value.versions.length;
const metadata = (row: ContractTemplateDto) =>
  JSON.stringify([row.id, row.name, row.description, row.status]);
const basis = (row: ContractTemplateDto) =>
  JSON.stringify([metadata(row), row.versionCount, row.latestVersion]);
const draftOf = (row: ContractTemplateDto): Draft => ({
  name: row.name,
  description: row.description ?? '',
  status: row.status,
});
type WorkspaceProps = {
  view?: ContractTemplateView;
  templateId?: string;
  onSettled?: (id?: string, version?: number) => void;
};

export default function AdminContractTemplatesPage(props: WorkspaceProps = {}) {
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedContractTemplatesPage key={JSON.stringify([account, revision])} {...props} />;
}

function OwnedContractTemplatesPage({ view, templateId, onSettled }: WorkspaceProps) {
  const showList = !view || view === 'list';
  const showEditor = !view || view === 'new' || view === 'edit';
  const catalogueNeeded = showList || view === 'new';
  const time = useAccountTime(undefined, showList || view === 'detail');
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = view ? (view === 'new' ? 'new' : (templateId ?? null)) : localSelected;
  const editorSelection = useRef(selected);
  const select = useCallback((id: string | null) => {
    editorSelection.current = id;
    setLocalSelected(id);
  }, []);
  const formText = (key: Parameters<typeof contentFormText>[0]) => contentFormText(key, locale);
  const messages = {
    name: formText('name'),
    description: formText('description'),
    status: formText('status'),
  };
  const editor = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, contractTemplateInvalidFields);
    },
    emptyContractTemplateDraft,
    formText('validationUnavailable')
  );
  const resetTemplate = editor.form.reset;
  const registerTemplate = editor.form.register;
  const statusRef = useCallback(
    (node: HTMLInputElement | null) => {
      registerTemplate('status').ref(node ? { focus: () => node.focus() } : null);
    },
    [registerTemplate]
  );
  const draft = selected && showEditor ? editor.values : null;
  const setDraft = (value: Draft) => {
    for (const field of ['name', 'description', 'status'] as const)
      editor.form.setValue(field, value[field], {
        shouldDirty: true,
        shouldValidate:
          editor.form.getFieldState(field).isTouched || editor.form.getFieldState(field).invalid,
      });
  };
  const applyFieldErrors = useActionFieldErrors(editor.form, messages, formText('invalid'));
  const [needsReset, setNeedsReset] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const validationBusy = useRef(false);
  const invalidFocus = useRef<{ field: keyof Draft; generation: number } | null>(null);

  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [upload, setUpload] = useState<UploadReview | null>(null),
    [fileError, setFileError] = useState(false),
    [reading, setReading] = useState(false);
  const fileGeneration = useRef(0),
    workGeneration = useRef(0),
    fileInput = useRef<HTMLInputElement>(null);
  const actionRef = useRef<TeamAction | null>(null),
    acceptedDetail = useRef<ContractTemplateDetailDto | null>(null);
  const acceptedRows = useRef<ContractTemplateDto[] | null>(null);
  const closeAction = useCallback(() => {
    workGeneration.current++;
    validationBusy.current = false;
    editor.setValidationPending(false);
    actionRef.current = null;
    setAction(null);
  }, [editor.setValidationPending]);
  const resetEditor = useCallback(() => {
    closeAction();
    fileGeneration.current++;
    acceptedDetail.current = null;
    resetTemplate(emptyContractTemplateDraft());
    setNeedsReset(false);
    setUncertain(false);
    setRecoveryReady(false);
    setUpload(null);
    setFileError(false);
    setReading(false);
    setSaved(false);
    if (fileInput.current) fileInput.current.value = '';
  }, [closeAction, resetTemplate]);
  const clearEditor = useCallback(() => {
    resetEditor();
    if (!view && editorSelection.current !== null) select(null);
  }, [resetEditor, select, view]);
  useLayoutEffect(() => {
    if (editorSelection.current === selected) return;
    editorSelection.current = selected;
    resetEditor();
  }, [selected, resetEditor]);
  const denied = useCallback(() => {
    acceptedRows.current = null;
    clearEditor();
  }, [clearEditor]);
  const scope = useCatalogueScope(denied);
  const catalogue = useCatalogueResource(
    scope,
    catalogueNeeded ? '/api/admin/contract-templates' : null,
    validList
  );
  const validateSelected = useCallback(
    (value: unknown): value is ContractTemplateDetailDto =>
      validDetail(value) && value.id === selected,
    [selected]
  );
  const history = useCatalogueResource(
    scope,
    selected && selected !== 'new' ? `/api/admin/contract-templates/${selected}` : null,
    validateSelected,
    { clearOnMissing: !!view }
  );
  const rows = catalogue.data ?? [],
    detail = history.data;
  const listReady =
    !scope.denied &&
    (!catalogueNeeded || (!catalogue.loading && !catalogue.error && catalogue.data !== null));
  const detailReady =
    selected === 'new' ||
    (!!detail && !history.loading && !history.error && acceptedDetail.current?.id === detail.id);
  const ready = listReady && detailReady && !needsReset && !uncertain;
  useEffect(() => {
    if (editor.pending || !ready || action) return;
    const target = invalidFocus.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      invalidFocus.current = null;
      if (target.generation === workGeneration.current) editor.form.setFocus(target.field);
    });
    return () => cancelAnimationFrame(frame);
  }, [editor.pending, editor.errors, editor.form.setFocus, ready, action]);
  useEffect(
    () => () => {
      workGeneration.current++;
      fileGeneration.current++;
      actionRef.current = null;
    },
    []
  );
  useEffect(() => {
    if (!catalogue.data || catalogue.loading || catalogue.error) return;
    const previous = acceptedRows.current;
    acceptedRows.current = catalogue.data;
    if (actionRef.current?.method === 'DELETE') {
      const id = actionRef.current.path.split('/').at(-1);
      const before = previous?.find((row) => row.id === id),
        after = catalogue.data.find((row) => row.id === id);
      if (!after || (before && basis(before) !== basis(after))) closeAction();
    }
    if (!selected || selected === 'new') return;
    const next = catalogue.data.find((row) => row.id === selected);
    if (!next) {
      clearEditor();
      return;
    }
    const before = previous?.find((row) => row.id === selected);
    if (before && basis(before) !== basis(next)) {
      closeAction();
      setNeedsReset(true);
      setRecoveryReady(false);
      history.retry();
    }
  }, [
    catalogue.data,
    catalogue.loading,
    catalogue.error,
    selected,
    closeAction,
    clearEditor,
    history.retry,
  ]);
  useEffect(() => {
    if (history.missing) resetEditor();
  }, [history.missing, resetEditor]);
  useEffect(() => {
    if (!detail || history.loading || history.error) return;
    const previous = acceptedDetail.current;
    if (!previous) resetTemplate(draftOf(detail));
    else if (metadata(previous) !== metadata(detail)) {
      setNeedsReset(true);
      setRecoveryReady(true);
    }
    if (
      previous &&
      (basis(previous) !== basis(detail) ||
        JSON.stringify(previous.versions) !== JSON.stringify(detail.versions))
    )
      closeAction();
    acceptedDetail.current = detail;
  }, [detail, history.loading, history.error, closeAction, resetTemplate]);
  function chooseEditor(value: string | null) {
    if (value === selected) {
      if (history.error) history.retry();
      return;
    }
    resetEditor();
    select(value);
  }
  function refresh() {
    if (validationBusy.current || uncertain) closeAction();
    setRecoveryReady(false);
    if (scope.denied) scope.recover();
    else {
      if (catalogueNeeded) catalogue.retry();
      if (selected && selected !== 'new') history.retry();
    }
  }
  useEffect(() => {
    if ((uncertain || needsReset) && listReady && detailReady) setRecoveryReady(true);
  }, [uncertain, needsReset, listReady, detailReady]);
  function resetSaved() {
    if (!listReady || !detailReady || !recoveryReady || actionRef.current || validationBusy.current)
      return;
    closeAction();
    resetTemplate(
      selected === 'new'
        ? emptyContractTemplateDraft()
        : detail
          ? draftOf(detail)
          : emptyContractTemplateDraft()
    );
    fileGeneration.current++;
    setUpload(null);
    setReading(false);
    setNeedsReset(false);
    setUncertain(false);
  }
  function unconfirmed() {
    setUncertain(true);
    setRecoveryReady(false);
    catalogue.retry();
    if (selected !== 'new') history.retry();
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    if (
      !listReady ||
      uncertain ||
      needsReset ||
      validationBusy.current ||
      actionRef.current ||
      (method !== 'DELETE' && !detailReady)
    )
      return;
    closeAction();
    setSaved(false);
    const next: TeamAction = {
      path,
      method,
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      conflictMessage: label('conflict'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        CONTRACT_TEMPLATE_ALREADY_EXISTS: label('duplicate'),
        CONTRACT_TEMPLATE_VERSIONED: label('versioned'),
        CONTRACT_TEMPLATE_REFERENCED: label('referenced'),
        CONTRACT_TEMPLATE_STORAGE_DISABLED: label('storageUnavailable'),
        CONTRACT_TEMPLATE_NOT_FOUND: label('missing'),
      },
    };
    actionRef.current = next;
    setAction(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !selected || !ready || actionRef.current || validationBusy.current) return;
    const generation = workGeneration.current;
    validationBusy.current = true;
    editor.setValidationPending(true);
    try {
      let captured: Draft | undefined;
      await editor.form.handleSubmit(
        (value) => {
          captured = value;
        },
        (errors) => {
          // Safari needs the fieldset's unlocked DOM commit before native focus.
          if (generation === workGeneration.current) {
            const field = (['name', 'description', 'status'] as const).find(
              (field) => errors[field]
            );
            invalidFocus.current = field ? { field, generation } : null;
            validationBusy.current = false;
            editor.setValidationPending(false);
          }
        }
      )();
      if (generation !== workGeneration.current || scope.denied || !captured) return;
      validationBusy.current = false;
      editor.setValidationPending(false);
      propose(
        `/api/admin/contract-templates${selected === 'new' ? '' : `/${selected}`}`,
        selected === 'new' ? 'POST' : 'PATCH',
        label('save'),
        label('confirmSave'),
        {
          name: captured.name.trim(),
          description: captured.description,
          ...(selected === 'new' ? {} : { status: captured.status }),
        }
      );
    } finally {
      if (generation === workGeneration.current) {
        validationBusy.current = false;
        editor.setValidationPending(false);
      }
    }
  }
  async function readFile(file: File | undefined) {
    const generation = ++fileGeneration.current;
    setUpload(null);
    setFileError(false);
    setReading(false);
    if (
      !file ||
      scope.denied ||
      validationBusy.current ||
      uncertain ||
      needsReset ||
      actionRef.current ||
      !selected ||
      selected === 'new'
    )
      return;
    if (
      file.size > MAX_BYTES ||
      file.size === 0 ||
      (file.type && !/^text\/[a-z0-9.+-]+$/i.test(file.type))
    ) {
      setFileError(true);
      return;
    }
    setReading(true);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (generation !== fileGeneration.current) return;
      if (content.includes('\0') || new TextEncoder().encode(content).byteLength > MAX_BYTES)
        throw new Error('Invalid text');
      setUpload({
        fileName: file.name,
        contentType: file.type || 'text/plain',
        content,
        placeholders: extractContractTemplatePlaceholders(content),
      });
    } catch {
      if (generation === fileGeneration.current) setFileError(true);
    } finally {
      if (generation === fileGeneration.current) setReading(false);
    }
  }
  const completionGeneration = workGeneration.current;
  const heading =
    view === 'new'
      ? label('add')
      : view === 'edit'
        ? label('editor')
        : view === 'upload'
          ? label('upload')
          : (detail?.name ?? label('title'));
  const taskView = view === 'new' || view === 'edit' || view === 'upload';
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col gap-4 ${taskView ? 'max-w-3xl' : 'max-w-6xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {view && view !== 'list' && (
            <Link
              to={templateId && view !== 'detail' ? routes.detail : routes.list}
              params={templateId ? { templateId } : {}}
              className="touch-action self-start text-sm text-primary underline underline-offset-4"
            >
              {templateId && view !== 'detail' ? label('open') : label('title')}
            </Link>
          )}
          <h1
            ref={listHeading}
            data-slot="editor-heading"
            tabIndex={-1}
            className="min-w-0 text-2xl font-semibold outline-none! [overflow-wrap:anywhere]"
          >
            {heading}
          </h1>
        </div>
        <ListRefreshButton
          label={label('refresh')}
          refreshing={catalogue.loading || history.loading}
          onClick={refresh}
        />
      </header>
      <CommandFeedback message={saved ? label('saved') : null} />
      <ListPage>
        {scope.denied && <p role="alert">{label('denied')}</p>}
        <ListPage.Content
          empty={false}
          emptyView={null}
          loading={catalogue.loading}
          error={catalogue.error}
          retainContent={catalogue.data !== null}
          loadingView={<LoadingStatus>{label('loading')}</LoadingStatus>}
          errorView={
            <div role="alert">
              {label('error')}{' '}
              <Button variant="outline" onClick={catalogue.retry}>
                {label('listRetry')}
              </Button>
            </div>
          }
        >
          {!scope.denied && (!catalogueNeeded || catalogue.data !== null) && (
            <>
              {showList && (
                <ListPage.Toolbar>
                  {view ? (
                    listReady && (
                      <Link to={routes.new} className={buttonVariants()}>
                        {label('add')}
                      </Link>
                    )
                  ) : (
                    <Button
                      disabled={!listReady || !!action || editor.pending || uncertain || needsReset}
                      onClick={() => chooseEditor('new')}
                    >
                      {label('add')}
                    </Button>
                  )}
                </ListPage.Toolbar>
              )}
              {history.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
              {history.error && (
                <div role="alert">
                  {label(history.missing ? 'missing' : 'error')}{' '}
                  <Button variant="outline" onClick={history.retry}>
                    {label('detailRetry')}
                  </Button>
                </div>
              )}
              {(uncertain || needsReset) && (
                <Alert variant="destructive">
                  {formText(uncertain ? 'unverified' : 'changed')}
                </Alert>
              )}
              {draft && (uncertain || needsReset) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!listReady || !detailReady || !recoveryReady || !!action}
                  onClick={resetSaved}
                >
                  {formText('reset')}
                </Button>
              )}
              {draft && (!templateId || detail) && (
                <form
                  noValidate
                  aria-busy={editor.pending || undefined}
                  aria-label={label('editor')}
                  onSubmit={save}
                  className={recordEditorSurface}
                >
                  {catalogueRootMessage(editor.errors) && (
                    <Alert variant="destructive" className="m-4">
                      {catalogueRootMessage(editor.errors)}
                    </Alert>
                  )}
                  <fieldset disabled={!!action || editor.pending || !ready} className="min-w-0">
                    <legend className="sr-only">{label('editor')}</legend>
                    <RecordEditorSection title={label('details')}>
                      <div className={recordEditorField}>
                        <Label htmlFor="template-name">{label('name')}</Label>
                        <Input
                          {...editor.bind('name')}
                          id="template-name"
                          dir="auto"
                          required
                          aria-required="true"
                          maxLength={200}
                          value={draft.name}
                          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={editor.errorId('name')}
                          error={editor.errors.name}
                          message={messages.name}
                        />
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor="template-description">{label('description')}</Label>
                        <Textarea
                          {...editor.bind('description')}
                          id="template-description"
                          dir="auto"
                          className="max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]"
                          rows={2}
                          placeholder={label('descriptionExample')}
                          maxLength={2000}
                          value={draft.description}
                          onChange={(event) =>
                            setDraft({ ...draft, description: event.target.value })
                          }
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={editor.errorId('description')}
                          error={editor.errors.description}
                          message={messages.description}
                        />
                      </div>
                      {selected !== 'new' && (
                        <label className="flex min-h-8 w-fit cursor-pointer items-center gap-2">
                          <input
                            {...editor.bind('status')}
                            ref={statusRef}
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={draft.status === 'active'}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                status: event.target.checked ? 'active' : 'inactive',
                              })
                            }
                          />
                          {label('active')}
                        </label>
                      )}
                      {editor.errors.status && (
                        <CatalogueFieldFeedback
                          compact
                          id={editor.errorId('status')}
                          error={editor.errors.status}
                          message={messages.status}
                        />
                      )}
                    </RecordEditorSection>
                    <RecordEditorActions>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => (onSettled ? onSettled(templateId) : chooseEditor(null))}
                      >
                        {label('cancel')}
                      </Button>
                      <CatalogueSaveButton
                        label={label('save')}
                        pending={editor.pending}
                        disabled={!ready || editor.pending || !!action}
                      />
                    </RecordEditorActions>
                  </fieldset>
                </form>
              )}
              {detail && (view === 'detail' || !view) && (
                <section aria-label={label('history')} className="flex flex-col gap-4">
                  {view === 'detail' && (
                    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
                      {detail.description && (
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {detail.description}
                        </p>
                      )}
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                          {label(detail.status)}
                        </span>
                        <Link
                          to={routes.edit}
                          params={{ templateId: detail.id }}
                          className={buttonVariants({ variant: 'outline' })}
                        >
                          {label('editor')}
                        </Link>
                        <Link
                          to={routes.version}
                          params={{ templateId: detail.id, version: 'new' }}
                          className={buttonVariants()}
                        >
                          {label('upload')}
                        </Link>
                      </div>
                    </div>
                  )}
                  <h2 className="text-xl font-semibold">{label('history')}</h2>
                  {!detail.versions.length && <p>{label('noVersions')}</p>}
                  {view === 'detail' && (
                    <ol className="divide-y rounded-xl border bg-card px-4">
                      {detail.versions
                        .slice()
                        .sort((a, b) => b.versionNumber - a.versionNumber)
                        .map((version) => (
                          <li
                            key={version.versionNumber}
                            className="flex flex-wrap items-start justify-between gap-3 py-4"
                          >
                            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                              <h3 className="font-semibold">
                                <Link
                                  to={routes.version}
                                  params={{
                                    templateId: detail.id,
                                    version: String(version.versionNumber),
                                  }}
                                  className="touch-action text-primary underline underline-offset-4"
                                >
                                  {label('version')} {numbers.number(version.versionNumber)}
                                </Link>
                              </h3>
                              <p className="text-sm">{version.fileName}</p>
                              <p className="text-sm text-muted-foreground" dir="auto">
                                {version.placeholders
                                  .map((value) => '{{' + value + '}}')
                                  .join(', ') || label('noPlaceholders')}
                              </p>
                            </div>
                            <time
                              dateTime={version.createdAt}
                              className="text-sm text-muted-foreground"
                            >
                              {time.format(version.createdAt)}
                            </time>
                          </li>
                        ))}
                    </ol>
                  )}
                </section>
              )}
              {detail && (!view || view === 'upload') && (
                <section className={recordEditorSurface} aria-label={label('upload')}>
                  <RecordEditorSection title={label('file')}>
                    {view === 'upload' && (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm [overflow-wrap:anywhere]">
                        <p className="font-medium" dir="auto">
                          {detail.name}
                        </p>
                        {detail.latestVersion && (
                          <dl>
                            <dt className="text-muted-foreground">{label('latestFile')}</dt>
                            <dd dir="auto">{detail.latestVersion.fileName}</dd>
                          </dl>
                        )}
                      </div>
                    )}
                    <div
                      className={recordFilePicker}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!action && !editor.pending && ready)
                          void readFile(event.dataTransfer.files[0]);
                      }}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className={recordFilePickerAction}
                        aria-invalid={fileError || undefined}
                        aria-describedby={
                          fileError
                            ? 'template-file-help template-file-error'
                            : 'template-file-help'
                        }
                        disabled={!!action || editor.pending || uncertain || needsReset}
                        onClick={() => fileInput.current?.click()}
                      >
                        <FileUp aria-hidden="true" className="size-4 shrink-0" />
                        {label(upload ? 'changeFile' : 'chooseFile')}
                      </Button>
                      <div className={recordFilePickerHelp}>
                        <p className="hidden [@media(pointer:fine)]:block">{label('dropHint')}</p>
                        <p id="template-file-help">{label('fileHelp')}</p>
                      </div>
                      <input
                        id="template-file"
                        aria-label={label('file')}
                        ref={fileInput}
                        type="file"
                        accept="text/*,.txt,.html,.md,.csv"
                        className="hidden"
                        disabled={!!action || editor.pending || uncertain || needsReset}
                        onChange={(event) => {
                          void readFile(event.target.files?.[0]);
                          event.target.value = '';
                        }}
                      />
                    </div>
                    {fileError && (
                      <p id="template-file-error" role="alert" className="text-sm text-destructive">
                        {label('fileError')}
                      </p>
                    )}
                    {reading && <p role="status">{label('reading')}</p>}
                  </RecordEditorSection>
                  {upload && (
                    <div className="space-y-3 px-4 py-4 sm:px-6">
                      <h2 className="font-semibold [overflow-wrap:anywhere]">{upload.fileName}</h2>
                      <p className="text-sm font-medium">{label('placeholders')}</p>
                      <p
                        dir="auto"
                        className="text-sm text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {upload.placeholders.map((name) => '{{' + name + '}}').join(', ') ||
                          label('noPlaceholders')}
                      </p>
                      <pre
                        dir="auto"
                        className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-sm [overflow-wrap:anywhere]"
                      >
                        {upload.content.slice(0, 12000)}
                      </pre>
                      {upload.content.length > 12000 && (
                        <p className="text-sm text-muted-foreground">{label('previewTruncated')}</p>
                      )}
                    </div>
                  )}
                  <RecordEditorActions>
                    <Button
                      disabled={!upload || reading || !ready || !!action}
                      onClick={() =>
                        upload &&
                        propose(
                          `/api/admin/contract-templates/${detail.id}/versions`,
                          'POST',
                          label('upload'),
                          label('confirmUpload'),
                          {
                            fileName: upload.fileName,
                            contentType: upload.contentType,
                            content: upload.content,
                          }
                        )
                      }
                    >
                      {label('upload')}
                    </Button>
                  </RecordEditorActions>
                  {!view && (
                    <ol className="divide-y">
                      {detail.versions.map((version) => (
                        <li key={version.versionNumber} className="flex flex-col gap-2 py-4">
                          <h3 className="font-semibold">
                            {label('version')} {numbers.number(version.versionNumber)}
                          </h3>
                          <p className="break-words">{version.fileName}</p>
                          <time dateTime={version.createdAt}>{time.format(version.createdAt)}</time>
                          <p>{label('placeholders')}</p>
                          <p className="break-words" dir="ltr">
                            {version.placeholders.length
                              ? version.placeholders.map((value) => `{{${value}}}`).join(', ')
                              : label('noPlaceholders')}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}
              {showList && (
                <OperationalQueueTable
                  locale={locale}
                  cardHeading="h2"
                  rows={rows}
                  caption={label('title')}
                  scrollLabel={label('tableTitle')}
                  nameHeader={label('name')}
                  loading={catalogue.loading}
                  emptyMessage={label('empty')}
                  renderName={(row) =>
                    view ? (
                      <Link
                        to={routes.detail}
                        params={{ templateId: row.id }}
                        className="touch-action text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <TextCell value={row.name} />
                    )
                  }
                  fields={[
                    {
                      id: 'description',
                      label: label('description'),
                      render: (row) => (
                        <span className="whitespace-pre-wrap">
                          <TextCell value={row.description} />
                        </span>
                      ),
                    },
                    {
                      id: 'status',
                      label: label('status'),
                      render: (row) => <>{label(row.status)}</>,
                    },
                    {
                      id: 'versions',
                      label: label('versions'),
                      render: (row) => (
                        <bdi className="tabular-nums">{numbers.number(row.versionCount)}</bdi>
                      ),
                    },
                    {
                      id: 'file',
                      label: label('latestFile'),
                      render: (row) => <TextCell value={row.latestVersion?.fileName} />,
                    },
                    {
                      id: 'created',
                      label: label('latestCreated'),
                      render: (row) => (
                        <DateCell
                          value={row.latestVersion?.createdAt}
                          format={(stamp) => time.format(stamp)}
                        />
                      ),
                    },
                  ]}
                  actionHeader={label('actions')}
                  renderActions={(row) => (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {view ? (
                        <Link
                          to={routes.edit}
                          params={{ templateId: row.id }}
                          aria-label={`${label('editor')} ${row.name}`}
                          className={buttonVariants({ variant: 'outline' })}
                          data-table-action-tooltip={label('editor')}
                        >
                          <TableActionIcon icon={TablePencilIcon}>
                            {label('editor')}
                          </TableActionIcon>
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          aria-label={`${label('open')} ${row.name}`}
                          disabled={
                            !listReady || !!action || editor.pending || uncertain || needsReset
                          }
                          onClick={() => chooseEditor(row.id)}
                          data-table-action-tooltip={label('open')}
                        >
                          <TableActionIcon icon={TableEyeIcon}>{label('open')}</TableActionIcon>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={
                          row.versionCount > 0 ||
                          !listReady ||
                          !!action ||
                          editor.pending ||
                          uncertain ||
                          needsReset
                        }
                        aria-label={`${label('delete')} ${row.name}`}
                        onClick={(event) => {
                          deleteTrigger.current = event.currentTarget;
                          propose(
                            `/api/admin/contract-templates/${row.id}`,
                            'DELETE',
                            label('delete'),
                            `${row.name}. ${label('confirmDelete')}`
                          );
                        }}
                        data-table-action-tooltip={label('delete')}
                      >
                        <TableActionIcon icon={TableTrash2Icon}>{label('delete')}</TableActionIcon>
                      </Button>
                    </div>
                  )}
                />
              )}
            </>
          )}
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          finalFocus={
            action.method === 'DELETE'
              ? () =>
                  deleteTrigger.current?.isConnected &&
                  deleteTrigger.current.getClientRects().length > 0 &&
                  listReady &&
                  !editor.pending &&
                  !uncertain &&
                  !needsReset
                    ? deleteTrigger.current
                    : listHeading.current
              : undefined
          }
          onDenied={() => {
            deleteTrigger.current = null;
            scope.deny();
          }}
          onUnconfirmed={unconfirmed}
          onValidationError={(fields) =>
            !action.path.endsWith('/versions') &&
            action.method !== 'DELETE' &&
            applyFieldErrors(fields)
          }
          confirmationDisabled={
            uncertain || needsReset || !listReady || (action.method !== 'DELETE' && !detailReady)
          }
          summary={
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={catalogue.loading || history.loading}
                onClick={refresh}
              >
                {label('refresh')}
              </Button>
              {catalogue.error && (
                <div role="alert">
                  {label('error')}{' '}
                  <Button type="button" variant="outline" onClick={catalogue.retry}>
                    {label('listRetry')}
                  </Button>
                </div>
              )}
              {history.error && (
                <div role="alert">
                  {label('error')}{' '}
                  <Button type="button" variant="outline" onClick={history.retry}>
                    {label('detailRetry')}
                  </Button>
                </div>
              )}
            </div>
          }
          onSuccess={async (result) => {
            if (
              completionGeneration !== workGeneration.current ||
              actionRef.current !== action ||
              scope.denied
            )
              return;
            if (action.method === 'DELETE') {
              if (!record(result) || result.deleted !== true)
                throw new Error('Invalid deletion acknowledgement');
            } else if (action.path.endsWith('/versions')) {
              if (
                !validVersion(result) ||
                result.fileName !== (action.body as Upload).fileName ||
                result.versionNumber <= (detail?.latestVersion?.versionNumber ?? 0)
              )
                throw new Error('Invalid version acknowledgement');
            } else {
              const expected = action.body as Draft;
              if (
                !validTemplate(result) ||
                (selected !== 'new' && result.id !== selected) ||
                result.name !== expected.name ||
                (result.description ?? '') !== expected.description ||
                (selected !== 'new' && result.status !== expected.status)
              )
                throw new Error('Invalid template acknowledgement');
            }
            // Accept this command's receipt as the refresh baseline. Our own saved
            // version must not be mistaken for a concurrent editor's change.
            if (action.path.endsWith('/versions') && validVersion(result) && detail) {
              const next = {
                ...detail,
                versionCount: detail.versionCount + 1,
                latestVersion: result,
                versions: [...detail.versions, result],
              };
              acceptedDetail.current = next;
              acceptedRows.current =
                acceptedRows.current?.map((row) => (row.id === detail.id ? next : row)) ?? null;
            } else if (validTemplate(result)) {
              acceptedRows.current =
                acceptedRows.current?.map((row) => (row.id === result.id ? result : row)) ?? null;
            }
            closeAction();
            if (
              onSettled &&
              action.path.endsWith('/versions') &&
              validVersion(result) &&
              templateId
            ) {
              onSettled(templateId, result.versionNumber);
              return label('saved');
            }
            if (onSettled && (view === 'new' || view === 'edit') && validTemplate(result)) {
              onSettled(result.id);
              return label('saved');
            }
            if (
              selected === 'new' ||
              (action.method === 'DELETE' && action.path.endsWith(`/${selected}`))
            )
              clearEditor();
            else if (action.method !== 'DELETE') {
              if (action.path.endsWith('/versions')) {
                fileGeneration.current++;
                setUpload(null);
              }
              if (!action.path.endsWith('/versions')) acceptedDetail.current = null;
              history.retry();
            }
            setSaved(true);
            catalogue.retry();
            return undefined;
          }}
        />
      )}
    </div>
  );
}
