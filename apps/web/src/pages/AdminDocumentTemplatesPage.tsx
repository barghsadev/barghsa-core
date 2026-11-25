import {
  RecordEditorActions,
  RecordEditorDisclosure,
  RecordEditorSection,
  recordEditorGrid,
  recordEditorSurface,
  recordFilePicker,
  recordFilePickerAction,
  recordFilePickerHelp,
} from '../components/RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';
import { FileUp } from 'lucide-react';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { Link } from '@tanstack/react-router';
import { documentTemplateRequiredPlaceholders } from '@barghsa/shared/admin';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LoadingStatus,
  Button,
  DateCell,
  TextCell,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
  buttonVariants,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  Form,
  FormInput,
  FormTextarea,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
} from '@barghsa/ui/form';
import { ConfigPreviewCard } from '../components/ConfigPreviewCard.js';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';
import { DocumentRequestError, documentUrl } from '../lib/documents.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import {
  documentTemplateRoutes as routes,
  type DocumentTemplateView,
} from '../lib/template-catalogue-routes.js';
import {
  emptyTemplateMetadata as blank,
  emptyTemplateVersion,
  metadataErrors,
  versionErrors,
  metadataReceipt,
  templateDetailReceipt,
  templateReceipt,
  versionReceipt,
  type TemplateCategory as Category,
  type DocumentTemplate as Template,
  type TemplateMetadata as Draft,
  type TemplateVersionDraft,
} from '../lib/document-template-form.js';

async function readTemplateJson(path: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(path, options);
  if (!response.ok) throw new DocumentRequestError(response.status, null);
  return response.json();
}

function templateAccessDenied(error: unknown) {
  return error instanceof DocumentRequestError && [401, 403].includes(error.status);
}

type DocumentTemplatesProps = {
  queries?: ListQueryBinding;
  view?: DocumentTemplateView;
  templateId?: string;
  versionId?: string;
  routeSearch?: Record<string, unknown>;
  onSettled?: (id?: string, versionId?: string) => void;
};

