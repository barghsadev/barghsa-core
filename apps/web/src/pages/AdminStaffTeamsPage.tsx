import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { AssignmentFallbackEditor } from '../components/AssignmentFallbackEditor.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import {
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  validateStaffAssignmentRules,
  STAFF_ASSIGNMENT_WORK_TYPES,
  STAFF_ASSIGNMENT_STRATEGIES,
  type StaffAssignmentRules,
  type StaffAssignmentStrategy,
} from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

interface Team {
  leadUserId?: string | null;
  id: string;
  name: string;
  description: string | null;
  skillTags: string[];
  isActive: boolean;
  memberUserIds: string[];
}
interface Member {
  id: string;
  name: string;
  eligible?: boolean;
}
const emptyDraft = () => ({
  name: '',
  description: '',
  tags: '',
  members: [] as string[],
  leadUserId: null as string | null,
});

export default function AdminStaffTeamsPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.teams.${key}`, locale);
  const [teams, setTeams] = useState<Team[]>([]),
    [rules, setRules] = useState<StaffAssignmentRules>(DEFAULT_STAFF_ASSIGNMENT_RULES);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(emptyDraft);
  const [search, setSearch] = useState(''),
    [members, setMembers] = useState<Member[]>([]),
    [known, setKnown] = useState<Record<string, Member>>({});
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
    rulesDirty.current = false;
    rulesSnapshot.current = null;
    editedTeam.current = null;
    setEditing(null);
    setDraft(emptyDraft());
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
  const updateRule = (
    type: keyof StaffAssignmentRules,
    rule: StaffAssignmentRules[keyof StaffAssignmentRules]
  ) => {
    setSaved(false);
    rulesDirty.current = true;
    setRules((current) => ({ ...current, [type]: rule }));
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
      const data = (await response.json()) as Team[];
      if (!Array.isArray(data)) throw new Error('Invalid teams');
      if (current !== generation.current || owner !== denialGeneration.current) return;
      const selected = editedTeam.current;
      if (selected && !data.some((team) => JSON.stringify(team) === JSON.stringify(selected))) {
        editedTeam.current = null;
        setEditing(null);
        setDraft(emptyDraft());
        clearAction();
      }
      const captured = actionRef.current;
      if (captured && JSON.stringify(data) !== JSON.stringify(teamSnapshot.current)) clearAction();
      if (deniedRef.current) {
        setMemberRevision((v) => v + 1);
        setRulesRevision((v) => v + 1);
      }
      deniedRef.current = false;
      setDenied(false);
      teamSnapshot.current = data;
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
        const data = (await response.json()) as StaffAssignmentRules;
        if (
          !validateStaffAssignmentRules(data).ok ||
          STAFF_ASSIGNMENT_WORK_TYPES.some((type) => !data[type])
        )
          throw new Error('Invalid rules');
        if (controller.signal.aborted || owner !== denialGeneration.current || deniedRef.current)
          return;
        if (
          rulesSnapshot.current &&
          JSON.stringify(data) !== JSON.stringify(rulesSnapshot.current) &&
          actionRef.current?.path === '/api/admin/config/assignment-rules'
        )
          clearAction();
        rulesSnapshot.current = data;
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
        const data = (await response.json()) as {
          items: Member[];
          selected: Member[];
          hasMore: boolean;
        };
        if (
          !data ||
          !Array.isArray(data.items) ||
          !Array.isArray(data.selected) ||
          typeof data.hasMore !== 'boolean'
        )
          throw new Error('Invalid members');
        if (controller.signal.aborted || owner !== denialGeneration.current || deniedRef.current)
          return;
        if (
          [...data.items, ...data.selected].some(
            (member) =>
              knownRef.current[member.id] &&
              JSON.stringify(knownRef.current[member.id]) !== JSON.stringify(member)
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
    setDraft(
      team
        ? {
            name: team.name,
            description: team.description ?? '',
            tags: team.skillTags.join(', '),
            members: [...team.memberUserIds],
            leadUserId: team.leadUserId ?? null,
          }
        : emptyDraft()
    );
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
  function saveTeam(event: FormEvent) {
    event.preventDefault();
    if (
      disabled ||
      memberLoading ||
      memberError ||
      draft.members.some((id) => !known[id] || known[id]?.eligible === false)
    )
      return;
    setSaved(false);
    setAction({
      title: label('saveTeam'),
      description: `${draft.name.trim()} · ${draft.members.map((id) => known[id]?.name ?? label('loading')).join(', ')}`,
      path: `/api/admin/staff-teams${editing ? `/${editing}` : ''}`,
      method: editing ? 'PUT' : 'POST',
      body: {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        skillTags: draft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        memberUserIds: [...draft.members],
        leadUserId: draft.leadUserId,
      },
      forbiddenMessage: label('forbidden'),
    });
  }
  const disabled = loading || error || denied || !!action;
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
          <Button variant="outline" disabled={loading || !!action} onClick={() => void load()}>
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
          <ul className="space-y-2">
            {teams.map((team) => (
              <li
                key={team.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border bg-card text-card-foreground p-3"
              >
                <div>
                  <h3 className="font-medium">{team.name}</h3>
                  <p className="text-sm text-muted-foreground">{team.description}</p>
                  <p className="text-sm">
                    {label('memberCount')}: {numbers.number(team.memberUserIds.length)}
                    {!team.isActive ? ` · ${label('inactive')}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={disabled} onClick={() => edit(team)}>
                    {label('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setSaved(false);
                      setAction({
                        title: label('delete'),
                        description: `${team.name}. ${label('deleteNote')}`,
                        path: `/api/admin/staff-teams/${team.id}`,
                        method: 'DELETE',
                        forbiddenMessage: label('forbidden'),
                      });
                    }}
                  >
                    {label('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ListPage.Content>
        {!denied && (
          <>
            <form
              onSubmit={saveTeam}
              className="space-y-4 rounded-lg border bg-card text-card-foreground p-4"
            >
              <h2 ref={formHeading} tabIndex={-1} className="text-lg font-semibold">
                {label(editing ? 'edit' : 'new')}
              </h2>
              <fieldset disabled={!!action} className="space-y-3">
                <div>
                  <Label htmlFor="staff-team-name">{label('name')}</Label>
                  <Input
                    id="staff-team-name"
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="staff-team-description">{label('teamDescription')}</Label>
                  <textarea
                    id="staff-team-description"
                    maxLength={2000}
                    className="block w-full rounded border p-2"
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="staff-team-tags">{label('tags')}</Label>
                  <Input
                    id="staff-team-tags"
                    value={draft.tags}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  />
                  <p className="text-sm text-muted-foreground">{label('tagsHelp')}</p>
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
                    <fieldset className="max-h-52 overflow-auto space-y-2">
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
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      disabled ||
                      !draft.name.trim() ||
                      memberLoading ||
                      memberError ||
                      draft.members.some((id) => !known[id] || known[id]?.eligible === false)
                    }
                  >
                    {label('saveTeam')}
                  </Button>
                  {editing && (
                    <Button type="button" variant="outline" onClick={() => edit()}>
                      {label('new')}
                    </Button>
                  )}
                </div>
              </fieldset>
            </form>
            <form
              className="space-y-4 rounded-lg border bg-card text-card-foreground p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || rulesLoading || rulesError) return;
                setSaved(false);
                setAction({
                  title: label('saveRules'),
                  description: STAFF_ASSIGNMENT_WORK_TYPES.map(
                    (type) =>
                      `${label(type)}: ${
                        rules[type].teamId
                          ? [rules[type], ...(rules[type].fallbacks ?? [])]
                              .map(
                                (choice) =>
                                  `${teams.find((team) => team.id === choice.teamId)?.name ?? label('unavailable')} · ${label(choice.strategy)}`
                              )
                              .concat(label('manual'))
                              .join(' → ')
                          : label('manual')
                      }`
                  ).join('; '),
                  path: '/api/admin/config/assignment-rules',
                  method: 'PUT',
                  body: structuredClone(rules),
                  forbiddenMessage: label('forbidden'),
                });
              }}
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
              <fieldset disabled={!!action} className="space-y-4">
                {STAFF_ASSIGNMENT_WORK_TYPES.map((type) => (
                  <fieldset key={type} className="flex flex-wrap items-end gap-3">
                    <legend className="font-medium">{label(type)}</legend>
                    <div>
                      <Label htmlFor={`team-${type}`}>{label('team')}</Label>
                      <select
                        id={`team-${type}`}
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
                    <AssignmentFallbackEditor
                      workType={type}
                      rule={rules[type]}
                      teams={teams}
                      label={label}
                      onChange={(rule) => updateRule(type, rule)}
                    />
                  </fieldset>
                ))}
                <Button type="submit" disabled={disabled || rulesLoading || rulesError}>
                  {label('saveRules')}
                </Button>
              </fieldset>
            </form>
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            loading ||
            error ||
            denied ||
            (action.path.includes('/assignment-rules')
              ? rulesLoading || rulesError
              : action.method === 'DELETE'
                ? false
                : memberLoading || memberError)
          }
          onClose={() => {
            if (actionGeneration === workGeneration.current) clearAction();
          }}
          onSuccess={async () => {
            if (actionGeneration !== workGeneration.current || deniedRef.current) return;
            if (action.path.includes('/staff-teams')) {
              if (
                action.method !== 'DELETE' ||
                editedTeam.current?.id === action.path.split('/').at(-1)
              ) {
                editedTeam.current = null;
                setEditing(null);
                setDraft(emptyDraft());
              }
              clearAction();
              await load();
            } else {
              rulesDirty.current = false;
              clearAction();
              setRulesRevision((v) => v + 1);
            }
            if (!deniedRef.current) setSaved(true);
          }}
        />
      )}
    </section>
  );
}
