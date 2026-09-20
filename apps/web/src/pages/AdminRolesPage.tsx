import { useEffect, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';

/**
 * Staff role management page (T-09.05.01).
 *
 * Displays the predefined staff roles with their permission sets grouped by
 * module. Predefined roles are read-only (custom role creation is a future
 * extension). Also provides a staff-user lookup to view effective permissions.
 */

interface StaffRole {
  roleId: string;
  name: string;
  description: string;
  permissions: string[];
  predefined: boolean;
}

interface EffectivePermissions {
  userId: string;
  isAdmin: boolean;
  roleIds: string[];
  roleNames: string[];
  permissions: { permission: string; group: string }[];
  isWildcard: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validRoles(value: unknown): value is StaffRole[] {
  return (
    Array.isArray(value) &&
    value.every(
      (role) =>
        record(role) &&
        typeof role.roleId === 'string' &&
        role.roleId.trim() !== '' &&
        typeof role.name === 'string' &&
        typeof role.description === 'string' &&
        typeof role.predefined === 'boolean' &&
        strings(role.permissions)
    )
  );
}

function validEffective(value: unknown, userId: string): value is EffectivePermissions {
  return (
    record(value) &&
    value.userId === userId &&
    typeof value.isAdmin === 'boolean' &&
    typeof value.isWildcard === 'boolean' &&
    strings(value.roleIds) &&
    strings(value.roleNames) &&
    Array.isArray(value.permissions) &&
    value.permissions.every(
      (item) =>
        record(item) && typeof item.permission === 'string' && typeof item.group === 'string'
    )
  );
}

/** Permission groups ordered for stable display. */
const GROUP_ORDER = [
  'admin',
  'users',
  'profiles',
  'tickets',
  'crm',
  'verification',
  'finance',
  'invoices',
  'payments',
  'reports',
  'legal',
  'contracts',
  'compliance',
  'operations',
  'orders',
  'scheduling',
  'config',
  'staff',
];

/** Group permissions by their prefix (module). */
function groupPermissions(permissions: string[]): { group: string; permissions: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of permissions) {
    const group = p.split(':')[0] ?? 'other';
    const list = map.get(group) ?? [];
    list.push(p);
    map.set(group, list);
  }
  const groups = [...map.entries()].map(([group, perms]) => ({
    group,
    permissions: perms.sort(),
  }));
  const sorted = groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.group);
    const ib = GROUP_ORDER.indexOf(b.group);
    if (ia === -1 && ib === -1) return a.group.localeCompare(b.group);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return sorted;
}

