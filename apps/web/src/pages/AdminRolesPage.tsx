import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { Check, ChevronDown, LoaderCircle, Minus, Search } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  LoadingStatus,
  Alert,
  Button,
  DataTable,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  TextCell,
  buttonVariants,
} from '@barghsa/ui';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  groupPermissions,
  validEffective,
  type EffectivePermissions,
} from '../lib/staff-permissions.js';
import { EffectivePermissionsView } from '../components/EffectivePermissionsView.js';
import { StaffAccountSearch, type StaffAccountOption } from '../components/StaffAccountSearch.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import {
  CatalogueFieldFeedback,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { recordEditorSurface } from '../components/RecordEditorLayout.js';

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

interface RolesPageProps {
  queries?: ListQueryBinding;
  variant?: 'catalogue' | 'compare' | 'effective';
  roleId?: string;
}

export default function AdminRolesPage({ queries, variant, roleId }: RolesPageProps = {}) {
  const compact = useCompactRecords();
  const read = useStaffQueryRead('profiles');
  const locale = useLocale();
  const { numberStyle, number } = useNumberFormatting(locale);
  const word = (key: string) => t(`admin.roles.${key}`, locale);
  const heading = useRef<HTMLHeadingElement>(null);
  const accountHeading = useRef<HTMLHeadingElement>(null);
  const standaloneLookup = variant === 'effective';
  const catalogue = variant === 'catalogue';
  const comparison = variant === 'compare' || (!variant && !roleId);
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
  const [isLoading, setIsLoading] = useState(!standaloneLookup);
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
  const selectedRole = roleId ? roles?.find((role) => role.roleId === roleId) : undefined;
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
  const [selectedAccount, setSelectedAccount] = useState<StaffAccountOption | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  useEffect(() => {
    if (effective && effective.userId === selectedAccount?.userId) accountHeading.current?.focus();
  }, [effective, selectedAccount]);

  const deny = useCallback(() => {
    catalogueRequest.current?.abort();
    lookupRequest.current?.abort();
    lookupOwner.current = null;
    setForbidden(true);
    setRoles(null);
    lookupForm.form.reset({ staffUserId: '' });
    setModule('');
    setEffective(null);
    setSelectedAccount(null);
    setPermError(null);
    setPermLoading(false);
    setIsError(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (standaloneLookup) return;
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
        const json = await read('/api/admin/roles', 'list', request.signal, staffQueryJson, reload);
        if (!validRoles(json)) throw new Error('roles');
        if (!request.signal.aborted) setRoles(json);
      } catch (failure) {
        if (!request.signal.aborted) {
          if (failure instanceof ServerQueryError && [401, 403].includes(failure.status)) deny();
          else setIsError(true);
        }
      } finally {
        if (!request.signal.aborted) setIsLoading(false);
      }
    })();
    return () => request.abort();
  }, [reload, deny, read, standaloneLookup]);

  useEffect(() => () => lookupRequest.current?.abort(), []);
  useEffect(() => {
    if (roleId || (variant && variant !== 'catalogue'))
      heading.current?.focus({ preventScroll: true });
  }, [roleId, variant]);

  const readEffective = useCallback(
    async (id: string, owner: object) => {
      lookupRequest.current?.abort();
      const request = new AbortController();
      lookupRequest.current = request;
      setPermLoading(true);
      setPermError(null);
      setEffective(null);
      try {
        const json = await read(
          `/api/admin/users/${encodeURIComponent(id)}/effective-permissions`,
          'detail',
          request.signal,
          staffQueryJson,
          reload
        );
        if (!validEffective(json, id)) throw new Error('permissions');
        if (!request.signal.aborted) setEffective(json);
      } catch (failure) {
        if (!request.signal.aborted) {
          const status = failure instanceof ServerQueryError ? failure.status : null;
          if (status === 401 || status === 403) deny();
          else
            setPermError(
              status === 404 ? 'admin.roles.user.notfound' : 'admin.roles.user.lookup.failed'
            );
        }
      } finally {
        if (lookupOwner.current === owner) lookupOwner.current = null;
        if (!request.signal.aborted) setPermLoading(false);
      }
    },
    [deny, read, reload]
  );

  const lookupEffective = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (lookupOwner.current || forbidden || isLoading || isError || (!roles && !standaloneLookup))
        return;
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
      setSelectedAccount(null);
      await readEffective(staffUserId.trim(), owner);
    },
    [staffUserId, forbidden, isLoading, isError, roles, lookupForm, readEffective, standaloneLookup]
  );

  function inspectAccount(account: StaffAccountOption) {
    if (lookupOwner.current || forbidden) return;
    const owner = {};
    lookupOwner.current = owner;
    setSelectedAccount(account);
    void readEffective(account.userId, owner);
  }

  const roleIdentity = (role: StaffRole) => (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="font-medium">
          {catalogue && !isLoading && !isError ? (
            <Link
              to="/admin/roles/$roleId"
              params={{ roleId: role.roleId }}
              className="touch-action text-primary underline underline-offset-4"
            >
              <TextCell value={roleText(role.roleId, 'name', role.name)} />
            </Link>
          ) : (
            <TextCell value={roleText(role.roleId, 'name', role.name)} />
          )}
        </h2>
        {role.predefined && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-muted">
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
              <fieldset key={g.group} className="min-w-0">
                <legend
                  className={
                    comparison && selectedGroup
                      ? 'sr-only'
                      : 'text-xs font-semibold text-muted-foreground'
                  }
                >
                  {groupName(g.group)}
                </legend>
                <ul className="mt-1 space-y-0.5">
                  {g.permissions.map((permission) => {
                    const granted =
                      role.permissions.includes('*') || role.permissions.includes(permission);
                    const label = permission === '*' ? word('all.permissions') : permission;
                    return (
                      <li key={permission} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={label}
                          checked={granted}
                          disabled
                          className={comparison ? 'sr-only' : 'mt-0.5 shrink-0'}
                        />
                        {comparison &&
                          (granted ? (
                            <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          ) : (
                            <Minus
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                          ))}
                        <bdi aria-hidden="true" dir="auto" className="font-mono wrap-anywhere">
                          {label}
                        </bdi>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        )}
      </>
    );
  };
  const roleCount = (role: StaffRole) => (
    <span className="text-sm font-medium">
      {role.permissions.includes('*')
        ? word('all.permissions')
        : number(new Set(role.permissions).size)}
    </span>
  );
  const idForm = (
    <form noValidate onSubmit={lookupEffective} className="max-w-xl space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor="staffUserId">{t('admin.roles.effective.userId', locale)}</Label>
        {standaloneLookup && (
          <Link
            to="/admin/users"
            search={{}}
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {t('admin.roles.effective.staffDirectory', locale)}
          </Link>
        )}
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
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
            setSelectedAccount(null);
            setPermError(null);
            setPermLoading(false);
          }}
          spellCheck={false}
          autoCapitalize="none"
          dir="ltr"
        />
        <Button
          type="submit"
          aria-busy={lookupForm.pending || permLoading || undefined}
          disabled={
            lookupForm.pending ||
            permLoading ||
            isLoading ||
            isError ||
            (!roles && !standaloneLookup)
          }
        >
          {lookupForm.pending || permLoading ? (
            <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Search aria-hidden="true" />
          )}
          {t('admin.roles.effective.lookup', locale)}
        </Button>
      </div>
      <CatalogueFieldFeedback
        compact
        id={lookupForm.errorId('staffUserId')}
        error={lookupForm.errors.staffUserId}
        message={t('admin.roles.effective.invalidUserId', locale)}
      />
    </form>
  );
  return (
    <div
      className={roleId || standaloneLookup ? 'mx-auto max-w-4xl space-y-6' : 'min-w-0 space-y-6'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-3">
        {(roleId || (variant && !catalogue)) && (
          <Link
            to="/admin/roles"
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {word('backToRoles')}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {variant === 'compare'
              ? word('compare.title')
              : standaloneLookup
                ? word('effective.title')
                : roleId
                  ? selectedRole
                    ? roleText(selectedRole.roleId, 'name', selectedRole.name)
                    : word('roleDetails')
                  : word('title')}
          </h1>
          {catalogue && (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/admin/roles/effective"
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              >
                {word('effective.title')}
              </Link>
              <Link to="/admin/roles/compare" className={buttonVariants({ className: 'min-h-11' })}>
                {word('compare.title')}
              </Link>
            </div>
          )}
        </div>
        {!roleId && !standaloneLookup && (
          <p
            id={comparison ? 'role-module-help' : undefined}
            className="text-sm text-muted-foreground"
          >
            {word(comparison ? 'compare.help' : 'subtitle')}
          </p>
        )}
      </header>

      <ListPage>
        {!standaloneLookup && (
          <ListPage.Toolbar>
            <div className={`flex w-full items-end gap-2 ${comparison ? 'max-w-sm' : ''}`}>
              {comparison && !forbidden && roles && (
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="role-module">{word('compare.module')}</Label>
                  <NativeSelect
                    id="role-module"
                    aria-describedby="role-module-help"
                    className="w-full"
                    value={selectedGroup?.group ?? ''}
                    onChange={(event) =>
                      queries
                        ? queries.setQuery({ filters: { module: event.target.value } })
                        : setModule(event.target.value)
                    }
                  >
                    <option value="">{word('compare.all')}</option>
                    {catalogueGroups.map((group) => (
                      <option key={group.group} value={group.group}>
                        {groupName(group.group)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <ListRefreshButton
                label={t('admin.jobs.refresh', locale)}
                refreshing={isLoading}
                className={comparison ? undefined : 'ms-auto'}
                onClick={() => setReload((v) => v + 1)}
              />
            </div>
            {selectedGroup && comparison && !forbidden && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:pb-3">
                <li className="flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-4 text-primary" />
                  {word('compare.granted')}
                </li>
                <li className="flex items-center gap-1.5">
                  <Minus aria-hidden="true" className="size-4" />
                  {word('compare.notGranted')}
                </li>
              </ul>
            )}
          </ListPage.Toolbar>
        )}
        {forbidden ? (
          <p role="alert">{t('admin.roles.forbidden', locale)}</p>
        ) : (
          <>
            {!standaloneLookup && (
              <ListPage.Content
                loading={isLoading}
                error={isError}
                empty={roleId ? !!roles && !selectedRole : roles?.length === 0}
                retainContent={roles !== null && roles.length > 0}
                loadingView={
                  roleId ? (
                    <RecordDetailSkeleton label={word('loading')} />
                  ) : (
                    <RecordListSkeleton
                      label={word('loading')}
                      view={compact ? 'card' : 'table'}
                      headings={[word('role'), word('permissions')]}
                    />
                  )
                }
                errorView={
                  <div role="alert" className="space-y-2">
                    <p>{t('admin.roles.load.failed', locale)}</p>
                    <Button onClick={() => setReload((v) => v + 1)}>
                      {t('admin.roles.retry', locale)}
                    </Button>
                  </div>
                }
                emptyView={<p>{word(roleId ? 'roleUnavailable' : 'empty')}</p>}
              >
                {roleId && selectedRole ? (
                  <section className="space-y-4 rounded-xl border bg-card p-5">
                    <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-4">
                      {selectedRole.predefined && (
                        <p className="text-sm font-medium text-muted-foreground">
                          {word('predefined')}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {roleText(selectedRole.roleId, 'description', selectedRole.description)}
                      </p>
                    </header>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold">{word('permissions')}</h2>
                      {roleCount(selectedRole)}
                    </div>
                    {rolePermissions(selectedRole)}
                  </section>
                ) : (
                  !roleId && (
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
                          header: selectedGroup
                            ? groupName(selectedGroup.group)
                            : word('permissions'),
                          cell: catalogue ? roleCount : rolePermissions,
                          cellClassName: 'p-4 align-top',
                        },
                      ]}
                      renderCard={(role) => (
                        <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
                          {roleIdentity(role)}
                          <div className="space-y-2">
                            {!comparison && (
                              <p className="text-sm font-medium text-muted-foreground">
                                {word('permissions')}
                              </p>
                            )}
                            {catalogue ? roleCount(role) : rolePermissions(role)}
                          </div>
                        </div>
                      )}
                    />
                  )
                )}
              </ListPage.Content>
            )}

            {/* Effective permissions lookup */}
            {((!variant && !roleId) || standaloneLookup) && (
              <section className={recordEditorSurface}>
                <div className="space-y-3 p-4 sm:p-5">
                  {!standaloneLookup && (
                    <h2 className="text-lg font-semibold">
                      {t('admin.roles.effective.title', locale)}
                    </h2>
                  )}
                  {!standaloneLookup && (
                    <p className="text-sm text-muted-foreground">
                      {t('admin.roles.effective.subtitle', locale)}
                    </p>
                  )}
                  {standaloneLookup ? (
                    <>
                      <StaffAccountSearch
                        copy={word}
                        disabled={lookupForm.pending || permLoading}
                        onSelect={inspectAccount}
                        onSessionEnded={deny}
                      />
                      <details className="group border-t pt-2">
                        <summary
                          data-permission-id-toggle
                          className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className="size-4 group-open:rotate-180"
                          />
                          {word('lookup.byId')}
                        </summary>
                        <div className="pt-2">{idForm}</div>
                      </details>
                    </>
                  ) : (
                    idForm
                  )}
                  {catalogueRootMessage(lookupForm.errors) && (
                    <Alert variant="destructive">{catalogueRootMessage(lookupForm.errors)}</Alert>
                  )}

                  {permError && !selectedAccount && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {t(permError, locale)}
                    </p>
                  )}

                  {(effective || selectedAccount) && (
                    <div className="space-y-3 border-t pt-4">
                      {selectedAccount && (
                        <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2 [overflow-wrap:anywhere]">
                          <p className="text-xs text-muted-foreground">{word('lookup.selected')}</p>
                          <h2
                            ref={accountHeading}
                            tabIndex={-1}
                            className="text-base font-semibold"
                          >
                            <bdi>{selectedAccount.name || selectedAccount.username}</bdi>
                          </h2>
                          {selectedAccount.name && (
                            <bdi className="text-xs text-muted-foreground">
                              {selectedAccount.username}
                            </bdi>
                          )}
                        </div>
                      )}
                      {effective ? (
                        <EffectivePermissionsView
                          data={effective}
                          headingLevel={standaloneLookup && !selectedAccount ? 'h2' : 'h3'}
                        />
                      ) : selectedAccount && permError ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p role="alert" className="text-sm text-destructive">
                            {t(permError, locale)}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => inspectAccount(selectedAccount)}
                          >
                            {word('retry')}
                          </Button>
                        </div>
                      ) : (
                        <LoadingStatus>{word('effective.loading')}</LoadingStatus>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </ListPage>
    </div>
  );
}
