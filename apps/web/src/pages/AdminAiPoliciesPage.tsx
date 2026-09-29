import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
const types = [
  'allowed_topics',
  'disallowed_actions',
  'data_access_scope',
  'response_style',
  'content_filter',
  'output_format',
  'rate_limit',
] as const;
type PolicyType = (typeof types)[number];
type Kind = 'policies' | 'policy-groups';
interface Entry {
  id: string;
  title: string;
  description: string;
  policyType?: PolicyType;
  rules?: Record<string, unknown>;
  enabled?: boolean;
  priority?: number;
  priorityOverride?: number | null;
  memberCount?: number;
}
interface Draft {
  id?: string;
  title: string;
  description: string;
  policyType: PolicyType;
  enabled: boolean;
  priority: string;
  items: string;
  tone: string;
  language: string;
  maxLength: string;
  requireSources: boolean;
  format: 'plain_text' | 'json_object';
  maxRequests: string;
  windowSeconds: string;
}
const validPriority = (value: string, optional = false) =>
  (optional && value === '') ||
  (/^-?\d+$/.test(value) && Number(value) >= -1000 && Number(value) <= 1000);
function draftFor(row?: Entry): Draft {
  const rules = row?.rules ?? {},
    items = rules.topics ?? rules.actions ?? rules.scopes ?? rules.blockedTerms;
  return {
    ...(row ? { id: row.id } : {}),
    title: row?.title ?? '',
    description: row?.description ?? '',
    policyType: row?.policyType ?? 'allowed_topics',
    enabled: row?.enabled ?? true,
    priority: String(row?.priority ?? 100),
    items: Array.isArray(items)
      ? items.filter((item): item is string => typeof item === 'string').join('\n')
      : '',
    tone: typeof rules.tone === 'string' ? rules.tone : '',
    language: typeof rules.language === 'string' ? rules.language : '',
    maxLength: typeof rules.maxLength === 'number' ? String(rules.maxLength) : '',
    requireSources: rules.requireSources === true,
    format: rules.format === 'json_object' ? 'json_object' : 'plain_text',
    maxRequests: typeof rules.maxRequests === 'number' ? String(rules.maxRequests) : '10',
    windowSeconds: typeof rules.windowSeconds === 'number' ? String(rules.windowSeconds) : '60',
  };
}
export default function AdminAiPoliciesPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.policies.${key}`, locale);
  const [kind, setKind] = useState<Kind>('policies'),
    [rows, setRows] = useState<Entry[]>([]),
    [policies, setPolicies] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [members, setMembers] = useState<Entry[]>([]),
    [member, setMember] = useState(''),
    [memberPriority, setMemberPriority] = useState(''),
    [memberPriorities, setMemberPriorities] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft | null>(null),
    [revision, setRevision] = useState(0),
    [action, setAction] = useState<TeamAction | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading'),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRows([]);
    setDraft(null);
    setMembers([]);
    setMember('');
    setMemberPriority('');
    void (async () => {
      try {
        const paths =
          kind === 'policies'
            ? ['/api/admin/policies']
            : [
                `/api/admin/policy-groups`,
                '/api/admin/policies',
                ...(selected ? [`/api/admin/policy-groups/${selected}`] : []),
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
        setPolicies((data[1] as Entry[] | undefined) ?? []);
        const loadedMembers = (data[2] as { members: Entry[] } | undefined)?.members ?? [];
        setMembers(loadedMembers);
        setMemberPriorities(
          Object.fromEntries(
            loadedMembers.map((item) => [
              item.id,
              item.priorityOverride === null || item.priorityOverride === undefined
                ? ''
                : String(item.priorityOverride),
            ])
          )
        );
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
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        AI_POLICY_RULES_INVALID: label('invalid'),
        AI_POLICY_TYPE_WITHOUT_RULES: label('invalid'),
      },
    });
  }
  const items =
    draft?.items
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  const validRules =
    !draft ||
    kind === 'policy-groups' ||
    (validPriority(draft.priority) &&
      (draft.policyType === 'response_style'
        ? !!draft.tone.trim() &&
          (!draft.maxLength ||
            (Number.isInteger(Number(draft.maxLength)) &&
              Number(draft.maxLength) > 0 &&
              Number(draft.maxLength) <= 100000))
        : draft.policyType === 'output_format'
          ? true
          : draft.policyType === 'rate_limit'
            ? /^\d+$/.test(draft.maxRequests) &&
              Number(draft.maxRequests) >= 1 &&
              Number(draft.maxRequests) <= 100 &&
              /^\d+$/.test(draft.windowSeconds) &&
              Number(draft.windowSeconds) >= 1 &&
              Number(draft.windowSeconds) <= 3600
            : items.length > 0 &&
              items.length <= 200 &&
              items.every((item) => item.length <= 200)));
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !validRules) return;
    const rules =
      draft.policyType === 'response_style'
        ? {
            tone: draft.tone.trim(),
            ...(draft.language.trim() ? { language: draft.language.trim() } : {}),
            ...(draft.maxLength ? { maxLength: Number(draft.maxLength) } : {}),
            ...(draft.requireSources ? { requireSources: true } : {}),
          }
        : draft.policyType === 'output_format'
          ? { format: draft.format }
          : draft.policyType === 'rate_limit'
            ? { maxRequests: Number(draft.maxRequests), windowSeconds: Number(draft.windowSeconds) }
            : {
                [{
                  allowed_topics: 'topics',
                  disallowed_actions: 'actions',
                  data_access_scope: 'scopes',
                  response_style: 'tone',
                  content_filter: 'blockedTerms',
                  output_format: 'format',
                  rate_limit: 'maxRequests',
                }[draft.policyType]]: items,
              };
    propose(
      `/api/admin/${kind}${draft.id ? `/${draft.id}` : ''}`,
      draft.id ? 'PUT' : 'POST',
      label('save'),
      label('confirmSave'),
      {
        title: draft.title.trim(),
        description: draft.description,
        ...(kind === 'policies'
          ? {
              policyType: draft.policyType,
              rules,
              enabled: draft.enabled,
              priority: Number(draft.priority),
            }
          : {}),
      }
    );
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['policies', 'policy-groups'] as const).map((value) => (
          <Button
            key={value}
            aria-pressed={kind === value}
            variant={kind === value ? 'default' : 'outline'}
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
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'ready' && (
        <>
          <div>
            <Button onClick={() => setDraft(draftFor())}>
              {label(kind === 'policies' ? 'addPolicy' : 'addGroup')}
            </Button>
          </div>
          {draft && (
            <form
              onSubmit={save}
              aria-label={label('editor')}
              className="flex flex-col gap-4 border-y py-5"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="policy-title">{label('name')}</Label>
                <Input
                  id="policy-title"
                  value={draft.title}
                  required
                  maxLength={120}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="policy-description">{label('description')}</Label>
                <textarea
                  id="policy-description"
                  className="min-h-24 rounded-md border bg-background p-3"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              {kind === 'policies' && (
                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-3 font-semibold">{label('rules')}</legend>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-type">{label('type')}</Label>
                    <select
                      id="policy-type"
                      className="rounded-md border bg-background p-2"
                      value={draft.policyType}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          policyType: event.target.value as PolicyType,
                          items: '',
                          tone: '',
                          language: '',
                          maxLength: '',
                          requireSources: false,
                        })
                      }
                    >
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {label(type)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-priority">{label('priority')}</Label>
                    <Input
                      id="policy-priority"
                      type="number"
                      min={-1000}
                      max={1000}
                      step={1}
                      required
                      value={draft.priority}
                      onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
                    />
                    <p className="text-sm text-muted-foreground">{label('priorityHelp')}</p>
                  </div>
                  {draft.policyType === 'response_style' ? (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-tone">{label('tone')}</Label>
                        <Input
                          id="policy-tone"
                          required
                          maxLength={200}
                          value={draft.tone}
                          onChange={(event) => setDraft({ ...draft, tone: event.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-language">{label('language')}</Label>
                        <Input
                          id="policy-language"
                          maxLength={50}
                          value={draft.language}
                          onChange={(event) => setDraft({ ...draft, language: event.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-length">{label('maxLength')}</Label>
                        <Input
                          id="policy-length"
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          value={draft.maxLength}
                          onChange={(event) =>
                            setDraft({ ...draft, maxLength: event.target.value })
                          }
                        />
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={draft.requireSources}
                          onChange={(event) =>
                            setDraft({ ...draft, requireSources: event.target.checked })
                          }
                        />
                        {label('requireSources')}
                      </label>
                    </>
                  ) : draft.policyType === 'output_format' ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="policy-format">{label('format')}</Label>
                      <select
                        id="policy-format"
                        className="rounded-md border bg-background p-2"
                        value={draft.format}
                        onChange={(event) =>
                          setDraft({ ...draft, format: event.target.value as Draft['format'] })
                        }
                      >
                        <option value="plain_text">{label('plain_text')}</option>
                        <option value="json_object">{label('json_object')}</option>
                      </select>
                    </div>
                  ) : draft.policyType === 'rate_limit' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-max-requests">{label('maxRequests')}</Label>
                        <Input
                          id="policy-max-requests"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          required
                          value={draft.maxRequests}
                          onChange={(event) =>
                            setDraft({ ...draft, maxRequests: event.target.value })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-window-seconds">{label('windowSeconds')}</Label>
                        <Input
                          id="policy-window-seconds"
                          type="number"
                          min={1}
                          max={3600}
                          step={1}
                          required
                          value={draft.windowSeconds}
                          onChange={(event) =>
                            setDraft({ ...draft, windowSeconds: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="policy-items">{label(draft.policyType)}</Label>
                      <textarea
                        id="policy-items"
                        className="min-h-32 rounded-md border bg-background p-3"
                        required
                        value={draft.items}
                        aria-describedby="policy-items-help"
                        onChange={(event) => setDraft({ ...draft, items: event.target.value })}
                      />
                      <p id="policy-items-help" className="text-sm text-muted-foreground">
                        {label('itemsHelp')}
                      </p>
                    </div>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                    />
                    {label('enabled')}
                  </label>
                </fieldset>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={!draft.title.trim() || !validRules}>
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
                  {row.policyType && (
                    <div className="mt-2 flex flex-wrap gap-2 text-sm">
                      <span className="rounded-full bg-muted px-2 py-1">
                        {label(row.policyType)}
                      </span>
                      <span className="px-2 py-1">
                        {label(row.enabled ? 'enabled' : 'disabled')}
                      </span>
                      <span className="px-2 py-1">
                        {label('priority')}: {row.priority ?? 100}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {kind === 'policy-groups' && (
                    <Button
                      variant="outline"
                      aria-label={`${label('open')} ${row.title}`}
                      onClick={() => setSelected(row.id)}
                    >
                      {label('open')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    aria-label={`${label('edit')} ${row.title}`}
                    onClick={() => setDraft(draftFor(row))}
                  >
                    {label('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`${label('delete')} ${row.title}`}
                    onClick={() =>
                      propose(
                        `/api/admin/${kind}/${row.id}`,
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
          {selected && kind === 'policy-groups' && (
            <section className="flex flex-col gap-4 border-t pt-5" aria-label={label('members')}>
              <h2 className="break-words text-xl font-semibold">
                {rows.find((row) => row.id === selected)?.title}
              </h2>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (member && validPriority(memberPriority, true))
                    propose(
                      `/api/admin/policy-groups/${selected}/members`,
                      'POST',
                      label('link'),
                      label('confirmLink'),
                      {
                        policyId: member,
                        ...(memberPriority ? { priorityOverride: Number(memberPriority) } : {}),
                      }
                    );
                }}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="policy-member">{label('selectPolicy')}</Label>
                  <select
                    id="policy-member"
                    className="max-w-full rounded-md border bg-background p-2"
                    required
                    value={member}
                    onChange={(event) => setMember(event.target.value)}
                  >
                    <option value="">{label('selectPolicy')}</option>
                    {policies
                      .filter((policy) => !members.some((item) => item.id === policy.id))
                      .map((policy) => (
                        <option key={policy.id} value={policy.id}>
                          {policy.title}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="policy-member-priority">{label('priorityOverride')}</Label>
                  <Input
                    id="policy-member-priority"
                    type="number"
                    min={-1000}
                    max={1000}
                    step={1}
                    placeholder={label('inheritPriority')}
                    value={memberPriority}
                    onChange={(event) => setMemberPriority(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={!member || !validPriority(memberPriority, true)}>
                  {label('link')}
                </Button>
              </form>
              <ul className="divide-y">
                {members.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0 break-words">{item.title}</span>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`member-priority-${item.id}`}>
                          {label('priorityOverride')} · {item.title}
                        </Label>
                        <Input
                          id={`member-priority-${item.id}`}
                          type="number"
                          min={-1000}
                          max={1000}
                          step={1}
                          placeholder={`${label('inheritPriority')} (${item.priority ?? 100})`}
                          value={memberPriorities[item.id] ?? ''}
                          onChange={(event) =>
                            setMemberPriorities({
                              ...memberPriorities,
                              [item.id]: event.target.value,
                            })
                          }
                        />
                      </div>
                      <Button
                        variant="outline"
                        disabled={!validPriority(memberPriorities[item.id] ?? '', true)}
                        onClick={() =>
                          propose(
                            `/api/admin/policy-groups/${selected}/members`,
                            'POST',
                            label('updatePriority'),
                            label('confirmPriority'),
                            {
                              policyId: item.id,
                              priorityOverride: memberPriorities[item.id]
                                ? Number(memberPriorities[item.id])
                                : null,
                            }
                          )
                        }
                      >
                        {label('updatePriority')}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      aria-label={`${label('unlink')} ${item.title}`}
                      onClick={() =>
                        propose(
                          `/api/admin/policy-groups/${selected}/members/${item.id}`,
                          'DELETE',
                          label('unlink'),
                          label('confirmUnlink')
                        )
                      }
                    >
                      {label('unlink')}
                    </Button>
                  </li>
                ))}
              </ul>
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
