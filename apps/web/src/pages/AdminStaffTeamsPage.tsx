import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { AssignmentFallbackEditor } from '../components/AssignmentFallbackEditor.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { tStaffTeams as t } from '@barghsa/i18n/staff-team-forms';
import { Alert, Badge, Button, Input, Label, ListPage, TextCell } from '@barghsa/ui';
import {
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  STAFF_ASSIGNMENT_WORK_TYPES,
  STAFF_ASSIGNMENT_STRATEGIES,
  type StaffAssignmentRules,
  type StaffAssignmentStrategy,
} from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  catalogueRootMessage,
  CatalogueSaveButton,
} from '../components/CatalogueEditorFeedback.js';
import {
  emptyTeamDraft,
  teamValues,
  teamBody,
  teamBasis,
  memberBasis,
  matchesTeamReceipt,
  validTeams,
  validMembers,
  validRouting,
  routingValues,
  routingBody,
  routingBasis,
  ruleField,
  teamInvalidFields,
  routingInvalidFields,
  type Team,
  type Member,
  type TeamDraft,
  type RoutingDraft,
} from '../lib/staff-team-form.js';

export default function AdminStaffTeamsPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.teams.${key}`, locale);
  const [teams, setTeams] = useState<Team[]>([]);
  const [known, setKnown] = useState<Record<string, Member>>({});
  const teamMessages = {
    name: label('invalidName'),
    description: label('invalidDescription'),
    tags: label('invalidTags'),
    members: label('invalidMembers'),
    leadUserId: label('invalidLead'),
  };
  const routingMessages = Object.fromEntries(
    STAFF_ASSIGNMENT_WORK_TYPES.map((type) => [ruleField(type), label('invalidRule')])
  ) as Record<keyof RoutingDraft, string>;
  const teamForm = useWizardForm<TeamDraft>(
    async () => {
      const { staffTeamSchema } = await import('../lib/catalogue-form-schemas.js');
      return staffTeamSchema(teamMessages, (draft: TeamDraft) =>
        teamInvalidFields(
          draft,
          Object.values(known)
            .filter((member) => member.eligible !== false)
            .map((member) => member.id)
        )
      );
    },
    emptyTeamDraft,
    label('validationUnavailable')
  );
  const routingForm = useWizardForm<RoutingDraft>(
    async () => {
      const { staffTeamSchema } = await import('../lib/catalogue-form-schemas.js');
      return staffTeamSchema(routingMessages, (draft: RoutingDraft) =>
        routingInvalidFields(
          draft,
          teams.filter((team) => team.isActive).map((team) => team.id)
        )
      );
    },
    () => routingValues(DEFAULT_STAFF_ASSIGNMENT_RULES),
    label('validationUnavailable')
  );
  const draft = teamForm.values,
    rules = routingBody(routingForm.values);
  const setDraft = (update: TeamDraft | ((previous: TeamDraft) => TeamDraft)) => {
    const next = typeof update === 'function' ? update(teamForm.form.getValues()) : update;
    setSaved(false);
    for (const field of Object.keys(next) as (keyof TeamDraft)[])
      teamForm.field(field)[1](next[field] as never);
  };
  const setRules = (value: StaffAssignmentRules) => routingForm.form.reset(routingValues(value));
  const resetTeam = (value: TeamDraft) => teamForm.form.reset(value);
  const teamErrors = useActionFieldErrors(teamForm.form, teamMessages, label('invalidName'));
  const routingErrors = useActionFieldErrors(
    {
      ...routingForm.form,
      setFocus: (field, options) => {
        const type = STAFF_ASSIGNMENT_WORK_TYPES.find((type) => ruleField(type) === field);
        if (type) routingForm.form.setFocus(`${ruleField(type)}.teamId`, options);
        else routingForm.form.setFocus(field, options);
      },
    },
    routingMessages,
    label('invalidRule')
  );
  const [teamStale, setTeamStale] = useState(false),
    [rulesStale, setRulesStale] = useState(false);
  const [teamUncertain, setTeamUncertain] = useState(false),
    [rulesUncertain, setRulesUncertain] = useState(false);
  const teamDirty = useRef(false);
  teamDirty.current = teamForm.form.formState.isDirty;
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState(''),
    [members, setMembers] = useState<Member[]>([]);
  const [memberLoading, setMemberLoading] = useState(false),
    [memberError, setMemberError] = useState(false),
    [hasMore, setHasMore] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true),
    [rulesError, setRulesError] = useState(false),
    [rulesRevision, setRulesRevision] = useState(0),
    [memberRevision, setMemberRevision] = useState(0),
    [denied, setDenied] = useState(false),
    [acceptedMemberScope, setAcceptedMemberScope] = useState('');
  const deniedRef = useRef(false),
    denialGeneration = useRef(0),
    workGeneration = useRef(0),
    rulesDirty = useRef(false),
    rulesSnapshot = useRef<StaffAssignmentRules | null>(null),
    teamSnapshot = useRef<Team[]>([]),
    editedTeam = useRef<Team | null>(null),
    actionRef = useRef<TeamAction | null>(null),
    knownRef = useRef<Record<string, Member>>({});
  actionRef.current = action;
  knownRef.current = known;
  const memberScope = JSON.stringify([search, editing]);
  const visibleMembers = memberScope === acceptedMemberScope ? members : [];
  function clearAction() {
    ++workGeneration.current;
    actionRef.current = null;
    invalidFocus.current = null;
    setAction(null);
  }
  function denyAccess() {
    ++denialGeneration.current;
    deniedRef.current = true;
    setDenied(true);
    setLoading(false);
    setRulesLoading(false);
    clearAction();
    setTeams([]);
    teamSnapshot.current = [];
    setRules(structuredClone(DEFAULT_STAFF_ASSIGNMENT_RULES));
    setTeamStale(false);
    setRulesStale(false);
    setTeamUncertain(false);
    setRulesUncertain(false);
    invalidFocus.current = null;
    rulesDirty.current = false;
    rulesSnapshot.current = null;
    editedTeam.current = null;
    setEditing(null);
    resetTeam(emptyTeamDraft());
    setMembers([]);
    setKnown({});
    knownRef.current = {};
    setSearch('');
    setSaved(false);
  }
  useEffect(
    () => () => {
      ++workGeneration.current;
    },
    []
  );
  const generation = useRef(0),
    formHeading = useRef<HTMLHeadingElement>(null);
  const teamRefresh = useRef<HTMLButtonElement>(null),
    rulesRefresh = useRef<HTMLButtonElement>(null);
  const pending =
    teamForm.pending ||
    routingForm.pending ||
    teamForm.form.formState.isSubmitting ||
    routingForm.form.formState.isSubmitting;
  const invalidFocus = useRef<{ kind: 'team' | 'rules'; field: string } | null>(null);
  useEffect(() => {
    if (pending || !invalidFocus.current) return;
    const target = invalidFocus.current;
    invalidFocus.current = null;
    if (target.field) {
      if (target.kind === 'team') teamForm.form.setFocus(target.field as keyof TeamDraft);
      else routingForm.form.setFocus(`${target.field as keyof RoutingDraft}.teamId`);
    }
  }, [pending, teamForm.form, routingForm.form]);
  const { register: registerTeam } = teamForm.form;
  const membersRef = useCallback(
    (element: HTMLElement | null) =>
      registerTeam('members').ref(
        element ? { name: 'members', focus: () => element.focus() } : null
      ),
    [registerTeam]
  );
  function routingBinding(field: keyof RoutingDraft) {
    const binding = routingForm.bind(field);
    return {
      name: binding.name,
      onBlur: binding.onBlur,
      'aria-invalid': binding['aria-invalid'],
      'aria-describedby': binding['aria-describedby'],
    };
  }
  function feedback(kind: 'team' | 'rules', field: keyof TeamDraft | keyof RoutingDraft) {
    const form = kind === 'team' ? teamForm : routingForm;
    const message =
      kind === 'team'
        ? teamForm.form.getFieldState(field as keyof TeamDraft).error?.message
        : routingForm.form.getFieldState(field as keyof RoutingDraft).error?.message;
    return (
      <p
        id={form.errorId(field as never)}
        aria-hidden={!message || undefined}
        className={`min-h-5 text-sm text-destructive ${message ? '' : 'invisible'}`}
      >
        {message || '\u00a0'}
      </p>
    );
  }
  const updateRule = (
    type: keyof StaffAssignmentRules,
    rule: StaffAssignmentRules[keyof StaffAssignmentRules]
  ) => {
    setSaved(false);
    rulesDirty.current = true;
    routingForm.field(ruleField(type))[1](rule);
  };
  const load = useCallback(async () => {
    const current = ++generation.current,
      owner = denialGeneration.current;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/admin/staff-teams', { credentials: 'include' });
      if (current !== generation.current || owner !== denialGeneration.current) return;
      if ([401, 403].includes(response.status)) {
        denyAccess();
        return;
      }
      if (!response.ok) throw new Error('Teams unavailable');
      const data: unknown = await response.json();
      if (!validTeams(data)) throw new Error('Invalid teams');
      if (current !== generation.current || owner !== denialGeneration.current) return;
      const selected = editedTeam.current;
      const fresh = selected ? data.find((team) => team.id === selected.id) : null;
      if (selected && (!fresh || teamBasis(fresh) !== teamBasis(selected))) {
        clearAction();
        if (teamDirty.current || !fresh) setTeamStale(true);
        else resetTeam(teamValues(fresh));
        editedTeam.current = fresh ?? selected;
        setSaved(false);
      }
      const captured = actionRef.current;
      if (
        (captured || teamForm.isPending() || routingForm.isPending()) &&
        JSON.stringify(data.map(teamBasis).sort()) !==
          JSON.stringify(teamSnapshot.current.map(teamBasis).sort())
      )
        clearAction();
      if (deniedRef.current) {
        setMemberRevision((v) => v + 1);
        setRulesRevision((v) => v + 1);
      }
      deniedRef.current = false;
      setDenied(false);
      teamSnapshot.current = data;
      setTeamUncertain(false);
      setTeams(data);
    } catch {
      if (current === generation.current && owner === denialGeneration.current) setError(true);
    } finally {
      if (current === generation.current && owner === denialGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  useEffect(() => {
    const controller = new AbortController(),
      owner = denialGeneration.current;
    setRulesLoading(true);
    setRulesError(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/config/assignment-rules', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (controller.signal.aborted || owner !== denialGeneration.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Rules unavailable');
        const data: unknown = await response.json();
        if (!validRouting(data)) throw new Error('Invalid rules');
        if (controller.signal.aborted || owner !== denialGeneration.current || deniedRef.current)
          return;
        if (
          (rulesSnapshot.current || rulesDirty.current) &&
          routingBasis(data) !==
            routingBasis(rulesSnapshot.current ?? DEFAULT_STAFF_ASSIGNMENT_RULES)
        ) {
          if (
            actionRef.current?.path === '/api/admin/config/assignment-rules' ||
            routingForm.isPending()
          )
            clearAction();
          if (rulesDirty.current) setRulesStale(true);
          setSaved(false);
        }
        rulesSnapshot.current = data;
        setRulesUncertain(false);
        if (!rulesDirty.current) setRules(data);
      } catch {
        if (!controller.signal.aborted && owner === denialGeneration.current) setRulesError(true);
      } finally {
        if (!controller.signal.aborted && owner === denialGeneration.current)
          setRulesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [rulesRevision]);
  useEffect(() => {
    if (deniedRef.current) return;
    const controller = new AbortController(),
      owner = denialGeneration.current;
    setMemberLoading(true);
    setMemberError(false);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: search, ...(editing ? { teamId: editing } : {}) });
        const response = await fetch(`/api/admin/staff-teams/members?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (controller.signal.aborted || owner !== denialGeneration.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const data: unknown = await response.json();
        if (!validMembers(data)) throw new Error('Invalid members');
        if (controller.signal.aborted || owner !== denialGeneration.current || deniedRef.current)
          return;
        if (
          [...data.items, ...data.selected].some(
            (member) =>
              knownRef.current[member.id] &&
              memberBasis(knownRef.current[member.id]!) !== memberBasis(member)
          )
        )
          clearAction();
        setAcceptedMemberScope(memberScope);
        setMembers(data.items);
        setHasMore(data.hasMore);
        setKnown((previous) => ({
          ...previous,
          ...Object.fromEntries(
            [...data.items, ...data.selected].map((member) => [member.id, member])
          ),
        }));
      } catch {
        if (!controller.signal.aborted && owner === denialGeneration.current) setMemberError(true);
      } finally {
        if (!controller.signal.aborted && owner === denialGeneration.current)
          setMemberLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, editing, memberRevision]);
  function edit(team?: Team) {
    clearAction();
    editedTeam.current = team ?? null;
    setEditing(team?.id ?? null);
    resetTeam(team ? teamValues(team) : emptyTeamDraft());
    setTeamStale(false);
    setSearch('');
    setSaved(false);
    formHeading.current?.focus();
  }
  function toggleMember(id: string, checked: boolean) {
    setDraft((previous) => ({
      ...previous,
      members: checked
        ? [...previous.members, id]
        : previous.members.filter((value) => value !== id),
      leadUserId: !checked && previous.leadUserId === id ? null : previous.leadUserId,
    }));
  }
  const disabled = loading || error || denied || !!action || pending;
  const live = useRef({ teamReady: false, rulesReady: false });
  live.current = {
    teamReady:
      !loading &&
      !error &&
      !denied &&
      !memberLoading &&
      !memberError &&
      !teamStale &&
      !teamUncertain,
    rulesReady:
      !loading &&
      !error &&
      !denied &&
      !rulesLoading &&
      !rulesError &&
      !rulesStale &&
      !rulesUncertain,
  };
  async function submit(event: FormEvent, kind: 'team' | 'rules') {
    event.preventDefault();
    if (
      actionRef.current ||
      teamForm.isPending() ||
      routingForm.isPending() ||
      !(kind === 'team' ? live.current.teamReady : live.current.rulesReady)
    )
      return;
    const form = kind === 'team' ? teamForm : routingForm,
      version = workGeneration.current;
    form.setValidationPending(true);
    setSaved(false);
    try {
      await form.form.handleSubmit(
        (value) => {
          if (
            version !== workGeneration.current ||
            actionRef.current ||
            !(kind === 'team' ? live.current.teamReady : live.current.rulesReady)
          )
            return;
          const body =
            kind === 'team' ? teamBody(value as TeamDraft) : routingBody(value as RoutingDraft);
          const next: TeamAction = {
            title: label(kind === 'team' ? 'saveTeam' : 'saveRules'),
            description:
              kind === 'team'
                ? `${(body as ReturnType<typeof teamBody>).name} · ${(body as ReturnType<typeof teamBody>).memberUserIds.map((id) => knownRef.current[id]?.name ?? label('loading')).join(', ')}`
                : STAFF_ASSIGNMENT_WORK_TYPES.map((type) => {
                    const rule = (body as StaffAssignmentRules)[type];
                    return `${label(type)}: ${
                      rule.teamId
                        ? [rule, ...(rule.fallbacks ?? [])]
                            .map(
                              (choice) =>
                                `${teamSnapshot.current.find((team) => team.id === choice.teamId)?.name ?? label('unavailable')} · ${label(choice.strategy)}`
                            )
                            .concat(label('manual'))
                            .join(' → ')
                        : label('manual')
                    }`;
                  }).join('; '),
            path:
              kind === 'team'
                ? `/api/admin/staff-teams${editing ? `/${editing}` : ''}`
                : '/api/admin/config/assignment-rules',
            method: kind === 'team' && !editing ? 'POST' : 'PUT',
            ...(kind === 'team' && !editing ? { successStatus: 201 } : {}),
            body,
            forbiddenMessage: label('forbidden'),
          };
          actionRef.current = next;
          setAction(next);
        },
        (errors) => {
          if (version !== workGeneration.current) {
            form.form.clearErrors();
            return;
          }
          const keys = kind === 'team' ? Object.keys(teamMessages) : Object.keys(routingMessages);
          invalidFocus.current = {
            kind,
            field: Object.keys(errors).find((field) => keys.includes(field)) ?? '',
          };
        }
      )();
    } finally {
      form.setValidationPending(false);
    }
  }
  const actionGeneration = workGeneration.current;
  return (
    <section className="mx-auto max-w-4xl min-w-0 space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{label('description')}</p>
      </header>
      {saved && <p role="status">{label('saved')}</p>}
      <ListPage>
        <ListPage.Toolbar>
          <h2 className="text-lg font-semibold">{label('teams')}</h2>
          <Button
            ref={teamRefresh}
            variant="outline"
            disabled={loading || pending}
            onClick={() => void load()}
          >
            {label('refresh')}
          </Button>
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={error || denied}
          empty={!teams.length}
          retainContent={!!teams.length && !denied}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={
            <div role="alert">
              <p>{label(denied ? 'forbidden' : 'error')}</p>
              {!denied && (
                <Button variant="outline" onClick={() => void load()}>
                  {label('retry')}
                </Button>
              )}
            </div>
          }
          emptyView={<p>{label('empty')}</p>}
        >
          <OperationalQueueTable
            locale={locale}
            rows={teams}
            caption={label('catalogue')}
            scrollLabel={label('catalogue')}
            nameHeader={label('name')}
            renderName={(team) => <TextCell value={team.name} />}
            fields={[
              {
                id: 'description',
                label: label('teamDescription'),
                render: (team) => <TextCell value={team.description} />,
              },
              {
                id: 'members',
                label: label('memberCount'),
                render: (team) => <bdi>{numbers.number(team.memberUserIds.length)}</bdi>,
              },
              {
                id: 'lead',
                label: label('lead'),
                render: (team) => (
                  <TextCell
                    value={team.leadUserId ? known[team.leadUserId]?.name || team.leadUserId : null}
                  />
                ),
              },
              {
                id: 'tags',
                label: label('tags'),
                render: (team) => <TextCell value={team.skillTags.join(', ') || null} />,
              },
              {
                id: 'status',
                label: label('status'),
                render: (team) => (
                  <Badge variant={team.isActive ? 'secondary' : 'outline'}>
                    {label(team.isActive ? 'active' : 'inactive')}
                  </Badge>
                ),
              },
            ]}
            actionHeader={label('actions')}
            renderActions={(team) => (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={disabled || teamUncertain}
                  onClick={() => edit(team)}
                >
                  {label('edit')}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={disabled}
                  onClick={() => {
                    setSaved(false);
                    const next: TeamAction = {
                      title: label('delete'),
                      description: `${team.name}. ${label('deleteNote')}`,
                      path: `/api/admin/staff-teams/${team.id}`,
                      method: 'DELETE',
                      forbiddenMessage: label('forbidden'),
                    };
                    actionRef.current = next;
                    setAction(next);
                  }}
                >
                  {label('delete')}
                </Button>
              </div>
            )}
            loading={loading}
            emptyMessage={label('empty')}
            tableClassName="min-w-[56rem]"
          />
        </ListPage.Content>
        {!denied && (
          <>
            <form
              noValidate
              aria-busy={pending || undefined}
              onSubmit={(event) => void submit(event, 'team')}
              className="space-y-4 rounded-lg border bg-card text-card-foreground p-4"
            >
              <h2 ref={formHeading} tabIndex={-1} className="text-lg font-semibold">
                {label(editing ? 'edit' : 'new')}
              </h2>
              {teamStale && <Alert variant="destructive">{label('staleTeam')}</Alert>}
              {teamUncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
              {catalogueRootMessage(teamForm.errors) && (
                <Alert variant="destructive">{catalogueRootMessage(teamForm.errors)}</Alert>
              )}
              <fieldset
                disabled={!!action || pending || teamStale || teamUncertain}
                className="min-w-0 space-y-3"
              >
                <div>
                  <Label htmlFor="staff-team-name">{label('name')}</Label>
                  <Input
                    id="staff-team-name"
                    {...teamForm.bind('name')}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                  {feedback('team', 'name')}
                </div>
                <div>
                  <Label htmlFor="staff-team-description">{label('teamDescription')}</Label>
                  <textarea
                    id="staff-team-description"
                    {...teamForm.bind('description')}
                    className="block w-full rounded border p-2"
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                  {feedback('team', 'description')}
                </div>
                <div>
                  <Label htmlFor="staff-team-tags">{label('tags')}</Label>
                  <Input
                    id="staff-team-tags"
                    {...teamForm.bind('tags')}
                    aria-describedby={`staff-team-tags-help ${teamForm.errorId('tags')}`}
                    value={draft.tags}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  />
                  <p id="staff-team-tags-help" className="text-sm text-muted-foreground">
                    {label('tagsHelp')}
                  </p>
                  {feedback('team', 'tags')}
                </div>
                <div>
                  <Label htmlFor="staff-team-search">{label('search')}</Label>
                  <Input
                    id="staff-team-search"
                    maxLength={100}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                {memberLoading ? (
                  <p role="status">{label('loading')}</p>
                ) : memberError ? (
                  <div role="alert">
                    <p>{label('memberError')}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setMemberRevision((v) => v + 1)}
                    >
                      {label('memberRetry')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <fieldset
                      {...teamForm.bind('members')}
                      ref={membersRef}
                      tabIndex={-1}
                      className="max-h-52 overflow-auto space-y-2"
                    >
                      <legend>{label('members')}</legend>
                      {visibleMembers.map((member) => (
                        <label key={member.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.members.includes(member.id)}
                            disabled={
                              !draft.members.includes(member.id) &&
                              (draft.members.length >= 200 || member.eligible === false)
                            }
                            onChange={(event) => toggleMember(member.id, event.target.checked)}
                          />
                          {member.name}
                        </label>
                      ))}
                    </fieldset>
                    {hasMore && <p className="text-sm">{label('more')}</p>}
                  </>
                )}
                {feedback('team', 'members')}
                <ul aria-label={label('selected')} className="flex flex-wrap gap-2">
                  {draft.members.map((id) => (
                    <li key={id} className="rounded border p-2 text-sm">
                      {known[id]?.name ?? label('loading')}{' '}
                      {known[id]?.eligible === false && label('inactive')}{' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => toggleMember(id, false)}
                      >
                        {label('remove')}
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  <Label htmlFor="staff-team-lead">{label('lead')}</Label>
                  <select
                    id="staff-team-lead"
                    {...teamForm.bind('leadUserId')}
                    className="block rounded border p-2"
                    value={draft.leadUserId ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, leadUserId: event.target.value || null })
                    }
                  >
                    <option value="">{label('noLead')}</option>
                    {draft.members.map((id) => (
                      <option key={id} value={id} disabled={known[id]?.eligible === false}>
                        {known[id]?.name ?? label('loading')}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-muted-foreground">{label('leadHelp')}</p>
                  {feedback('team', 'leadUserId')}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <CatalogueSaveButton
                  label={label(teamForm.pending ? 'working' : 'saveTeam')}
                  pending={teamForm.pending}
                  disabled={disabled || !live.current.teamReady}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || teamUncertain}
                  onClick={() => {
                    const current = editing ? teams.find((team) => team.id === editing) : null;
                    if (current) {
                      clearAction();
                      editedTeam.current = current;
                      resetTeam(teamValues(current));
                      setTeamStale(false);
                      setSaved(false);
                    } else edit();
                  }}
                >
                  {label('resetTeam')}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || teamUncertain}
                    onClick={() => edit()}
                  >
                    {label('new')}
                  </Button>
                )}
              </div>
            </form>
            <form
              className="space-y-4 rounded-lg border bg-card text-card-foreground p-4"
              noValidate
              aria-busy={pending || undefined}
              onSubmit={(event) => void submit(event, 'rules')}
            >
              <h2 className="text-lg font-semibold">{label('rules')}</h2>
              <p className="text-sm text-muted-foreground">{label('expertiseHelp')}</p>
              {rulesLoading && <p role="status">{label('rulesLoading')}</p>}
              {rulesError && (
                <div role="alert">
                  <p>{label('rulesError')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRulesRevision((v) => v + 1)}
                  >
                    {label('rulesRetry')}
                  </Button>
                </div>
              )}
              <Button
                ref={rulesRefresh}
                type="button"
                variant="outline"
                disabled={rulesLoading || pending}
                onClick={() => setRulesRevision((v) => v + 1)}
              >
                {label('refreshRules')}
              </Button>
              {rulesStale && <Alert variant="destructive">{label('staleRules')}</Alert>}
              {rulesUncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
              {catalogueRootMessage(routingForm.errors) && (
                <Alert variant="destructive">{catalogueRootMessage(routingForm.errors)}</Alert>
              )}
              <fieldset
                disabled={!!action || pending || rulesStale || rulesUncertain}
                className="min-w-0 space-y-4"
              >
                {STAFF_ASSIGNMENT_WORK_TYPES.map((type) => (
                  <fieldset
                    key={type}
                    {...routingBinding(ruleField(type))}
                    className="min-w-0 flex flex-wrap items-end gap-3"
                  >
                    <legend className="font-medium">{label(type)}</legend>
                    <div>
                      <Label htmlFor={`team-${type}`}>{label('team')}</Label>
                      <select
                        id={`team-${type}`}
                        {...routingForm.bind(`${ruleField(type)}.teamId`)}
                        aria-invalid={
                          routingForm.form.getFieldState(ruleField(type)).invalid || undefined
                        }
                        aria-describedby={routingForm.errorId(ruleField(type))}
                        className="block rounded border p-2"
                        value={rules[type].teamId ?? ''}
                        onChange={(event) =>
                          updateRule(
                            type,
                            event.target.value
                              ? { ...rules[type], teamId: event.target.value }
                              : { teamId: null, strategy: rules[type].strategy }
                          )
                        }
                      >
                        <option value="">{label('manual')}</option>
                        {teams
                          .filter((team) => team.isActive)
                          .map((team) => (
                            <option
                              key={team.id}
                              value={team.id}
                              disabled={rules[type].fallbacks?.some(
                                (choice) => choice.teamId === team.id
                              )}
                            >
                              {team.name}
                            </option>
                          ))}
                        {rules[type].teamId &&
                          !teams.some(
                            (team) => team.id === rules[type].teamId && team.isActive
                          ) && <option value={rules[type].teamId!}>{label('unavailable')}</option>}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`strategy-${type}`}>{label('strategy')}</Label>
                      <select
                        id={`strategy-${type}`}
                        aria-invalid={
                          routingForm.form.getFieldState(ruleField(type)).invalid || undefined
                        }
                        aria-describedby={routingForm.errorId(ruleField(type))}
                        className="block rounded border p-2"
                        disabled={!rules[type].teamId}
                        value={rules[type].strategy}
                        onChange={(event) =>
                          updateRule(type, {
                            ...rules[type],
                            strategy: event.target.value as StaffAssignmentStrategy,
                          })
                        }
                      >
                        {STAFF_ASSIGNMENT_STRATEGIES.map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {label(strategy)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-full">{feedback('rules', ruleField(type))}</div>
                    <AssignmentFallbackEditor
                      workType={type}
                      feedback={{
                        'aria-invalid':
                          routingForm.form.getFieldState(ruleField(type)).invalid || undefined,
                        'aria-describedby': routingForm.errorId(ruleField(type)),
                      }}
                      rule={rules[type]}
                      teams={teams}
                      label={label}
                      onChange={(rule) => updateRule(type, rule)}
                    />
                  </fieldset>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <CatalogueSaveButton
                  label={label(routingForm.pending ? 'working' : 'saveRules')}
                  pending={routingForm.pending}
                  disabled={disabled || !live.current.rulesReady}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    disabled ||
                    rulesLoading ||
                    rulesError ||
                    rulesUncertain ||
                    !rulesSnapshot.current
                  }
                  onClick={() => {
                    clearAction();
                    setRules(rulesSnapshot.current!);
                    rulesDirty.current = false;
                    setRulesStale(false);
                    setSaved(false);
                  }}
                >
                  {label('resetRules')}
                </Button>
              </div>
            </form>
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={action.path.includes('/assignment-rules') ? rulesRefresh : teamRefresh}
          confirmationDisabled={
            loading ||
            error ||
            denied ||
            (action.path.includes('/assignment-rules')
              ? rulesLoading || rulesError || rulesStale || rulesUncertain
              : action.method === 'DELETE'
                ? teamUncertain
                : memberLoading || memberError || teamStale || teamUncertain)
          }
          onClose={() => {
            if (actionGeneration === workGeneration.current) clearAction();
          }}
          onDenied={() => {
            if (actionGeneration === workGeneration.current) denyAccess();
          }}
          onValidationError={(fields) =>
            actionGeneration === workGeneration.current &&
            action.method !== 'DELETE' &&
            (action.path.includes('/assignment-rules') ? routingErrors(fields) : teamErrors(fields))
          }
          summary={
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={action.path.includes('/assignment-rules') ? rulesLoading : loading}
                onClick={() =>
                  action.path.includes('/assignment-rules')
                    ? setRulesRevision((v) => v + 1)
                    : void load()
                }
              >
                {label(action.path.includes('/assignment-rules') ? 'refreshRules' : 'refresh')}
              </Button>
              {(teamUncertain || rulesUncertain) && (
                <Alert variant="destructive">{label('unverified')}</Alert>
              )}
              {(action.path.includes('/assignment-rules') ? rulesError : error) && (
                <Alert variant="destructive">
                  {label(action.path.includes('/assignment-rules') ? 'rulesError' : 'error')}
                </Alert>
              )}
            </div>
          }
          onSuccess={async (result) => {
            if (actionGeneration !== workGeneration.current || deniedRef.current) return;
            if (action.path.includes('/staff-teams')) {
              const matches =
                action.method === 'DELETE'
                  ? !!result &&
                    typeof result === 'object' &&
                    'deleted' in result &&
                    result.deleted === true
                  : matchesTeamReceipt(
                      action.body as ReturnType<typeof teamBody>,
                      result,
                      editedTeam.current
                    );
              if (!matches) {
                setTeamUncertain(true);
                setTeamStale(true);
                throw new Error('Unverified staff-team acknowledgement');
              }
              if (
                action.method !== 'DELETE' ||
                editedTeam.current?.id === action.path.split('/').at(-1)
              ) {
                editedTeam.current = null;
                setEditing(null);
                resetTeam(emptyTeamDraft());
                setTeamStale(false);
              }
              if (action.method !== 'DELETE') {
                const receipt = result as Team;
                teamSnapshot.current = [
                  ...teamSnapshot.current.filter((team) => team.id !== receipt.id),
                  receipt,
                ];
                setTeams(teamSnapshot.current);
              }
              clearAction();
              await load();
            } else {
              if (
                !validRouting(result) ||
                routingBasis(result) !== routingBasis(action.body as StaffAssignmentRules)
              ) {
                setRulesUncertain(true);
                setRulesStale(true);
                throw new Error('Unverified assignment-rules acknowledgement');
              }
              rulesSnapshot.current = result;
              setRules(result);
              setRulesStale(false);
              rulesDirty.current = false;
              clearAction();
              setRulesRevision((v) => v + 1);
            }
            if (
              !deniedRef.current &&
              (action.method === 'DELETE' ||
                action.path.includes('/assignment-rules') ||
                !teamDirty.current)
            )
              setSaved(true);
          }}
        />
      )}
    </section>
  );
}
