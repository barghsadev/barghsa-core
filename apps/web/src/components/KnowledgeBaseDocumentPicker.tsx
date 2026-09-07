import { useEffect, useState } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
export function KnowledgeBaseDocumentPicker({
  attachedKeys,
  onAttach,
}: {
  attachedKeys: string[];
  onAttach: (key: string) => void;
}) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.kb.${key}`, locale);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0);
  const [files, setFiles] = useState<Array<{ storageKey: string; fileName: string }>>([]),
    [selected, setSelected] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setFiles([]);
    setSelected('');
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/knowledge-bases/documents/available?search=${encodeURIComponent(query)}`,
          { signal: abort.signal }
        );
        if (response.status === 403) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (!response.ok) throw new Error('Load failed');
        const data = (await response.json()) as Array<{ storageKey: string; fileName: string }>;
        if (!abort.signal.aborted) {
          setFiles(data);
          setState('ready');
        }
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [query, revision]);
  const available = files.filter((file) => !attachedKeys.includes(file.storageKey));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{label('pickerHelp')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setRevision((value) => value + 1);
        }}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="kb-file-search">{label('searchFiles')}</Label>
          <Input
            id="kb-file-search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          {label('search')}
        </Button>
      </form>
      {state === 'loading' && <p role="status">{label('loadingFiles')}</p>}
      {state === 'error' && <p role="alert">{label('fileError')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'ready' &&
        (available.length ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (available.some((file) => file.storageKey === selected)) onAttach(selected);
            }}
          >
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="kb-file">{label('selectFile')}</Label>
              <select
                id="kb-file"
                className="max-w-full rounded-md border bg-background p-2"
                required
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{label('selectFile')}</option>
                {available.map((file) => (
                  <option key={file.storageKey} value={file.storageKey}>
                    {file.fileName}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!selected}>
              {label('attach')}
            </Button>
          </form>
        ) : (
          <p>{label('noFiles')}</p>
        ))}
    </div>
  );
}
