import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, DateCell, TextCell, Input, Label, ListPage } from '@barghsa/ui';
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
import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';
import { documentUrl } from '../lib/documents.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import {
  emptyTemplateMetadata as blank,
  emptyTemplateVersion,
  metadataErrors,
  versionErrors,
  metadataReceipt,
  versionReceipt,
  type TemplateCategory as Category,
  type DocumentTemplate as Template,
  type TemplateMetadata as Draft,
  type TemplateVersionDraft,
} from '../lib/document-template-form.js';

export default function AdminDocumentTemplatesPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const word = (key: Parameters<typeof documentTemplateText>[0]) =>
    documentTemplateText(key, locale);
  const time = useAccountTime();
  const numbers = useNumberFormatting(locale);
  const [searchInput, setSearchInput] = useState(queries?.query.search || '');
  const [localSearch, setSearch] = useState('');
  const [localCategory, setCategory] = useState<Category | ''>('');
  const search = queries ? queries.query.search : localSearch;
  const category = queries ? queries.query.filters.category || '' : localCategory;
  useEffect(() => {
    if (queries) setSearchInput(search);
  }, [search]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Template[] | null>(null);
  const [detail, setDetail] = useState<Template | null>(null);
  const [editing, setEditing] = useState(false);
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
  const draft = editing ? metadata.watch() : null;
  const { retainedFileIds: retained, files } = version.watch();
  const [linkError, setLinkError] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'denied' | 'error'>('ready');
  const [acceptedCriteria, setAcceptedCriteria] = useState('');
  const [versionChanged, setVersionChanged] = useState(false);
  const criteria = JSON.stringify([search, category]);
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

  function choose(id: string | null, force = false) {
    if (owner.current && !force) return;
    ++linkGeneration.current;
    acceptedDetail.current = null;
    setSelected(id);
    setDetail(null);
    setEditing(false);
    metadata.reset(blank());
    version.reset(emptyTemplateVersion());
    owner.current = null;
    captured.current = null;
    errorFocus.current = null;
    setUncertain(false);
    setLinks({});
    setLinkError(false);
    setVersionChanged(false);
    setAction(null);
    setSaved(false);
    setDetailRevision((value) => value + 1);
  }
  useEffect(
    () => () => {
      ++linkGeneration.current;
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    void fetch(`/api/admin/document-templates?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error([401, 403].includes(response.status) ? 'denied' : 'error');
        const data = (await response.json()) as Template[];
        if (!Array.isArray(data)) throw new Error('error');
        if (controller.signal.aborted) return;
        accessDenied.current = false;
        setRows(data);
        setAcceptedCriteria(criteria);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const denied = reason instanceof Error && reason.message === 'denied';
        setState(denied ? 'denied' : 'error');
        if (denied) {
          accessDenied.current = true;
          setRows(null);
          choose(null, true);
        }
      });
    return () => controller.abort();
  }, [category, revision, search, criteria]);
  useEffect(() => {
    if (!selected) {
      setDetailState('ready');
      return;
    }
    const controller = new AbortController();
    setDetailState('loading');
    const current = linkGeneration.current;
    void fetch(`/api/admin/document-templates/${selected}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error([401, 403].includes(response.status) ? 'denied' : 'error');
        const next = (await response.json()) as Template;
        if (next.id !== selected || (next.versions !== undefined && !Array.isArray(next.versions)))
          throw new Error('error');
        if (controller.signal.aborted || accessDenied.current || current !== linkGeneration.current)
          return;
        const previous = acceptedDetail.current;
        const latest = next.versions?.[0];
        if (!previous)
          version.reset({
            ...emptyTemplateVersion(),
            retainedFileIds: latest?.files.map((file) => file.id) ?? [],
          });
        else if (previous.versions?.[0]?.id !== latest?.id) {
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
        setDetail(next);
        setDetailState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || accessDenied.current || current !== linkGeneration.current)
          return;
        const denied = reason instanceof Error && reason.message === 'denied';
        setDetailState(denied ? 'denied' : 'error');
        if (denied) {
          ++linkGeneration.current;
          acceptedDetail.current = null;
          setDetail(null);
          setEditing(false);
          metadata.reset(blank());
          version.reset(emptyTemplateVersion());
          owner.current = null;
          captured.current = null;
          setUncertain(false);
          setVersionChanged(false);
          setSaved(false);
          setLinks({});
          setLinkError(false);
          setAction(null);
        }
      });
    return () => controller.abort();
  }, [selected, detailRevision]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || owner.current || accessDenied.current || (selected && detailState !== 'ready'))
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
      setValidating(false);
      if (!captured.current) owner.current = null;
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
          body,
          successStatus: 201,
          forbiddenMessage: word('denied'),
          conflictMessage: word('conflict'),
        });
      })(event);
    } finally {
      setValidating(false);
      if (!captured.current) owner.current = null;
    }
  }

  function selectFiles(next: File[]) {
    if (owner.current) return;
    version.setValue('files', next, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  }

  async function getLink(versionId: string, fileId: string) {
    if (!selected || accessDenied.current) return;
    const current = linkGeneration.current;
    try {
      const response = await fetch(
        `/api/admin/document-templates/${selected}/versions/${versionId}/files/${fileId}/download`
      );
      if (!response.ok) throw new Error('Link unavailable');
      const data = (await response.json()) as { url: string };
      const url = documentUrl(data.url);
      if (current === linkGeneration.current && !accessDenied.current)
        setLinks((links) => ({ ...links, [fileId]: url }));
    } catch {
      if (current === linkGeneration.current && !accessDenied.current) setLinkError(true);
    }
  }

  const latest = detail?.versions?.[0];
  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{word('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{word('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={validating || !!action || state === 'loading' || detailState === 'loading'}
          onClick={() => {
            if (owner.current && !uncertain) return;
            setRevision((value) => value + 1);
            setDetailRevision((value) => value + 1);
          }}
        >
          {word('refresh')}
        </Button>
      </header>
      {saved ? <p role="status">{word('saved')}</p> : null}
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
        <ListPage.Toolbar>
          <form
            className="flex min-w-0 flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (owner.current) return;
              if (queries) queries.setQuery({ search: searchInput.trim() });
              else setSearch(searchInput.trim());
            }}
          >
            <div className="min-w-52 flex-1 space-y-1">
              <Label htmlFor="document-template-search">{word('search')}</Label>
              <Input
                id="document-template-search"
                value={searchInput}
                maxLength={100}
                disabled={locked}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="min-w-44 space-y-1">
              <Label htmlFor="document-template-category">{word('category')}</Label>
              <select
                id="document-template-category"
                className="h-10 w-full rounded-md border bg-background px-3"
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
              </select>
            </div>
            <Button type="submit" variant="outline" disabled={locked}>
              {word('search')}
            </Button>
          </form>
        </ListPage.Toolbar>
        <div className="flex min-w-0 flex-col gap-8">
          <div className="min-w-0 space-y-3">
            <div role="region" aria-label={word('listTitle')}>
              <ListPage.Toolbar>
                <Button
                  disabled={locked || rows === null || state === 'denied'}
                  onClick={() => {
                    choose(null);
                    editMetadata(blank());
                  }}
                >
                  {word('add')}
                </Button>
              </ListPage.Toolbar>
              <ListPage.Content
                loading={state === 'loading'}
                error={state === 'error' || state === 'denied'}
                empty={!visibleRows?.length}
                retainContent={!!visibleRows?.length && state !== 'denied'}
                loadingView={<p role="status">{word('loading')}</p>}
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
                  renderName={(row) => (
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
                      }}
                    >
                      <TextCell value={row.title} />
                    </Button>
                  )}
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
          <div className="min-w-0 space-y-7" role="region" aria-label={word('workspaceTitle')}>
            {detailState === 'loading' && <p role="status">{word('loadingDetail')}</p>}
            {(detailState === 'error' || detailState === 'denied') && (
              <div role="alert" className="space-y-2">
                <p>{word(detailState === 'denied' ? 'denied' : 'detailError')}</p>
                {detailState !== 'denied' && (
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
                )}
              </div>
            )}
            {versionChanged && <p role="status">{word('versionChanged')}</p>}
            {detail && !draft ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold" dir="auto">
                    {detail.title}
                  </h2>
                  {detail.description ? (
                    <p
                      className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground"
                      dir="auto"
                    >
                      {detail.description}
                    </p>
                  ) : null}
                </div>
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
              </div>
            ) : null}
            {draft ? (
              <Form {...metadata}>
                <form
                  key={`metadata-${linkGeneration.current}`}
                  noValidate
                  className="space-y-4 border-y py-5"
                  onSubmit={save}
                  aria-label={word('edit')}
                  onChangeCapture={(event) => {
                    if (owner.current) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                >
                  <h2 className="text-xl font-semibold">{word(selected ? 'edit' : 'add')}</h2>
                  {metadata.formState.errors.root?.validation?.message && (
                    <p role="alert">{metadata.formState.errors.root.validation.message}</p>
                  )}
                  <FormInput
                    control={metadata.control}
                    name="title"
                    label={word('name')}
                    id="document-template-title"
                    disabled={locked}
                    inputProps={{ autoFocus: true, maxLength: 200 }}
                  />
                  <FormTextarea
                    control={metadata.control}
                    name="description"
                    label={word('details')}
                    id="document-template-description"
                    disabled={locked}
                    inputProps={{ className: 'min-h-24', maxLength: 2000 }}
                  />
                  <FormField
                    control={metadata.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem id="document-template-kind">
                        <FormLabel>{word('category')}</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            id="document-template-kind"
                            className="h-10 w-full rounded-md border bg-background px-3"
                            disabled={locked}
                          >
                            {(['general', 'contract', 'invoice'] as const).map((value) => (
                              <option key={value} value={value}>
                                {word(value)}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                  <ConfigPreviewCard
                    title={`${settingsText('admin.settings.comparison', locale)}: ${word('edit')}`}
                    current={
                      detail ? (
                        <TemplateSummary value={detail} locale={locale} />
                      ) : (
                        <p>{settingsText('admin.settings.none', locale)}</p>
                      )
                    }
                    draft={<TemplateSummary value={draft} locale={locale} />}
                  />
                  <div className="flex gap-2">
                    <FormSubmit
                      loading={validating && owner.current === 'metadata'}
                      disabled={locked || (!!selected && detailState !== 'ready')}
                    >
                      {word('save')}
                    </FormSubmit>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locked}
                      onClick={() => {
                        if (!owner.current) setEditing(false);
                      }}
                    >
                      {word('cancel')}
                    </Button>
                  </div>
                </form>
              </Form>
            ) : null}
            {detail ? (
              <>
                <Form {...version}>
                  <form
                    key={`version-${linkGeneration.current}`}
                    noValidate
                    className="space-y-4 border-y py-5"
                    onSubmit={createVersion}
                    aria-label={word('publishVersion')}
                    onChangeCapture={(event) => {
                      if (owner.current) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  >
                    <h3 className="text-lg font-semibold">{word('publishVersion')}</h3>
                    {version.formState.errors.root?.validation?.message && (
                      <p role="alert">{version.formState.errors.root.validation.message}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{word('versionHelp')}</p>
                    <ConfigPreviewCard
                      title={`${settingsText('admin.settings.comparison', locale)}: ${word('publishVersion')}`}
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
                                <legend className="font-medium">{word('currentFiles')}</legend>
                                {latest.files.map((file) => (
                                  <label key={file.id} className="flex items-center gap-2 text-sm">
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
                            <FormMessage reserveSpace />
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
                            className="space-y-1 rounded-md border border-dashed p-4"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              selectFiles([...event.dataTransfer.files]);
                            }}
                          >
                            <FormLabel>{word('newFiles')}</FormLabel>
                            <FormControl>
                              <input
                                id="document-template-files"
                                type="file"
                                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                multiple
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                disabled={locked}
                                className="block w-full text-sm"
                                onChange={(event) => selectFiles([...(event.target.files ?? [])])}
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">{word('fileHelp')}</p>
                            {files.length ? (
                              <p className="text-sm" dir="auto">
                                {files.map((file) => file.name).join(', ')}
                              </p>
                            ) : null}
                            <FormMessage reserveSpace />
                          </div>
                        </FormItem>
                      )}
                    />
                    <FormInput
                      control={version.control}
                      name="changeSummary"
                      label={word('changeSummary')}
                      id="document-template-summary"
                      disabled={locked}
                      inputProps={{ maxLength: 500 }}
                    />
                    <FormSubmit
                      loading={validating && owner.current === 'version'}
                      disabled={locked || detailState !== 'ready'}
                    >
                      {word('publishVersion')}
                    </FormSubmit>
                  </form>
                </Form>
                <section className="space-y-4" aria-label={word('history')}>
                  <h3 className="text-lg font-semibold">{word('history')}</h3>
                  {detail.versions?.length ? (
                    detail.versions.map((version) => (
                      <div key={version.id} className="space-y-3 border-b pb-5 last:border-0">
                        <div className="flex flex-wrap items-baseline gap-3">
                          <h4 className="font-semibold">
                            {word('version')} {version.versionNumber}
                          </h4>
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
                          {version.files.map((file) => (
                            <li key={file.id} className="flex flex-wrap items-center gap-2">
                              <span dir="auto">{file.originalName}</span>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void getLink(version.id, file.id)}
                              >
                                {word('download')}
                              </Button>
                              {links[file.id] ? (
                                <a
                                  href={links[file.id]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  referrerPolicy="no-referrer"
                                  className="text-primary underline"
                                >
                                  {word('openFile')}
                                </a>
                              ) : null}
                            </li>
                          ))}
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
                            <p className="my-2 text-muted-foreground">{word('conflictsHelp')}</p>
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
                    <p className="text-sm text-muted-foreground">{word('noVersions')}</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
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
          onDenied={() => {
            accessDenied.current = true;
            setRows(null);
            setState('denied');
            choose(null, true);
          }}
          onUnconfirmed={() => {
            setUncertain(true);
            setAction(null);
            setState('loading');
            setRevision((value) => value + 1);
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
            choose(next.id, true);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function TemplateSummary({ value, locale }: { value: Draft; locale: 'fa' | 'en' }) {
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {(['title', 'description', 'category'] as const).map((key) => (
        <div key={key}>
          <dt className="text-muted-foreground">
            {documentTemplateText(
              key === 'title' ? 'name' : key === 'description' ? 'details' : 'category',
              locale
            )}
          </dt>
          <dd className="whitespace-pre-wrap break-words" dir="auto">
            {key === 'category' ? documentTemplateText(value.category, locale) : value[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
