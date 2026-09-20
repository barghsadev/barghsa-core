import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { KnowledgeBaseDocumentPicker } from '../components/KnowledgeBaseDocumentPicker.js';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Entry {
  id: string;
  title: string;
  description: string;
  documentCount?: number;
  memberCount?: number;
}
interface Detail extends Entry {
  members?: { id: string; title: string }[];
  documents?: { id: string; fileName: string; storageKey: string; processingStatus: string }[];
}
type Kind = 'knowledge-bases' | 'kb-groups';
export default function AdminKnowledgeBasesPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.kb.${key}`, locale);
  const [kind, setKind] = useState<Kind>('knowledge-bases');
  const [rows, setRows] = useState<Entry[]>([]),
    [kbs, setKbs] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<{ id?: string; title: string; description: string } | null>(
    null
  );
  const [member, setMember] = useState(''),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [action, setAction] = useState<TeamAction | null>(null),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRows([]);
    setDetail(null);
    setDraft(null);
    setMember('');
    void (async () => {
      try {
        const paths = [
          `/api/admin/${kind}`,
          '/api/admin/knowledge-bases',
          ...(selected ? [`/api/admin/${kind}/${selected}`] : []),
        ];
        const responses = await Promise.all(
          paths.map((path) => fetch(path, { signal: abort.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted) return;
        setRows(data[0] as Entry[]);
        setKbs(data[1] as Entry[]);
        setDetail((data[2] as Detail | undefined) ?? null);
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [kind, selected, revision]);
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    setNotice(false);
    setAction({
      path,
      method,
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      errorMessages: { 'VALIDATION:PARSE:ZOD_ERROR': label('invalid') },
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    propose(
      `/api/admin/${kind}${draft.id ? `/${draft.id}` : ''}`,
      draft.id ? 'PUT' : 'POST',
      label('save'),
      label('confirmSave'),
      { title: draft.title.trim(), description: draft.description }
    );
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['knowledge-bases', 'kb-groups'] as const).map((value) => (
          <Button
            key={value}
            variant={kind === value ? 'default' : 'outline'}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setSelected(null);
              setNotice(false);
            }}
          >
            {label(value)}
          </Button>
        ))}
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
      {notice && <p role="status">{label('saved')}</p>}
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'ready' && (
        <>
          <div>
            <Button onClick={() => setDraft({ title: '', description: '' })}>
              {label(kind === 'knowledge-bases' ? 'addKb' : 'addGroup')}
            </Button>
          </div>
          {draft && (
            <form
              onSubmit={save}
              aria-label={label('editor')}
              className="flex flex-col gap-4 border-y py-5"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="kb-title">{label('name')}</Label>
                <Input
                  id="kb-title"
                  required
                  maxLength={120}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="kb-description">{label('description')}</Label>
                <textarea
                  id="kb-description"
                  className="min-h-24 rounded-md border bg-background p-3"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={!draft.title.trim()}>
                  {label('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
          )}
          {!rows.length && <p>{label('empty')}</p>}
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">{row.title}</h2>
                  <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {label(kind === 'knowledge-bases' ? 'documents' : 'members')}:{' '}
                    {numbers.number(row.documentCount ?? row.memberCount ?? 0)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelected(row.id)}
                    aria-label={`${label('open')} ${row.title}`}
                  >
                    {label('open')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDraft({ id: row.id, title: row.title, description: row.description })
                    }
                    aria-label={`${label('edit')} ${row.title}`}
                  >
                    {label('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      propose(
                        `/api/admin/${kind}/${row.id}`,
                        'DELETE',
                        label('delete'),
                        `${row.title}. ${label('confirmDelete')}`
                      )
                    }
                    aria-label={`${label('delete')} ${row.title}`}
                  >
                    {label('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {detail && (
            <section aria-label={detail.title} className="flex flex-col gap-4 border-t pt-5">
              <h2 className="break-words text-xl font-semibold">{detail.title}</h2>
              {kind === 'kb-groups' ? (
                <>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (member)
                        propose(
                          `/api/admin/kb-groups/${detail.id}/members`,
                          'POST',
                          label('link'),
                          label('confirmLink'),
                          { kbId: member }
                        );
                    }}
                  >
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="kb-member">{label('selectKb')}</Label>
                      <select
                        id="kb-member"
                        className="max-w-full rounded-md border bg-background p-2"
                        required
                        value={member}
                        onChange={(event) => setMember(event.target.value)}
                      >
                        <option value="">{label('selectKb')}</option>
                        {kbs
                          .filter(
                            (kb) => !detail.members?.some((existing) => existing.id === kb.id)
                          )
                          .map((kb) => (
                            <option key={kb.id} value={kb.id}>
                              {kb.title}
                            </option>
                          ))}
                      </select>
                    </div>
                    <Button type="submit" disabled={!member}>
                      {label('link')}
                    </Button>
                  </form>
                  <ul className="divide-y">
                    {detail.members?.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                        <span className="min-w-0 break-words">{item.title}</span>
                        <Button
                          variant="outline"
                          onClick={() =>
                            propose(
                              `/api/admin/kb-groups/${detail.id}/members/${item.id}`,
                              'DELETE',
                              label('unlink'),
                              label('confirmUnlink')
                            )
                          }
                          aria-label={`${label('unlink')} ${item.title}`}
                        >
                          {label('unlink')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <h3 className="font-semibold">{label('documents')}</h3>
                  <KnowledgeBaseDocumentPicker
                    key={`${detail.id}:${revision}`}
                    attachedKeys={detail.documents?.map((doc) => doc.storageKey) ?? []}
                    onAttach={(key) =>
                      propose(
                        `/api/admin/knowledge-bases/${detail.id}/documents`,
                        'POST',
                        label('attach'),
                        label('confirmAttach'),
                        { storageKey: key }
                      )
                    }
                  />

                  {!detail.documents?.length && <p>{label('noDocuments')}</p>}
                  <ul className="divide-y">
                    {detail.documents?.map((doc) => (
                      <li key={doc.id} className="flex flex-col gap-1 py-3">
                        <span className="break-words">{doc.fileName}</span>
                        <div>
                          <Button
                            variant="outline"
                            aria-label={`${label('detach')} ${doc.fileName}`}
                            onClick={() =>
                              propose(
                                `/api/admin/knowledge-bases/${detail.id}/documents/${doc.id}`,
                                'DELETE',
                                label('detach'),
                                label('confirmDetach')
                              )
                            }
                          >
                            {label('detach')}
                          </Button>
                        </div>
                        <span>
                          {label(
                            ['pending', 'processing', 'ready', 'failed'].includes(
                              doc.processingStatus
                            )
                              ? doc.processingStatus
                              : 'unknown'
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            if (action.method === 'DELETE' && action.path === `/api/admin/${kind}/${selected}`)
              setSelected(null);
            setNotice(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