export default function AdminRolesPage() {
  const locale = useLocale();
  const roleText = (id: string, field: 'name' | 'description', fallback: string) => {
    const key = `admin.staff.role.${id}.${field}`;
    const translated = t(key, locale);
    return translated === key ? fallback : translated;
  };
  const groupName = (group: string) => {
    const key = `admin.roles.group.${group}`;
    const translated = t(key, locale);
    return translated === key ? group : translated;
  };
  const [roles, setRoles] = useState<StaffRole[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [reload, setReload] = useState(0);
  const lookupRequest = useRef<AbortController | null>(null);

  const [staffUserId, setStaffUserId] = useState('');
  const [effective, setEffective] = useState<EffectivePermissions | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  useEffect(() => {
    const request = new AbortController();
    setIsLoading(true);
    setIsError(false);
    void (async () => {
      try {
        const res = await fetch('/api/admin/roles', { signal: request.signal });
        if (!res.ok) throw new Error('roles');
        const json: unknown = await res.json();
        if (!validRoles(json)) throw new Error('roles');
        if (!request.signal.aborted) setRoles(json);
      } catch {
        if (!request.signal.aborted) setIsError(true);
      } finally {
        if (!request.signal.aborted) setIsLoading(false);
      }
    })();
    return () => request.abort();
  }, [reload]);

  useEffect(() => () => lookupRequest.current?.abort(), []);

  const lookupEffective = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const id = staffUserId.trim();
      if (!id) return;
      lookupRequest.current?.abort();
      const request = new AbortController();
      lookupRequest.current = request;
      setPermLoading(true);
      setPermError(null);
      setEffective(null);
      let failureKey = 'admin.roles.user.lookup.failed';
      try {
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(id)}/effective-permissions`,
          {
            signal: request.signal,
          }
        );
        if (!res.ok) {
          if (res.status === 404) failureKey = 'admin.roles.user.notfound';
          throw new Error('permissions');
        }
        const json: unknown = await res.json();
        if (!validEffective(json, id)) throw new Error('permissions');
        if (!request.signal.aborted) setEffective(json);
      } catch {
        if (!request.signal.aborted) setPermError(failureKey);
      } finally {
        if (!request.signal.aborted) setPermLoading(false);
      }
    },
    [staffUserId]
  );

  if (isLoading) {
    return (
      <div role="status" className="p-6 text-muted-foreground">
        {t('common.loading', locale)}
      </div>
    );
  }

  if (isError || !roles) {
    return (
      <div className="p-6 space-y-3">
        <p role="alert" className="text-destructive">
          {t('admin.roles.load.failed', locale)}
        </p>
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="rounded-md border px-3 py-2"
        >
          {t('admin.roles.retry', locale)}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{t('admin.roles.title', locale)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.roles.subtitle', locale)}</p>
      </header>

      {/* Roles table */}
      <section className="bg-card rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-start text-xs font-semibold">
                  {t('admin.roles.role', locale)}
                </th>
                <th scope="col" className="px-4 py-3 text-start text-xs font-semibold">
                  {t('admin.roles.permissions', locale)}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => {
                const groups = groupPermissions(role.permissions);
                return (
                  <tr key={role.roleId}>
                    <th scope="row" className="px-4 py-4 align-top text-start font-normal">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {roleText(role.roleId, 'name', role.name)}
                        </span>
                        {role.predefined && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted">
                            {t('admin.roles.predefined', locale)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {roleText(role.roleId, 'description', role.description)}
                      </p>
                    </th>
                    <td className="px-4 py-4">
                      {role.permissions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t('admin.roles.no.permissions', locale)}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                          {groups.map((g) => (
                            <fieldset key={g.group}>
                              <legend className="text-xs font-semibold text-muted-foreground">
                                {groupName(g.group)}
                              </legend>
                              <ul className="mt-1 space-y-0.5">
                                {g.permissions.map((p) => (
                                  <li key={p} className="text-xs">
                                    <label className="flex items-start gap-2">
                                      <input
                                        type="checkbox"
                                        checked
                                        disabled
                                        className="mt-0.5 shrink-0"
                                      />
                                      <bdi dir="ltr" className="font-mono break-all">
                                        {p === '*' ? t('admin.roles.all.permissions', locale) : p}
                                      </bdi>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            </fieldset>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Effective permissions lookup */}
      <section className="bg-card rounded-lg shadow-sm border p-6">
        <h2 className="text-lg font-semibold">{t('admin.roles.effective.title', locale)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('admin.roles.effective.subtitle', locale)}
        </p>
        <form onSubmit={lookupEffective} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-0 max-w-md">
            <label htmlFor="staffUserId" className="block text-sm font-medium mb-1">
              {t('admin.roles.effective.userId', locale)}
            </label>
            <input
              id="staffUserId"
              type="text"
              value={staffUserId}
              onChange={(e) => {
                lookupRequest.current?.abort();
                setStaffUserId(e.target.value);
                setEffective(null);
                setPermError(null);
                setPermLoading(false);
              }}
              placeholder={t('admin.roles.effective.userId.placeholder', locale)}
              dir="ltr"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={permLoading || !staffUserId.trim()}
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {permLoading ? t('common.loading', locale) : t('admin.roles.effective.lookup', locale)}
          </button>
        </form>

        {permError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t(permError, locale)}
          </p>
        )}

        {effective && (
          <div className="mt-5 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <bdi dir="ltr" className="font-mono text-sm break-all">
                {effective.userId}
              </bdi>
              {effective.isAdmin && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted">
                  {t('admin.roles.effective.admin', locale)}
                </span>
              )}
            </div>
            {effective.roleNames.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('admin.roles.effective.roles', locale)}:{' '}
                {effective.roleIds
                  .map((id, index) => roleText(id, 'name', effective.roleNames[index] ?? id))
                  .join(locale === 'fa' ? '، ' : ', ')}
              </p>
            )}
            {effective.isWildcard ? (
              <p className="mt-3 text-sm">{t('admin.roles.effective.wildcard', locale)}</p>
            ) : effective.permissions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('admin.roles.effective.none', locale)}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {groupPermissions(effective.permissions.map((p) => p.permission)).map((g) => (
                  <div key={g.group}>
                    <div className="text-xs font-semibold text-muted-foreground">
                      {groupName(g.group)}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {g.permissions.map((p) => (
                        <li key={p} className="text-xs font-mono break-all">
                          <bdi dir="ltr">{p}</bdi>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
