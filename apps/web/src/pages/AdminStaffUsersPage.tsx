import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { StaffEffectivePermissions } from '../components/StaffEffectivePermissions.js';
import { StaffPermissionHistory } from '../components/StaffPermissionHistory.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Alert, Button, DataTable, DateCell, Input, Label, ListPage, TextCell } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import type { StaffCreationDraft, StaffRoleDraft } from '../lib/staff-access-form-schemas.js';

type StaffAction = TeamAction & { pageOffset: number };

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

const staffBasis = (staff: Staff) => JSON.stringify({ ...staff, lastLoginAt: null });

export default function AdminStaffUsersPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.staff.${key}`, locale);
  const [access, setAccess] = useState<Access | null>(null),
    [roles, setRoles] = useState<Role[]>([]);
  const [list, setList] = useState<StaffList>({ items: [], total: 0 });
  const [localOffset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const offset = queries ? (queries.query.page - 1) * 25 : localOffset;
  const createMessages = {
    username: label('invalidUsername'),
    firstName: label('invalidName'),
    lastName: label('invalidName'),
    roleIds: label('invalidRoles'),
    activationMethod: label('invalidActivation'),
  };
  const roleMessages = { roleIds: label('invalidRoles'), reason: label('invalidReason') };
  const createForm = useWizardForm<StaffCreationDraft>(
    async () =>
      (await import('../lib/staff-access-form-schemas.js')).staffCreationSchema(
        createMessages,
        roles.map((role) => role.roleId)
      ),
    blank,
    label('validationUnavailable')
  );
  const roleForm = useWizardForm<StaffRoleDraft>(
    async () =>
      (await import('../lib/staff-access-form-schemas.js')).staffRoleSchema(
        roleMessages,
        roles.map((role) => role.roleId)
      ),
    () => ({ roleIds: [], reason: '' }),
    label('validationUnavailable')
  );
  const draft = createForm.values;
  const setDraft = (value: StaffCreationDraft) => createForm.form.reset(value);
  const [roleIds, setRoleIds] = roleForm.field('roleIds');
  const [reason, setReason] = roleForm.field('reason');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const createErrors = useActionFieldErrors(createForm.form, createMessages, label('invalidName'));
  const roleErrors = useActionFieldErrors(roleForm.form, roleMessages, label('invalidReason'));
  const validationOwner = useRef<object | null>(null);
  const validationFocus = useRef<{
    kind: 'create' | 'roles';
    field: string;
    generation: number;
  } | null>(null);
  const [action, setAction] = useState<StaffAction | null>(null);
  const [created, setCreated] = useState<{ username: string; password?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [activationNotice, setActivationNotice] = useState(false);
  const [permissionTarget, setPermissionTarget] = useState<Staff | null>(null);
  const permissionTargetRef = useRef<Staff | null>(null),
    permissionTrigger = useRef<HTMLButtonElement | null>(null);
  permissionTargetRef.current = permissionTarget;
  const [history, setHistory] = useState<{ userId: string; username: string } | 'all' | null>(null);
  const [accessLoading, setAccessLoading] = useState(true),
    [accessError, setAccessError] = useState(false),
    [accessRevision, setAccessRevision] = useState(0),
    [accessVersion, setAccessVersion] = useState(0);
  const [optionsLoading, setOptionsLoading] = useState(false),
    [optionsError, setOptionsError] = useState(false),
    [optionsRevision, setOptionsRevision] = useState(0),
    [listRevision, setListRevision] = useState(0);
  const workGeneration = useRef(0),
    accessRef = useRef<Access | null>(null),
    editingRef = useRef<Staff | null>(null),
    actionRef = useRef<StaffAction | null>(null),
    rowsRef = useRef<Staff[]>([]),
    rolesRef = useRef<Role[]>([]);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const previousOffset = useRef(offset);
  if (previousOffset.current !== offset) {
    previousOffset.current = offset;
    ++workGeneration.current;
  }
  useEffect(() => {
    setAction(null);
    setPermissionTarget(null);
    setHistory(null);
    setSaved(false);
    setActivationNotice(false);
  }, [offset]);
  editingRef.current = editing;
  actionRef.current = action;
  function clearAction() {
    ++workGeneration.current;
    actionRef.current = null;
    setAction(null);
  }
  function openAction(value: StaffAction) {
    actionRef.current = value;
    setAction(value);
  }
  function denyAccess() {
    accessRef.current = null;
    setAccess(null);
    setList({ items: [], total: 0 });
    rowsRef.current = [];
    rolesRef.current = [];
    setRoles([]);
    clearAction();
    setEditing(null);
    setShowCreate(false);
    setDraft(blank());
    setRoleIds([]);
    setReason('');
    setCreated(null);
    setHistory(null);
    setPermissionTarget(null);
    setSaved(false);
    setActivationNotice(false);
    setLoading(false);
  }
  useEffect(
    () => () => {
      ++workGeneration.current;
    },
    []
  );
  function refreshAccess() {
    if (validationOwner.current) return;
    setAccessLoading(true);
    setAccessRevision((v) => v + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    setAccessLoading(true);
    setAccessError(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/staff-access', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Access unavailable');
        const next = (await response.json()) as Access;
        if (controller.signal.aborted) return;
        if (
          !next ||
          typeof next.userId !== 'string' ||
          [next.canView, next.canCreate, next.canEditRoles, next.canDisable].some(
            (value) => typeof value !== 'boolean'
          )
        )
          throw new Error('Invalid access');
        if (!next.canView && !next.canCreate) {
          denyAccess();
          return;
        }
        if (accessRef.current && JSON.stringify(accessRef.current) !== JSON.stringify(next))
          clearAction();
        if (accessRef.current && accessRef.current.userId !== next.userId) {
          setCreated(null);
          setDraft(blank());
          setShowCreate(false);
          setEditing(null);
          setRoleIds([]);
          setReason('');
          setHistory(null);
          setPermissionTarget(null);
        }
        if (!next.canCreate) {
          setShowCreate(false);
          setDraft(blank());
          setCreated(null);
        }
        if (!next.canEditRoles || !next.canView) setPermissionTarget(null);
        if (!next.canEditRoles) {
          setEditing(null);
          setRoleIds([]);
          setReason('');
        }
        if (!next.canView) {
          setList({ items: [], total: 0 });
          rowsRef.current = [];
          setHistory(null);
          setEditing(null);
          setRoleIds([]);
          setReason('');
        }
        accessRef.current = next;
        setAccess(next);
        setAccessVersion((v) => v + 1);
      } catch {
        if (!controller.signal.aborted) setAccessError(true);
      } finally {
        if (!controller.signal.aborted) {
          setAccessLoading(false);
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [accessRevision]);
  useEffect(() => {
    if (accessLoading || accessError || !access?.canView) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/staff?limit=25&offset=${offset}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || !accessRef.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('List unavailable');
        const data = (await response.json()) as StaffList;
        if (!data || !Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0)
          throw new Error('Invalid staff list');
        if (controller.signal.aborted || !accessRef.current) return;
        const inspected = permissionTargetRef.current;
        if (inspected && !data.items.some((row) => staffBasis(row) === staffBasis(inspected)))
          setPermissionTarget(null);
        const selected = editingRef.current;
        if (selected && !data.items.some((row) => staffBasis(row) === staffBasis(selected))) {
          setEditing(null);
          setRoleIds([]);
          setReason('');
          clearAction();
        }
        const captured = actionRef.current;
        if (
          captured &&
          rowsRef.current.some(
            (row) =>
              captured.path.includes(encodeURIComponent(row.userId)) &&
              !data.items.some((fresh) => staffBasis(row) === staffBasis(fresh))
          )
        )
          clearAction();
        rowsRef.current = data.items;
        setList(data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [offset, listRevision, accessVersion, accessLoading, accessError, access?.canView]);
  useEffect(() => {
    if (accessLoading || accessError) return;
    if (!access?.canCreate && !access?.canEditRoles) {
      setOptionsLoading(false);
      setOptionsError(false);
      setRoles([]);
      return;
    }
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/staff-role-options', {
          signal: controller.signal,
        });
        if (controller.signal.aborted || !accessRef.current) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Role options unavailable');
        const data = (await response.json()) as Role[];
        if (!Array.isArray(data)) throw new Error('Invalid role options');
        if (controller.signal.aborted || !accessRef.current) return;
        if (rolesRef.current.length && JSON.stringify(data) !== JSON.stringify(rolesRef.current))
          clearAction();
        rolesRef.current = data;
        setRoles(data);
      } catch {
        if (!controller.signal.aborted) setOptionsError(true);
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    optionsRevision,
    accessVersion,
    accessLoading,
    accessError,
    access?.canCreate,
    access?.canEditRoles,
  ]);
  const load = async () => {
    setListRevision((v) => v + 1);
  };
  const actionGeneration = workGeneration.current;
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
  const validationPending = createForm.pending || roleForm.pending;
  const disabled =
    loading ||
    error ||
    accessLoading ||
    accessError ||
    !!action ||
    !!permissionTarget ||
    validationPending;
  const rolesDisabled = disabled || optionsLoading || optionsError;
  useEffect(() => {
    const target = validationFocus.current;
    if (!target || validationPending) return;
    validationFocus.current = null;
    if (
      target.generation !== workGeneration.current ||
      validationOwner.current ||
      actionRef.current
    )
      return;
    if (target.kind === 'create')
      createForm.form.setFocus(target.field as keyof StaffCreationDraft);
    else roleForm.form.setFocus(target.field as keyof StaffRoleDraft);
  }, [validationPending, createForm.errors, roleForm.errors, createForm.form, roleForm.form]);
  const name = (staff: Staff) =>
    [staff.firstName, staff.lastName].filter(Boolean).join(' ') || staff.username;
  async function propose(kind: 'create' | 'roles', event: FormEvent) {
    event.preventDefault();
    if (rolesDisabled || actionRef.current || validationOwner.current) return;
    const owner = {};
    validationOwner.current = owner;
    const generation = workGeneration.current;
    const actor = accessRef.current;
    const target = editingRef.current;
    const form = kind === 'create' ? createForm : roleForm;
    let invalidField: string | null = null;
    form.setValidationPending(true);
    try {
      const valid = await form.form.trigger();
      if (!valid) {
        invalidField =
          (kind === 'create' ? Object.keys(createMessages) : Object.keys(roleMessages)).find(
            (field) =>
              kind === 'create'
                ? createForm.form.getFieldState(field as keyof StaffCreationDraft).invalid
                : roleForm.form.getFieldState(field as keyof StaffRoleDraft).invalid
          ) ?? null;
      }
      if (
        !valid ||
        validationOwner.current !== owner ||
        generation !== workGeneration.current ||
        accessRef.current !== actor ||
        !actor ||
        accessLoading ||
        accessError ||
        (kind === 'create'
          ? !actor.canCreate
          : !actor.canEditRoles || editingRef.current !== target)
      )
        return;
      if (kind === 'create') {
        const value = createForm.form.getValues();
        setSaved(false);
        setCreated(null);
        openAction({
          pageOffset: offset,
          title: label('create'),
          description: `${value.firstName} ${value.lastName} (${value.username}). ${label('roles')}: ${roleSummary(value.roleIds)}. ${label(value.activationMethod === 'link' ? 'linkHelp' : 'passwordOnce')}`,
          path: '/api/admin/users/create-staff',
          method: 'POST',
          body: {
            ...value,
            username: value.username.trim().toLowerCase(),
            firstName: value.firstName.trim(),
            lastName: value.lastName.trim(),
            roleIds: [...value.roleIds],
          },
          conflictMessage: label('usernameTaken'),
          forbiddenMessage: label('forbidden'),
          errorMessages: { 'AUTH:DELIVERY:UNAVAILABLE': label('deliveryUnavailable') },
        });
      } else if (target) {
        const value = roleForm.form.getValues();
        openAction({
          pageOffset: offset,
          title: label('editRoles'),
          description: `${name(target)} (${target.username}). ${label('roles')}: ${roleSummary(value.roleIds)}. ${label('reason')}: ${value.reason.trim()}. ${label('rolesHelp')}`,
          path: `/api/admin/users/${encodeURIComponent(target.userId)}/roles`,
          method: 'PUT',
          requiresOtp: true,
          body: { roleIds: [...value.roleIds], reason: value.reason.trim() },
          signsOut: target.userId === actor.userId,
          forbiddenMessage: label('forbidden'),
        });
      }
    } finally {
      if (validationOwner.current === owner) validationOwner.current = null;
      form.setValidationPending(false);
      if (invalidField) {
        validationFocus.current = { kind, field: invalidField, generation };
      }
    }
  }
  const selectRoles = (
    selected: string[],
    change: (value: string[]) => void,
    form: typeof roleForm | typeof createForm
  ) => (
    <fieldset className="space-y-2">
      <legend className="font-medium">{label('roles')}</legend>
      <details className="rounded border">
        <summary
          ref={form.bind('roleIds').ref}
          onBlur={form.bind('roleIds').onBlur}
          aria-invalid={form.bind('roleIds')['aria-invalid']}
          aria-describedby={form.bind('roleIds')['aria-describedby']}
          className="cursor-pointer p-3 focus-visible:outline focus-visible:outline-2"
        >
          {roleSummary(selected)}
        </summary>
        <div className="space-y-2 border-t p-3">
          {roles.map((role) => (
            <label key={role.roleId} className="flex items-start gap-2 rounded border p-3">
              <input
                type="checkbox"
                disabled={rolesDisabled}
                checked={selected.includes(role.roleId)}
                onChange={(event) => {
                  if (validationOwner.current || actionRef.current) return;
                  change(
                    event.target.checked
                      ? [...selected, role.roleId]
                      : selected.filter((id) => id !== role.roleId)
                  );
                }}
              />
              <span>
                <span className="block font-medium">{roleText(role, 'name')}</span>
                <span className="text-sm text-muted-foreground">
                  {roleText(role, 'description')}
                </span>
              </span>
            </label>
          ))}
          {selected
            .filter((id) => !roles.some((role) => role.roleId === id))
            .map((id) => (
              <label key={id} className="flex items-start gap-2 rounded border p-3">
                <input
                  type="checkbox"
                  checked
                  disabled={rolesDisabled}
                  onChange={() => {
                    if (!validationOwner.current && !actionRef.current)
                      change(selected.filter((value) => value !== id));
                  }}
                />
                <span>
                  {label('unavailableRole')}: <span dir="ltr">{id}</span>
                </span>
              </label>
            ))}
        </div>
      </details>
      <CatalogueFieldFeedback
        id={form.errorId('roleIds')}
        error={form.errors.roleIds}
        message={label('invalidRoles')}
      />
    </fieldset>
  );
  const staffName = (staff: Staff) => (
    <>
      <h2 className="font-semibold">
        <TextCell value={name(staff)} />
      </h2>
    </>
  );
  const staffUsername = (staff: Staff) => (
    <>
      <TextCell value={staff.username} />
    </>
  );
  const staffRoles = (staff: Staff) => (
    <>
      <div className="flex flex-wrap gap-1">
        {staff.isAdmin && (
          <span className="rounded bg-muted px-2 py-1">{label('administrator')}</span>
        )}
        {staff.roles.map((role) => (
          <span key={role.roleId} className="rounded bg-muted px-2 py-1">
            {roleText(role, 'name')}
          </span>
        ))}
        {!staff.isAdmin && !staff.roles.length && label('noRoles')}
      </div>
    </>
  );
  const staffStatus = (staff: Staff) => (
    <>
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
    </>
  );
  const staffLastLogin = (staff: Staff) => (
    <>
      {staff.lastLoginAt ? (
        <DateCell
          value={staff.lastLoginAt}
          format={(value) => time.format(new Date(value).toISOString())}
        />
      ) : (
        label('never')
      )}
    </>
  );
  const staffActions = (staff: Staff) => {
    if (!access?.canView) return null;
    return (
      <>
        <div className="flex flex-wrap gap-2">
          {access.canEditRoles && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={(event) => {
                permissionTrigger.current = event.currentTarget;
                setPermissionTarget(staff);
              }}
            >
              {t('admin.roles.effective.inspect', locale)}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => setHistory({ userId: staff.userId, username: staff.username })}
          >
            {label('audit.title')}
          </Button>
          {access.canCreate && staff.activationPending && staff.status === 'active' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setActivationNotice(false);
                setSaved(false);
                openAction({
                  pageOffset: offset,
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
              disabled={rolesDisabled}
              onClick={() => {
                if (validationOwner.current || actionRef.current) return;
                setEditing(staff);
                roleForm.form.reset({
                  roleIds: staff.roles.map((role) => role.roleId),
                  reason: '',
                });
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
                openAction({
                  pageOffset: offset,
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
      </>
    );
  };
  return (
    <section className="mx-auto max-w-5xl min-w-0 space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{label('description')}</p>
        </div>
        {access?.canView && (
          <Button variant="outline" disabled={disabled} onClick={() => setHistory('all')}>
            {label('audit.title')}
          </Button>
        )}
        {access?.canCreate && (
          <Button
            disabled={rolesDisabled}
            onClick={() => {
              if (validationOwner.current || actionRef.current) return;
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
        <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={label('created')}>
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
      <ListPage>
        <ListPage.Toolbar>
          <Button
            variant="outline"
            disabled={loading || accessLoading || !!action || validationPending}
            onClick={refreshAccess}
          >
            {label('refresh')}
          </Button>
        </ListPage.Toolbar>
        {accessLoading && <p role="status">{label('loading')}</p>}
        {accessError && (
          <div role="alert">
            <p>{label('accessError')}</p>
            <Button variant="outline" onClick={refreshAccess}>
              {label('accessRetry')}
            </Button>
          </div>
        )}
        {optionsLoading && <p role="status">{label('optionsLoading')}</p>}
        {optionsError && (
          <div role="alert">
            <p>{label('optionsError')}</p>
            <Button variant="outline" onClick={() => setOptionsRevision((v) => v + 1)}>
              {label('optionsRetry')}
            </Button>
          </div>
        )}
        <>
          {!accessLoading && !accessError && !access?.canView && !access?.canCreate && (
            <p role="alert">{label('forbidden')}</p>
          )}
          {access?.canView && (
            <>
              <ListPage.Content
                loading={loading}
                error={error}
                empty={!list.items.length}
                retainContent={!!list.items.length}
                loadingView={<p role="status">{label('loading')}</p>}
                errorView={
                  <div role="alert">
                    {label('error')}{' '}
                    <Button variant="outline" onClick={() => void load()}>
                      {label('retry')}
                    </Button>
                  </div>
                }
                emptyView={<p>{label('empty')}</p>}
              >
                <DataTable
                  locale={locale}
                  numerals={
                    numbers.numberStyle === 'western'
                      ? 'latn'
                      : numbers.numberStyle === 'persian'
                        ? 'arabext'
                        : locale === 'fa'
                          ? 'arabext'
                          : 'latn'
                  }
                  caption={label('title')}
                  scrollLabel={label('table')}
                  data={list.items}
                  keyExtractor={(staff) => staff.userId}
                  sortable={false}
                  className="max-h-[32rem] bg-card"
                  tableClassName="min-w-[52rem]"
                  columns={[
                    {
                      id: 'name',
                      header: label('name'),
                      cell: staffName,
                      rowHeader: true,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'username',
                      header: label('username'),
                      cell: staffUsername,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'roles',
                      header: label('roles'),
                      cell: staffRoles,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'status',
                      header: label('status'),
                      cell: staffStatus,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'lastLogin',
                      header: label('lastLogin'),
                      cell: staffLastLogin,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'actions',
                      header: label('actions'),
                      cell: staffActions,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                  ]}
                  renderCard={(staff) => (
                    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
                      {staffName(staff)}
                      <dl className="space-y-3 text-sm">
                        {(
                          [
                            ['username', staffUsername],
                            ['roles', staffRoles],
                            ['status', staffStatus],
                            ['lastLogin', staffLastLogin],
                          ] as const
                        ).map(([key, render]) => (
                          <div key={key}>
                            <dt className="font-medium text-muted-foreground">{label(key)}</dt>
                            <dd>{render(staff)}</dd>
                          </div>
                        ))}
                      </dl>
                      {staffActions(staff)}
                    </div>
                  )}
                />
              </ListPage.Content>
              <p>{label('total').replace('{count}', numbers.number(list.total))}</p>
              <ListPage.Pagination
                kind="cursor"
                label={label('pages')}
                loading={loading || accessLoading || validationPending}
                hasMore={
                  !error &&
                  !accessError &&
                  offset + 25 < list.total &&
                  (!queries || queries.query.page < 1_000_000)
                }
                nextLabel={label('next')}
                onNext={() =>
                  queries
                    ? queries.setQuery({ page: queries.query.page + 1 })
                    : setOffset((v) => v + 25)
                }
                previous={{
                  enabled: !error && !accessError && offset > 0,
                  label: label('previous'),
                  onClick: () =>
                    queries
                      ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                      : setOffset((v) => Math.max(0, v - 25)),
                }}
              />
            </>
          )}
          {permissionTarget && access?.canView && access.canEditRoles && (
            <StaffEffectivePermissions
              key={permissionTarget.userId}
              target={{
                userId: permissionTarget.userId,
                username: permissionTarget.username,
                name: name(permissionTarget),
              }}
              paused={loading || error || accessLoading || accessError}
              finalFocus={() =>
                permissionTrigger.current?.isConnected ? permissionTrigger.current : false
              }
              onClose={() => setPermissionTarget(null)}
              onDenied={(status) => {
                setPermissionTarget(null);
                if (status === 401) denyAccess();
                else refreshAccess();
              }}
            />
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
              className="space-y-4 rounded-lg border bg-card p-4"
              noValidate
              onSubmit={(event) => void propose('create', event)}
            >
              <h2 className="text-lg font-semibold">{label('create')}</h2>
              {catalogueRootMessage(createForm.errors) && (
                <Alert variant="destructive">{catalogueRootMessage(createForm.errors)}</Alert>
              )}
              <fieldset disabled={!!action || validationPending} className="space-y-4">
                {(['username', 'firstName', 'lastName'] as const).map((field) => (
                  <div key={field}>
                    <Label htmlFor={`staff-${field}`}>{label(field)}</Label>
                    <Input
                      id={`staff-${field}`}
                      required
                      {...createForm.bind(field)}
                      maxLength={field === 'username' ? 255 : 100}
                      value={draft[field]}
                      dir={field === 'username' ? 'ltr' : undefined}
                      onChange={(event) => {
                        if (!validationOwner.current && !actionRef.current)
                          createForm.field(field)[1](event.target.value);
                      }}
                    />
                    <CatalogueFieldFeedback
                      id={createForm.errorId(field)}
                      error={createForm.errors[field]}
                      message={createMessages[field]}
                    />
                  </div>
                ))}
                {selectRoles(
                  draft.roleIds,
                  (value) => createForm.field('roleIds')[1](value),
                  createForm
                )}
                <fieldset className="space-y-2">
                  <legend>{label('activation')}</legend>
                  {(['link', 'tempPassword'] as const).map((method) => (
                    <label key={method} className="flex gap-2">
                      <input
                        type="radio"
                        {...(method === 'link'
                          ? createForm.bind('activationMethod')
                          : {
                              name: 'activationMethod',
                              onBlur: createForm.bind('activationMethod').onBlur,
                            })}
                        value={method}
                        checked={draft.activationMethod === method}
                        onChange={() => {
                          if (!validationOwner.current && !actionRef.current)
                            createForm.field('activationMethod')[1](method);
                        }}
                      />
                      {label(method)}
                    </label>
                  ))}
                </fieldset>
                <CatalogueFieldFeedback
                  id={createForm.errorId('activationMethod')}
                  error={createForm.errors.activationMethod}
                  message={createMessages.activationMethod}
                />
                {draft.activationMethod === 'link' && (
                  <p className="text-sm">{label('linkHelp')}</p>
                )}
                <div className="flex gap-2">
                  <CatalogueSaveButton
                    label={label('create')}
                    pending={createForm.pending}
                    disabled={rolesDisabled}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (validationOwner.current || actionRef.current) return;
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
              className="space-y-4 rounded-lg border bg-card p-4"
              noValidate
              onSubmit={(event) => void propose('roles', event)}
            >
              <h2 className="text-lg font-semibold">
                {label('editRoles')}: {name(editing)}
              </h2>
              {catalogueRootMessage(roleForm.errors) && (
                <Alert variant="destructive">{catalogueRootMessage(roleForm.errors)}</Alert>
              )}
              <fieldset disabled={!!action || validationPending} className="space-y-4">
                {selectRoles(roleIds, setRoleIds, roleForm)}
                <p>{label('rolesHelp')}</p>
                <Label htmlFor="staff-role-reason">{label('reason')}</Label>
                <Input
                  id="staff-role-reason"
                  {...roleForm.bind('reason')}
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    if (!validationOwner.current && !actionRef.current)
                      setReason(event.target.value);
                  }}
                />
                <CatalogueFieldFeedback
                  id={roleForm.errorId('reason')}
                  error={roleForm.errors.reason}
                  message={roleMessages.reason}
                />
                <div className="flex gap-2">
                  <CatalogueSaveButton
                    label={label('saveRoles')}
                    pending={roleForm.pending}
                    disabled={rolesDisabled}
                  />
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    {label('cancel')}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            action.pageOffset !== offset ||
            loading ||
            error ||
            accessLoading ||
            accessError ||
            ((action.path === '/api/admin/users/create-staff' || action.path.endsWith('/roles')) &&
              (optionsLoading || optionsError))
          }
          onDenied={() => denyAccess()}
          onValidationError={(fields) => {
            if (actionGeneration !== workGeneration.current || actionRef.current !== action)
              return false;
            return action.path === '/api/admin/users/create-staff'
              ? createErrors(fields)
              : action.path.endsWith('/roles')
                ? roleErrors(fields)
                : false;
          }}
          onClose={() => {
            if (actionGeneration === workGeneration.current && actionRef.current === action)
              clearAction();
          }}
          onSuccess={async (result) => {
            if (
              actionGeneration !== workGeneration.current ||
              action.pageOffset !== offsetRef.current ||
              actionRef.current !== action ||
              !accessRef.current ||
              accessLoading ||
              accessError
            )
              return;
            if (action.path === '/api/admin/users/create-staff') {
              const data = result as { username: string; temporaryPassword?: string };
              const request = action.body as { username: string; activationMethod: string };
              if (
                !data ||
                typeof data.username !== 'string' ||
                data.username !== request.username ||
                (data.temporaryPassword != null && typeof data.temporaryPassword !== 'string') ||
                (request.activationMethod === 'tempPassword' && !data.temporaryPassword?.trim())
              )
                throw new Error('Unconfirmed staff creation');
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
            refreshAccess();
          }}
        />
      )}
    </section>
  );
}
