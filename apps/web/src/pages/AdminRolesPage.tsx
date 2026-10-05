import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, DataTable, Label, ListPage, TextCell } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  groupPermissions,
  validEffective,
  type EffectivePermissions,
} from '../lib/staff-permissions.js';
import { EffectivePermissionsView } from '../components/EffectivePermissionsView.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';

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
  const { numberStyle } = useNumberFormatting(locale);
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
  const lookupForm = useWizardForm<{ staffUserId: string }>(
    async () =>
      (await import('../lib/staff-access-form-schemas.js')).staffLookupSchema(
        t('admin.roles.effective.invalidUserId', locale)
      ),
    () => ({ staffUserId: '' }),
    t('admin.roles.effective.validationUnavailable', locale)
  );
  const [staffUserId, setStaffUserId] = lookupForm.field('staffUserId');
  const lookupOwner = useRef<object | null>(null);
  const invalidFocus = useRef<string | null>(null);
  useEffect(() => {
    const value = invalidFocus.current;
    if (value === null || lookupForm.pending) return;
    invalidFocus.current = null;
    if (!lookupOwner.current && lookupForm.form.getValues('staffUserId') === value)
      lookupForm.form.setFocus('staffUserId');
  }, [lookupForm.pending, lookupForm.errors, lookupForm.form]);
  const [effective, setEffective] = useState<EffectivePermissions | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  const deny = useCallback(() => {
    catalogueRequest.current?.abort();
    lookupRequest.current?.abort();
    lookupOwner.current = null;
    setForbidden(true);
    setRoles(null);
    lookupForm.form.reset({ staffUserId: '' });
    setModule('');
    setEffective(null);
    setPermError(null);
    setPermLoading(false);
    setIsError(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    lookupRequest.current?.abort();
    lookupOwner.current = null;
    setPermLoading(false);
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
      if (lookupOwner.current || forbidden || isLoading || isError || !roles) return;
      const owner = {};
      lookupOwner.current = owner;
      lookupForm.setValidationPending(true);
      let valid = false;
      try {
        valid = await lookupForm.form.trigger();
      } finally {
        lookupForm.setValidationPending(false);
      }
      if (lookupOwner.current !== owner) return;
      if (!valid) {
        lookupOwner.current = null;
        invalidFocus.current = staffUserId;
        return;
      }
      const id = staffUserId.trim();
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
        if (lookupOwner.current === owner) lookupOwner.current = null;
        if (!request.signal.aborted) setPermLoading(false);
      }
    },
    [staffUserId, forbidden, isLoading, isError, roles, deny, lookupForm]
  );

  const roleIdentity = (role: StaffRole) => (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">
          <TextCell value={roleText(role.roleId, 'name', role.name)} />
        </h2>
        {role.predefined && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted">
            {t('admin.roles.predefined', locale)}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <TextCell value={roleText(role.roleId, 'description', role.description)} />
      </p>
    </div>
  );
  const rolePermissions = (role: StaffRole) => {
    const groups = selectedGroup ? [selectedGroup] : groupPermissions(role.permissions);
    return (
      <>
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
                          checked={role.permissions.includes('*') || role.permissions.includes(p)}
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
      </>
    );
  };
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
              <DataTable
                locale={locale}
                numerals={
                  numberStyle === 'western'
                    ? 'latn'
                    : numberStyle === 'persian'
                      ? 'arabext'
                      : locale === 'fa'
                        ? 'arabext'
                        : 'latn'
                }
                data={roles ?? []}
                keyExtractor={(role) => role.roleId}
                caption={t('admin.roles.catalogue', locale)}
                scrollLabel={t('admin.roles.catalogue', locale)}
                sortable={false}
                className="max-h-[32rem] bg-card"
                tableClassName="min-w-[44rem]"
                columns={[
                  {
                    id: 'role',
                    header: t('admin.roles.role', locale),
                    cell: roleIdentity,
                    rowHeader: true,
                    cellClassName: 'p-4 align-top',
                  },
                  {
                    id: 'permissions',
                    header: t('admin.roles.permissions', locale),
                    cell: rolePermissions,
                    cellClassName: 'p-4 align-top',
                  },
                ]}
                renderCard={(role) => (
                  <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
                    {roleIdentity(role)}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('admin.roles.permissions', locale)}
                      </p>
                      {rolePermissions(role)}
                    </div>
                  </div>
                )}
              />
            </ListPage.Content>

            {/* Effective permissions lookup */}
            <section className="bg-card rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold">{t('admin.roles.effective.title', locale)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('admin.roles.effective.subtitle', locale)}
              </p>
              <form
                noValidate
                onSubmit={lookupEffective}
                className="mt-4 flex flex-wrap items-end gap-3"
              >
                <div className="basis-full min-w-0 max-w-md sm:basis-0 sm:flex-1">
                  <label htmlFor="staffUserId" className="block text-sm font-medium mb-1">
                    {t('admin.roles.effective.userId', locale)}
                  </label>
                  <input
                    id="staffUserId"
                    {...lookupForm.bind('staffUserId')}
                    type="text"
                    disabled={lookupForm.pending}
                    value={staffUserId}
                    onChange={(e) => {
                      lookupRequest.current?.abort();
                      lookupOwner.current = null;
                      setStaffUserId(e.target.value);
                      setEffective(null);
                      setPermError(null);
                      setPermLoading(false);
                    }}
                    placeholder={t('admin.roles.effective.userId.placeholder', locale)}
                    dir="ltr"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <CatalogueFieldFeedback
                    id={lookupForm.errorId('staffUserId')}
                    error={lookupForm.errors.staffUserId}
                    message={t('admin.roles.effective.invalidUserId', locale)}
                  />
                </div>
                <CatalogueSaveButton
                  label={t('admin.roles.effective.lookup', locale)}
                  pending={lookupForm.pending || permLoading}
                  disabled={lookupForm.pending || permLoading || isLoading || isError || !roles}
                />
              </form>
              {catalogueRootMessage(lookupForm.errors) && (
                <Alert variant="destructive">{catalogueRootMessage(lookupForm.errors)}</Alert>
              )}

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
