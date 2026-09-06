import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
interface Ref {
  id: string;
  title: string;
}
interface Agent extends Ref {
  description: string;
  modelId: string;
  modelTitle: string;
  enabled: boolean;
}
interface Detail extends Agent {
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
interface Options {
  models: Ref[];
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
interface Draft {
  title: string;
  description: string;
  modelId: string;
  enabled: boolean;
  kbIds: string[];
  policyIds: string[];
  kbGroupIds: string[];
  policyGroupIds: string[];
}
const sets = [
  ['kbIds', 'kbs'],
  ['policyIds', 'policies'],
  ['kbGroupIds', 'kbGroups'],
  ['policyGroupIds', 'policyGroups'],
] as const;
const blank = (): Draft => ({
  title: '',
  description: '',
  modelId: '',
  enabled: true,
  kbIds: [],
  policyIds: [],
  kbGroupIds: [],
  policyGroupIds: [],
});
export default function AdminAiAgentsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.agents.${key}`, locale);
  const [rows, setRows] = useState<Agent[]>([]),
    [options, setOptions] = useState<Options | null>(null),
    [editor, setEditor] = useState<string | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [revision, setRevision] = useState(0),
    [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading'),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRows([]);
    setOptions(null);
    setDraft(null);
    void (async () => {
      try {
        const paths = [
          '/api/admin/agents',
          '/api/admin/agents/options',
          ...(editor && editor !== 'new' ? [`/api/admin/agents/${editor}`] : []),
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
        setRows(data[0] as Agent[]);
        setOptions(data[1] as Options);
        if (editor === 'new') setDraft(blank());
        else if (editor) {
          const row = data[2] as Detail;
          setDraft({
            title: row.title,
            description: row.description,
            modelId: row.modelId,
            enabled: row.enabled,
            kbIds: row.kbs.map((item) => item.id),
            policyIds: row.policies.map((item) => item.id),
            kbGroupIds: row.kbGroups.map((item) => item.id),
            policyGroupIds: row.policyGroups.map((item) => item.id),
          });
        }
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [editor, revision]);
  function chooseEditor(value: string | null) {
    setState('loading');
    setEditor(value);
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
      conflictMessage: label('changed'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        AI_MODEL_NOT_FOUND: label('changed'),
        AI_KB_NOT_FOUND: label('changed'),
        AI_POLICY_NOT_FOUND: label('changed'),
        AI_KB_GROUP_NOT_FOUND: label('changed'),
        AI_POLICY_GROUP_NOT_FOUND: label('changed'),
      },
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor) return;
    propose(
      `/api/admin/agents${editor === 'new' ? '' : `/${editor}`}`,
      editor === 'new' ? 'POST' : 'PUT',
      label('save'),
      label('confirmSave'),
      { ...draft, title: draft.title.trim() }
    );
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            setEditor(null);
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
      {state === 'ready' && options && (
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
                <Label htmlFor="agent-title">{label('name')}</Label>
                <Input
                  id="agent-title"
                  required
                  maxLength={120}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="agent-description">{label('description')}</Label>
                <textarea
                  id="agent-description"
                  className="min-h-24 rounded-md border bg-background p-3"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="agent-model">{label('model')}</Label>
                <select
                  id="agent-model"
                  className="max-w-full rounded-md border bg-background p-2"
                  required
                  value={draft.modelId}
                  onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                >
                  <option value="">{label('chooseModel')}</option>
                  {options.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.title}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                {label('enabled')}
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                {sets.map(([field, source]) => (
                  <fieldset key={field} className="min-w-0 rounded-md border p-4">
                    <legend className="px-1 font-semibold">{label(source)}</legend>
                    <p className="mb-3 text-sm text-muted-foreground">{label('selectionHelp')}</p>
                    {!options[source].length && <p>{label('noChoices')}</p>}
                    <div className="flex max-h-60 flex-col gap-3 overflow-y-auto">
                      {options[source].map((item) => (
                        <label key={item.id} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={draft[field].includes(item.id)}
                            disabled={!draft[field].includes(item.id) && draft[field].length >= 200}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                [field]: event.target.checked
                                  ? [...draft[field], item.id]
                                  : draft[field].filter((id) => id !== item.id),
                              })
                            }
                          />
                          <span className="min-w-0 break-words">{item.title}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={!draft.title.trim() || !draft.modelId}>
                  {label('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => chooseEditor(null)}>
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
                  <p className="break-words text-sm">
                    {label('model')}: {row.modelTitle}
                  </p>
                  <span className="text-sm">{label(row.enabled ? 'enabled' : 'disabled')}</span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    aria-label={`${label('edit')} ${row.title}`}
                    onClick={() => chooseEditor(row.id)}
                  >
                    {label('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`${label('delete')} ${row.title}`}
                    onClick={() =>
                      propose(
                        `/api/admin/agents/${row.id}`,
                        'DELETE',
                        label('delete'),
                        `${row.title}. ${label('confirmDelete')}`
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
            setEditor(null);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
