import { useState } from 'react';
import { z } from 'zod';
import { FormField, type UseFormReturn } from '@barghsa/ui/form';
import { Avatar, AvatarFallback, Button } from '@barghsa/ui';
import { Crown } from 'lucide-react';
import { t } from '@barghsa/i18n/team';
import { useLocale } from '../hooks/useLocale.js';
import { maskDestination } from '../lib/mask-destination.js';
import { TEAM_ROLES, type TeamEntry, type TeamRole } from '../lib/team-catalogue.js';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';

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
type RoleValues = { roles: TeamRole[] };
interface TeamRoleDraft {
  form: UseFormReturn<RoleValues>;
  errors: UseFormReturn<RoleValues>['formState']['errors'];
  errorId: (name: 'roles') => string;
  selected: TeamRole[];
  onValidationError: (fields: unknown[]) => boolean;
  stale: boolean;
  unchanged: boolean;
  toggle: (role: TeamRole, checked: boolean) => void;
  reset: () => void;
  confirm: () => void;
}
export function useTeamRoleDraft(roles: string[]): TeamRoleDraft {
  const locale = useLocale();
  const basis = [...roles].sort().join(',');
  const [draftBasis, setDraftBasis] = useState(basis);
  const draft = useDraftForm(
    z.object({
      roles: z
        .array(z.enum(TEAM_ROLES))
        .min(1, t('team.invalidRoles', locale))
        .max(3, t('team.invalidRoles', locale))
        .refine((value) => new Set(value).size === value.length, t('team.invalidRoles', locale)),
    }),
    {
      roles: roles.filter((role): role is TeamRole => TEAM_ROLES.includes(role as TeamRole)),
    }
  );
  const selected = draft.values.roles;
  const onValidationError = useActionFieldErrors(
    draft.form,
    {
      roles: t('team.invalidRoles', locale),
    },
    t('team.error', locale)
  );
  return {
    form: draft.form,
    errors: draft.errors,
    errorId: draft.errorId,
    selected,
    onValidationError,
    stale: draftBasis !== basis,
    unchanged: selected.length === roles.length && selected.every((role) => roles.includes(role)),
    toggle: (role: TeamRole, checked: boolean) =>
      draft.form.setValue(
        'roles',
        checked ? [...new Set([...selected, role])] : selected.filter((item) => item !== role),
        { shouldDirty: true, shouldTouch: true, shouldValidate: true }
      ),
    reset: () => {
      setDraftBasis(basis);
      draft.form.reset({
        roles: roles.filter((role): role is TeamRole => TEAM_ROLES.includes(role as TeamRole)),
      });
    },
    confirm: () => {
      setDraftBasis([...selected].sort().join(','));
      draft.form.reset({ roles: selected });
    },
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
      <FormField
        control={draft.form.control}
        name="roles"
        render={({ field }) => (
          <fieldset
            disabled={locked || draft.form.formState.isSubmitting}
            className="flex flex-wrap gap-3"
            aria-invalid={!!draft.errors.roles || undefined}
            aria-describedby={draft.errors.roles ? draft.errorId('roles') : undefined}
          >
            <legend className="sr-only">{word('roles')}</legend>
            {TEAM_ROLES.map((role, index) => (
              <label key={role} className="flex items-center gap-2">
                <input
                  ref={index === 0 ? field.ref : undefined}
                  name={field.name}
                  onBlur={field.onBlur}
                  aria-invalid={!!draft.errors.roles || undefined}
                  aria-describedby={draft.errors.roles ? draft.errorId('roles') : undefined}
                  type="checkbox"
                  value={role}
                  tabIndex={0}
                  checked={draft.selected.includes(role)}
                  onChange={(event) => draft.toggle(role, event.target.checked)}
                />
                {word(role)}
              </label>
            ))}
          </fieldset>
        )}
      />
      {draft.errors.roles && (
        <p id={draft.errorId('roles')} role="alert" className="text-sm text-destructive">
          {draft.errors.roles.message}
        </p>
      )}
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
