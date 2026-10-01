import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { ConfigPreviewCard } from '../components/ConfigPreviewCard.js';
import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';
import { documentUrl } from '../lib/documents.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

type Category = 'general' | 'contract' | 'invoice';
type FileInfo = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  placeholders: Array<{ name: string; context: string }>;
};
type Version = {
  id: string;
  versionNumber: number;
  changeSummary: string;
  placeholders: string[];
  missingRequired: string[];
  conflicts: Array<{ name: string; files: Array<{ fileName: string; context: string }> }>;
  createdAt: string;
  files: FileInfo[];
};
type Template = {
  id: string;
  title: string;
  description: string;
  category: Category;
  versionCount: number;
  updatedAt: string;
  versions?: Version[];
};
type Draft = { title: string; description: string; category: Category };
const blank = (): Draft => ({ title: '', description: '', category: 'general' });
const MAX_FILE = 10 * 1024 * 1024;

export default function AdminDocumentTemplatesPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const word = (key: Parameters<typeof documentTemplateText>[0]) =>
    documentTemplateText(key, locale);
  const time = useAccountTime();
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [retained, setRetained] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [changeSummary, setChangeSummary] = useState('');
  const [fileError, setFileError] = useState(false);
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

  function choose(id: string | null) {
    ++linkGeneration.current;
    acceptedDetail.current = null;
    setSelected(id);
    setDetail(null);
    setDraft(null);
    setRetained([]);
    setFiles([]);
    setChangeSummary('');
    setFileError(false);
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
          choose(null);
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
        if (!previous) setRetained(latest?.files.map((file) => file.id) ?? []);
        else if (previous.versions?.[0]?.id !== latest?.id) {
          const ids = new Set(latest?.files.map((file) => file.id) ?? []);
          setRetained((current) => current.filter((id) => ids.has(id)));
          setAction(null);
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
          setDraft(null);
          setRetained([]);
          setFiles([]);
          setChangeSummary('');
          setVersionChanged(false);
          setSaved(false);
          setLinks({});
          setLinkError(false);
          setAction(null);
        }
      });
    return () => controller.abort();
  }, [selected, detailRevision]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || accessDenied.current || (selected && detailState !== 'ready')) return;
    setAction({
      title: word('save'),
      description: word('confirmSave'),
      path: `/api/admin/document-templates${selected ? `/${selected}` : ''}`,
      method: selected ? 'PUT' : 'POST',
      body: draft,
      forbiddenMessage: word('denied'),
    });
  }

  function createVersion(event: FormEvent) {
    event.preventDefault();
    if (!selected || !detail || detailState !== 'ready' || accessDenied.current) return;
    if ((!retained.length && !files.length) || retained.length + files.length > 5) {
      setFileError(true);
      return;
    }
    const body = new FormData();
    body.set('changeSummary', changeSummary.trim());
    body.set('retainedFileIds', JSON.stringify(retained));
    for (const file of files) body.append('files', file);
    setAction({
      title: word('publishVersion'),
      description: word('confirmVersion'),
      path: `/api/admin/document-templates/${selected}/versions`,
      method: 'POST',
      body,
      forbiddenMessage: word('denied'),
      conflictMessage: word('conflict'),
    });
  }

  function selectFiles(next: File[]) {
    setFiles(next);
    setFileError(
      next.length > 5 ||
        next.some((file) => file.size === 0 || file.size > MAX_FILE) ||
        next.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024
    );
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
  const actionGeneration = linkGeneration.current;
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
          disabled={state === 'loading' || detailState === 'loading'}
          onClick={() => {
            setRevision((value) => value + 1);
            setDetailRevision((value) => value + 1);
          }}
        >
          {word('refresh')}
        </Button>
      </header>
      {saved ? <p role="status">{word('saved')}</p> : null}
      {linkError ? <p role="alert">{word('linkError')}</p> : null}
      <ListPage>
        <ListPage.Toolbar>
          <form
            className="flex min-w-0 flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
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
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="min-w-44 space-y-1">
              <Label htmlFor="document-template-category">{word('category')}</Label>
              <select
                id="document-template-category"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={category}
                onChange={(event) => {
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
            <Button type="submit" variant="outline">
              {word('search')}
            </Button>
          </form>
        </ListPage.Toolbar>
        <div className="grid gap-8 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-3">
            <div role="region" aria-label={word('listTitle')}>
              <ListPage.Toolbar>
                <Button
                  disabled={rows === null || state === 'denied'}
                  onClick={() => {
                    choose(null);
                    setDraft(blank());
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
                        onClick={() => setRevision((value) => value + 1)}
                      >
                        {word('retry')}
                      </Button>
                    )}
                  </div>
                }
                emptyView={<p className="text-sm text-muted-foreground">{word('empty')}</p>}
              >
                <ul className="divide-y border-y">
                  {visibleRows?.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="w-full px-2 py-3 text-start hover:bg-muted focus-visible:outline focus-visible:outline-2"
                        aria-current={selected === row.id ? 'page' : undefined}
                        onClick={() => {
                          choose(row.id);
                        }}
                      >
                        <span className="block font-medium" dir="auto">
                          {row.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {word(row.category)} · {word('versionCount')}: {row.versionCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ListPage.Content>
            </div>
          </aside>
          <div className="min-w-0 space-y-7">
            {detailState === 'loading' && <p role="status">{word('loadingDetail')}</p>}
            {(detailState === 'error' || detailState === 'denied') && (
              <div role="alert" className="space-y-2">
                <p>{word(detailState === 'denied' ? 'denied' : 'detailError')}</p>
                {detailState !== 'denied' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDetailRevision((value) => value + 1)}
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
                  onClick={() =>
                    setDraft({
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
              <form className="space-y-4 border-y py-5" onSubmit={save} aria-label={word('edit')}>
                <h2 className="text-xl font-semibold">{word(selected ? 'edit' : 'add')}</h2>
                <div className="space-y-1">
                  <Label htmlFor="document-template-title">{word('name')}</Label>
                  <Input
                    id="document-template-title"
                    autoFocus
                    required
                    maxLength={200}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="document-template-description">{word('details')}</Label>
                  <textarea
                    id="document-template-description"
                    className="min-h-24 w-full rounded-md border bg-background p-3"
                    maxLength={2000}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="document-template-kind">{word('category')}</Label>
                  <select
                    id="document-template-kind"
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={draft.category}
                    onChange={(event) =>
                      setDraft({ ...draft, category: event.target.value as Category })
                    }
                  >
                    {(['general', 'contract', 'invoice'] as const).map((value) => (
                      <option key={value} value={value}>
                        {word(value)}
                      </option>
                    ))}
                  </select>
                </div>
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
                  <Button type="submit" disabled={!!selected && detailState !== 'ready'}>
                    {word('save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                    {word('cancel')}
                  </Button>
                </div>
              </form>
            ) : null}
            {detail ? (
              <>
                <form className="space-y-4 border-y py-5" onSubmit={createVersion}>
                  <h3 className="text-lg font-semibold">{word('publishVersion')}</h3>
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
                    <fieldset className="space-y-2">
                      <legend className="font-medium">{word('currentFiles')}</legend>
                      {latest.files.map((file) => (
                        <label key={file.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={retained.includes(file.id)}
                            onChange={(event) =>
                              setRetained((current) =>
                                event.target.checked
                                  ? [...current, file.id]
                                  : current.filter((id) => id !== file.id)
                              )
                            }
                          />
                          <span dir="auto">{file.originalName}</span>
                          <span className="text-muted-foreground">({word('retain')})</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <div
                    className="space-y-1 rounded-md border border-dashed p-4"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      selectFiles([...event.dataTransfer.files]);
                    }}
                  >
                    <Label htmlFor="document-template-files">{word('newFiles')}</Label>
                    <input
                      id="document-template-files"
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      multiple
                      className="block w-full text-sm"
                      onChange={(event) => selectFiles([...(event.target.files ?? [])])}
                    />
                    <p className="text-xs text-muted-foreground">{word('fileHelp')}</p>
                    {files.length ? (
                      <p className="text-sm" dir="auto">
                        {files.map((file) => file.name).join(', ')}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="document-template-summary">{word('changeSummary')}</Label>
                    <Input
                      id="document-template-summary"
                      maxLength={500}
                      value={changeSummary}
                      onChange={(event) => setChangeSummary(event.target.value)}
                    />
                  </div>
                  {fileError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {word('fileError')}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={
                      detailState !== 'ready' || fileError || (!retained.length && !files.length)
                    }
                  >
                    {word('publishVersion')}
                  </Button>
                </form>
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
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (accessDenied.current || actionGeneration !== linkGeneration.current) return;
            const next = result as Template | null;
            choose(next?.id ?? selected);
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
