import {
  ChevronDown,
  Pencil as TablePencilIcon,
  Plus,
  Search,
  Trash2 as TableTrash2Icon,
  X,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
} from '../components/RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';
import { AssignmentFallbackEditor } from '../components/AssignmentFallbackEditor.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { tStaffTeams as t } from '@barghsa/i18n/staff-team-forms';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import {
  LoadingStatus,
  Alert,
  Badge,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  TextCell,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import {
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  STAFF_ASSIGNMENT_WORK_TYPES,
  STAFF_ASSIGNMENT_STRATEGIES,
  STAFF_TEAM_SKILL_TAGS_MAX,
  type StaffAssignmentRules,
  type StaffAssignmentStrategy,
} from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';

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
  teamSkillTags,
  validTeamSkillTags,
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

type TeamsMode = 'directory' | 'detail' | 'create' | 'edit' | 'assignment';

const specificSkills = [
  'support',
  'order',
  'contract',
  'invoice',
  'privacy',
  'identity',
  'individual',
  'legal',
] as const;
const routingSkills = new Set<string>([...STAFF_ASSIGNMENT_WORK_TYPES, ...specificSkills]);

function TeamNavigationGuard({ active }: { active: boolean }) {
  useBlocker({ shouldBlockFn: () => active, enableBeforeUnload: () => active });
  return null;
}

