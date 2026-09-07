import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { StaffPermissionHistory } from '../components/StaffPermissionHistory.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

interface Access {
  userId: string;
  canView: boolean;
  canCreate: boolean;
  canEditRoles: boolean;
  canDisable: boolean;
}
interface Role {
  roleId: string;
  name: string;
  description: string;
}
interface Staff {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  roles: Role[];
  status: 'active' | 'disabled';
  activationPending: boolean;
  activationExpiresAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
}
interface StaffList {
  items: Staff[];
  total: number;
}
const blank = () => ({
  username: '',
  firstName: '',
  lastName: '',
  roleIds: [] as string[],
  activationMethod: 'link' as 'link' | 'tempPassword',
});

export default function AdminStaffUsersPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.staff.${key}`, locale);
  const [access, setAccess] = useState<Access | null>(null),
    [roles, setRoles] = useState<Role[]>([]);
  const [list, setList] = useState<StaffList>({ items: [], total: 0 });
  const [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [draft, setDraft] = useState(blank),
    [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null),
    [roleIds, setRoleIds] = useState<string[]>([]),
    [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [created, setCreated] = useState<{ username: string; password?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [activationNotice, setActivationNotice] = useState(false);
  const [history, setHistory] = useState<{ userId: string; username: string } | 'all' | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/admin/staff-access');
      if (!response.ok) throw new Error('Unavailable');
      const nextAccess = (await response.json()) as Access;
      const [staffResponse, rolesResponse] = await Promise.all([
        nextAccess.canView ? fetch(`/api/admin/staff?limit=25&offset=${offset}`) : null,
        nextAccess.canEditRoles ? fetch('/api/admin/roles') : null,
      ]);
      if ((staffResponse && !staffResponse.ok) || (rolesResponse && !rolesResponse.ok))
        throw new Error('Unavailable');
      const [nextList, nextRoles] = await Promise.all([
        staffResponse ? staffResponse.json() : { items: [], total: 0 },
        rolesResponse ? rolesResponse.json() : [],
      ]);
      if (generation.current !== current) return;
      setAccess(nextAccess);
      setList(nextList);
      setRoles(nextRoles);
    } catch {
      if (generation.current === current) setError(true);
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [offset]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  const roleText = (role: Role, field: 'name' | 'description') => {
    const key = `admin.staff.role.${role.roleId}.${field}`;
    const translated = t(key, locale);
    return translated === key ? role[field] : translated;
  };
  const roleSummary = (ids: string[]) =>
    ids
      .map((id) => {
        const role = roles.find((item) => item.roleId === id);
        return role ? roleText(role, 'name') : id;
      })
      .join(', ') || label('noRoles');
  const disabled = loading || error || !!action;
  const name = (staff: Staff) =>
    [staff.firstName, staff.lastName].filter(Boolean).join(' ') || staff.username;
  const selectRoles = (selected: string[], change: (value: string[]) => void) => (
    <fieldset className="space-y-2">
      <legend className="font-medium">{label('roles')}</legend>
      {roles.map((role) => (
        <label key={role.roleId} className="flex items-start gap-2 rounded border p-3">
          <input
            type="checkbox"
            checked={selected.includes(role.roleId)}
            onChange={(event) =>
              change(
                event.target.checked
                  ? [...selected, role.roleId]
                  : selected.filter((id) => id !== role.roleId)
              )
            }
          />
          <span>
            <span className="block font-medium">{roleText(role, 'name')}</span>
            <span className="text-sm text-gray-600">{roleText(role, 'description')}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <section className="mx-auto max-w-5xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="mt-2 text-sm text-gray-600">{label('description')}</p>
        </div>
        {access?.canView && (
          <Button variant="outline" disabled={disabled} onClick={() => setHistory('all')}>
            {label('audit.title')}
          </Button>
        )}
        {access?.canCreate && (
          <Button
            disabled={disabled}
            onClick={() => {
              setShowCreate(true);
              setEditing(null);
              setCreated(null);
              setSaved(false);
            }}
          >
            {label('create')}
          </Button>
        )}
      </header>
      {saved && <p role="status">{label('saved')}</p>}
      {activationNotice && <p role="status">{label('linkQueued')}</p>}
      {created && (
        <section className="space-y-3 rounded-lg border bg-white p-4" aria-label={label('created')}>
          <h2 className="font-semibold">{label('created')}</h2>
          <p dir="ltr">{created.username}</p>
          {created.password ? (
            <>
              <p>{label('passwordOnce')}</p>
              <Label htmlFor="staff-created-password">{label('temporaryPassword')}</Label>
              <Input
                id="staff-created-password"
                readOnly
                value={created.password}
                dir="ltr"
                autoComplete="off"
              />
            </>
          ) : (
            <p role="status">{label('linkQueued')}</p>
          )}
          <Button variant="outline" onClick={() => setCreated(null)}>
            {label('dismiss')}
          </Button>
        </section>
      )}
      {loading ? (
        <p role="status">{label('loading')}</p>
      ) : error ? (
        <div role="alert">
          {label('error')}{' '}
          <Button variant="outline" onClick={() => void load()}>
            {label('retry')}
          </Button>
        </div>
      ) : (
        <>
          {!access?.canView && <p role="status">{label('forbidden')}</p>}
          {access?.canView && (
            <>
              <div className="overflow-x-auto rounded border bg-white">
                <table className="w-full text-sm text-start">
                  <caption className="sr-only">{label('title')}</caption>
                  <thead>
                    <tr>
                      {['name', 'username', 'roles', 'status', 'lastLogin', 'actions'].map(
                        (key) => (
                          <th key={key} scope="col" className="p-3 text-start">
                            {label(key)}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((staff) => (
                      <tr key={staff.userId} className="border-t">
                        <th scope="row" className="p-3 text-start font-medium">
                          {name(staff)}
                        </th>
                        <td className="p-3" dir="ltr">
                          {staff.username}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {staff.isAdmin && (
                              <span className="rounded bg-gray-100 px-2 py-1">
                                {label('administrator')}
                              </span>
                            )}
                            {staff.roles.map((role) => (
                              <span key={role.roleId} className="rounded bg-gray-100 px-2 py-1">
                                {roleText(role, 'name')}
                              </span>
                            ))}
                            {!staff.isAdmin && !staff.roles.length && label('noRoles')}
                          </div>
                        </td>
                        <td className="p-3">
                          {label(staff.status)}
                          {staff.activationPending && (
                            <p className="text-xs">
                              {label('activationPending')}
                              {staff.activationExpiresAt && (
                                <>
                                  {' '}
                                  · {label('expires')}: {time.format(staff.activationExpiresAt)}
                                </>
                              )}
                            </p>
                          )}
                        </td>
                        <td className="p-3">
                          {staff.lastLoginAt ? time.format(staff.lastLoginAt) : label('never')}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() =>
                                setHistory({ userId: staff.userId, username: staff.username })
                              }
                            >
                              {label('audit.title')}
                            </Button>
                            {access.canCreate &&
                              staff.activationPending &&
                              staff.status === 'active' && (
                                <Button
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => {
                                    setActivationNotice(false);
                                    setSaved(false);
                                    setAction({
                                      title: label('resendActivation'),
                                      description: `${staff.username}. ${label('resendHelp')}`,
                                      path: `/api/admin/users/${encodeURIComponent(staff.userId)}/resend-activation`,
                                      method: 'POST',
                                      forbiddenMessage: label('forbidden'),
                                      conflictMessage: label('activationNotPending'),
                                      errorMessages: {
                                        'AUTH:DELIVERY:UNAVAILABLE': label('deliveryUnavailable'),
                                      },
                                    });
                                  }}
                                >
                                  {label('resendActivation')}
                                </Button>
                              )}
                            {access.canEditRoles && (
                              <Button
                                variant="outline"
                                disabled={disabled}
                                onClick={() => {
                                  setEditing(staff);
                                  setRoleIds(staff.roles.map((role) => role.roleId));
                                  setReason('');
                                  setShowCreate(false);
                                  setSaved(false);
                                }}
                              >
                                {label('editRoles')}
                              </Button>
                            )}
                            {access.canDisable && staff.status === 'active' && (
                              <Button
                                variant="outline"
                                disabled={disabled || staff.userId === access.userId}
                                onClick={() => {
                                  setSaved(false);
                                  setAction({
                                    title: label('disable'),
                                    description: `${name(staff)} (${staff.username}). ${label('disableHelp')}`,
                                    path: `/api/admin/staff/${encodeURIComponent(staff.userId)}/disable`,
                                    method: 'POST',
                                    forbiddenMessage: label('forbidden'),
                                    conflictMessage: label('conflict'),
                                  });
                                }}
                              >
                                {label('disable')}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!list.items.length && <p>{label('empty')}</p>}
              <nav aria-label={label('pages')} className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={disabled || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 25))}
                >
                  {label('previous')}
                </Button>
                <span>{label('total').replace('{count}', numbers.number(list.total))}</span>
                <Button
                  variant="outline"
                  disabled={disabled || offset + 25 >= list.total}
                  onClick={() => setOffset(offset + 25)}
                >
                  {label('next')}
                </Button>
              </nav>
            </>
          )}
          {history && access?.canView && (
            <StaffPermissionHistory
              key={history === 'all' ? 'all' : history.userId}
              target={history === 'all' ? null : history}
              onClose={() => setHistory(null)}
            />
          )}
          {showCreate && access?.canCreate && (
            <form
              className="space-y-4 rounded-lg border bg-white p-4"
              onSubmit={(event) => {
                event.preventDefault();
                setSaved(false);
                setCreated(null);
                setAction({
                  title: label('create'),
                  description: `${draft.firstName} ${draft.lastName} (${draft.username}). ${label('roles')}: ${roleSummary(draft.roleIds)}. ${label(draft.activationMethod === 'link' ? 'linkHelp' : 'passwordOnce')}`,
                  path: '/api/admin/users/create-staff',
                  method: 'POST',
                  body: {
                    ...draft,
                    username: draft.username.trim().toLowerCase(),
                    firstName: draft.firstName.trim(),
                    lastName: draft.lastName.trim(),
                    roleIds: [...draft.roleIds],
                  },
                  conflictMessage: label('usernameTaken'),
                  forbiddenMessage: label('forbidden'),
                  errorMessages: { 'AUTH:DELIVERY:UNAVAILABLE': label('deliveryUnavailable') },
                });
              }}
            >
              <h2 className="text-lg font-semibold">{label('create')}</h2>
              <fieldset disabled={disabled} className="space-y-4">
                {(['username', 'firstName', 'lastName'] as const).map((field) => (
                  <div key={field}>
                    <Label htmlFor={`staff-${field}`}>{label(field)}</Label>
                    <Input
                      id={`staff-${field}`}
                      required
                      maxLength={field === 'username' ? 254 : 100}
                      value={draft[field]}
                      dir={field === 'username' ? 'ltr' : undefined}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                    />
                  </div>
                ))}
                {access.canEditRoles ? (
                  selectRoles(draft.roleIds, (value) => setDraft({ ...draft, roleIds: value }))
                ) : (
                  <p>{label('noInitialRoles')}</p>
                )}
                <fieldset className="space-y-2">
                  <legend>{label('activation')}</legend>
                  {(['link', 'tempPassword'] as const).map((method) => (
                    <label key={method} className="flex gap-2">
                      <input
                        type="radio"
                        name="staff-activation"
                        value={method}
                        checked={draft.activationMethod === method}
                        onChange={() => setDraft({ ...draft, activationMethod: method })}
                      />
                      {label(method)}
                    </label>
                  ))}
                </fieldset>
                {draft.activationMethod === 'link' && (
                  <p className="text-sm">{label('linkHelp')}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      !draft.username.trim() ||
                      !draft.firstName.trim() ||
                      !draft.lastName.trim() ||
                      (draft.activationMethod === 'link' && !draft.username.includes('@'))
                    }
                  >
                    {label('create')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreate(false);
                      setDraft(blank());
                    }}
                  >
                    {label('cancel')}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          {editing && access?.canEditRoles && (
            <form
              className="space-y-4 rounded-lg border bg-white p-4"
              onSubmit={(event) => {
                event.preventDefault();
                setAction({
                  title: label('editRoles'),
                  description: `${name(editing)} (${editing.username}). ${label('roles')}: ${roleSummary(roleIds)}. ${label('reason')}: ${reason.trim()}. ${label('rolesHelp')}`,
                  path: `/api/admin/users/${encodeURIComponent(editing.userId)}/roles`,
                  method: 'PUT',
                  body: { roleIds: [...roleIds], reason: reason.trim() },
                  signsOut: editing.userId === access.userId,
                  forbiddenMessage: label('forbidden'),
                });
              }}
            >
              <h2 className="text-lg font-semibold">
                {label('editRoles')}: {name(editing)}
              </h2>
              <fieldset disabled={disabled} className="space-y-4">
                {selectRoles(roleIds, setRoleIds)}
                <p>{label('rolesHelp')}</p>
                <Label htmlFor="staff-role-reason">{label('reason')}</Label>
                <Input
                  id="staff-role-reason"
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={!reason.trim()}>
                    {label('saveRoles')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    {label('cancel')}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (action.path === '/api/admin/users/create-staff') {
              const data = result as { username: string; temporaryPassword?: string };
              setCreated({
                username: data.username,
                ...(data.temporaryPassword ? { password: data.temporaryPassword } : {}),
              });
              setDraft(blank());
              setShowCreate(false);
            }
            if (action.path.endsWith('/resend-activation')) setActivationNotice(true);
            setEditing(null);
            setSaved(true);
            await load();
          }}
        />
      )}
    </section>
  );
}
