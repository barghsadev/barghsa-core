import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { buildSmsTestParameters } from '@barghsa/shared/notifications';
import { smsProviderText } from '@barghsa/i18n/providers';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  ProviderStepUpError,
  ProviderRequestError,
  type Status,
} from '../lib/email-providers-api.js';
import {
  loadSmsProviders,
  readSmsProvider,
  sameSmsConfig,
  smsRequest,
  type SmsConfig,
  type SmsProvider,
} from '../lib/sms-providers-api.js';

type Variable = { id: string; internal: string; parameter: string };
type Mapping = {
  id: string;
  event: string;
  locale: 'all' | 'fa' | 'en';
  template: string;
  variables: Variable[];
};
type Editor = {
  id: string | null;
  label: string;
  key: string;
  keyConfigured: boolean;
  sender: string;
  timeout: string;
  throughput: string;
  credit: string;
  mappings: Mapping[];
};
const variable = (): Variable => ({ id: crypto.randomUUID(), internal: '', parameter: '' });
const mapping = (): Mapping => ({
  id: crypto.randomUUID(),
  event: '',
  locale: 'all',
  template: '',
  variables: [variable()],
});
function editorFor(row?: SmsProvider, clone = false): Editor {
  return {
    id: clone ? null : (row?.id ?? null),
    label: row?.label ?? '',
    key: '',
    keyConfigured: !clone && !!row?.keyConfigured,
    sender: row?.config.sender ?? '',
    timeout: String(row?.config.timeout ?? 15),
    throughput: String(row?.config.throughput_limit ?? 100),
    credit: String(row?.config.low_credit_threshold ?? 0),
    mappings: row?.config.template_mappings.map((m) => ({
      id: crypto.randomUUID(),
      event: m.event_key,
      locale: m.locale ?? 'all',
      template: m.template_id,
      variables: Object.entries(m.variables).map(([internal, parameter]) => ({
        id: crypto.randomUUID(),
        internal,
        parameter,
      })),
    })) ?? [mapping()],
  };
}
function configFor(editor: Editor): SmsConfig {
  const integer = (value: string, min: number, max: number) => {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new Error('invalid');
    return n;
  };
  if (
    !editor.label.trim() ||
    !editor.sender.trim() ||
    (!editor.keyConfigured && !editor.key.trim())
  )
    throw new Error('invalid');
  const seen = new Set<string>();
  return {
    sender: editor.sender.trim(),
    timeout: integer(editor.timeout, 1, 300),
    throughput_limit: integer(editor.throughput, 1, 10000),
    low_credit_threshold: integer(editor.credit, 0, 1_000_000_000),
    template_mappings: editor.mappings.map((m) => {
      const identity = `${m.event.trim()}:${m.locale}`;
      if (!m.event.trim() || !/^[1-9]\d*$/.test(m.template.trim()) || seen.has(identity))
        throw new Error('invalid');
      seen.add(identity);
      const names = new Set<string>(),
        parameters = new Set<string>();
      const pairs = m.variables.map((v) => {
        const name = v.internal.trim(),
          parameter = v.parameter.trim();
        if (
          !name ||
          !parameter ||
          names.has(name) ||
          parameters.has(parameter) ||
          ['__proto__', 'constructor', 'prototype'].some((part) => name.split('.').includes(part))
        )
          throw new Error('invalid');
        names.add(name);
        parameters.add(parameter);
        return [name, parameter];
      });
      if (!pairs.length) throw new Error('invalid');
      return {
        event_key: m.event.trim(),
        ...(m.locale === 'all' ? {} : { locale: m.locale }),
        template_id: m.template.trim(),
        variables: Object.fromEntries(pairs),
      };
    }),
  };
}

