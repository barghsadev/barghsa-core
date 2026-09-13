import { useAccountTime } from '../hooks/useAccountTime.js';
/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The labelled, horizontally scrollable table region must be keyboard-focusable. */
import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Model {
  id: string;
  title: string;
  providerType: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  modelName: string;
  apiTokenMasked: string;
  status: 'reachable' | 'unreachable' | 'unknown';
  lastTestedAt: string | null;
  lastTestError: string | null;
}
interface Draft {
  id?: string;
  title: string;
  providerType: Model['providerType'];
  baseUrl: string;
  modelName: string;
  apiToken: string;
  tokenChoice: 'keep' | 'replace' | 'clear';
  masked: string;
}
const blank = (): Draft => ({
  title: '',
  providerType: 'openai_compatible',
  baseUrl: '',
  modelName: '',
  apiToken: '',
  tokenChoice: 'replace',
  masked: '',
});
export default function AdminAiModelsPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.aiModels.${key}`, locale);
  const [models, setModels] = useState<Model[]>([]),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null),
    [action, setAction] = useState<TeamAction | null>(null),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDenied(false);
    setError(false);
    setModels([]);
    setDraft(null);
    void (async () => {
      try {
        const response = await fetch('/api/admin/ai-models', { signal: controller.signal });
        if (response.status === 403) {
          if (!controller.signal.aborted) setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const rows = (await response.json()) as Model[];
        if (!controller.signal.aborted) setModels(rows);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  const errors = {
    AI_MODEL_TOKEN_REENTRY_REQUIRED: label('reentry'),
    AI_MODEL_ENCRYPTION_UNAVAILABLE: label('encryption'),
    AI_MODEL_IN_USE: label('inUse'),
    AI_MODEL_CHANGED: label('changed'),
    AI_MODEL_TEST_UNAVAILABLE: label('workerUnavailable'),
    AI_MODEL_TEST_EXPIRED: label('workerUnavailable'),
    'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setResult(null);
    setAction({
      title: label('save'),
      description: label('confirmSave'),
      path: `/api/admin/ai-models${draft.id ? `/${draft.id}` : ''}`,
      method: draft.id ? 'PUT' : 'POST',
      body: {
        title: draft.title.trim(),
        providerType: draft.providerType,
        baseUrl: draft.baseUrl.trim(),
        modelName: draft.modelName.trim(),
        ...(draft.tokenChoice === 'clear'
          ? { apiToken: '' }
          : draft.tokenChoice === 'replace'
            ? { apiToken: draft.apiToken }
            : {}),
      },
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  function perform(model: Model, kind: 'test' | 'delete') {
    setResult(null);
    setAction({
      title: `${label(kind)}: ${model.title}`,
      description: label(kind === 'test' ? 'confirmTest' : 'confirmDelete'),
      path: `/api/admin/ai-models/${model.id}${kind === 'test' ? '/test' : ''}`,
      method: kind === 'test' ? 'POST' : 'DELETE',
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {label('refresh')}
        </Button>
      </header>
      {loading ? (
        <p role="status">{label('loading')}</p>
      ) : denied ? (
        <p role="alert">{label('forbidden')}</p>
      ) : error ? (
        <div role="alert">
          {label('error')}{' '}
          <Button onClick={() => setRevision((v) => v + 1)}>{label('retry')}</Button>
        </div>
      ) : (
        <>
          {result && (
            <div role={result.ok ? 'status' : 'alert'} className="rounded border bg-background p-4">
              <p>{label(result.ok ? 'success' : 'testFailed')}</p>
              {result.text && (
                <p className="mt-2 whitespace-pre-wrap break-words" dir="auto">
                  {result.text}
                </p>
              )}
            </div>
          )}
          <Button
            onClick={() => {
              setDraft(blank());
              setResult(null);
            }}
          >
            {label('add')}
          </Button>
          {draft && (
            <form
              onSubmit={submit}
              className="max-w-2xl space-y-4 rounded-lg border bg-background p-5"
              aria-label={label('form')}
            >
              <h2 className="text-lg font-semibold">{label(draft.id ? 'edit' : 'add')}</h2>
              {(['title', 'baseUrl', 'modelName'] as const).map((key) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={`ai-model-${key}`}>{label(key === 'title' ? 'name' : key)}</Label>
                  <Input
                    id={`ai-model-${key}`}
                    autoFocus={key === 'title'}
                    type={key === 'baseUrl' ? 'url' : 'text'}
                    required
                    maxLength={key === 'title' ? 120 : key === 'baseUrl' ? 500 : 200}
                    value={draft[key]}
                    dir={key === 'title' ? 'auto' : 'ltr'}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor="ai-model-provider">{label('provider')}</Label>
                <select
                  id="ai-model-provider"
                  className="w-full rounded border bg-background p-2"
                  value={draft.providerType}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      providerType: event.target.value as Model['providerType'],
                    })
                  }
                >
                  <option value="openai_compatible">{label('openai')}</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              {draft.id && (
                <div className="space-y-2">
                  <Label htmlFor="ai-model-token-choice">{label('tokenChoice')}</Label>
                  <p className="break-all text-sm" dir="ltr">
                    {draft.masked || label('noToken')}
                  </p>
                  <select
                    id="ai-model-token-choice"
                    className="w-full rounded border bg-background p-2"
                    value={draft.tokenChoice}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tokenChoice: event.target.value as Draft['tokenChoice'],
                        apiToken: '',
                      })
                    }
                  >
                    <option value="keep">{label('keep')}</option>
                    <option value="replace">{label('replace')}</option>
                    <option value="clear">{label('clear')}</option>
                  </select>
                </div>
              )}
              {draft.tokenChoice === 'replace' && (
                <div className="space-y-2">
                  <Label htmlFor="ai-model-token">{label('token')}</Label>
                  <Input
                    id="ai-model-token"
                    type="password"
                    autoComplete="new-password"
                    maxLength={4000}
                    value={draft.apiToken}
                    onChange={(event) => setDraft({ ...draft, apiToken: event.target.value })}
                    dir="ltr"
                    aria-describedby="ai-model-token-help"
                  />
                </div>
              )}
              <p id="ai-model-token-help" className="text-sm text-muted-foreground">
                {label('tokenHelp')}
              </p>
              <div className="flex gap-3">
                <Button type="submit">{label('save')}</Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
          )}
          {models.length === 0 ? (
            <p>{label('empty')}</p>
          ) : (
            <div
              className="overflow-x-auto rounded-lg border bg-background"
              role="region"
              aria-label={label('title')}
              tabIndex={0}
            >
              <table className="w-full min-w-[760px] table-fixed text-start text-sm">
                <thead className="border-b bg-muted">
                  <tr>
                    {['name', 'provider', 'modelName', 'status', 'actions'].map((key) => (
                      <th key={key} scope="col" className="p-4 text-start font-semibold">
                        {label(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr
                      key={model.id}
                      aria-label={model.title}
                      className="border-b align-top last:border-0"
                    >
                      <th scope="row" className="space-y-2 p-4 text-start font-normal">
                        <p className="font-semibold break-words" dir="auto">
                          {model.title}
                        </p>
                        <p className="break-all" dir="ltr">
                          {model.baseUrl}
                        </p>
                      </th>
                      <td className="space-y-2 p-4">
                        <p>{model.providerType === 'anthropic' ? 'Anthropic' : label('openai')}</p>
                        <p>
                          {label('token')}:{' '}
                          <span dir="ltr">{model.apiTokenMasked || label('noToken')}</span>
                        </p>
                      </td>
                      <td className="break-all p-4" dir="ltr">
                        {model.modelName}
                      </td>
                      <td className="space-y-2 p-4">
                        <p>{label(model.status)}</p>
                        {model.lastTestedAt && (
                          <p>
                            {label('lastTest')}: {time.format(model.lastTestedAt)}
                          </p>
                        )}
                        {model.lastTestError && (
                          <p className="break-words text-destructive" dir="auto">
                            {model.lastTestError}
                          </p>
                        )}
                      </td>
                      <td className="p-4">
                        {' '}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setDraft({
                                id: model.id,
                                title: model.title,
                                providerType: model.providerType,
                                baseUrl: model.baseUrl,
                                modelName: model.modelName,
                                apiToken: '',
                                tokenChoice: 'keep',
                                masked: model.apiTokenMasked,
                              });
                              setResult(null);
                            }}
                          >
                            {label('edit')}
                          </Button>
                          <Button variant="outline" onClick={() => perform(model, 'test')}>
                            {label('test')}
                          </Button>
                          <Button variant="outline" onClick={() => perform(model, 'delete')}>
                            {label('delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (value) => {
            const data = value as {
              test?: { ok: boolean; responsePreview?: string; error?: string };
            } | null;
            setResult(
              data?.test
                ? { ok: data.test.ok, text: data.test.responsePreview ?? data.test.error ?? '' }
                : { ok: true, text: '' }
            );
            setDraft(null);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