export default function AdminDocumentTemplatesPage(props: DocumentTemplatesProps = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return (
    <OwnedAdminDocumentTemplatesPage key={JSON.stringify([actor, contextRevision])} {...props} />
  );
}
function OwnedAdminDocumentTemplatesPage({
  queries,
  view,
  templateId,
  versionId,
  routeSearch,
  onSettled,
}: DocumentTemplatesProps) {
  const listView = !view || view === 'list';
  const catalogueNeeded = listView || view === 'new';
  const metadataView = !view || view === 'new' || view === 'edit';
  const publishView = !view || view === 'publish';
  const historyView = !view || view === 'detail' || view === 'version';
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const locale = useLocale();
  const word = (key: Parameters<typeof documentTemplateText>[0]) =>
    documentTemplateText(key, locale);
  const time = useAccountTime(undefined, listView || historyView);
  const numbers = useNumberFormatting(locale);
  const [searchInput, setSearchInput] = useState(queries?.query.search || '');
  const [localSearch, setSearch] = useState('');
  const [localCategory, setCategory] = useState<Category | ''>('');
  const search = queries ? queries.query.search : localSearch;
  const category = queries ? queries.query.filters.category || '' : localCategory;
  useEffect(() => {
    if (queries) setSearchInput(search);
  }, [search]);
  const [selected, setSelected] = useState<string | null>(templateId ?? null);
  const editAfterRead = useRef(view === 'edit');
  const workspace = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Template[] | null>(null);
  const [detail, setDetail] = useState<Template | null>(null);
  const [editing, setEditing] = useState(view === 'new');
  const owner = useRef<'metadata' | 'version' | null>(null);
  const [validating, setValidating] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const metadata = useZodForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(
        {
          title: word('titleInvalid'),
          description: word('descriptionInvalid'),
          category: word('categoryInvalid'),
        },
        metadataErrors
      );
    },
    { defaultValues: blank(), validationUnavailableMessage: word('validationUnavailable') }
  );
  const version = useZodForm<TemplateVersionDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<TemplateVersionDraft>(
        {
          retainedFileIds: word('fileError'),
          files: word('fileError'),
          changeSummary: word('summaryInvalid'),
        },
        (value) => versionErrors(value, acceptedDetail.current?.versions?.[0]?.files ?? [])
      );
    },
    {
      defaultValues: emptyTemplateVersion(),
      validationUnavailableMessage: word('validationUnavailable'),
    }
  );
  const draft =
    metadataView && editing && (selected !== null || rows !== null) ? metadata.watch() : null;
  const { retainedFileIds: retained, files } = version.watch();
  const [linkError, setLinkError] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>(
    catalogueNeeded ? 'loading' : 'ready'
  );
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [missing, setMissing] = useState(false);
  const [acceptedCriteria, setAcceptedCriteria] = useState('');
  const [versionChanged, setVersionChanged] = useState(false);
  const criteria = JSON.stringify([search, category]);
  const readList = useOwnedDocumentRead(actor, contextRevision, true, undefined, criteria);
  const readDetail = useOwnedDocumentRead(
    actor,
    contextRevision,
    true,
    undefined,
    JSON.stringify(['template-detail', selected])
  );
  const listRequest = useRef<AbortController | null>(null);
  const linkRequests = useRef(new Map<string, AbortController>());
  function retireLinks() {
    for (const controller of linkRequests.current.values()) controller.abort();
    linkRequests.current.clear();
  }
  const visibleRows = acceptedCriteria === criteria ? rows : null;
  const accessDenied = useRef(false);
  const linkGeneration = useRef(0);
  const acceptedDetail = useRef<Template | null>(null);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const captured = useRef<
    | { kind: 'metadata'; draft: Draft; selected: string | null; generation: number }
    | { kind: 'version'; draft: TemplateVersionDraft; base: Template; generation: number }
    | null
  >(null);
  const locked = validating || !!action || uncertain;
  const errorFocus = useRef<{ kind: 'metadata' | 'version'; name: string } | null>(null);
  useEffect(() => {
    if (!locked && errorFocus.current) {
      const focus = errorFocus.current;
      errorFocus.current = null;
      if (focus.kind === 'metadata') metadata.setFocus(focus.name as keyof Draft);
      else version.setFocus(focus.name as keyof TemplateVersionDraft);
    }
  }, [locked]);
  function closeAction() {
    setAction(null);
    if (!uncertain) {
      owner.current = null;
      captured.current = null;
    }
  }
  function editMetadata(value: Draft) {
    if (owner.current) return;
    metadata.reset(value);
    setEditing(true);
  }

  function resetWorkspace(id: string | null, reread = true) {
    retireLinks();
    ++linkGeneration.current;
    acceptedDetail.current = null;
    editAfterRead.current = false;
    setSelected(id);
    setDetail(null);
    setEditing(false);
    metadata.reset(blank());
    version.reset(emptyTemplateVersion());
    owner.current = null;
    captured.current = null;
    errorFocus.current = null;
    setValidating(false);
    setUncertain(false);
    setLinks({});
    setPendingLinks([]);
    setLinkError(false);
    setVersionChanged(false);
    setMissing(false);
    setAction(null);
    setSaved(false);
    if (reread) setDetailRevision((value) => value + 1);
  }
  function choose(id: string | null, force = false) {
    if (owner.current && !force) return;
    resetWorkspace(id);
  }
  function denyAccess() {
    accessDenied.current = true;
    listRequest.current?.abort();
    setRows(null);
    setState('denied');
    resetWorkspace(templateId ?? null, false);
    editAfterRead.current = view === 'edit';
  }
  useEffect(
    () => () => {
      retireLinks();
      ++linkGeneration.current;
    },
    []
  );
  useEffect(() => {
    if (!catalogueNeeded) return;
    const controller = new AbortController();
    listRequest.current = controller;
    setState('loading');
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    void readList<unknown>(
      `/api/admin/document-templates?${params}`,
      { signal: controller.signal },
      readTemplateJson
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data) || !data.every(templateReceipt))
          throw new Error('Invalid document template list');
        accessDenied.current = false;
        setRows(data);
        setAcceptedCriteria(criteria);
        setState('ready');
        if (view === 'new') setEditing(true);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (templateAccessDenied(reason)) denyAccess();
        else setState('error');
      });
    return () => controller.abort();
  }, [category, revision, search, criteria, readList, catalogueNeeded, view]);
  useEffect(() => {
    if (accessDenied.current) return;
    if (!selected) {
      setDetailState('ready');
      return;
    }
    const controller = new AbortController();
    setDetailState('loading');
    const current = linkGeneration.current;
    void readDetail<unknown>(
      `/api/admin/document-templates/${selected}`,
      { signal: controller.signal },
      readTemplateJson
    )
      .then((next) => {
        if (controller.signal.aborted || accessDenied.current || current !== linkGeneration.current)
          return;
        if (!templateDetailReceipt(next) || next.id !== selected)
          throw new Error('Invalid document template detail');
        const previous = acceptedDetail.current;
        const latest = next.versions[0];
        if (!previous)
          version.reset({
            ...emptyTemplateVersion(),
            retainedFileIds: latest?.files.map((file) => file.id) ?? [],
          });
        else if (previous.versions?.[0]?.id !== latest?.id) {
          retireLinks();
          setLinks({});
          setPendingLinks([]);
          const ids = new Set(latest?.files.map((file) => file.id) ?? []);
          version.setValue(
            'retainedFileIds',
            version.getValues('retainedFileIds').filter((id) => ids.has(id))
          );
          setAction(null);
          if (!uncertain) {
            owner.current = null;
            captured.current = null;
          }
          setVersionChanged(true);
        }
        acceptedDetail.current = next;
        setMissing(false);
        setDetail(next);
        if (editAfterRead.current) {
          editAfterRead.current = false;
          metadata.reset({
            title: next.title,
            description: next.description,
            category: next.category,
          });
          setEditing(true);
        }
        setDetailState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || accessDenied.current || current !== linkGeneration.current)
          return;
        if (templateAccessDenied(reason)) denyAccess();
        else {
          if (view && reason instanceof DocumentRequestError && reason.status === 404) {
            resetWorkspace(selected, false);
            editAfterRead.current = view === 'edit';
            setMissing(true);
          }
          setDetailState('error');
        }
      });
    return () => controller.abort();
  }, [selected, detailRevision, readDetail, view]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      owner.current ||
      accessDenied.current ||
      state !== 'ready' ||
      (selected && detailState !== 'ready')
    )
      return;
    owner.current = 'metadata';
    setValidating(true);
    const generation = linkGeneration.current;
    try {
      await metadata.handleSubmit((values) => {
        if (accessDenied.current || generation !== linkGeneration.current) return;
        const body = {
          title: values.title.trim(),
          description: values.description.trim(),
          category: values.category,
        };
        captured.current = { kind: 'metadata', draft: body, selected, generation };
        setAction({
          title: word('save'),
          description: word('confirmSave'),
          path: `/api/admin/document-templates${selected ? `/${selected}` : ''}`,
          method: selected ? 'PUT' : 'POST',
          body,
          successStatus: selected ? 200 : 201,
          forbiddenMessage: word('denied'),
        });
      })(event);
    } finally {
      if (generation === linkGeneration.current) {
        setValidating(false);
        if (!captured.current) owner.current = null;
      }
    }
  }

  async function createVersion(event: FormEvent) {
    event.preventDefault();
    if (!selected || !detail || owner.current || detailState !== 'ready' || accessDenied.current)
      return;
    owner.current = 'version';
    setValidating(true);
    const generation = linkGeneration.current;
    try {
      await version.handleSubmit((values) => {
        if (accessDenied.current || generation !== linkGeneration.current) return;
        const savedDraft = {
          ...values,
          retainedFileIds: [...values.retainedFileIds],
          files: [...values.files],
        };
        const body = new FormData();
        body.set('changeSummary', values.changeSummary.trim());
        body.set('retainedFileIds', JSON.stringify(values.retainedFileIds));
        for (const file of values.files) body.append('files', file);
        captured.current = { kind: 'version', draft: savedDraft, base: detail, generation };
        setAction({
          title: word('publishVersion'),
          description: word('confirmVersion'),
          path: `/api/admin/document-templates/${selected}/versions`,
          method: 'POST',
          // A version can upload, extract and store several files in one request.
          responseDeadline: 300_000,
          body,
          successStatus: 201,
          forbiddenMessage: word('denied'),
          conflictMessage: word('conflict'),
        });
      })(event);
    } finally {
      if (generation === linkGeneration.current) {
        setValidating(false);
        if (!captured.current) owner.current = null;
      }
    }
  }

  function selectFiles(next: File[]) {
    if (owner.current) return;
    version.setValue('files', next, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  }

  async function getLink(versionId: string, fileId: string) {
    const key = `${versionId}:${fileId}`;
    if (!selected || accessDenied.current || linkRequests.current.has(key)) return;
    const current = linkGeneration.current;
    const controller = new AbortController();
    linkRequests.current.set(key, controller);
    setPendingLinks([...linkRequests.current.keys()]);
    try {
      const data = await readDetail<unknown>(
        `/api/admin/document-templates/${selected}/versions/${versionId}/files/${fileId}/download`,
        { signal: controller.signal },
        readTemplateJson
      );
      const url = documentUrl((data as { url?: unknown } | null)?.url);
      if (
        !controller.signal.aborted &&
        current === linkGeneration.current &&
        !accessDenied.current
      ) {
        setLinks((links) => ({ ...links, [key]: url }));
        setLinkError(false);
      }
    } catch (reason: unknown) {
      if (controller.signal.aborted || current !== linkGeneration.current || accessDenied.current)
        return;
      if (templateAccessDenied(reason)) denyAccess();
      else setLinkError(true);
    } finally {
      if (linkRequests.current.get(key) === controller) {
        linkRequests.current.delete(key);
        setPendingLinks([...linkRequests.current.keys()]);
      }
    }
  }

  const changedMetadata =
    detail && draft ? templateMetadataFields.filter((key) => draft[key] !== detail[key]) : [];
  const latest = detail?.versions?.[0];
  const requestedVersion = versionId
    ? detail?.versions?.find((item) => item.id === versionId)
    : undefined;
  const visibleVersions = versionId
    ? requestedVersion
      ? [requestedVersion]
      : []
    : (detail?.versions ?? []);
  const VersionHeading = view === 'version' ? 'h2' : 'h3';
  const VersionTitle = view === 'version' ? 'h3' : 'h4';
  const heading =
    view === 'new'
      ? word('add')
      : view === 'edit'
        ? word('edit')
        : view === 'publish'
          ? word('publishVersion')
          : view === 'version' && requestedVersion
            ? word('version') + ' ' + numbers.number(requestedVersion.versionNumber)
            : (detail?.title ?? word('title'));
  function refreshWorkspace() {
    if (owner.current && !uncertain) return;
    if (accessDenied.current && selected) {
      accessDenied.current = false;
      setState('ready');
    }
    if (catalogueNeeded) setRevision((value) => value + 1);
    if (selected) setDetailRevision((value) => value + 1);
  }
  const taskView = view === 'new' || view === 'edit' || view === 'publish';
  return (
    <section
      className={`mx-auto flex w-full min-w-0 flex-col gap-4 ${taskView ? 'max-w-3xl' : 'max-w-6xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {view && !listView && (
            <Link
              to={templateId && view !== 'detail' ? routes.detail : routes.list}
              params={templateId ? { templateId } : {}}
              search={routeSearch}
              className="touch-action self-start text-sm text-primary underline underline-offset-4"
            >
              {templateId && view !== 'detail' ? (detail?.title ?? word('open')) : word('title')}
            </Link>
          )}
          <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]" dir="auto">
            {heading}
          </h1>
          {listView && <p className="mt-1 text-sm text-muted-foreground">{word('description')}</p>}
        </div>
        {!listView && (
          <ListRefreshButton
            label={word('refresh')}
            refreshing={state === 'loading' || detailState === 'loading'}
            disabled={validating || !!action}
            onClick={refreshWorkspace}
          />
        )}
      </header>
      {!listView && state === 'denied' && <p role="alert">{word('denied')}</p>}
      {view === 'new' && state === 'error' && <p role="alert">{word('error')}</p>}
      {view === 'new' && state === 'loading' && <LoadingStatus>{word('loading')}</LoadingStatus>}
      <CommandFeedback message={saved ? word('saved') : null} />
      {linkError ? <p role="alert">{word('linkError')}</p> : null}
      {uncertain && (
        <div role="alert" className="space-y-2">
          <p>{word('uncertain')}</p>
          <Button
            type="button"
            variant="outline"
            disabled={state !== 'ready' || (selected !== null && detailState !== 'ready')}
            onClick={() => {
              if (state !== 'ready' || (selected && detailState !== 'ready')) return;
              captured.current = null;
              owner.current = null;
              setUncertain(false);
            }}
          >
            {word('resumeEditing')}
          </Button>
        </div>
      )}
      <ListPage>
        {listView && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (owner.current) return;
              if (queries) queries.setQuery({ search: searchInput.trim() });
              else setSearch(searchInput.trim());
            }}
          >
            <ListPage.Toolbar
              search={
                <ListSearchInput
                  label={word('search')}
                  id="document-template-search"
                  value={searchInput}
                  maxLength={100}
                  disabled={locked}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              }
              sort={
                <NativeSelect
                  aria-label={word('category')}
                  id="document-template-category"
                  className="w-full"
                  value={category}
                  disabled={locked}
                  onChange={(event) => {
                    if (owner.current) return;
                    if (queries) queries.setQuery({ filters: { category: event.target.value } });
                    else setCategory(event.target.value as Category | '');
                  }}
                >
                  <option value="">{word('allCategories')}</option>
                  {(['general', 'contract', 'invoice'] as const).map((value) => (
                    <option key={value} value={value}>
                      {word(value)}
                    </option>
                  ))}
                </NativeSelect>
              }
              actions={
                <Button type="submit" variant="secondary" disabled={locked}>
                  {word('search')}
                </Button>
              }
              refresh={
                <ListRefreshButton
                  label={word('refresh')}
                  refreshing={state === 'loading' || detailState === 'loading'}
                  disabled={validating || !!action}
                  onClick={refreshWorkspace}
                />
              }
            />
          </form>
        )}
        <div className="flex min-w-0 flex-col gap-8">
          {listView && (
            <div className="min-w-0 space-y-3">
              <div role="region" aria-label={word('listTitle')}>
                <ListPage.Toolbar>
                  {view ? (
                    state === 'ready' && (
                      <Link to={routes.new} search={routeSearch} className={buttonVariants()}>
                        {word('add')}
                      </Link>
                    )
                  ) : (
                    <Button
                      disabled={locked || rows === null || state === 'denied'}
                      onClick={() => {
                        if (owner.current) return;
                        resetWorkspace(null);
                        editMetadata(blank());
                        workspace.current?.focus();
                      }}
                    >
                      {word('add')}
                    </Button>
                  )}
                </ListPage.Toolbar>
                <ListPage.Content
                  loading={state === 'loading'}
                  error={state === 'error' || state === 'denied'}
                  empty={!visibleRows?.length}
                  retainContent={!!visibleRows?.length && state !== 'denied'}
                  loadingView={<LoadingStatus>{word('loading')}</LoadingStatus>}
                  errorView={
                    <div role="alert" className="space-y-2">
                      <p>{word(state === 'denied' ? 'denied' : 'error')}</p>
                      {state !== 'denied' && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={validating || !!action}
                          onClick={() => {
                            if (!owner.current || uncertain) setRevision((value) => value + 1);
                          }}
                        >
                          {word('retry')}
                        </Button>
                      )}
                    </div>
                  }
                  emptyView={<p className="text-sm text-muted-foreground">{word('empty')}</p>}
                >
                  <OperationalQueueTable
                    locale={locale}
                    cardHeading="h2"
                    rows={visibleRows ?? []}
                    caption={word('listTitle')}
                    scrollLabel={word('tableTitle')}
                    nameHeader={word('name')}
                    loading={state === 'loading'}
                    emptyMessage={word('empty')}
                    renderName={(row) =>
                      view ? (
                        <Link
                          to={routes.detail}
                          params={{ templateId: row.id }}
                          search={routeSearch}
                          className="touch-action text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                          dir="auto"
                        >
                          {row.title}
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto max-w-full whitespace-normal text-start"
                          aria-label={`${word('open')} ${row.title}`}
                          aria-current={selected === row.id ? 'page' : undefined}
                          disabled={locked}
                          onClick={() => {
                            if (owner.current && !uncertain) return;
                            choose(row.id);
                            workspace.current?.focus();
                          }}
                        >
                          <TextCell value={row.title} />
                        </Button>
                      )
                    }
                    fields={[
                      {
                        id: 'category',
                        label: word('category'),
                        render: (row) => <>{word(row.category)}</>,
                      },
                      {
                        id: 'description',
                        label: word('details'),
                        render: (row) => (
                          <span className="whitespace-pre-wrap">
                            <TextCell value={row.description} />
                          </span>
                        ),
                      },
                      {
                        id: 'versions',
                        label: word('versionCount'),
                        render: (row) => (
                          <bdi className="tabular-nums">{numbers.number(row.versionCount)}</bdi>
                        ),
                      },
                      {
                        id: 'updated',
                        label: word('updated'),
                        render: (row) => (
                          <DateCell value={row.updatedAt} format={(stamp) => time.format(stamp)} />
                        ),
                      },
                    ]}
                  />
                </ListPage.Content>
              </div>
            </div>
          )}
          {view !== 'list' && (
            <div
              ref={workspace}
              className="min-w-0 scroll-mt-20 space-y-7 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              role="region"
              aria-label={word('workspaceTitle')}
              tabIndex={-1}
            >
              {detailState === 'loading' && <LoadingStatus>{word('loadingDetail')}</LoadingStatus>}
              {detailState === 'error' && (
                <div role="alert" className="space-y-2">
                  <p>{word(missing ? 'missingTemplate' : 'detailError')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={validating || !!action}
                    onClick={() => {
                      if (!owner.current || uncertain) setDetailRevision((value) => value + 1);
                    }}
                  >
                    {word('retry')}
                  </Button>
                </div>
              )}
              {versionChanged && <p role="status">{word('versionChanged')}</p>}
              {detail && !draft && (!view || view === 'detail' || view === 'publish') ? (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    {!view && (
                      <h2 className="text-xl font-semibold" dir="auto">
                        {detail.title}
                      </h2>
                    )}
                    {detail.description ? (
                      <p
                        className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground"
                        dir="auto"
                      >
                        {detail.description}
                      </p>
                    ) : null}
                    {view && <p className="mt-1 text-sm font-medium">{word(detail.category)}</p>}
                  </div>
                  {view === 'detail' ? (
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={routes.edit}
                        params={{ templateId: detail.id }}
                        search={routeSearch}
                        className={buttonVariants({ variant: 'outline' })}
                      >
                        {word('edit')}
                      </Link>
                      <Link
                        to={routes.version}
                        params={{ templateId: detail.id, version: 'new' }}
                        search={routeSearch}
                        className={buttonVariants()}
                      >
                        {word('publishVersion')}
                      </Link>
                    </div>
                  ) : (
                    !view && (
                      <Button
                        variant="outline"
                        disabled={locked || detailState !== 'ready'}
                        onClick={() =>
                          editMetadata({
                            title: detail.title,
                            description: detail.description,
                            category: detail.category,
                          })
                        }
                      >
                        {word('edit')}
                      </Button>
                    )
                  )}
                </div>
              ) : null}
              {draft ? (
                <Form {...metadata}>
                  <form
                    key={`metadata-${linkGeneration.current}`}
                    noValidate
                    className={`${recordEditorSurface} [&_[data-slot=form-message]]:min-h-4`}
                    onSubmit={save}
                    aria-label={word('edit')}
                    onChangeCapture={(event) => {
                      if (owner.current) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  >
                    {metadata.formState.errors.root?.validation?.message && (
                      <p role="alert" className="mx-4 mt-4 text-sm text-destructive">
                        {metadata.formState.errors.root.validation.message}
                      </p>
                    )}
                    <RecordEditorSection title={word('templateDetails')}>
                      <div className={recordEditorGrid}>
                        <FormInput
                          control={metadata.control}
                          name="title"
                          label={word('name')}
                          id="document-template-title"
                          disabled={locked}
                          inputProps={{ dir: 'auto', maxLength: 200, 'aria-required': true }}
                        />
                        <FormField
                          control={metadata.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem id="document-template-kind">
                              <FormLabel>{word('category')}</FormLabel>
                              <FormControl>
                                <NativeSelect
                                  {...field}
                                  id="document-template-kind"
                                  aria-required="true"
                                  className="w-full"
                                  disabled={locked}
                                >
                                  {(['general', 'contract', 'invoice'] as const).map((value) => (
                                    <option key={value} value={value}>
                                      {word(value)}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </FormControl>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormTextarea
                        control={metadata.control}
                        name="description"
                        label={word('details')}
                        id="document-template-description"
                        disabled={locked}
                        inputProps={{
                          className:
                            'max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]',
                          maxLength: 2000,
                          dir: 'auto',
                          rows: 2,
                          placeholder: word('descriptionExample'),
                        }}
                      />
                    </RecordEditorSection>
                    {detail && changedMetadata.length > 0 && (
                      <RecordEditorDisclosure label={word('compareChanges')}>
                        <ConfigPreviewCard
                          title={word('templateDetails')}
                          current={
                            <TemplateSummary
                              value={detail}
                              locale={locale}
                              fields={changedMetadata}
                            />
                          }
                          draft={
                            <TemplateSummary
                              value={draft}
                              locale={locale}
                              fields={changedMetadata}
                            />
                          }
                        />
                      </RecordEditorDisclosure>
                    )}
                    <RecordEditorActions>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked}
                        onClick={() => {
                          if (owner.current) return;
                          setEditing(false);
                          onSettled?.(templateId);
                        }}
                      >
                        {word('cancel')}
                      </Button>
                      <FormSubmit
                        loading={validating && owner.current === 'metadata'}
                        disabled={
                          locked || state !== 'ready' || (!!selected && detailState !== 'ready')
                        }
                      >
                        {word('save')}
                      </FormSubmit>
                    </RecordEditorActions>
                  </form>
                </Form>
              ) : null}
              {detail && (publishView || historyView) ? (
                <div className={view ? 'max-w-4xl' : 'grid items-start gap-6 xl:grid-cols-2'}>
                  {publishView && (
                    <Form {...version}>
                      <form
                        key={`version-${linkGeneration.current}`}
                        noValidate
                        className={`${recordEditorFormSurface} [&_[data-slot=form-message]]:min-h-4`}
                        onSubmit={createVersion}
                        onFocus={keepRecordFieldVisible}
                        aria-label={word('publishVersion')}
                        onChangeCapture={(event) => {
                          if (owner.current) {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        }}
                      >
                        {version.formState.errors.root?.validation?.message && (
                          <p role="alert" className="mx-4 mt-4 text-sm text-destructive">
                            {version.formState.errors.root.validation.message}
                          </p>
                        )}
                        <RecordEditorSection
                          title={word('fileSelection')}
                          description={word('versionHelp')}
                        >
                          {latest?.files.length ? (
                            <FormField
                              control={version.control}
                              name="retainedFileIds"
                              render={({ field }) => (
                                <FormItem id="document-template-retained">
                                  <FormControl>
                                    <fieldset
                                      className="space-y-2"
                                      ref={field.ref}
                                      tabIndex={-1}
                                      onBlur={field.onBlur}
                                      disabled={locked}
                                    >
                                      <legend className="font-medium">
                                        {word('currentFiles')}
                                      </legend>
                                      {latest.files.map((file) => (
                                        <label
                                          key={file.id}
                                          className="touch-label flex flex-wrap items-center gap-2 text-sm [overflow-wrap:anywhere]"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={retained.includes(file.id)}
                                            disabled={locked}
                                            onChange={(event) =>
                                              field.onChange(
                                                event.target.checked
                                                  ? [...retained, file.id]
                                                  : retained.filter((id) => id !== file.id)
                                              )
                                            }
                                          />
                                          <span dir="auto">{file.originalName}</span>
                                          <span className="text-muted-foreground">
                                            ({word('retain')})
                                          </span>
                                        </label>
                                      ))}
                                    </fieldset>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : null}
                          <FormField
                            control={version.control}
                            name="files"
                            render={({ field }) => (
                              <FormItem id="document-template-files">
                                <div
                                  className={recordFilePicker}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    selectFiles([...event.dataTransfer.files]);
                                  }}
                                >
                                  <div className="relative min-w-0 max-w-full rounded-lg focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[:disabled]:opacity-60">
                                    <FormLabel
                                      className={buttonVariants({
                                        variant: 'outline',
                                        className: recordFilePickerAction,
                                      })}
                                    >
                                      <FileUp aria-hidden="true" className="size-4 shrink-0" />
                                      {word(files.length ? 'changeFiles' : 'chooseFiles')}
                                    </FormLabel>
                                    <FormControl>
                                      <input
                                        type="file"
                                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                        multiple
                                        name={field.name}
                                        ref={field.ref}
                                        onBlur={field.onBlur}
                                        aria-required={!retained.length || undefined}
                                        aria-describedby="document-template-file-help"
                                        disabled={locked}
                                        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                        onChange={(event) =>
                                          selectFiles([...(event.target.files ?? [])])
                                        }
                                      />
                                    </FormControl>
                                  </div>
                                  <div className={recordFilePickerHelp}>
                                    <p className="hidden [@media(pointer:fine)]:block">
                                      {word('dropHint')}
                                    </p>
                                    <p id="document-template-file-help">{word('fileHelp')}</p>
                                  </div>
                                </div>
                                <FormMessage />
                                {!!files.length && (
                                  <ul className="list-disc space-y-1 ps-5 text-sm [overflow-wrap:anywhere]">
                                    {files.map((file, index) => (
                                      <li key={index}>
                                        <bdi>{file.name}</bdi>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </FormItem>
                            )}
                          />
                          <FormInput
                            control={version.control}
                            name="changeSummary"
                            label={word('changeSummary')}
                            id="document-template-summary"
                            disabled={locked}
                            inputProps={{ maxLength: 500, dir: 'auto' }}
                          />
                        </RecordEditorSection>
                        {view === 'publish' && (
                          <div className="px-4 py-3 sm:px-6">
                            <dl className="space-y-1 rounded-lg border bg-muted p-3 text-sm">
                              <dt className="font-medium">{word('fieldsChecked')}</dt>
                              <dd className="[overflow-wrap:anywhere]" dir="ltr">
                                {documentTemplateRequiredPlaceholders
                                  .map((key) => '{{' + key + '}}')
                                  .join(', ')}
                              </dd>
                              {!!latest?.missingRequired.length && (
                                <>
                                  <dt className="pt-2 font-medium">
                                    {word('currentMissingRequired')}
                                  </dt>
                                  <dd className="[overflow-wrap:anywhere]" dir="ltr">
                                    {latest.missingRequired
                                      .map((key) => '{{' + key + '}}')
                                      .join(', ')}
                                  </dd>
                                </>
                              )}
                            </dl>
                          </div>
                        )}
                        <RecordEditorDisclosure label={word('compareFiles')}>
                          <ConfigPreviewCard
                            title={word('compareFiles')}
                            hideTitle
                            current={
                              <ul className="flex flex-col gap-2">
                                {latest?.files.map((file) => (
                                  <li key={file.id} dir="auto">
                                    {file.originalName}
                                  </li>
                                ))}
                              </ul>
                            }
                            draft={
                              <ul className="flex flex-col gap-2">
                                {latest?.files
                                  .filter((file) => retained.includes(file.id))
                                  .map((file) => (
                                    <li key={file.id} dir="auto">
                                      {file.originalName}
                                    </li>
                                  ))}
                                {files.map((file, index) => (
                                  <li key={index} dir="auto">
                                    {file.name}
                                  </li>
                                ))}
                              </ul>
                            }
                          />
                        </RecordEditorDisclosure>
                        <StickyRecordEditorActions>
                          <FormSubmit
                            loading={validating && owner.current === 'version'}
                            disabled={locked || detailState !== 'ready'}
                          >
                            {word('publishVersion')}
                          </FormSubmit>
                        </StickyRecordEditorActions>
                      </form>
                    </Form>
                  )}
                  {historyView && (
                    <section
                      className="min-w-0 space-y-4 rounded-lg border bg-card p-4"
                      aria-label={word('history')}
                    >
                      {view === 'version' ? (
                        <VersionHeading className="text-lg font-semibold">
                          {word('versionFiles')}
                        </VersionHeading>
                      ) : view ? (
                        <h2 className="text-lg font-semibold">{word('history')}</h2>
                      ) : (
                        <VersionHeading className="text-lg font-semibold">
                          {word('history')}
                        </VersionHeading>
                      )}
                      {visibleVersions.length ? (
                        visibleVersions.map((version) => (
                          <div key={version.id} className="space-y-3 border-b pb-5 last:border-0">
                            <div className="flex flex-wrap items-baseline gap-3">
                              {view === 'detail' ? (
                                <h3 className="font-semibold">
                                  <Link
                                    to={routes.version}
                                    params={{ templateId: detail.id, version: version.id }}
                                    search={routeSearch}
                                    className="touch-action text-primary underline underline-offset-4"
                                  >
                                    {word('version')} {numbers.number(version.versionNumber)}
                                  </Link>
                                </h3>
                              ) : (
                                !view && (
                                  <VersionTitle className="font-semibold">
                                    {word('version')} {version.versionNumber}
                                  </VersionTitle>
                                )
                              )}
                              <time
                                className="text-xs text-muted-foreground"
                                dateTime={version.createdAt}
                              >
                                {time.format(version.createdAt)}
                              </time>
                            </div>
                            {version.changeSummary ? (
                              <p className="text-sm" dir="auto">
                                {version.changeSummary}
                              </p>
                            ) : null}
                            <ul className="space-y-2 text-sm">
                              {version.files.map((file) => {
                                const key = `${version.id}:${file.id}`;
                                const pending = pendingLinks.includes(key);
                                return (
                                  <li key={file.id} className="flex flex-wrap items-center gap-2">
                                    <span dir="auto">{file.originalName}</span>
                                    {view !== 'detail' && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        loading={pending}
                                        onClick={() => void getLink(version.id, file.id)}
                                      >
                                        {word('download')}
                                      </Button>
                                    )}
                                    {pending && (
                                      <LoadingStatus className="sr-only">
                                        {word('linkLoading')}
                                      </LoadingStatus>
                                    )}
                                    {links[key] ? (
                                      <a
                                        href={links[key]}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        referrerPolicy="no-referrer"
                                        className="text-primary underline"
                                      >
                                        {word('openFile')}
                                      </a>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="text-sm">
                              <span className="font-medium">{word('placeholders')}: </span>
                              {version.placeholders.length ? (
                                <span dir="ltr">
                                  {version.placeholders.map((name) => `{{${name}}}`).join(', ')}
                                </span>
                              ) : (
                                word('noPlaceholders')
                              )}
                            </div>
                            {version.missingRequired.length ? (
                              <p className="text-sm text-amber-700 dark:text-amber-300">
                                {word('missingRequired')}:{' '}
                                <span dir="ltr">
                                  {version.missingRequired.map((name) => `{{${name}}}`).join(', ')}
                                </span>
                              </p>
                            ) : null}
                            {version.conflicts.length ? (
                              <details className="text-sm">
                                <summary className="cursor-pointer font-medium">
                                  {word('conflicts')} ({version.conflicts.length})
                                </summary>
                                <p className="my-2 text-muted-foreground">
                                  {word('conflictsHelp')}
                                </p>
                                {version.conflicts.map((conflict) => (
                                  <div key={conflict.name} className="my-2">
                                    <strong dir="ltr">{`{{${conflict.name}}}`}</strong>
                                    <ul className="ms-4 list-disc">
                                      {conflict.files.map((file, index) => (
                                        <li key={`${file.fileName}-${index}`}>
                                          <span dir="auto">{file.fileName}</span>:{' '}
                                          <span dir="auto">{file.context}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </details>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {word(versionId ? 'missingVersion' : 'noVersions')}
                        </p>
                      )}
                    </section>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </ListPage>
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            captured.current?.kind === 'metadata' ? (
              <TemplateSummary value={captured.current.draft} locale={locale} />
            ) : captured.current?.kind === 'version' ? (
              <div className="space-y-2 text-sm">
                <p dir="auto">{captured.current.draft.changeSummary}</p>
                <ul>
                  {[
                    ...(captured.current.base.versions?.[0]?.files ?? [])
                      .filter(
                        (file) =>
                          captured.current?.kind === 'version' &&
                          captured.current.draft.retainedFileIds.includes(file.id)
                      )
                      .map((file) => file.originalName),
                    ...captured.current.draft.files.map((file) => file.name),
                  ].map((name) => (
                    <li key={name} dir="auto">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          }
          confirmationDisabled={
            uncertain ||
            !captured.current ||
            captured.current.generation !== linkGeneration.current ||
            (!!selected && detailState !== 'ready')
          }
          onClose={closeAction}
          onDenied={denyAccess}
          onUnconfirmed={() => {
            setUncertain(true);
            setAction(null);
            if (catalogueNeeded) {
              setState('loading');
              setRevision((value) => value + 1);
            }
            if (selected) {
              setDetailState('loading');
              setDetailRevision((value) => value + 1);
            }
          }}
          onValidationError={(fields) => {
            const pending = captured.current;
            if (!pending || pending.generation !== linkGeneration.current) return false;
            const names =
              pending.kind === 'metadata'
                ? ['title', 'description', 'category']
                : ['retainedFileIds', 'files', 'changeSummary'];
            const publicFields = fields.filter(
              (field): field is string => typeof field === 'string' && names.includes(field)
            );
            if (!publicFields.length) return false;
            for (const field of publicFields) {
              if (pending.kind === 'metadata')
                metadata.setError(field as keyof Draft, {
                  type: 'server',
                  message: word(
                    field === 'title'
                      ? 'titleInvalid'
                      : field === 'description'
                        ? 'descriptionInvalid'
                        : 'categoryInvalid'
                  ),
                });
              else
                version.setError(field as keyof TemplateVersionDraft, {
                  type: 'server',
                  message: word(field === 'changeSummary' ? 'summaryInvalid' : 'fileError'),
                });
            }
            errorFocus.current = { kind: pending.kind, name: publicFields[0]! };
            return true;
          }}
          onSuccess={async (result) => {
            const pending = captured.current;
            if (accessDenied.current || !pending || pending.generation !== linkGeneration.current)
              throw new Error('Obsolete document template receipt');
            if (
              pending.kind === 'metadata'
                ? !metadataReceipt(result, pending.draft, pending.selected)
                : !versionReceipt(result, pending.draft, pending.base)
            )
              throw new Error('Unconfirmed document template receipt');
            const next = result as Template;
            if (onSettled) {
              onSettled(next.id, pending.kind === 'version' ? next.versions?.[0]?.id : undefined);
              return word('saved');
            }
            choose(next.id, true);
            setSaved(true);
            setRevision((value) => value + 1);
            return undefined;
          }}
        />
      ) : null}
    </section>
  );
}

const templateMetadataFields = ['title', 'description', 'category'] as const;

function TemplateSummary({
  value,
  locale,
  fields = templateMetadataFields,
}: {
  value: Draft;
  locale: 'fa' | 'en';
  fields?: readonly (typeof templateMetadataFields)[number][];
}) {
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {fields.map((key) => (
        <div key={key}>
          <dt className="text-muted-foreground">
            {documentTemplateText(
              key === 'title' ? 'name' : key === 'description' ? 'details' : 'category',
              locale
            )}
          </dt>
          <dd className="whitespace-pre-wrap break-words" dir="auto">
            {key === 'category' ? documentTemplateText(value.category, locale) : value[key] || '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