export default function AdminSmsProvidersPage() {
  const locale = useLocale(),
    time = useAccountTime();
  const text = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
  const [providers, setProviders] = useState<SmsProvider[]>([]),
    [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [firstEvent, setFirstEvent] = useState('');
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
  } | null>(null);
  const request = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const result = await loadSmsProviders(controller.signal);
      if (controller.signal.aborted) return;
      setProviders(result.providers);
      setEvents(result.events);
      setLoadFailed(false);
    } catch {
      if (!controller.signal.aborted) setLoadFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  const disabled = loading || loadFailed || busy || !!protectedAction;
  const testProvider = providers.find((p) => p.id === selected);
  const testMappings = [...(testProvider?.config.template_mappings ?? [])].sort(
    (a, b) => Number(b.event_key === firstEvent) - Number(a.event_key === firstEvent)
  );

  async function mutate(
    action: Pick<TeamAction, 'path' | 'method' | 'body'>,
    accept: (result: unknown) => Promise<void>
  ) {
    if (inFlight.current || protectedAction) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await accept(await smsRequest(action.path, action.method as 'POST' | 'PUT', action.body));
    } catch (e) {
      if (e instanceof ProviderStepUpError)
        setProtectedAction({
          action: {
            ...e.action,
            title: text('title'),
            description: text('confirm'),
            requiresPassword: true,
          },
          onSuccess: accept,
        });
      else setError(text('unavailable'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || disabled) return;
    let config: SmsConfig;
    try {
      config = configFor(editor);
    } catch {
      setError(text('invalid'));
      return;
    }
    const captured = editor,
      label = editor.label.trim();
    await mutate(
      {
        path: captured.id ? `/${encodeURIComponent(captured.id)}` : '',
        method: captured.id ? 'PUT' : 'POST',
        body: { label, config: { ...config, ...(captured.key ? { api_key: captured.key } : {}) } },
      },
      async (result) => {
        const saved = readSmsProvider(result, {
          status: 'draft',
          ...(captured.id ? { id: captured.id } : {}),
        });
        if (saved.label !== label || !saved.keyConfigured || !sameSmsConfig(saved.config, config))
          throw new ProviderRequestError();
        setEditor(null);
        setSelected(saved.id);
        setFirstEvent(saved.config.template_mappings[0]?.event_key ?? '');
        setNotice(text('saved'));
        await refresh();
      }
    );
  }
  function lifecycle(row: SmsProvider, operation: 'activate' | 'disable' | 'rollback') {
    if (disabled) return;
    setError(null);
    setNotice(null);
    const status: Status = operation === 'disable' ? 'disabled' : 'active';
    setProtectedAction({
      action: {
        title: text(operation),
        description: text(operation === 'rollback' ? 'rollbackNotice' : 'confirm'),
        path: `/api/admin/sms-providers/${encodeURIComponent(row.id)}/${operation}`,
        method: 'POST',
      },
      onSuccess: async (result) => {
        const saved = readSmsProvider(result, {
          status,
          ...(operation !== 'rollback' ? { id: row.id } : {}),
        });
        if (operation === 'rollback' && saved.id === row.id) throw new ProviderRequestError();
        setSelected(null);
        setNotice(text('changed'));
        await refresh();
      },
    });
  }
  async function test() {
    if (
      disabled ||
      !testProvider ||
      testProvider.status !== 'draft' ||
      !testMappings.length ||
      !testMappings.some((m) => m.event_key === firstEvent)
    )
      return;
    const id = testProvider.id;
    await mutate(
      {
        path: `/${encodeURIComponent(id)}/test-connection`,
        method: 'POST',
        body: { eventKey: firstEvent },
      },
      async (result) => {
        const saved = readSmsProvider(result, { status: 'draft', id }),
          outcome = (result as { test?: { ok?: unknown; error?: unknown } }).test;
        if (
          !outcome ||
          typeof outcome.ok !== 'boolean' ||
          !(outcome.error === null || typeof outcome.error === 'string') ||
          saved.lastTestStatus !== (outcome.ok ? 'passed' : 'failed') ||
          (outcome.ok && outcome.error !== null)
        )
          throw new ProviderRequestError();
        if (outcome.ok) setNotice(text('passed'));
        else setError(text('failed'));
        await refresh();
      }
    );
  }
  function field<K extends keyof Editor>(key: K, value: Editor[K]) {
    setEditor((old) => (old ? { ...old, [key]: value } : old));
  }
  function changeMapping(id: string, change: Partial<Mapping>) {
    setEditor((old) =>
      old
        ? { ...old, mappings: old.mappings.map((m) => (m.id === id ? { ...m, ...change } : m)) }
        : old
    );
  }
  function open(row?: SmsProvider, clone = false) {
    setEditor(editorFor(row, clone));
    setSelected(null);
    setError(null);
    setNotice(null);
  }

  return (
    <section aria-labelledby="sms-title" className="space-y-5 text-foreground">
      {time.notice}
      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onClose={() => setProtectedAction(null)}
          onSuccess={protectedAction.onSuccess}
        />
      )}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 id="sms-title" className="text-2xl font-bold">
            {text('title')}
          </h1>
          <p className="text-muted-foreground">{text('subtitle')}</p>
        </div>
        <Button disabled={disabled || !!editor} onClick={() => open()}>
          {text('new')}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{text('recovery')}</p>
      {loading && <p role="status">{smsProviderText('tabs', locale)}…</p>}
      {loadFailed && (
        <div role="alert">
          <p>{text('loadFailed')}</p>
          <Button variant="outline" disabled={loading || busy} onClick={() => void refresh()}>
            {text('retry')}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!loading && !loadFailed && !providers.length && <p>{text('empty')}</p>}
      {providers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{text('title')}</caption>
            <thead>
              <tr>
                {['label', 'status', 'lastTest', 'version', 'actions'].map((k) => (
                  <th key={k} className="p-2 text-start">
                    {text(k as 'label' | 'status' | 'lastTest' | 'version' | 'actions')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.label}</td>
                  <td>{text(p.status)}</td>
                  <td>
                    {text(
                      p.lastTestStatus === 'passed'
                        ? 'testPassed'
                        : p.lastTestStatus === 'failed'
                          ? 'testFailed'
                          : 'pending'
                    )}
                  </td>
                  <td>{time.format(p.createdAt)}</td>
                  <td className="flex flex-wrap gap-2 p-2">
                    {p.status === 'draft' ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={disabled || !!editor}
                          onClick={() => open(p)}
                        >
                          {text('edit')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={disabled || !!editor || !p.config.template_mappings.length}
                          onClick={() => {
                            setSelected(p.id);
                            setFirstEvent(p.config.template_mappings[0]?.event_key ?? '');
                            setNotice(null);
                            setError(null);
                          }}
                        >
                          {text('preview')}
                        </Button>
                        <Button
                          disabled={disabled || !!editor || p.lastTestStatus !== 'passed'}
                          onClick={() => lifecycle(p, 'activate')}
                        >
                          {text('activate')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={disabled || !!editor}
                        onClick={() => open(p, true)}
                      >
                        {text('clone')}
                      </Button>
                    )}
                    {p.status === 'active' && (
                      <Button
                        variant="outline"
                        disabled={disabled || !!editor}
                        onClick={() => lifecycle(p, 'disable')}
                      >
                        {text('disable')}
                      </Button>
                    )}
                    {(p.status === 'superseded' || p.status === 'disabled') && (
                      <Button
                        variant="outline"
                        disabled={disabled || !!editor}
                        onClick={() => lifecycle(p, 'rollback')}
                      >
                        {text('rollback')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editor && (
        <form onSubmit={save} className="rounded border p-4 space-y-4">
          <fieldset disabled={disabled} className="space-y-4">
            <legend className="font-semibold">{text(editor.id ? 'edit' : 'new')}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              {(['label', 'sender', 'timeout', 'throughput', 'credit'] as const).map((key) => (
                <div key={key}>
                  <Label htmlFor={`sms-${key}`}>{text(key)}</Label>
                  <Input
                    id={`sms-${key}`}
                    value={editor[key]}
                    onChange={(e) => field(key, e.target.value)}
                    required
                    type={['timeout', 'throughput', 'credit'].includes(key) ? 'number' : 'text'}
                    {...(key === 'timeout'
                      ? { min: 1, max: 300 }
                      : key === 'throughput'
                        ? { min: 1, max: 10000 }
                        : key === 'credit'
                          ? { min: 0, max: 1_000_000_000 }
                          : { maxLength: key === 'sender' ? 64 : 120 })}
                  />
                </div>
              ))}
              <div>
                <Label htmlFor="sms-key">{text('key')}</Label>
                <Input
                  id="sms-key"
                  type="password"
                  autoComplete="new-password"
                  value={editor.key}
                  required={!editor.keyConfigured}
                  maxLength={1024}
                  onChange={(e) => field('key', e.target.value)}
                  aria-describedby="sms-key-hint"
                />
                <p id="sms-key-hint" className="text-sm text-muted-foreground">
                  {text(editor.keyConfigured ? 'keyHint' : 'keyMissing')}
                </p>
              </div>
            </div>
            <datalist id="sms-events">
              {events.map((event) => (
                <option key={event} value={event} />
              ))}
            </datalist>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="font-semibold text-start">{text('mappings')}</caption>
                <thead>
                  <tr>
                    <th>{text('event')}</th>
                    <th>{text('language')}</th>
                    <th>{text('template')}</th>
                    <th>{text('parameter')}</th>
                    <th>{text('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {editor.mappings.map((m, index) => (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2">
                        <Input
                          aria-label={`${text('event')} ${index + 1}`}
                          list="sms-events"
                          value={m.event}
                          maxLength={128}
                          required
                          onChange={(e) => changeMapping(m.id, { event: e.target.value })}
                        />
                      </td>
                      <td className="p-2">
                        <select
                          aria-label={`${text('language')} ${index + 1}`}
                          value={m.locale}
                          className="border rounded bg-background p-2"
                          onChange={(e) =>
                            changeMapping(m.id, { locale: e.target.value as Mapping['locale'] })
                          }
                        >
                          <option value="all">{text('allLanguages')}</option>
                          <option value="fa">{text('persian')}</option>
                          <option value="en">{text('english')}</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          aria-label={`${text('template')} ${index + 1}`}
                          value={m.template}
                          maxLength={128}
                          inputMode="numeric"
                          required
                          onChange={(e) => changeMapping(m.id, { template: e.target.value })}
                        />
                      </td>
                      <td className="p-2 space-y-2">
                        {m.variables.map((v, vi) => (
                          <div key={v.id} className="flex gap-2">
                            <Input
                              aria-label={`${text('variable')} ${index + 1}.${vi + 1}`}
                              placeholder={text('variable')}
                              value={v.internal}
                              maxLength={255}
                              required
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((x) =>
                                    x.id === v.id ? { ...x, internal: e.target.value } : x
                                  ),
                                })
                              }
                            />
                            <Input
                              aria-label={`${text('parameter')} ${index + 1}.${vi + 1}`}
                              placeholder={text('parameter')}
                              value={v.parameter}
                              maxLength={255}
                              required
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((x) =>
                                    x.id === v.id ? { ...x, parameter: e.target.value } : x
                                  ),
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              aria-label={`${text('remove')} ${text('variable')} ${index + 1}.${vi + 1}`}
                              onClick={() =>
                                changeMapping(m.id, {
                                  variables: m.variables.filter((x) => x.id !== v.id),
                                })
                              }
                            >
                              {text('remove')}
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            changeMapping(m.id, { variables: [...m.variables, variable()] })
                          }
                        >
                          {text('addVariable')}
                        </Button>
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`${text('remove')} ${text('event')} ${index + 1}`}
                          onClick={() =>
                            field(
                              'mappings',
                              editor.mappings.filter((x) => x.id !== m.id)
                            )
                          }
                        >
                          {text('remove')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => field('mappings', [...editor.mappings, mapping()])}
            >
              {text('addMapping')}
            </Button>
            <div className="flex gap-2">
              <Button type="submit">{text('save')}</Button>
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                {text('cancel')}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {testProvider && !editor && (
        <section aria-labelledby="sms-preview-title" className="rounded border p-4 space-y-3">
          <h2 id="sms-preview-title" className="font-semibold">
            {text('preview')}: {testProvider.label}
          </h2>
          <Label htmlFor="sms-test-event">{text('firstEvent')}</Label>
          <select
            id="sms-test-event"
            disabled={disabled}
            value={firstEvent}
            onChange={(e) => setFirstEvent(e.target.value)}
            className="border rounded bg-background p-2"
          >
            {[...new Set(testProvider.config.template_mappings.map((m) => m.event_key))].map(
              (event) => (
                <option key={event} value={event}>
                  {event}
                </option>
              )
            )}
          </select>
          <p>
            {text('testNotice').replace(
              '{count}',
              new Intl.NumberFormat(locale).format(testMappings.length)
            )}
          </p>
          {testMappings.map((m) => (
            <div key={`${m.event_key}:${m.locale ?? '*'}`} className="border rounded p-3">
              <h3 className="font-mono" dir="ltr">
                {m.event_key} · {m.template_id} ·{' '}
                {text(
                  m.locale === 'fa' ? 'persian' : m.locale === 'en' ? 'english' : 'allLanguages'
                )}
              </h3>
              <dl>
                {buildSmsTestParameters(m.variables).map((p) => (
                  <div key={p.name} className="flex gap-4 font-mono" dir="ltr">
                    <dt>{p.name}</dt>
                    <dd>{p.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <Button
            disabled={disabled || testProvider.status !== 'draft' || !testMappings.length}
            onClick={() => void test()}
          >
            {text('test')}
          </Button>
        </section>
      )}
    </section>
  );
}
