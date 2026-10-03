import { contentFormText } from '@barghsa/i18n/content-forms';
import { Alert } from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
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
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import type {
  ContractTemplateDto,
  ContractTemplateDetailDto,
  ContractTemplateVersionDto,
} from '@barghsa/shared/admin';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
type Draft = ContractTemplateDraft;
type Upload = { fileName: string; contentType: string; content: string };
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
export default function AdminContractTemplatesPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
  const [selected, setSelected] = useState<string | null>(null);
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
  const draft = selected ? editor.values : null;
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
  const [upload, setUpload] = useState<Upload | null>(null),
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
  const clearEditor = useCallback(() => {
    closeAction();
    fileGeneration.current++;
    acceptedDetail.current = null;
    setSelected(null);
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
  const denied = useCallback(() => {
    acceptedRows.current = null;
    clearEditor();
  }, [clearEditor]);
  const scope = useCatalogueScope(denied);
  const catalogue = useCatalogueResource(scope, '/api/admin/contract-templates', validList);
  const validateSelected = useCallback(
    (value: unknown): value is ContractTemplateDetailDto =>
      validDetail(value) && value.id === selected,
    [selected]
  );
  const history = useCatalogueResource(
    scope,
    selected && selected !== 'new' ? `/api/admin/contract-templates/${selected}` : null,
    validateSelected
  );
  const rows = catalogue.data ?? [],
    detail = history.data;
  const listReady =
    !scope.denied && !catalogue.loading && !catalogue.error && catalogue.data !== null;
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
    clearEditor();
    setSelected(value);
    if (value === 'new') resetTemplate(emptyContractTemplateDraft());
  }
  function refresh() {
    if (validationBusy.current || uncertain) closeAction();
    setRecoveryReady(false);
    if (scope.denied) scope.recover();
    else {
      catalogue.retry();
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
      setUpload({ fileName: file.name, contentType: file.type || 'text/plain', content });
    } catch {
      if (generation === fileGeneration.current) setFileError(true);
    } finally {
      if (generation === fileGeneration.current) setReading(false);
    }
  }
  const completionGeneration = workGeneration.current;
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div>
        <Button variant="outline" disabled={catalogue.loading || history.loading} onClick={refresh}>
          {label('refresh')}
        </Button>
      </div>
      {saved && <p role="status">{label('saved')}</p>}
      <ListPage>
        {scope.denied && <p role="alert">{label('denied')}</p>}
        <ListPage.Content
          empty={false}
          emptyView={null}
          loading={catalogue.loading}
          error={catalogue.error}
          retainContent={catalogue.data !== null}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={
            <div role="alert">
              {label('error')}{' '}
              <Button variant="outline" onClick={catalogue.retry}>
                {label('listRetry')}
              </Button>
            </div>
          }
        >
          {!scope.denied && catalogue.data !== null && (
            <>
              <ListPage.Toolbar>
                <Button
                  disabled={!listReady || !!action || editor.pending || uncertain || needsReset}
                  onClick={() => chooseEditor('new')}
                >
                  {label('add')}
                </Button>
              </ListPage.Toolbar>
              {history.loading && <p role="status">{label('loading')}</p>}
              {history.error && (
                <div role="alert">
                  {label('error')}{' '}
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
              {draft && (
                <form
                  noValidate
                  aria-busy={editor.pending || undefined}
                  aria-label={label('editor')}
                  onSubmit={save}
                  className="flex flex-col gap-4 border-y py-5"
                >
                  {catalogueRootMessage(editor.errors) && (
                    <Alert variant="destructive">{catalogueRootMessage(editor.errors)}</Alert>
                  )}
                  <fieldset disabled={!!action || editor.pending || !ready} className="space-y-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="template-name">{label('name')}</Label>
                      <Input
                        {...editor.bind('name')}
                        id="template-name"
                        required
                        maxLength={200}
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </div>
                    <p
                      id={editor.errorId('name')}
                      role={editor.errors.name ? 'alert' : undefined}
                      aria-hidden={!editor.errors.name || undefined}
                      className={`text-sm text-destructive ${editor.errors.name ? '' : 'invisible'}`}
                    >
                      {editor.errors.name?.message ?? messages.name}
                    </p>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="template-description">{label('description')}</Label>
                      <textarea
                        {...editor.bind('description')}
                        id="template-description"
                        className="min-h-24 rounded-md border bg-background p-3"
                        maxLength={2000}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft({ ...draft, description: event.target.value })
                        }
                      />
                    </div>
                    <p
                      id={editor.errorId('description')}
                      role={editor.errors.description ? 'alert' : undefined}
                      aria-hidden={!editor.errors.description || undefined}
                      className={`text-sm text-destructive ${editor.errors.description ? '' : 'invisible'}`}
                    >
                      {editor.errors.description?.message ?? messages.description}
                    </p>
                    {selected !== 'new' && (
                      <label className="flex items-center gap-2">
                        <input
                          {...editor.bind('status')}
                          ref={statusRef}
                          type="checkbox"
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
                    <p
                      id={editor.errorId('status')}
                      role={editor.errors.status ? 'alert' : undefined}
                      aria-hidden={!editor.errors.status || undefined}
                      className={`text-sm text-destructive ${editor.errors.status ? '' : 'invisible'}`}
                    >
                      {editor.errors.status?.message ?? messages.status}
                    </p>
                    <div className="flex gap-2">
                      <CatalogueSaveButton
                        label={label('save')}
                        pending={editor.pending}
                        disabled={!ready || editor.pending || !!action}
                      />
                      <Button type="button" variant="outline" onClick={() => chooseEditor(null)}>
                        {label('cancel')}
                      </Button>
                    </div>
                  </fieldset>
                </form>
              )}
              {detail && (
                <section aria-label={label('history')} className="flex flex-col gap-4">
                  <h2 className="text-xl font-semibold">{label('history')}</h2>
                  <div
                    className="rounded-md border border-dashed p-4"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!action && !editor.pending && ready)
                        void readFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <Label htmlFor="template-file">{label('file')}</Label>
                    <p className="my-2 text-sm text-muted-foreground">{label('fileHelp')}</p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!action || editor.pending || uncertain || needsReset}
                      onClick={() => fileInput.current?.click()}
                    >
                      {label('chooseFile')}
                    </Button>
                    <input
                      id="template-file"
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
                  {fileError && <p role="alert">{label('fileError')}</p>}
                  {reading && <p role="status">{label('reading')}</p>}
                  {upload && <p className="break-words">{upload.fileName}</p>}
                  <div>
                    <Button
                      disabled={!upload || reading || !ready || !!action}
                      onClick={() =>
                        upload &&
                        propose(
                          `/api/admin/contract-templates/${detail.id}/versions`,
                          'POST',
                          label('upload'),
                          label('confirmUpload'),
                          { ...upload }
                        )
                      }
                    >
                      {label('upload')}
                    </Button>
                  </div>
                  {!detail.versions.length && <p>{label('noVersions')}</p>}
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
                </section>
              )}
              {!rows.length && <p>{label('empty')}</p>}
              <ul className="divide-y">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold">{row.name}</h2>
                      <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>
                      <p>
                        {label(row.status)} · {label('versions')}:{' '}
                        {numbers.number(row.versionCount)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        aria-label={`${label('open')} ${row.name}`}
                        disabled={
                          !listReady || !!action || editor.pending || uncertain || needsReset
                        }
                        onClick={() => chooseEditor(row.id)}
                      >
                        {label('open')}
                      </Button>
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
                        onClick={() =>
                          propose(
                            `/api/admin/contract-templates/${row.id}`,
                            'DELETE',
                            label('delete'),
                            `${row.name}. ${label('confirmDelete')}`
                          )
                        }
                      >
                        {label('delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
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
          }}
        />
      )}
    </div>
  );
}
