import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';
import { documentUrl } from '../lib/documents.js';

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

export default function AdminDocumentTemplatesPage() {
  const locale = useLocale();
  const word = (key: Parameters<typeof documentTemplateText>[0]) =>
    documentTemplateText(key, locale);
  const time = useAccountTime();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Template[]>([]);
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
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setLinks({});
    setLinkError(false);
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (category) params.set('category', category);
        const paths = [
          `/api/admin/document-templates?${params.toString()}`,
          ...(selected ? [`/api/admin/document-templates/${selected}`] : []),
        ];
        const responses = await Promise.all(
          paths.map((path) => fetch(path, { signal: controller.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!controller.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Template read failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (controller.signal.aborted) return;
        setRows(data[0] as Template[]);
        const next = (data[1] as Template | undefined) ?? null;
        setDetail(next);
        setRetained(next?.versions?.[0]?.files.map((file) => file.id) ?? []);
        setFiles([]);
        setChangeSummary('');
        setFileError(false);
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, [category, revision, search, selected]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
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
    if (!selected || !detail) return;
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
    if (!selected) return;
    try {
      const response = await fetch(
        `/api/admin/document-templates/${selected}/versions/${versionId}/files/${fileId}/download`
      );
      if (!response.ok) throw new Error('Link unavailable');
      const data = (await response.json()) as { url: string };
      setLinks((current) => ({ ...current, [fileId]: documentUrl(data.url) }));
    } catch {
      setLinkError(true);
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
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          {word('refresh')}
        </Button>
      </header>
      {saved ? <p role="status">{word('saved')}</p> : null}
      {linkError ? <p role="alert">{word('linkError')}</p> : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchInput.trim());
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
            onChange={(event) => setCategory(event.target.value as Category | '')}
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
      {state === 'loading' ? <p role="status">{word('loading')}</p> : null}
      {state === 'denied' ? <p role="alert">{word('denied')}</p> : null}
      {state === 'error' ? (
        <p role="alert">
          {word('error')}{' '}
          <Button onClick={() => setRevision((value) => value + 1)}>{word('retry')}</Button>
        </p>
      ) : null}
      {state === 'ready' ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
          <aside className="space-y-3">
            <Button
              onClick={() => {
                setSelected(null);
                setDetail(null);
                setDraft(blank());
                setSaved(false);
              }}
            >
              {word('add')}
            </Button>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{word('empty')}</p>
            ) : null}
            <ul className="divide-y border-y">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full px-2 py-3 text-start hover:bg-muted focus-visible:outline focus-visible:outline-2"
                    aria-current={selected === row.id ? 'page' : undefined}
                    onClick={() => {
                      setSelected(row.id);
                      setDraft(null);
                      setSaved(false);
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
          </aside>
          <div className="min-w-0 space-y-7">
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
                <div className="flex gap-2">
                  <Button type="submit">{word('save')}</Button>
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
                  <Button type="submit" disabled={fileError || (!retained.length && !files.length)}>
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
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const next = result as Template | null;
            setSaved(true);
            setDraft(null);
            setFiles([]);
            if (next?.id) setSelected(next.id);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
