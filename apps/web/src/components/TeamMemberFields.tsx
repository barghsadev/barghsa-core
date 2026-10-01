import { useState } from 'react';
import { Avatar, AvatarFallback, Button } from '@barghsa/ui';
import { Crown } from 'lucide-react';
import { t } from '@barghsa/i18n/team';
import { useLocale } from '../hooks/useLocale.js';
import { maskDestination } from '../lib/mask-destination.js';
import { TEAM_ROLES, type TeamEntry, type TeamRole } from '../lib/team-catalogue.js';

export function teamMemberName(entry: TeamEntry, unnamed: string) {
  return entry.name?.trim() || (entry.username ? maskDestination(entry.username) : unnamed);
}
export function teamMemberLabel(entry: TeamEntry, unnamed: string) {
  const name = teamMemberName(entry, unnamed);
  return entry.name?.trim() && entry.username
    ? `${name} (${maskDestination(entry.username)})`
    : name;
}
export function TeamIdentity({ entry, owner = false }: { entry: TeamEntry; owner?: boolean }) {
  const locale = useLocale();
  const name = teamMemberName(entry, t('team.unnamed', locale));
  const contact = entry.username ? maskDestination(entry.username) : null;
  const initials = entry.name?.trim()
    ? entry.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => Array.from(part)[0])
        .join('')
    : Array.from(name)[0];
  return (
    <div className="flex min-w-40 items-start gap-2">
      <Avatar aria-hidden="true">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
        <h3 className="flex items-center gap-1 font-medium">
          {owner && <Crown className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          {entry.name?.trim() ? name : <bdi dir="ltr">{name}</bdi>}
        </h3>
        {entry.name?.trim() && contact && (
          <p className="text-muted-foreground">
            <bdi dir="ltr">{contact}</bdi>
          </p>
        )}
      </div>
    </div>
  );
}
export function useTeamRoleDraft(roles: string[]) {
  const basis = [...roles].sort().join(',');
  const [draft, setDraft] = useState({
    basis,
    roles: roles.filter((role): role is TeamRole => TEAM_ROLES.includes(role as TeamRole)),
  });
  return {
    selected: draft.roles,
    stale: draft.basis !== basis,
    unchanged:
      draft.roles.length === roles.length && draft.roles.every((role) => roles.includes(role)),
    toggle: (role: TeamRole, checked: boolean) =>
      setDraft((current) => ({
        ...current,
        roles: checked ? [...current.roles, role] : current.roles.filter((item) => item !== role),
      })),
    reset: () =>
      setDraft({
        basis,
        roles: roles.filter((role): role is TeamRole => TEAM_ROLES.includes(role as TeamRole)),
      }),
    confirm: () => setDraft({ basis: [...draft.roles].sort().join(','), roles: draft.roles }),
  };
}
export function TeamRoleFields({
  draft,
  locked,
  canCommand,
}: {
  draft: ReturnType<typeof useTeamRoleDraft>;
  locked: boolean;
  canCommand: boolean;
}) {
  const locale = useLocale(),
    word = (key: string) => t(`team.${key}`, locale);
  return (
    <>
      <fieldset disabled={locked} className="flex flex-wrap gap-3">
        <legend className="sr-only">{word('roles')}</legend>
        {TEAM_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2">
            <input
              type="checkbox"
              tabIndex={0}
              checked={draft.selected.includes(role)}
              onChange={(event) => draft.toggle(role, event.target.checked)}
            />
            {word(role)}
          </label>
        ))}
      </fieldset>
      {draft.stale && (
        <div className="space-y-2">
          <p role="status">{word('staleRoles')}</p>
          <Button variant="outline" disabled={!canCommand || locked} onClick={draft.reset}>
            {word('resetRoles')}
          </Button>
        </div>
      )}
    </>
  );
}
