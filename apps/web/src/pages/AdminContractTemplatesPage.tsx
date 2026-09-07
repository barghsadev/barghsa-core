import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import type { ContractTemplateDto, ContractTemplateDetailDto } from '@barghsa/shared/admin';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
type Draft = { name: string; description: string; status: 'active' | 'inactive' };
type Upload = { fileName: string; contentType: string; content: string };
const MAX_BYTES = 10 * 1024 * 1024;
export default function AdminContractTemplatesPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
  const [rows, setRows] = useState<ContractTemplateDto[]>([]),
    [detail, setDetail] = useState<ContractTemplateDetailDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading'),
    [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null),
    [fileError, setFileError] = useState(false),
    [reading, setReading] = useState(false);
  const fileGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fileGeneration.current++;
    setUpload(null);
    setFileError(false);
    setReading(false);
    setState('loading');
    setRows([]);
    setDetail(null);
    setDraft(null);
    void (async () => {
      try {
        const responses = await Promise.all(
          [
            '/api/admin/contract-templates',
            ...(selected && selected !== 'new'
              ? [`/api/admin/contract-templates/${selected}`]
              : []),
          ].map((path) => fetch(path, { signal: abort.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted) return;
        setRows(data[0] as ContractTemplateDto[]);
        if (selected === 'new') setDraft({ name: '', description: '', status: 'active' });
        else if (selected) {
          const row = data[1] as ContractTemplateDetailDto;
          setDetail(row);
          setDraft({ name: row.name, description: row.description ?? '', status: row.status });
        }
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => {
      abort.abort();
      fileGeneration.current++;
    };
  }, [selected, revision]);
  function chooseEditor(value: string | null) {
    setState('loading');
    setSelected(value);
    setRevision((current) => current + 1);
  }
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    setSaved(false);
    setAction({
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
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !selected) return;
    propose(
      `/api/admin/contract-templates${selected === 'new' ? '' : `/${selected}`}`,
      selected === 'new' ? 'POST' : 'PATCH',
      label('save'),
      label('confirmSave'),
      {
        name: draft.name.trim(),
        description: draft.description,
        ...(selected === 'new' ? {} : { status: draft.status }),
      }
    );
  }
  async function readFile(file: File | undefined) {
    const generation = ++fileGeneration.current;
    setUpload(null);
    setFileError(false);
    setReading(false);
    if (!file) return;
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
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null);
            setRevision((value) => value + 1);
          }}
        >
          {label('refresh')}
        </Button>
      </div>
      {saved && <p role="status">{label('saved')}</p>}
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'ready' && (
        <>
          <div>
            <Button onClick={() => chooseEditor('new')}>{label('add')}</Button>
          </div>
          {draft && (
            <form
              aria-label={label('editor')}
              onSubmit={save}
              className="flex flex-col gap-4 border-y py-5"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="template-name">{label('name')}</Label>
                <Input
                  id="template-name"
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="template-description">{label('description')}</Label>
                <textarea
                  id="template-description"
                  className="min-h-24 rounded-md border bg-background p-3"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              {selected !== 'new' && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.status === 'active'}
                    onChange={(event) =>
                      setDraft({ ...draft, status: event.target.checked ? 'active' : 'inactive' })
                    }
                  />
                  {label('active')}
                </label>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={!draft.name.trim()}>
                  {label('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => chooseEditor(null)}>
                  {label('cancel')}
                </Button>
              </div>
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
                  void readFile(event.dataTransfer.files[0]);
                }}
              >
                <Label htmlFor="template-file">{label('file')}</Label>
                <p className="my-2 text-sm text-muted-foreground">{label('fileHelp')}</p>
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                  {label('chooseFile')}
                </Button>
                <input
                  id="template-file"
                  ref={fileInput}
                  type="file"
                  accept="text/*,.txt,.html,.md,.csv"
                  className="hidden"
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
                  disabled={!upload || reading}
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
                      {label('version')} {version.versionNumber.toLocaleString(locale)}
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
                    {row.versionCount.toLocaleString(locale)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    aria-label={`${label('open')} ${row.name}`}
                    onClick={() => chooseEditor(row.id)}
                  >
                    {label('open')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={row.versionCount > 0}
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
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            if (selected === 'new' || action.method === 'DELETE') setSelected(null);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
