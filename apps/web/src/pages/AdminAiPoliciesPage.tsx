import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  type PolicyDraft as Draft,
  invalidPolicyFields,
  policyBody,
  matchesAiCatalogueReceipt,
} from '../lib/knowledge-policy-form.js';
import type { PolicyCatalogueKind } from '../lib/catalogue-category-query.js';
import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validEntries(value: unknown): value is Entry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        record(v) &&
        ['id', 'title', 'description'].every((k) => typeof v[k] === 'string') &&
        (v.policyType === undefined || types.includes(v.policyType as PolicyType)) &&
        (v.rules === undefined || record(v.rules)) &&
        (v.enabled === undefined || typeof v.enabled === 'boolean') &&
        (v.priority === undefined || typeof v.priority === 'number') &&
        (v.priorityOverride === undefined ||
          v.priorityOverride === null ||
          typeof v.priorityOverride === 'number')
    )
  );
}
function override(row: Entry) {
  return row.priorityOverride === null || row.priorityOverride === undefined
    ? ''
    : String(row.priorityOverride);
}
function priorityBasis(row: Entry) {
  return JSON.stringify({
    id: row.id,
    priority: row.priority,
    override: row.priorityOverride ?? null,
  });
}
function membersBasis(rows: Entry[]) {
  return JSON.stringify(rows.map(priorityBasis).sort());
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
export default function AdminAiPoliciesPage({
  initialKind = 'policies',
  onKindChange,
  focusCategory = false,
}: {
  initialKind?: PolicyCatalogueKind;
  focusCategory?: boolean;
  onKindChange?: (value: PolicyCatalogueKind) => void;
} = {}) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.policies.${key}`, locale);
  const [kind, setKind] = useState<Kind>(initialKind);
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const messages = Object.fromEntries(
    Object.keys(draftFor()).map((key) => [key, copy(key as Parameters<typeof copy>[0])])
  ) as Record<keyof Draft, string>;
  messages.id = copy('invalid');
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, (value) => invalidPolicyFields(value, kindRef.current));
    },
    draftFor,
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const [draftOpen, setDraftOpen] = useState(false);
  const draft = draftOpen ? form.values : null;
  const resetForm = form.form.reset;
  const setDraft = useCallback(
    (value: Draft | null) => {
      resetForm(value ?? draftFor());
      setDraftOpen(!!value);
    },
    [resetForm]
  );
  const [changed, setChanged] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [pending, setPending] = useState(false);
  const validationBusy = useRef(false),
    networkPending = useRef(false),
    requiredRead = useRef(0);
  const formCapture = useRef<{ body: Record<string, unknown>; id?: string } | null>(null);
  const actionRef = useRef<TeamAction | null>(null);
  const setAction = useCallback((value: TeamAction | null) => {
    actionRef.current = value;
    if (!value) formCapture.current = null;
    updateAction(value);
  }, []);
  const onPendingChange = useCallback((value: boolean) => {
    networkPending.current = value;
    setPending(value);
  }, []);

  const [selected, setSelected] = useState<string | null>(null),
    [member, setMember] = useState(''),
    [memberPriority, setMemberPriority] = useState(''),
    [memberPriorities, setMemberPriorities] = useState<Record<string, string>>({});
  const [action, updateAction] = useState<TeamAction | null>(null);
  const [notice, setNotice] = useState(false);
  const commandTarget = useRef<{ id: string; basis: string } | null>(null);
  const membershipBasis = useRef<string | null>(null);
  const proposedExistingMember = useRef(false);
  const generation = useRef(0),
    commandGeneration = useRef(0);
  const draftBasis = useRef<string | null>(null),
    acceptedMembers = useRef<Entry[]>([]);
  const clearSelection = useCallback(() => {
    generation.current++;
    commandTarget.current = null;
    setSelected(null);
    setMember('');
    setMemberPriority('');
    setMemberPriorities({});
    acceptedMembers.current = [];
    membershipBasis.current = null;
    setAction(null);
  }, [setAction]);
  const clearWork = useCallback(() => {
    clearSelection();
    setDraft(null);
    draftBasis.current = null;
    setNotice(false);
    setChanged(false);
    setUncertain(false);
    requiredRead.current = 0;
    formCapture.current = null;
    validationBusy.current = false;
    form.setValidationPending(false);
    onPendingChange(false);
  }, [clearSelection, setAction, setDraft, form.setValidationPending, onPendingChange]);
  const scope = useCatalogueScope(clearWork);
  const list = useCatalogueResource(scope, `/api/admin/${kind}`, validEntries);
  const choices = useCatalogueResource(
    scope,
    kind === 'policy-groups' ? '/api/admin/policies' : null,
    validEntries
  );
  const validateDetail = useCallback(
    (value: unknown): value is { id: string; members: Entry[] } =>
      record(value) && value.id === selected && validEntries(value.members),
    [selected]
  );
  const selectedRead = useCatalogueResource(
    scope,
    selected && kind === 'policy-groups'
      ? `/api/admin/policy-groups/${encodeURIComponent(selected)}`
      : null,
    validateDetail
  );
  const rows = list.data ?? [],
    policies = kind === 'policies' ? rows : (choices.data ?? []),
    members = selectedRead.data?.members ?? [];
  const disabled = scope.denied || list.loading || list.error;
  const detailDisabled = disabled || selectedRead.loading || selectedRead.error;
  const memberDisabled = detailDisabled || choices.loading || choices.error;
  const work = useRef({ selected, draft, action, disabled, detailDisabled, memberDisabled });
  work.current = { selected, draft, action, disabled, detailDisabled, memberDisabled };
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    if (!list.data) return;
    const current = work.current;
    if (current.draft?.id && draftBasis.current) {
      const fresh = list.data.find((row) => row.id === current.draft?.id);
      if (!fresh || JSON.stringify(draftFor(fresh)) !== draftBasis.current) {
        generation.current++;
        setChanged(true);
        setAction(null);
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
    const command = commandTarget.current;
    if (
      command &&
      !list.data.some(
        (row) => row.id === command.id && JSON.stringify(draftFor(row)) === command.basis
      )
    ) {
      generation.current++;
      setAction(null);
      commandTarget.current = null;
    }
    if (current.selected && !list.data.some((row) => row.id === current.selected)) clearSelection();
  }, [list.data, clearSelection, setAction, form.setValidationPending]);
  useEffect(() => {
    if (!selectedRead.data) return;
    const next = selectedRead.data.members,
      old = acceptedMembers.current;
    if (membershipBasis.current !== null && membershipBasis.current !== membersBasis(next)) {
      if (!formCapture.current) {
        generation.current++;
        setAction(null);
      }
    }
    setMemberPriorities((previous) =>
      Object.fromEntries(
        next.map((item) => {
          const before = old.find((row) => row.id === item.id);
          return [
            item.id,
            before && priorityBasis(before) === priorityBasis(item)
              ? (previous[item.id] ?? override(item))
              : override(item),
          ];
        })
      )
    );
    acceptedMembers.current = next;
    membershipBasis.current = membersBasis(next);
  }, [selectedRead.data]);
  useEffect(() => {
    const pending = work.current.action;
    if (
      !choices.data ||
      !pending ||
      !record(pending.body) ||
      typeof pending.body.policyId !== 'string' ||
      proposedExistingMember.current
    )
      return;
    const id = pending.body.policyId;
    if (!choices.data.some((row) => row.id === id)) {
      generation.current++;
      setAction(null);
    }
  }, [choices.data]);
  function open(value: string) {
    if (
      disabled ||
      value === selected ||
      networkPending.current ||
      actionRef.current ||
      validationBusy.current
    )
      return;
    clearSelection();
    setSelected(value);
  }
  function edit(entry?: Entry) {
    if (
      disabled ||
      networkPending.current ||
      validationBusy.current ||
      actionRef.current ||
      uncertain
    )
      return;
    generation.current++;
    formCapture.current = null;
    setChanged(false);
    commandTarget.current = null;
    setAction(null);
    setDraft(draftFor(entry));
    draftBasis.current = entry ? JSON.stringify(draftFor(entry)) : null;
    setNotice(false);
  }
  function refresh() {
    if (networkPending.current) return;
    if (validationBusy.current) {
      generation.current++;
      validationBusy.current = false;
      form.setValidationPending(false);
    }
    if (scope.denied) scope.recover();
    else {
      list.retry();
      choices.retry();
      selectedRead.retry();
    }
  }
  function commandDisabled(path: string, body?: unknown) {
    const current = work.current;
    return path.endsWith('/members')
      ? record(body) && acceptedMembers.current.some((row) => row.id === body.policyId)
        ? current.detailDisabled
        : current.memberDisabled
      : path.includes('/members/')
        ? current.detailDisabled
        : current.disabled;
  }
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending || list.loading || choices.loading || selectedRead.loading}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {list.loading && <p role="status">{label('loading')}</p>}
      {list.error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" onClick={list.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      {choices.error && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" onClick={choices.retry}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {selectedRead.error && (
        <div role="alert">
          <p>{label('detailError')}</p>
          <Button type="button" onClick={selectedRead.retry}>
            {label('detailRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    if (
      commandDisabled(path, body) ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const target = rows.find((row) => path === `/api/admin/${kind}/${row.id}`);
    commandTarget.current = target
      ? { id: target.id, basis: JSON.stringify(draftFor(target)) }
      : null;
    proposedExistingMember.current =
      record(body) && acceptedMembers.current.some((row) => row.id === body.policyId);
    commandGeneration.current = generation.current;
    setNotice(false);
    setAction({
      path,
      method,
      ...(formCapture.current
        ? { successStatus: method === 'POST' ? 201 : 200, conflictMessage: copy('changed') }
        : {}),
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
  function changePolicyType(value: PolicyType) {
    form.field('policyType')[1](value);
    for (const field of ['items', 'tone', 'language', 'maxLength'] as const)
      form.field(field)[1]('');
    form.field('requireSources')[1](false);
    form.form.clearErrors([
      'items',
      'tone',
      'language',
      'maxLength',
      'requireSources',
      'format',
      'maxRequests',
      'windowSeconds',
    ]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      disabled ||
      changed ||
      uncertain ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const epoch = ++generation.current;
    validationBusy.current = true;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (epoch !== generation.current || work.current.disabled || actionRef.current || uncertain)
          return;
        validationBusy.current = false;
        const body = policyBody(value, kindRef.current);
        formCapture.current = { body, ...(value.id ? { id: value.id } : {}) };
        propose(
          `/api/admin/${kind}${value.id ? `/${value.id}` : ''}`,
          value.id ? 'PUT' : 'POST',
          label('save'),
          label('confirmSave'),
          body
        );
      })();
    } finally {
      if (epoch === generation.current) {
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
  }
  function unconfirmed() {
    if (!formCapture.current) return;
    setUncertain(true);
    generation.current++;
    setAction(null);
    onPendingChange(false);
    requiredRead.current = list.retry();
  }
  const resetDisabled =
    disabled ||
    !!action ||
    form.pending ||
    pending ||
    (uncertain && (list.readAttempt === null || list.readAttempt < requiredRead.current));
  function resetDraft() {
    if (resetDisabled || !draft) return;
    generation.current++;
    const fresh = draft.id ? rows.find((row) => row.id === draft.id) : undefined;
    setDraft(draft.id && !fresh ? null : draftFor(fresh));
    draftBasis.current = fresh ? JSON.stringify(draftFor(fresh)) : null;
    setChanged(false);
    setUncertain(false);
    formCapture.current = null;
    setNotice(false);
  }
  return (
    <div
      className="mx-auto min-w-0 flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['policies', 'policy-groups'] as const).map((value) => (
          <Button
            key={value}
            autoFocus={focusCategory && kind === value}
            disabled={pending}
            aria-pressed={kind === value}
            variant={kind === value ? 'default' : 'outline'}
            onClick={() => {
              if (kind === value) return;
              clearWork();
              if (onKindChange) onKindChange(value);
              else {
                scope.recover();
                setKind(value);
              }
            }}
          >
            {label(value)}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={pending || list.loading || choices.loading || selectedRead.loading}
          onClick={refresh}
        >
          {label('refresh')}
        </Button>
      </div>
      <ListPage>
        {scope.denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            {notice && <p role="status">{label('saved')}</p>}
            <ListPage.Toolbar>
              <Button
                disabled={disabled || form.pending || !!action || pending || uncertain}
                onClick={() => edit()}
              >
                {label(kind === 'policies' ? 'addPolicy' : 'addGroup')}
              </Button>
            </ListPage.Toolbar>
            {choices.loading && <p role="status">{label('optionsLoading')}</p>}
            {choices.error && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button onClick={choices.retry}>{label('optionsRetry')}</Button>
              </div>
            )}
            {selectedRead.loading && <p role="status">{label('detailLoading')}</p>}
            {selectedRead.error && (
              <div role="alert">
                <p>{label('detailError')}</p>
                <Button onClick={selectedRead.retry}>{label('detailRetry')}</Button>
              </div>
            )}
            {draft && (
              <form
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                aria-label={label('editor')}
                className="flex flex-col gap-4 border-y py-5"
              >
                {changed && <p role="alert">{copy('changed')}</p>}
                {uncertain && <p role="alert">{copy('uncertain')}</p>}
                {catalogueRootMessage(form.errors) && (
                  <p role="alert">{catalogueRootMessage(form.errors)}</p>
                )}
                <fieldset disabled={form.pending || !!action || pending} className="contents">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-title">{label('name')}</Label>
                    <Input
                      {...form.bind('title')}
                      id="policy-title"
                      value={draft.title}
                      required
                      maxLength={120}
                      onChange={(event) =>
                        form.field('title')[1](event.target.value as Draft['title'])
                      }
                    />
                    <CatalogueFieldFeedback
                      id={form.errorId('title')}
                      error={form.errors.title}
                      message={messages.title}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-description">{label('description')}</Label>
                    <textarea
                      {...form.bind('description')}
                      id="policy-description"
                      className="min-h-24 rounded-md border bg-background p-3"
                      maxLength={2000}
                      value={draft.description}
                      onChange={(event) =>
                        form.field('description')[1](event.target.value as Draft['description'])
                      }
                    />
                    <CatalogueFieldFeedback
                      id={form.errorId('description')}
                      error={form.errors.description}
                      message={messages.description}
                    />
                  </div>
                  {kind === 'policies' && (
                    <fieldset className="flex flex-col gap-4">
                      <legend className="mb-3 font-semibold">{label('rules')}</legend>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-type">{label('type')}</Label>
                        <select
                          {...form.bind('policyType')}
                          id="policy-type"
                          className="rounded-md border bg-background p-2"
                          value={draft.policyType}
                          onChange={(event) => changePolicyType(event.target.value as PolicyType)}
                        >
                          {types.map((type) => (
                            <option key={type} value={type}>
                              {label(type)}
                            </option>
                          ))}
                        </select>
                        <CatalogueFieldFeedback
                          id={form.errorId('policyType')}
                          error={form.errors.policyType}
                          message={messages.policyType}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="policy-priority">{label('priority')}</Label>
                        <Input
                          {...form.bind('priority')}
                          id="policy-priority"
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          min={-1000}
                          max={1000}
                          step={1}
                          required
                          value={draft.priority}
                          onChange={(event) =>
                            form.field('priority')[1](event.target.value as Draft['priority'])
                          }
                        />
                        <CatalogueFieldFeedback
                          id={form.errorId('priority')}
                          error={form.errors.priority}
                          message={messages.priority}
                        />
                        <p className="text-sm text-muted-foreground">{label('priorityHelp')}</p>
                      </div>
                      {draft.policyType === 'response_style' ? (
                        <>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="policy-tone">{label('tone')}</Label>
                            <Input
                              {...form.bind('tone')}
                              id="policy-tone"
                              required
                              maxLength={200}
                              value={draft.tone}
                              onChange={(event) =>
                                form.field('tone')[1](event.target.value as Draft['tone'])
                              }
                            />
                            <CatalogueFieldFeedback
                              id={form.errorId('tone')}
                              error={form.errors.tone}
                              message={messages.tone}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="policy-language">{label('language')}</Label>
                            <Input
                              {...form.bind('language')}
                              id="policy-language"
                              maxLength={50}
                              value={draft.language}
                              onChange={(event) =>
                                form.field('language')[1](event.target.value as Draft['language'])
                              }
                            />
                            <CatalogueFieldFeedback
                              id={form.errorId('language')}
                              error={form.errors.language}
                              message={messages.language}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="policy-length">{label('maxLength')}</Label>
                            <Input
                              {...form.bind('maxLength')}
                              id="policy-length"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={100000}
                              step={1}
                              value={draft.maxLength}
                              onChange={(event) =>
                                form.field('maxLength')[1](event.target.value as Draft['maxLength'])
                              }
                            />
                            <CatalogueFieldFeedback
                              id={form.errorId('maxLength')}
                              error={form.errors.maxLength}
                              message={messages.maxLength}
                            />
                          </div>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              {...form.bind('requireSources')}
                              checked={draft.requireSources}
                              onChange={(event) =>
                                form.field('requireSources')[1](event.target.checked)
                              }
                            />
                            {label('requireSources')}
                          </label>
                          <CatalogueFieldFeedback
                            id={form.errorId('requireSources')}
                            error={form.errors.requireSources}
                            message={messages.requireSources}
                          />
                        </>
                      ) : draft.policyType === 'output_format' ? (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="policy-format">{label('format')}</Label>
                          <select
                            {...form.bind('format')}
                            id="policy-format"
                            className="rounded-md border bg-background p-2"
                            value={draft.format}
                            onChange={(event) =>
                              form.field('format')[1](event.target.value as Draft['format'])
                            }
                          >
                            <option value="plain_text">{label('plain_text')}</option>
                            <option value="json_object">{label('json_object')}</option>
                          </select>
                          <CatalogueFieldFeedback
                            id={form.errorId('format')}
                            error={form.errors.format}
                            message={messages.format}
                          />
                        </div>
                      ) : draft.policyType === 'rate_limit' ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="policy-max-requests">{label('maxRequests')}</Label>
                            <Input
                              {...form.bind('maxRequests')}
                              id="policy-max-requests"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={100}
                              step={1}
                              required
                              value={draft.maxRequests}
                              onChange={(event) =>
                                form.field('maxRequests')[1](
                                  event.target.value as Draft['maxRequests']
                                )
                              }
                            />
                            <CatalogueFieldFeedback
                              id={form.errorId('maxRequests')}
                              error={form.errors.maxRequests}
                              message={messages.maxRequests}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="policy-window-seconds">{label('windowSeconds')}</Label>
                            <Input
                              {...form.bind('windowSeconds')}
                              id="policy-window-seconds"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={3600}
                              step={1}
                              required
                              value={draft.windowSeconds}
                              onChange={(event) =>
                                form.field('windowSeconds')[1](
                                  event.target.value as Draft['windowSeconds']
                                )
                              }
                            />
                            <CatalogueFieldFeedback
                              id={form.errorId('windowSeconds')}
                              error={form.errors.windowSeconds}
                              message={messages.windowSeconds}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="policy-items">{label(draft.policyType)}</Label>
                          <textarea
                            {...form.bind('items')}
                            id="policy-items"
                            className="min-h-32 rounded-md border bg-background p-3"
                            required
                            value={draft.items}
                            aria-describedby={`${form.errorId('items')} policy-items-help`}
                            onChange={(event) =>
                              form.field('items')[1](event.target.value as Draft['items'])
                            }
                          />
                          <CatalogueFieldFeedback
                            id={form.errorId('items')}
                            error={form.errors.items}
                            message={messages.items}
                          />
                          <p id="policy-items-help" className="text-sm text-muted-foreground">
                            {label('itemsHelp')}
                          </p>
                        </div>
                      )}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...form.bind('enabled')}
                          checked={draft.enabled}
                          onChange={(event) => form.field('enabled')[1](event.target.checked)}
                        />
                        {label('enabled')}
                      </label>
                      <CatalogueFieldFeedback
                        id={form.errorId('enabled')}
                        error={form.errors.enabled}
                        message={messages.enabled}
                      />
                    </fieldset>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={resetDisabled}
                      onClick={resetDraft}
                    >
                      {copy('reset')}
                    </Button>
                    <CatalogueSaveButton
                      label={label('save')}
                      pending={form.pending}
                      disabled={disabled || changed || uncertain}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uncertain}
                      onClick={() => setDraft(null)}
                    >
                      {label('cancel')}
                    </Button>
                  </div>
                </fieldset>
              </form>
            )}
            <ListPage.Content
              loading={list.loading}
              error={list.error}
              empty={!rows.length}
              retainContent={rows.length > 0}
              loadingView={<p role="status">{label('loading')}</p>}
              errorView={
                <div role="alert">
                  <p>{label('error')}</p>
                  <Button onClick={list.retry}>{label('retry')}</Button>
                </div>
              }
              emptyView={<p>{label('empty')}</p>}
            >
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
                          disabled={disabled || form.pending || !!action || pending}
                          onClick={() => open(row.id)}
                        >
                          {label('open')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        aria-label={`${label('edit')} ${row.title}`}
                        disabled={disabled || form.pending || !!action || pending}
                        onClick={() => edit(row)}
                      >
                        {label('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`${label('delete')} ${row.title}`}
                        disabled={disabled || form.pending || !!action || pending}
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
            </ListPage.Content>
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
                      {member &&
                        (!policies.some((p) => p.id === member) ||
                          members.some((m) => m.id === member)) && (
                          <option value={member}>
                            {label('unavailable')} ({member})
                          </option>
                        )}
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
                  <Button
                    type="submit"
                    disabled={
                      memberDisabled ||
                      !member ||
                      !validPriority(memberPriority, true) ||
                      !policies.some((p) => p.id === member) ||
                      members.some((m) => m.id === member)
                    }
                  >
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
                          disabled={
                            detailDisabled || !validPriority(memberPriorities[item.id] ?? '', true)
                          }
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
                        disabled={detailDisabled}
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
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            commandDisabled(action.path, action.body) ||
            (!!formCapture.current && (changed || uncertain))
          }
          onPendingChange={onPendingChange}
          onDenied={scope.deny}
          onValidationError={(fields) => (formCapture.current ? ownedFields(fields) : false)}
          onUnconfirmed={unconfirmed}
          summary={recovery}
          onClose={() => {
            generation.current++;
            setAction(null);
            onPendingChange(false);
          }}
          onSuccess={((command, version) => async (value: unknown) => {
            if (actionRef.current !== command) return;
            const captured = formCapture.current;
            if (version !== generation.current && !captured) return;
            if (captured && !matchesAiCatalogueReceipt(value, captured.body, captured.id))
              throw new Error('Unconfirmed catalogue settings');
            if (command.body && typeof command.body === 'object' && 'title' in command.body) {
              setDraft(null);
              draftBasis.current = null;
            }
            if (command.path.endsWith('/members')) {
              setMember('');
              setMemberPriority('');
            }
            if (command.method === 'DELETE' && command.path === `/api/admin/${kind}/${selected}`)
              clearSelection();
            setNotice(true);
            list.retry();
            choices.retry();
            selectedRead.retry();
          })(action, commandGeneration.current)}
        />
      )}
    </div>
  );
}