export default function AdminStaffTeamsPage({
  mode,
  teamId,
}: { mode?: TeamsMode; teamId?: string } = {}) {
  const locale = useLocale();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const read = useManualServerRead();
  const teamRequest = useRef<AbortController | null>(null);
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.teams.${key}`, locale);
  const skillLabel = (skill: string) => {
    const key = skill.toLowerCase();
    if (!routingSkills.has(key)) return skill;
    return label(
      STAFF_ASSIGNMENT_WORK_TYPES.some((workType) => workType === key) ? key : `skill.${key}`
    );
  };
  const catalogue = !mode || mode === 'directory';
  const showEditor = !mode || mode === 'create' || mode === 'edit';
  const showRouting = !mode || mode === 'assignment';
  const unavailableMember = loadingText('recordUnavailable', locale);
  const [teams, setTeams] = useState<Team[]>([]);
  const [known, setKnown] = useState<Record<string, Member>>({});
  const teamMessages = {
    name: label('invalidName'),
    description: label('invalidDescription'),
    tags: label('invalidTags'),
    selectedSkills: label('invalidTags'),
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
  const [missing, setMissing] = useState(false);
  const [createdTeam, setCreatedTeam] = useState<Team | null>(null);
  const [search, setSearch] = useState(''),
    [members, setMembers] = useState<Member[]>([]);
  const memberSearch = useRef<HTMLInputElement>(null);
  const [memberLoading, setMemberLoading] = useState(false),
    [memberError, setMemberError] = useState(false),
    [hasMore, setHasMore] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [writePending, setWritePending] = useState(false);
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
    teamRecovery = useRef<TeamAction | null>(null),
    rulesRecovery = useRef<TeamAction | null>(null),
    knownRef = useRef<Record<string, Member>>({});
  actionRef.current = action;
  knownRef.current = known;
  const memberScope = JSON.stringify([search, editing, memberRevision]);
  const matchingMembers =
    memberScope === acceptedMemberScope
      ? members.filter((member) => member.eligible !== false)
      : [];
  const visibleMembers = matchingMembers.filter((member) => !draft.members.includes(member.id));
  function clearAction() {
    ++workGeneration.current;
    actionRef.current = null;
    invalidFocus.current = null;
    setAction(null);
    setWritePending(false);
  }
  function holdUnconfirmed(command: TeamAction, invalidReceipt = false) {
    setSaved(false);
    if (command.path === '/api/admin/config/assignment-rules') {
      rulesRecovery.current = command;
      setRulesUncertain(true);
      if (invalidReceipt) setRulesStale(true);
    } else {
      teamRecovery.current = command;
      setTeamUncertain(true);
      if (invalidReceipt) setTeamStale(true);
    }
  }
  function denyAccess() {
    ++denialGeneration.current;
    teamRequest.current?.abort();
    deniedRef.current = true;
    setDenied(true);
    setLoading(false);
    setRulesLoading(false);
    clearAction();
    setTeams([]);
    setCreatedTeam(null);
    teamSnapshot.current = [];
    setRules(structuredClone(DEFAULT_STAFF_ASSIGNMENT_RULES));
    setTeamStale(false);
    setRulesStale(false);
    setTeamUncertain(false);
    setRulesUncertain(false);
    teamRecovery.current = null;
    rulesRecovery.current = null;
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
  function feedback(
    kind: 'team' | 'rules',
    field: keyof TeamDraft | keyof RoutingDraft,
    reserveSpace = true
  ) {
    const form = kind === 'team' ? teamForm : routingForm;
    const message =
      kind === 'team'
        ? teamForm.form.getFieldState(field as keyof TeamDraft).error?.message
        : routingForm.form.getFieldState(field as keyof RoutingDraft).error?.message;
    if (!message && !reserveSpace) return null;
    return (
      <p
        id={form.errorId(field as never)}
        aria-hidden={!message || undefined}
        className={`min-h-4 text-xs text-destructive ${message ? '' : 'invisible'}`}
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
      owner = denialGeneration.current,
      recovering = teamRecovery.current;
    teamRequest.current?.abort();
    const controller = new AbortController();
    teamRequest.current = controller;
    setLoading(true);
    setError(false);
    try {
      const path = teamId
        ? `/api/admin/staff-teams/${encodeURIComponent(teamId)}`
        : '/api/admin/staff-teams';
      const key = queryKeys.catalogue.list(
        {
          context: 'staff',
          ownerId: accountId ?? 'staff-session',
          accountId,
          revision: profileRevision,
        },
        new URLSearchParams({ endpoint: path, permission: String(owner) })
      );
      const data = await read(key, controller.signal, async (signal) => {
        const response = await fetch(path, { credentials: 'include', signal });
        if ([401, 403].includes(response.status)) return null;
        if (teamId && response.status === 404) return [];
        if (!response.ok) throw new Error('Teams unavailable');
        const json: unknown = await response.json();
        const value = teamId ? [json] : json;
        if (!validTeams(value) || (teamId && value[0]?.id !== teamId))
          throw new Error('Invalid teams');
        return value;
      });
      if (current !== generation.current || owner !== denialGeneration.current) return;
      if (!data) {
        denyAccess();
        return;
      }
      setMissing(!!teamId && data.length === 0);
      const selected = editedTeam.current;
      if (mode === 'edit' && !selected && data[0]) edit(data[0]);
      const fresh = selected ? data.find((team) => team.id === selected.id) : null;
      if (selected && (!fresh || teamBasis(fresh) !== teamBasis(selected))) {
        clearAction();
        if (teamId && !fresh) {
          editedTeam.current = null;
          setEditing(null);
          resetTeam(emptyTeamDraft());
          setKnown({});
        } else if (teamDirty.current || !fresh) setTeamStale(true);
        else resetTeam(teamValues(fresh));
        if (fresh || !teamId) editedTeam.current = fresh ?? selected;
        if (fresh) setMemberRevision((value) => value + 1);
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
      if (recovering && teamRecovery.current === recovering) {
        teamRecovery.current = null;
        setTeamUncertain(false);
        if (actionRef.current === recovering) clearAction();
        if (recovering.method === 'POST') {
          const match = data.find(
            (team) => team.name === (recovering.body as ReturnType<typeof teamBody>).name
          );
          if (match) {
            setTeamStale(true);
            if (mode === 'create') setCreatedTeam(match);
          }
        }
      }
      setTeams(data);
    } catch {
      if (current === generation.current && owner === denialGeneration.current) setError(true);
    } finally {
      if (current === generation.current && owner === denialGeneration.current) setLoading(false);
      if (teamRequest.current === controller) teamRequest.current = null;
    }
  }, [accountId, profileRevision, read, teamId, mode]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      teamRequest.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (!showRouting) return;
    const controller = new AbortController(),
      owner = denialGeneration.current,
      recovering = rulesRecovery.current;
    setRulesLoading(true);
    setRulesError(false);
    void (async () => {
      try {
        const { response, data } = await readWithDeadline(controller.signal, async (signal) => {
          const response = await fetch('/api/admin/config/assignment-rules', {
            credentials: 'include',
            signal,
          });
          return { response, data: response.ok ? ((await response.json()) as unknown) : null };
        });
        if (controller.signal.aborted || owner !== denialGeneration.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Rules unavailable');
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
        if (recovering && rulesRecovery.current === recovering) {
          rulesRecovery.current = null;
          setRulesUncertain(false);
          if (actionRef.current === recovering) clearAction();
        }
        if (!rulesDirty.current) setRules(data);
      } catch {
        if (!controller.signal.aborted && owner === denialGeneration.current) setRulesError(true);
      } finally {
        if (!controller.signal.aborted && owner === denialGeneration.current)
          setRulesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [rulesRevision, showRouting]);
  useEffect(() => {
    const needsMembers = showEditor || mode === 'detail';
    if (!needsMembers || (teamId && !teams.length) || deniedRef.current) return;
    const controller = new AbortController(),
      owner = denialGeneration.current;
    setMemberLoading(true);
    setMemberError(false);
    const timer = setTimeout(async () => {
      try {
        const memberTeamId = teamId ?? editing;
        const params = new URLSearchParams({
          q: search,
          ...(memberTeamId ? { teamId: memberTeamId } : {}),
        });
        const { response, data } = await readWithDeadline(controller.signal, async (signal) => {
          const response = await fetch(`/api/admin/staff-teams/members?${params}`, {
            credentials: 'include',
            signal,
          });
          return { response, data: response.ok ? ((await response.json()) as unknown) : null };
        });
        if (controller.signal.aborted || owner !== denialGeneration.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        if (!validMembers(data)) throw new Error('Invalid members');
        if (controller.signal.aborted || owner !== denialGeneration.current || deniedRef.current)
          return;
        // The server reports persisted membership separately from the search results.
        const team = memberTeamId
          ? teamSnapshot.current.find((item) => item.id === memberTeamId)
          : null;
        if (
          team &&
          (data.selected.length !== team.memberUserIds.length ||
            data.selected.some((member) => !team.memberUserIds.includes(member.id)))
        )
          throw new Error('Staff team membership changed');
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
  }, [search, editing, memberRevision, showEditor, mode, teamId, !!teams.length]);
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
  function addSkills(skill?: string) {
    const previous = teamForm.form.getValues();
    const next = skill
      ? { ...previous, selectedSkills: [...previous.selectedSkills, skill] }
      : { ...previous, selectedSkills: teamSkillTags(previous), tags: '' };
    if (!validTeamSkillTags(teamSkillTags(next))) {
      teamForm.form.setError('tags', { type: 'manual', message: teamMessages.tags });
      teamForm.form.setFocus('tags');
      return;
    }
    setDraft(next);
    teamForm.form.clearErrors('tags');
  }
  const disabled = loading || error || denied || !!action || pending;
  const unknownMember = memberLoading ? label('loading') : unavailableMember;
  const live = useRef({ teamReady: false, rulesReady: false });
  live.current = {
    teamReady:
      !loading &&
      !error &&
      !denied &&
      !missing &&
      (mode !== 'edit' || editing === teamId) &&
      memberScope === acceptedMemberScope &&
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
                ? `${(body as ReturnType<typeof teamBody>).name} · ${(body as ReturnType<typeof teamBody>).memberUserIds.map((id) => knownRef.current[id]?.name ?? unavailableMember).join(', ')}`
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
            responseDeadline: true,
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
  const record = teamId ? teams[0] : undefined;
  const heading =
    mode === 'assignment'
      ? label('rules')
      : mode === 'create'
        ? label('new')
        : mode === 'edit'
          ? label('edit')
          : mode === 'detail'
            ? (record?.name ?? label('team'))
            : label('title');
  function askToDelete(team: Team) {
    setSaved(false);
    const next: TeamAction = {
      title: label('delete'),
      description: `${team.name}. ${label('deleteNote')}`,
      path: `/api/admin/staff-teams/${team.id}`,
      method: 'DELETE',
      responseDeadline: true,
      forbiddenMessage: label('forbidden'),
    };
    actionRef.current = next;
    setAction(next);
  }
  const editorRoute = mode === 'create' || mode === 'edit' || mode === 'assignment';
  const compact = useCompactRecords();
  return (
    <section
      className={`mx-auto min-w-0 space-y-4 ${editorRoute ? 'max-w-3xl' : 'max-w-4xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {mode && <TeamNavigationGuard active={writePending || pending} />}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!catalogue && (
            <Link
              to="/admin/staff-teams"
              className="text-sm text-primary underline underline-offset-4"
            >
              {label('title')}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold wrap-anywhere sm:text-3xl">{heading}</h1>
            {mode === 'detail' && record && (
              <Badge variant={record.isActive ? 'success' : 'outline'}>
                {label(record.isActive ? 'active' : 'inactive')}
              </Badge>
            )}
          </div>
          {catalogue && (
            <p className="mt-2 text-sm text-muted-foreground">{label('description')}</p>
          )}
          {mode === 'edit' && record && (
            <Link
              to="/admin/staff-teams/$teamId"
              params={{ teamId: record.id }}
              className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
            >
              <bdi>{record.name}</bdi>
            </Link>
          )}
        </div>
        {editorRoute && (
          <ListRefreshButton
            label={label(mode === 'assignment' ? 'refreshRules' : 'refresh')}
            ref={mode === 'assignment' ? rulesRefresh : teamRefresh}
            disabled={loading || pending || (mode === 'assignment' && rulesLoading)}
            onClick={() => {
              void load();
              if (mode === 'assignment') setRulesRevision((v) => v + 1);
            }}
          />
        )}
        {mode === 'directory' && !loading && !error && !denied && (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/staff-teams/assignment"
              className={buttonVariants({ variant: 'outline' })}
            >
              {label('rules')}
            </Link>
            <Link to="/admin/staff-teams/new" className={buttonVariants()}>
              {label('new')}
            </Link>
          </div>
        )}
      </header>
      <CommandFeedback message={saved ? label('saved') : null} />
      {createdTeam && (
        <Link
          className="inline-block text-primary underline underline-offset-4"
          to="/admin/staff-teams/$teamId"
          params={{ teamId: createdTeam.id }}
        >
          <bdi>{createdTeam.name}</bdi>
        </Link>
      )}
      <ListPage>
        {!editorRoute && (
          <ListPage.Toolbar>
            {!mode && <h2 className="text-lg font-semibold">{label('teams')}</h2>}
            <ListRefreshButton
              label={label('refresh')}
              ref={teamRefresh}
              disabled={loading || pending}
              onClick={() => void load()}
            />
          </ListPage.Toolbar>
        )}
        {catalogue ? (
          <ListPage.Content
            loading={loading}
            error={error || denied}
            empty={!teams.length}
            retainContent={!!teams.length && !denied}
            loadingView={
              <RecordListSkeleton
                label={label('loading')}
                view={compact ? 'card' : 'table'}
                headings={[label('name'), label('status'), label('memberCount'), label('tags')]}
              />
            }
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
              renderName={(team) => (
                <span className="block space-y-1">
                  {mode === 'directory' ? (
                    <Link
                      className="text-primary underline underline-offset-4"
                      to="/admin/staff-teams/$teamId"
                      params={{ teamId: team.id }}
                    >
                      <TextCell value={team.name} />
                    </Link>
                  ) : (
                    <TextCell value={team.name} />
                  )}
                  {team.description && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      <TextCell value={team.description} />
                    </span>
                  )}
                </span>
              )}
              fields={[
                {
                  id: 'status',
                  label: label('status'),
                  render: (team) => (
                    <Badge variant={team.isActive ? 'success' : 'outline'}>
                      {label(team.isActive ? 'active' : 'inactive')}
                    </Badge>
                  ),
                },
                {
                  id: 'members',
                  label: label('memberCount'),
                  render: (team) => <bdi>{numbers.number(team.memberUserIds.length)}</bdi>,
                },
                ...(!mode
                  ? [
                      {
                        id: 'lead',
                        label: label('lead'),
                        render: (team: Team) => (
                          <TextCell
                            value={
                              team.leadUserId
                                ? known[team.leadUserId]?.name || team.leadUserId
                                : null
                            }
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  id: 'tags',
                  label: label('tags'),
                  render: (team) => <TextCell value={team.skillTags.join(', ') || null} />,
                },
              ]}
              actionHeader={label('actions')}
              cardHeading={mode ? 'h2' : 'h3'}
              {...(!mode
                ? {
                    renderActions: (team: Team) => (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="min-h-11"
                          disabled={disabled || teamUncertain}
                          onClick={() => edit(team)}
                          data-table-action-tooltip={label('edit')}
                        >
                          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          disabled={disabled || teamUncertain}
                          onClick={() => askToDelete(team)}
                          data-table-action-tooltip={label('delete')}
                        >
                          <TableActionIcon icon={TableTrash2Icon}>
                            {label('delete')}
                          </TableActionIcon>
                        </Button>
                      </div>
                    ),
                  }
                : {})}
              loading={loading}
              emptyMessage={label('empty')}
              tableClassName="min-w-[40rem]"
            />
          </ListPage.Content>
        ) : (
          <>
            {loading &&
              (mode === 'detail' ? (
                <RecordDetailSkeleton label={label('loading')} />
              ) : (
                <LoadingStatus>{label('loading')}</LoadingStatus>
              ))}
            {(missing || denied || error) && (
              <Alert variant="destructive" className="space-y-2">
                <p>{missing ? unavailableMember : label(denied ? 'forbidden' : 'error')}</p>
                {error && !denied && (
                  <Button variant="outline" onClick={() => void load()}>
                    {label('retry')}
                  </Button>
                )}
              </Alert>
            )}
            {mode === 'detail' && record && !denied && (
              <section className="space-y-5 rounded-lg border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {record.description && (
                    <p className="text-sm">
                      <TextCell value={record.description} />
                    </p>
                  )}
                </div>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-muted-foreground">{label('lead')}</dt>
                    <dd>
                      <TextCell
                        value={
                          record.leadUserId
                            ? (known[record.leadUserId]?.name ?? unknownMember)
                            : label('noLead')
                        }
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">{label('tags')}</dt>
                    <dd>
                      <TextCell value={record.skillTags.join(', ') || null} />
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-muted-foreground">
                      {label('memberCount')}{' '}
                      <bdi>{numbers.number(record.memberUserIds.length)}</bdi>
                    </dt>
                    <dd>
                      {record.memberUserIds.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {record.memberUserIds.map((id) => (
                            <li key={id}>
                              <TextCell value={known[id]?.name ?? unknownMember} />
                            </li>
                          ))}
                        </ul>
                      )}
                      {memberError && (
                        <Button
                          variant="outline"
                          onClick={() => setMemberRevision((value) => value + 1)}
                        >
                          {label('retry')}
                        </Button>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/admin/staff-teams/$teamId/edit"
                    params={{ teamId: record.id }}
                    className={buttonVariants()}
                  >
                    {label('edit')}
                  </Link>
                  <Button
                    variant="outline"
                    disabled={disabled || teamUncertain}
                    onClick={() => askToDelete(record)}
                  >
                    {label('delete')}
                  </Button>
                </div>
                {teamUncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
              </section>
            )}
          </>
        )}
        {!denied && (
          <>
            {showEditor && (mode !== 'edit' || !!record) && (
              <form
                noValidate
                aria-busy={pending || undefined}
                onSubmit={(event) => void submit(event, 'team')}
                className={recordEditorFormSurface}
                onFocus={keepRecordFieldVisible}
                aria-label={label(editing ? 'edit' : 'new')}
              >
                {!mode && (
                  <h2
                    ref={formHeading}
                    tabIndex={-1}
                    className="px-4 pt-4 text-lg font-semibold sm:px-6"
                  >
                    {label(editing ? 'edit' : 'new')}
                  </h2>
                )}
                {teamStale && (
                  <Alert variant="destructive" className="m-4">
                    {label('staleTeam')}
                  </Alert>
                )}
                {teamUncertain && (
                  <Alert variant="destructive" className="m-4">
                    {label('unverified')}
                  </Alert>
                )}
                {catalogueRootMessage(teamForm.errors) && (
                  <Alert variant="destructive" className="m-4">
                    {catalogueRootMessage(teamForm.errors)}
                  </Alert>
                )}
                <fieldset
                  disabled={!!action || pending || teamStale || teamUncertain}
                  className="min-w-0"
                >
                  <legend className="sr-only">{label(editing ? 'edit' : 'new')}</legend>
                  <div className="grid min-w-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                    <div className="min-w-0 border-b md:border-e md:border-b-0">
                      <RecordEditorSection title={label('teamDetails')}>
                        <div className={recordEditorField}>
                          <Label htmlFor="staff-team-name">{label('name')}</Label>
                          <Input
                            id="staff-team-name"
                            dir="auto"
                            required
                            {...teamForm.bind('name')}
                            value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                          />
                          {feedback('team', 'name')}
                        </div>
                        <div className={recordEditorField}>
                          <Label htmlFor="staff-team-description">{label('teamDescription')}</Label>
                          <Textarea
                            id="staff-team-description"
                            {...teamForm.bind('description')}
                            rows={2}
                            dir="auto"
                            className="max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]"
                            placeholder={label('descriptionExample')}
                            value={draft.description}
                            onChange={(event) =>
                              setDraft({ ...draft, description: event.target.value })
                            }
                          />
                          {feedback('team', 'description')}
                        </div>
                        <div className="space-y-3 border-t pt-3">
                          <div className={recordEditorField}>
                            <Label htmlFor="staff-team-skill">{label('tags')}</Label>
                            <NativeSelect
                              id="staff-team-skill"
                              className="w-full min-w-0"
                              value=""
                              aria-describedby="staff-team-skill-help"
                              disabled={draft.selectedSkills.length >= STAFF_TEAM_SKILL_TAGS_MAX}
                              onChange={(event) => addSkills(event.target.value)}
                            >
                              <option value="" disabled>
                                {label('chooseSkill')}
                              </option>
                              {(
                                [
                                  ['workTypeSkills', STAFF_ASSIGNMENT_WORK_TYPES],
                                  ['specificSkills', specificSkills],
                                ] as const
                              ).map(([group, skills]) => (
                                <optgroup key={group} label={label(group)}>
                                  {skills.map((skill) => (
                                    <option
                                      key={skill}
                                      value={skill}
                                      disabled={draft.selectedSkills.some(
                                        (tag) => tag.toLowerCase() === skill
                                      )}
                                    >
                                      {skillLabel(skill)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </NativeSelect>
                            <p id="staff-team-skill-help" className="text-xs text-muted-foreground">
                              {label('routingSkillHelp')}
                            </p>
                          </div>
                          {draft.selectedSkills.length > 0 && (
                            // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops unmarked list semantics.
                            <ul
                              role="list"
                              aria-label={label('chosenSkills')}
                              className="flex flex-wrap gap-1.5"
                            >
                              {draft.selectedSkills.map((skill) => (
                                <li
                                  key={skill}
                                  className="flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-muted/25 ps-2 text-sm"
                                >
                                  <bdi className="min-w-0 [overflow-wrap:anywhere]">
                                    {skillLabel(skill)}
                                  </bdi>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`${label('remove')} ${skillLabel(skill)}`}
                                    onClick={() => {
                                      teamForm.form.setFocus('tags');
                                      setDraft((previous) => ({
                                        ...previous,
                                        selectedSkills: previous.selectedSkills.filter(
                                          (tag) => tag !== skill
                                        ),
                                      }));
                                      teamForm.form.clearErrors('tags');
                                    }}
                                  >
                                    <X aria-hidden="true" />
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className={recordEditorField}>
                            <Label htmlFor="staff-team-tags">{label('customSkills')}</Label>
                            <div className="flex min-w-0 items-center gap-2">
                              <Input
                                id="staff-team-tags"
                                dir="auto"
                                {...teamForm.bind('tags')}
                                aria-describedby={[
                                  'staff-team-tags-help',
                                  teamForm.errors.tags && teamForm.errorId('tags'),
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                value={draft.tags}
                                onChange={(event) =>
                                  setDraft({ ...draft, tags: event.target.value })
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' || event.nativeEvent.isComposing)
                                    return;
                                  event.preventDefault();
                                  if (draft.tags.trim()) addSkills();
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                disabled={!draft.tags.trim()}
                                aria-label={label('addCustomSkills')}
                                onClick={() => addSkills()}
                              >
                                {label('addSkill')}
                              </Button>
                            </div>
                            <p id="staff-team-tags-help" className="text-xs text-muted-foreground">
                              {label('tagsHelp')}
                            </p>
                            {feedback('team', 'tags', false)}
                          </div>
                        </div>
                      </RecordEditorSection>
                    </div>
                    <RecordEditorSection title={label('membership')}>
                      <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
                        <p
                          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                          aria-live="polite"
                        >
                          {label('selected')}
                          <bdi className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums">
                            {numbers.number(draft.members.length)}
                          </bdi>
                        </p>
                        {draft.members.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{label('emptySelection')}</p>
                        ) : (
                          // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops unmarked list semantics.
                          <ul
                            role="list"
                            aria-label={label('selected')}
                            className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
                          >
                            {draft.members.map((id) => (
                              <li
                                key={id}
                                className="flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-card ps-2 text-sm"
                              >
                                <span className="min-w-0 [overflow-wrap:anywhere]" dir="auto">
                                  {known[id]?.name ?? unknownMember}
                                  {known[id]?.eligible === false ? ` · ${label('inactive')}` : ''}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`${label('remove')} ${known[id]?.name ?? unknownMember}`}
                                  title={label('remove')}
                                  onClick={(event) => {
                                    if (event.detail === 0) memberSearch.current?.focus();
                                    toggleMember(id, false);
                                  }}
                                >
                                  <X aria-hidden="true" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className={recordEditorField}>
                          <Label htmlFor="staff-team-lead">{label('lead')}</Label>
                          <NativeSelect
                            id="staff-team-lead"
                            {...teamForm.bind('leadUserId')}
                            aria-describedby={[
                              'staff-team-lead-help',
                              teamForm.bind('leadUserId')['aria-describedby'],
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            className="w-full"
                            value={draft.leadUserId ?? ''}
                            disabled={draft.members.length === 0}
                            onChange={(event) =>
                              setDraft({ ...draft, leadUserId: event.target.value || null })
                            }
                          >
                            <option value="">{label('noLead')}</option>
                            {draft.members.map((id) => (
                              <option key={id} value={id} disabled={known[id]?.eligible === false}>
                                {known[id]?.name ?? unknownMember}
                              </option>
                            ))}
                          </NativeSelect>
                          <p id="staff-team-lead-help" className="text-xs text-muted-foreground">
                            {label('leadHelp')}
                          </p>
                          {feedback('team', 'leadUserId', false)}
                        </div>
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor="staff-team-search">{label('search')}</Label>
                        <div className="relative">
                          <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                          />
                          <Input
                            id="staff-team-search"
                            ref={memberSearch}
                            type="search"
                            className="ps-9"
                            maxLength={100}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                                event.preventDefault();
                            }}
                          />
                        </div>
                      </div>
                      {memberLoading ? (
                        <LoadingStatus>{label('loading')}</LoadingStatus>
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
                            className="min-w-0 rounded-lg border bg-muted/20 px-1.5 pb-1.5"
                          >
                            <legend className="ms-1 px-1 text-xs font-medium text-muted-foreground">
                              {label('members')}
                            </legend>
                            {visibleMembers.length === 0 && (
                              <p role="status" className="p-2 text-sm text-muted-foreground">
                                {label(
                                  matchingMembers.length ? 'matchesSelected' : 'noMatchingMembers'
                                )}
                              </p>
                            )}
                            <div className="max-h-52 space-y-1 overflow-y-auto">
                              {visibleMembers.map((member) => (
                                <Button
                                  key={member.id}
                                  type="button"
                                  variant="ghost"
                                  className="h-auto min-h-11 w-full justify-between rounded-md px-2 text-start font-normal whitespace-normal"
                                  aria-label={label('addMember').replace('{name}', member.name)}
                                  disabled={draft.members.length >= 200}
                                  onClick={(event) => {
                                    if (event.detail === 0) memberSearch.current?.focus();
                                    toggleMember(member.id, true);
                                  }}
                                >
                                  <bdi className="min-w-0 [overflow-wrap:anywhere]">
                                    {member.name}
                                  </bdi>
                                  <Plus className="size-4 text-primary" aria-hidden="true" />
                                </Button>
                              ))}
                            </div>
                          </fieldset>
                          {hasMore && (
                            <p className="text-xs text-muted-foreground">{label('more')}</p>
                          )}
                        </>
                      )}
                      {feedback('team', 'members', false)}
                    </RecordEditorSection>
                  </div>
                </fieldset>
                <StickyRecordEditorActions>
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
                  {editing && !mode && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled || teamUncertain}
                      onClick={() => edit()}
                    >
                      {label('new')}
                    </Button>
                  )}
                  <CatalogueSaveButton
                    label={label(teamForm.pending ? 'working' : 'saveTeam')}
                    pending={teamForm.pending}
                    disabled={disabled || !live.current.teamReady}
                  />
                </StickyRecordEditorActions>
              </form>
            )}
            {showRouting && (
              <form
                className={recordEditorFormSurface}
                onFocus={keepRecordFieldVisible}
                aria-label={label('rules')}
                noValidate
                aria-busy={pending || undefined}
                onSubmit={(event) => void submit(event, 'rules')}
              >
                <div className="space-y-2 border-b bg-muted/20 px-4 py-3 sm:px-6">
                  {!mode && <h2 className="text-lg font-semibold">{label('rules')}</h2>}
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1 pt-1">
                      <p className="text-sm text-muted-foreground">{label('newWorkHelp')}</p>
                      <details className="group text-sm">
                        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
                          {label('routingHelp')}
                          <ChevronDown
                            aria-hidden="true"
                            className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                          />
                        </summary>
                        <div className="max-w-prose space-y-2 pb-1 text-muted-foreground">
                          <p>{label('fallbackHelp')}</p>
                          <p>{label('expertiseHelp')}</p>
                        </div>
                      </details>
                    </div>
                    {!mode && (
                      <ListRefreshButton
                        ref={rulesRefresh}
                        label={label('refreshRules')}
                        disabled={rulesLoading || pending}
                        onClick={() => setRulesRevision((v) => v + 1)}
                      />
                    )}
                  </div>
                  {rulesLoading &&
                    (rulesSnapshot.current ? (
                      <LoadingStatus>{label('rulesLoading')}</LoadingStatus>
                    ) : (
                      <RecordListSkeleton label={label('rulesLoading')} view="card" headings={[]} />
                    ))}
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
                  {rulesStale && <Alert variant="destructive">{label('staleRules')}</Alert>}
                  {rulesUncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
                  {catalogueRootMessage(routingForm.errors) && (
                    <Alert variant="destructive">{catalogueRootMessage(routingForm.errors)}</Alert>
                  )}
                </div>
                <fieldset
                  disabled={!!action || pending || rulesStale || rulesUncertain}
                  hidden={rulesLoading && !rulesSnapshot.current}
                  className="min-w-0 divide-y"
                >
                  {STAFF_ASSIGNMENT_WORK_TYPES.map((type) => (
                    <div key={type} className="min-w-0 px-4 pb-2 pt-3 sm:px-6">
                      <fieldset
                        {...routingBinding(ruleField(type))}
                        className="min-w-0 space-y-1.5"
                      >
                        <legend className="mb-2 text-sm font-semibold">{label(type)}</legend>
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
                          number={numbers.number}
                          onChange={(rule) => updateRule(type, rule)}
                        >
                          <div className={recordEditorGrid}>
                            <div className={recordEditorField}>
                              <Label htmlFor={`team-${type}`}>{label('team')}</Label>
                              <NativeSelect
                                id={`team-${type}`}
                                {...routingForm.bind(`${ruleField(type)}.teamId`)}
                                aria-invalid={
                                  routingForm.form.getFieldState(ruleField(type)).invalid ||
                                  undefined
                                }
                                aria-describedby={routingForm.errorId(ruleField(type))}
                                className="w-full"
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
                                  ) && (
                                    <option value={rules[type].teamId!}>
                                      {label('unavailable')}
                                    </option>
                                  )}
                              </NativeSelect>
                            </div>
                            {rules[type].teamId && (
                              <div className={recordEditorField}>
                                <Label htmlFor={`strategy-${type}`}>{label('strategy')}</Label>
                                <NativeSelect
                                  id={`strategy-${type}`}
                                  aria-invalid={
                                    routingForm.form.getFieldState(ruleField(type)).invalid ||
                                    undefined
                                  }
                                  aria-describedby={routingForm.errorId(ruleField(type))}
                                  className="w-full"
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
                                </NativeSelect>
                              </div>
                            )}
                          </div>
                        </AssignmentFallbackEditor>
                        {feedback('rules', ruleField(type))}
                      </fieldset>
                    </div>
                  ))}
                </fieldset>
                <StickyRecordEditorActions>
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
                  <CatalogueSaveButton
                    label={label(routingForm.pending ? 'working' : 'saveRules')}
                    pending={routingForm.pending}
                    disabled={disabled || !live.current.rulesReady}
                  />
                </StickyRecordEditorActions>
              </form>
            )}
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
                : !live.current.teamReady)
          }
          onClose={() => {
            if (actionGeneration === workGeneration.current) clearAction();
          }}
          onDenied={() => {
            if (actionGeneration === workGeneration.current) denyAccess();
          }}
          onPendingChange={(value) => {
            if (actionGeneration === workGeneration.current) setWritePending(value);
          }}
          onUnconfirmed={() => {
            if (actionGeneration === workGeneration.current) holdUnconfirmed(action);
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
                disabled={
                  writePending ||
                  (action.path.includes('/assignment-rules') ? rulesLoading : loading)
                }
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
                holdUnconfirmed(action, true);
                throw new Error('Unverified staff-team acknowledgement');
              }
              if (mode === 'edit' && action.method === 'PUT') {
                const receipt = result as Team;
                editedTeam.current = receipt;
                resetTeam(teamValues(receipt));
                setTeamStale(false);
              } else if (
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
                if (mode === 'create') setCreatedTeam(receipt);
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
                holdUnconfirmed(action, true);
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
