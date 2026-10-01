import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { Button, Label, ListPage, ScrollArea } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  groupPermissions,
  validEffective,
  type EffectivePermissions,
} from '../lib/staff-permissions.js';
import { EffectivePermissionsView } from '../components/EffectivePermissionsView.js';

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

export default function AdminRolesPage({ queries }: { queries?: ListQueryBinding } = {}) {
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
  const [forbidden, setForbidden] = useState(false);
  const catalogueRequest = useRef<AbortController | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);

  const [localModule, setModule] = useState('');
  const module = queries ? queries.query.filters.module : localModule;
  const catalogueGroups = groupPermissions([
    ...new Set(
      roles?.flatMap((role) => role.permissions).filter((permission) => permission !== '*') ?? []
    ),
  ]);
  const selectedGroup = catalogueGroups.find((group) => group.group === module);
  const [staffUserId, setStaffUserId] = useState('');
  const [effective, setEffective] = useState<EffectivePermissions | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  const deny = useCallback(() => {
    catalogueRequest.current?.abort();
    lookupRequest.current?.abort();
    setForbidden(true);
    setRoles(null);
    setStaffUserId('');
    setModule('');
    setEffective(null);
    setPermError(null);
    setPermLoading(false);
    setIsError(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const request = new AbortController();
    catalogueRequest.current = request;
    setForbidden(false);
    setIsLoading(true);
    setIsError(false);
    void (async () => {
      try {
        const res = await fetch('/api/admin/roles', { signal: request.signal });
        if (request.signal.aborted) return;
        if (res.status === 401 || res.status === 403) {
          deny();
          return;
        }
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
  }, [reload, deny]);

  useEffect(() => () => lookupRequest.current?.abort(), []);

  const lookupEffective = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const id = staffUserId.trim();
      if (!id || forbidden || isLoading || isError || !roles) return;
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
        if (request.signal.aborted) return;
        if (res.status === 401 || res.status === 403) {
          deny();
          return;
        }
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
    [staffUserId, forbidden, isLoading, isError, roles, deny]
  );

  return (
    <div className="min-w-0 space-y-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{t('admin.roles.title', locale)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.roles.subtitle', locale)}</p>
      </header>

      <ListPage>
        <ListPage.Toolbar>
          {!forbidden && roles && (
            <div className="space-y-1">
              <Label htmlFor="role-module">{t('admin.roles.compare.module', locale)}</Label>
              <select
                id="role-module"
                className="block w-full rounded border bg-background px-3 py-2 text-sm"
                value={selectedGroup?.group ?? ''}
                onChange={(event) =>
                  queries
                    ? queries.setQuery({ filters: { module: event.target.value } })
                    : setModule(event.target.value)
                }
              >
                <option value="">{t('admin.roles.compare.all', locale)}</option>
                {catalogueGroups.map((group) => (
                  <option key={group.group} value={group.group}>
                    {groupName(group.group)}
                  </option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground">
                {t('admin.roles.compare.help', locale)}
              </p>
            </div>
          )}

          <Button variant="outline" disabled={isLoading} onClick={() => setReload((v) => v + 1)}>
            {t('admin.jobs.refresh', locale)}
          </Button>
        </ListPage.Toolbar>
        {forbidden ? (
          <p role="alert">{t('admin.roles.forbidden', locale)}</p>
        ) : (
          <>
            <ListPage.Content
              loading={isLoading}
              error={isError}
              empty={roles?.length === 0}
              retainContent={roles !== null && roles.length > 0}
              loadingView={<p role="status">{t('common.loading', locale)}</p>}
              errorView={
                <div role="alert" className="space-y-2">
                  <p>{t('admin.roles.load.failed', locale)}</p>
                  <Button onClick={() => setReload((v) => v + 1)}>
                    {t('admin.roles.retry', locale)}
                  </Button>
                </div>
              }
              emptyView={<p>{t('admin.roles.empty', locale)}</p>}
            >
              <ScrollArea
                scrollbarOrientation="horizontal"
                role="region"
                aria-label={t('admin.roles.catalogue', locale)}
                className="max-w-full min-w-0 rounded-lg border bg-card"
              >
                <table className="w-full min-w-[44rem] divide-y divide-border">
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
                    {roles?.map((role) => {
                      const groups = selectedGroup
                        ? [selectedGroup]
                        : groupPermissions(role.permissions);
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
                            {groups.length === 0 ? (
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
                                              checked={
                                                role.permissions.includes('*') ||
                                                role.permissions.includes(p)
                                              }
                                              disabled
                                              className="mt-0.5 shrink-0"
                                            />
                                            <bdi dir="ltr" className="font-mono break-all">
                                              {p === '*'
                                                ? t('admin.roles.all.permissions', locale)
                                                : p}
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
              </ScrollArea>
            </ListPage.Content>

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
                  disabled={permLoading || isLoading || isError || !roles || !staffUserId.trim()}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {permLoading
                    ? t('common.loading', locale)
                    : t('admin.roles.effective.lookup', locale)}
                </button>
              </form>

              {permError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {t(permError, locale)}
                </p>
              )}

              {effective && <EffectivePermissionsView data={effective} />}
            </section>
          </>
        )}
      </ListPage>
    </div>
  );
}
