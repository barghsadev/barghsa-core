import {
  Ban as TableBanIcon,
  ChevronDown,
  History as TableHistoryIcon,
  KeyRound,
  Mail,
  Send as TableSendIcon,
  ShieldCheck as TableShieldCheckIcon,
  UserCog as TableUserCogIcon,
  X,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { StaffEffectivePermissions } from '../components/StaffEffectivePermissions.js';
import { StaffPermissionHistory } from '../components/StaffPermissionHistory.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/admin-ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import {
  LoadingStatus,
  Alert,
  Badge,
  Button,
  DataTable,
  DateCell,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  TextCell,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import type { StaffCreationDraft, StaffRoleDraft } from '../lib/staff-access-form-schemas.js';

type StaffAction = TeamAction & { pageOffset: number } & (
    | { kind: 'create'; body: StaffCreationDraft }
    | { kind: 'roles'; target: Staff; body: StaffRoleDraft }
    | { kind: 'activation' | 'disable'; target: Staff }
  );

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
type StaffPageMode = 'directory' | 'create' | 'account' | 'roles' | 'permissions';
const blank = () => ({
  username: '',
  firstName: '',
  lastName: '',
  roleIds: [] as string[],
  activationMethod: 'link' as 'link' | 'tempPassword',
});

const staffBasis = (staff: Staff) => JSON.stringify({ ...staff, lastLoginAt: null });
const validStaff = (row: Staff) =>
  !!row &&
  typeof row.userId === 'string' &&
  !!row.userId &&
  typeof row.username === 'string' &&
  !!row.username &&
  (row.status === 'active' || row.status === 'disabled') &&
  Array.isArray(row.roles) &&
  row.roles.every(
    (role) => !!role && typeof role.roleId === 'string' && typeof role.name === 'string'
  );

function StaffCommandNavigationGuard({ active }: { active: boolean }) {
  useBlocker({ shouldBlockFn: () => active, enableBeforeUnload: () => active });
  return null;
}

export default function AdminStaffUsersPage({
  queries,
  mode,
  userId,
  search,
}: {
  queries?: ListQueryBinding;
  mode?: StaffPageMode;
  userId?: string;
  search?: Record<string, unknown>;
} = {}) {
  const read = useStaffQueryRead('profiles');
  const deniedRead = (failure: unknown) =>
    failure instanceof ServerQueryError && [401, 403].includes(failure.status);
  const time = useAccountTime();
  const locale = useLocale();
  const directory = !mode || mode === 'directory';
  const usesRoleOptions = !mode || mode === 'create' || mode === 'roles';
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
  const [showCreate, setShowCreate] = useState(mode === 'create');
  const [editing, setEditing] = useState<Staff | null>(null);
  const [missing, setMissing] = useState(false);
  const createErrors = useActionFieldErrors(createForm.form, createMessages, label('invalidName'));
  const roleErrors = useActionFieldErrors(roleForm.form, roleMessages, label('invalidReason'));
  const validationOwner = useRef<object | null>(null);
  const validationFocus = useRef<{
    kind: 'create' | 'roles';
    field: string;
    generation: number;
  } | null>(null);
  const [action, setAction] = useState<StaffAction | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
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
    accessRequest = useRef<AbortController | null>(null),
    editingRef = useRef<Staff | null>(null),
    actionRef = useRef<StaffAction | null>(null),
    recoveryRef = useRef<{ access?: Access } | null>(null),
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
    const command: StaffAction = {
      ...value,
      responseDeadline: true,
      successStatus: value.kind === 'create' ? 201 : 200,
    };
    actionRef.current = command;
    setAction(command);
  }
  function clearRecovery() {
    recoveryRef.current = null;
    setUnconfirmed(false);
  }
  function denyAccess() {
    accessRequest.current?.abort();
    accessRef.current = null;
    setAccess(null);
    setAccessLoading(false);
    setAccessError(false);
    setList({ items: [], total: 0 });
    setMissing(false);
    rowsRef.current = [];
    rolesRef.current = [];
    setRoles([]);
    clearAction();
    clearRecovery();
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
    accessRequest.current = controller;
    const recovering = recoveryRef.current;
    setAccessLoading(true);
    setAccessError(false);
    void (async () => {
      try {
        const next = (await read(
          '/api/admin/staff-access',
          'detail',
          controller.signal,
          staffQueryJson,
          accessRevision
        )) as Access;
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
          clearRecovery();
          rowsRef.current = [];
          setList({ items: [], total: 0 });
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
        if (recovering && recoveryRef.current === recovering) {
          if (next.canView) recovering.access = next;
          else clearRecovery();
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (deniedRead(failure)) denyAccess();
          else setAccessError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setAccessLoading(false);
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [accessRevision, read]);
  useEffect(() => {
    if (accessLoading || accessError || !access?.canView) return;
    if (mode === 'create') return;
    if ((mode === 'roles' || mode === 'permissions') && !access.canEditRoles) return;
    const controller = new AbortController();
    const recovering = recoveryRef.current;
    const recoveryAccess = recovering?.access;
    setLoading(true);
    setError(false);
    setMissing(false);
    void (async () => {
      try {
        const response = await read(
          userId
            ? `/api/admin/staff/accounts/${encodeURIComponent(userId)}`
            : `/api/admin/staff?limit=25&offset=${offset}`,
          userId ? 'detail' : 'list',
          controller.signal,
          staffQueryJson,
          accessVersion
        );
        const data = (userId ? { items: [response], total: 1 } : response) as StaffList;
        if (
          !data ||
          !Array.isArray(data.items) ||
          !data.items.every(validStaff) ||
          (userId && data.items[0]?.userId !== userId) ||
          new Set(data.items.map((row) => row.userId)).size !== data.items.length ||
          !Number.isInteger(data.total) ||
          data.total < 0
        )
          throw new Error('Invalid staff list');
        if (controller.signal.aborted || !accessRef.current) return;
        const inspected = permissionTargetRef.current;
        if (
          !userId &&
          inspected &&
          !data.items.some((row) => staffBasis(row) === staffBasis(inspected))
        ) {
          setPermissionTarget(null);
        }
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
          captured.kind !== 'create' &&
          rowsRef.current.some(
            (row) =>
              captured.target.userId === row.userId &&
              !data.items.some((fresh) => staffBasis(row) === staffBasis(fresh))
          )
        )
          clearAction();
        rowsRef.current = data.items;
        setList(data);
        if (
          mode === 'roles' &&
          data.items[0] &&
          (!selected || staffBasis(selected) !== staffBasis(data.items[0]))
        ) {
          openRoleEditor(data.items[0]);
        }
        if (
          recovering &&
          recoveryRef.current === recovering &&
          recoveryAccess === accessRef.current
        )
          clearRecovery();
      } catch (failure) {
        if (!controller.signal.aborted && accessRef.current) {
          if (deniedRead(failure)) denyAccess();
          else if (userId && failure instanceof ServerQueryError && failure.status === 404) {
            setMissing(true);
            setList({ items: [], total: 0 });
            rowsRef.current = [];
            setEditing(null);
            roleForm.form.reset({ roleIds: [], reason: '' });
            clearAction();
          } else setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    offset,
    listRevision,
    accessVersion,
    accessLoading,
    accessError,
    access?.canView,
    access?.canEditRoles,
    mode,
    userId,
    read,
  ]);
  useEffect(() => {
    if (accessLoading || accessError) return;
    if (!usesRoleOptions || (!access?.canCreate && !access?.canEditRoles)) {
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
        const data = (await read(
          '/api/admin/staff-role-options',
          'list',
          controller.signal,
          staffQueryJson,
          accessVersion
        )) as Role[];
        if (!Array.isArray(data)) throw new Error('Invalid role options');
        if (controller.signal.aborted || !accessRef.current) return;
        if (rolesRef.current.length && JSON.stringify(data) !== JSON.stringify(rolesRef.current))
          clearAction();
        rolesRef.current = data;
        setRoles(data);
      } catch (failure) {
        if (!controller.signal.aborted && accessRef.current) {
          if (deniedRead(failure)) denyAccess();
          else setOptionsError(true);
        }
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
    usesRoleOptions,
    read,
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
  const roleName = (id: string, previous: Role[] = []) => {
    const role =
      roles.find((item) => item.roleId === id) ?? previous.find((item) => item.roleId === id);
    return role ? roleText(role, 'name') : id;
  };
  const roleList = (ids: string[], previous?: Role[]) =>
    ids.length ? (
      <ul className="flex flex-wrap gap-x-2 gap-y-1">
        {ids.map((id) => (
          <li key={id} className="min-w-0 rounded bg-muted/55 px-2 py-1 wrap-anywhere">
            <bdi>{roleName(id, previous)}</bdi>
          </li>
        ))}
      </ul>
    ) : (
      label('noRoles')
    );
  const validationPending = createForm.pending || roleForm.pending;
  const disabled =
    loading ||
    error ||
    accessLoading ||
    accessError ||
    unconfirmed ||
    !!action ||
    !!permissionTarget ||
    validationPending;
  const rolesDisabled = disabled || optionsLoading || optionsError;
  function openRoleEditor(staff: Staff) {
    setEditing(staff);
    roleForm.form.reset({ roleIds: staff.roles.map((role) => role.roleId), reason: '' });
    setShowCreate(false);
  }
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
          kind: 'create',
          pageOffset: offset,
          title: label('create'),
          description: label(value.activationMethod === 'link' ? 'linkHelp' : 'tempPasswordReview'),
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
          kind: 'roles',
          target,
          pageOffset: offset,
          risk: 'destructive',
          title: label('editRoles'),
          description: label('rolesHelp'),
          path: `/api/admin/users/${encodeURIComponent(target.userId)}/roles`,
          method: 'PUT',
          requiresOtp: true,
          body: { roleIds: [...value.roleIds], reason: value.reason.trim() },
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
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{label('roles')}</legend>
      <details className="group rounded-lg border bg-muted/20">
        <summary
          ref={form.bind('roleIds').ref}
          onBlur={form.bind('roleIds').onBlur}
          aria-invalid={form.bind('roleIds')['aria-invalid']}
          aria-describedby={form.bind('roleIds')['aria-describedby']}
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted/45 focus-visible:outline focus-visible:outline-2 [&::-webkit-details-marker]:hidden"
        >
          {label('chooseRoles')}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="max-h-64 space-y-1 overflow-y-auto border-t p-2">
          {roles.map((role) => (
            <label
              key={role.roleId}
              className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/35"
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
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
              <label
                key={id}
                className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/35"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
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
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={label('selectedRoles')}>
          {selected.map((id) => {
            const selectedName = roleName(id, editing?.roles);
            return (
              <li
                key={id}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-muted/35 ps-2 text-xs"
              >
                <bdi className="min-w-0 wrap-anywhere">{selectedName}</bdi>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  disabled={rolesDisabled}
                  aria-label={label('removeSelectedRole').replace('{role}', selectedName)}
                  onClick={(event) => {
                    if (validationOwner.current || actionRef.current) return;
                    change(selected.filter((value) => value !== id));
                    event.currentTarget.closest('fieldset')?.querySelector('summary')?.focus();
                  }}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {label(editing ? 'noRoles' : 'noInitialRoles')}
        </p>
      )}
      <CatalogueFieldFeedback
        compact
        id={form.errorId('roleIds')}
        error={form.errors.roleIds}
        message={label('invalidRoles')}
      />
    </fieldset>
  );
  const staffName = (staff: Staff) => (
    <h2 className="font-semibold">
      {mode === 'directory' ? (
        <Link
          to="/admin/users/$userId"
          params={{ userId: staff.userId }}
          search={search ?? {}}
          className="text-primary underline underline-offset-4"
        >
          <TextCell value={name(staff)} />
        </Link>
      ) : (
        <TextCell value={name(staff)} />
      )}
    </h2>
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
      <Badge variant={staff.status === 'active' ? 'success' : 'outline'}>
        {label(staff.status)}
      </Badge>
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
          {access.canEditRoles && mode === 'account' && (
            <>
              <Link
                to="/admin/users/$userId/roles"
                params={{ userId: staff.userId }}
                search={search ?? {}}
                className={buttonVariants()}
                data-table-action-tooltip={label('editRoles')}
              >
                <TableActionIcon icon={TableUserCogIcon}>{label('editRoles')}</TableActionIcon>
              </Link>
              <Link
                to="/admin/users/$userId/permissions"
                params={{ userId: staff.userId }}
                search={search ?? {}}
                className={buttonVariants({ variant: 'outline' })}
                data-table-action-tooltip={t('admin.roles.effective.inspect', locale)}
              >
                <TableActionIcon icon={TableShieldCheckIcon}>
                  {t('admin.roles.effective.inspect', locale)}
                </TableActionIcon>
              </Link>
            </>
          )}
          {access.canEditRoles && !mode && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={(event) => {
                permissionTrigger.current = event.currentTarget;
                setPermissionTarget(staff);
              }}
              data-table-action-tooltip={t('admin.roles.effective.inspect', locale)}
            >
              <TableActionIcon icon={TableShieldCheckIcon}>
                {t('admin.roles.effective.inspect', locale)}
              </TableActionIcon>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => setHistory({ userId: staff.userId, username: staff.username })}
            data-table-action-tooltip={label('audit.title')}
          >
            <TableActionIcon icon={TableHistoryIcon}>{label('audit.title')}</TableActionIcon>
          </Button>
          {access.canCreate && staff.activationPending && staff.status === 'active' && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setActivationNotice(false);
                setSaved(false);
                openAction({
                  kind: 'activation',
                  target: staff,
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
              data-table-action-tooltip={label('resendActivation')}
            >
              <TableActionIcon icon={TableSendIcon}>{label('resendActivation')}</TableActionIcon>
            </Button>
          )}
          {access.canEditRoles && !mode && (
            <Button
              variant="outline"
              disabled={rolesDisabled}
              onClick={() => {
                if (validationOwner.current || actionRef.current) return;
                openRoleEditor(staff);
              }}
              data-table-action-tooltip={label('editRoles')}
            >
              <TableActionIcon icon={TableUserCogIcon}>{label('editRoles')}</TableActionIcon>
            </Button>
          )}
          {access.canDisable && staff.status === 'active' && (
            <Button
              variant="outline"
              disabled={disabled || staff.userId === access.userId}
              onClick={() => {
                setSaved(false);
                openAction({
                  kind: 'disable',
                  target: staff,
                  pageOffset: offset,
                  risk: 'destructive',
                  title: label('disable'),
                  description: `${name(staff)} (${staff.username}). ${label('disableHelp')}`,
                  path: `/api/admin/staff/${encodeURIComponent(staff.userId)}/disable`,
                  method: 'POST',
                  forbiddenMessage: label('forbidden'),
                  conflictMessage: label('conflict'),
                });
              }}
              data-table-action-tooltip={label('disable')}
            >
              <TableActionIcon icon={TableBanIcon}>{label('disable')}</TableActionIcon>
            </Button>
          )}
        </div>
      </>
    );
  };
  const account = userId ? list.items[0] : undefined;
  const title =
    mode === 'create'
      ? label('create')
      : mode === 'roles'
        ? label('editRoles')
        : mode === 'permissions'
          ? t('admin.roles.effective.title', locale)
          : mode === 'account'
            ? account
              ? name(account)
              : label('accountTitle')
            : label('title');
  const insufficientAccess =
    mode === 'create'
      ? !access?.canCreate
      : mode === 'roles' || mode === 'permissions'
        ? !access?.canView || !access.canEditRoles
        : mode === 'account'
          ? !access?.canView
          : !access?.canView && !access?.canCreate;
  const editorRoute = mode === 'create' || mode === 'roles';
  const compact = useCompactRecords();
  const directoryLoading = (
    <RecordListSkeleton
      label={label('loading')}
      view={compact ? 'card' : 'table'}
      headings={[
        label('name'),
        label('status'),
        label('roles'),
        label('lastLogin'),
        ...(!mode ? [label('actions')] : []),
      ]}
    />
  );
  const accountLoading = <RecordDetailSkeleton label={label('loading')} />;
  return (
    <section
      className={`mx-auto min-w-0 space-y-4 ${editorRoute ? 'max-w-3xl' : 'max-w-5xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {mode && <StaffCommandNavigationGuard active={!!action || validationPending} />}
      {time.notice}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!directory && (
            <Link
              to="/admin/users"
              search={search ?? {}}
              className="text-sm text-primary underline underline-offset-4"
            >
              {label('title')}
            </Link>
          )}
          {userId && mode !== 'account' && account && (
            <Link
              to="/admin/users/$userId"
              params={{ userId }}
              search={search ?? {}}
              className="ms-4 text-sm text-primary underline underline-offset-4"
            >
              <bdi>{name(account)}</bdi>
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold wrap-anywhere sm:text-3xl">{title}</h1>
            {mode === 'account' && account && staffStatus(account)}
          </div>
          {mode === 'account' && account && (
            <p className="text-sm text-muted-foreground">{staffUsername(account)}</p>
          )}
          {directory && (
            <p className="mt-2 text-sm text-muted-foreground">{label('description')}</p>
          )}
        </div>
        {editorRoute && (
          <ListRefreshButton
            label={label('refresh')}
            disabled={loading || accessLoading || !!action || validationPending}
            onClick={refreshAccess}
          />
        )}
        {directory && access?.canView && (
          <Button variant="outline" disabled={disabled} onClick={() => setHistory('all')}>
            {label('audit.title')}
          </Button>
        )}
        {mode === 'directory' && access?.canCreate && !accessLoading && !accessError && (
          <Link to="/admin/users/new" search={search ?? {}} className={buttonVariants()}>
            {label('create')}
          </Link>
        )}
        {!mode && access?.canCreate && (
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
      <CommandFeedback message={saved ? label('saved') : null} />
      {unconfirmed && (
        <Alert variant="destructive">{confirmationText('unconfirmed', locale)}</Alert>
      )}
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
          {mode === 'create' ? (
            <Link
              to="/admin/users"
              search={search ?? {}}
              className={buttonVariants({ variant: 'outline' })}
            >
              {label('dismiss')}
            </Link>
          ) : (
            <Button variant="outline" onClick={() => setCreated(null)}>
              {label('dismiss')}
            </Button>
          )}
        </section>
      )}
      <ListPage>
        {!editorRoute && (
          <ListPage.Toolbar>
            <ListRefreshButton
              label={label('refresh')}
              disabled={loading || accessLoading || !!action || validationPending}
              onClick={refreshAccess}
            />
          </ListPage.Toolbar>
        )}
        {accessLoading &&
          (directory ? (
            directoryLoading
          ) : userId ? (
            accountLoading
          ) : (
            <LoadingStatus>{label('loading')}</LoadingStatus>
          ))}
        {accessError && (
          <div role="alert">
            <p>{label('accessError')}</p>
            <Button variant="outline" onClick={refreshAccess}>
              {label('accessRetry')}
            </Button>
          </div>
        )}
        {optionsLoading && <LoadingStatus>{label('optionsLoading')}</LoadingStatus>}
        {optionsError && (
          <div role="alert">
            <p>{label('optionsError')}</p>
            <Button variant="outline" onClick={() => setOptionsRevision((v) => v + 1)}>
              {label('optionsRetry')}
            </Button>
          </div>
        )}
        <>
          {!accessLoading && !accessError && insufficientAccess && (
            <p role="alert">{label('forbidden')}</p>
          )}
          {userId && !insufficientAccess && !accessLoading && !accessError && (
            <>
              {loading && accountLoading}
              {missing && <Alert variant="destructive">{label('accountUnavailable')}</Alert>}
              {error && (
                <Alert variant="destructive" className="space-y-2">
                  <p>{label('error')}</p>
                  <Button variant="outline" onClick={() => void load()}>
                    {label('retry')}
                  </Button>
                </Alert>
              )}
              {account && mode === 'account' && (
                <section
                  aria-label={label('accountTitle')}
                  className="space-y-5 rounded-xl border bg-card p-4 sm:p-5"
                >
                  <dl className="grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        ['roles', staffRoles],
                        ['lastLogin', staffLastLogin],
                      ] as const
                    ).map(([key, render]) => (
                      <div key={key}>
                        <dt className="mb-1 text-sm font-medium text-muted-foreground">
                          {label(key)}
                        </dt>
                        <dd>{render(account)}</dd>
                      </div>
                    ))}
                  </dl>
                  {!loading && !error && staffActions(account)}
                </section>
              )}
              {mode === 'permissions' && account && (
                <StaffEffectivePermissions
                  key={account.userId}
                  target={{
                    userId: account.userId,
                    username: account.username,
                    name: name(account),
                  }}
                  paused={loading || error}
                  standalone
                  onClose={() => {}}
                  onDenied={denyAccess}
                />
              )}
            </>
          )}
          {directory && access?.canView && (
            <>
              <ListPage.Content
                loading={loading}
                error={error}
                empty={!list.items.length}
                retainContent={!!list.items.length}
                loadingView={directoryLoading}
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
                  tableClassName="min-w-[40rem]"
                  columns={[
                    {
                      id: 'name',
                      header: label('name'),
                      cell: (staff) => (
                        <div className="space-y-1">
                          {staffName(staff)}
                          <p className="text-xs text-muted-foreground">{staffUsername(staff)}</p>
                        </div>
                      ),
                      rowHeader: true,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'status',
                      header: label('status'),
                      cell: staffStatus,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'roles',
                      header: label('roles'),
                      cell: staffRoles,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    {
                      id: 'lastLogin',
                      header: label('lastLogin'),
                      cell: staffLastLogin,
                      cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                    },
                    ...(!mode
                      ? [
                          {
                            id: 'actions',
                            header: label('actions'),
                            cell: staffActions,
                            cellClassName: 'align-top p-3 [overflow-wrap:anywhere]',
                          },
                        ]
                      : []),
                  ]}
                  renderCard={(staff) => (
                    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          {staffName(staff)}
                          <p className="text-xs text-muted-foreground">{staffUsername(staff)}</p>
                        </div>
                        <div className="text-sm">{staffStatus(staff)}</div>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                        {(
                          [
                            ['roles', staffRoles],
                            ['lastLogin', staffLastLogin],
                          ] as const
                        ).map(([key, render]) => (
                          <div key={key}>
                            <dt className="font-medium text-muted-foreground">{label(key)}</dt>
                            <dd>{render(staff)}</dd>
                          </div>
                        ))}
                      </dl>
                      {!mode && staffActions(staff)}
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
              onClose={() => {
                setPermissionTarget(null);
              }}
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
              onDenied={denyAccess}
            />
          )}
          {(mode === 'create' ? !created : showCreate) && access?.canCreate && (
            <form
              className={recordEditorSurface}
              noValidate
              aria-label={label('create')}
              onSubmit={(event) => void propose('create', event)}
            >
              {catalogueRootMessage(createForm.errors) && (
                <Alert variant="destructive" className="m-4">
                  {catalogueRootMessage(createForm.errors)}
                </Alert>
              )}
              <fieldset disabled={!!action || validationPending} className="min-w-0">
                <legend className="sr-only">{label('create')}</legend>
                <div className="grid min-w-0 border-b md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  <div className="min-w-0 border-b md:border-e md:border-b-0">
                    <RecordEditorSection title={label('accountDetails')}>
                      <div className={recordEditorGrid}>
                        {(['username', 'firstName', 'lastName'] as const).map((field) => (
                          <div
                            key={field}
                            className={`${recordEditorField} ${field === 'username' ? 'sm:col-span-2' : ''}`}
                          >
                            <Label htmlFor={`staff-${field}`}>
                              {label(
                                field === 'username' && draft.activationMethod === 'link'
                                  ? 'activationEmailAddress'
                                  : field
                              )}
                            </Label>
                            <Input
                              id={`staff-${field}`}
                              required
                              aria-required="true"
                              {...createForm.bind(field)}
                              maxLength={field === 'username' ? 255 : 100}
                              inputMode={
                                field === 'username' && draft.activationMethod === 'link'
                                  ? 'email'
                                  : undefined
                              }
                              value={draft[field]}
                              dir={field === 'username' ? 'ltr' : 'auto'}
                              placeholder={
                                field === 'username'
                                  ? draft.activationMethod === 'link'
                                    ? 'name@example.com'
                                    : '+989121234567'
                                  : undefined
                              }
                              onChange={(event) => {
                                if (!validationOwner.current && !actionRef.current)
                                  createForm.field(field)[1](event.target.value);
                              }}
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={createForm.errorId(field)}
                              error={createForm.errors[field]}
                              message={createMessages[field]}
                            />
                          </div>
                        ))}
                      </div>
                    </RecordEditorSection>
                  </div>
                  <RecordEditorSection title={label('activation')}>
                    <fieldset
                      role="radiogroup"
                      aria-labelledby="staff-activation-label"
                      aria-required="true"
                      aria-invalid={createForm.bind('activationMethod')['aria-invalid']}
                      aria-describedby={createForm.bind('activationMethod')['aria-describedby']}
                      className="space-y-2"
                    >
                      <legend id="staff-activation-label" className="sr-only">
                        {label('activation')}
                      </legend>
                      {(['link', 'tempPassword'] as const).map((method) => (
                        <label
                          key={method}
                          className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-3 hover:bg-muted/35 has-checked:border-primary/40 has-checked:bg-primary/5"
                        >
                          <input
                            type="radio"
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                            {...(method === 'link'
                              ? createForm.bind('activationMethod')
                              : {
                                  name: 'activationMethod',
                                  onBlur: createForm.bind('activationMethod').onBlur,
                                })}
                            aria-labelledby={`staff-activation-${method}`}
                            aria-describedby={`staff-activation-${method}-help`}
                            value={method}
                            checked={draft.activationMethod === method}
                            onChange={() => {
                              if (!validationOwner.current && !actionRef.current)
                                createForm.field('activationMethod')[1](method);
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              id={`staff-activation-${method}`}
                              className="block text-sm font-medium"
                            >
                              {label(method)}
                            </span>
                            <span
                              id={`staff-activation-${method}-help`}
                              className="mt-0.5 block text-xs text-muted-foreground"
                            >
                              {label(method === 'link' ? 'linkHelp' : 'tempPasswordHelp')}
                            </span>
                          </span>
                          {method === 'link' ? (
                            <Mail aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          ) : (
                            <KeyRound aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          )}
                        </label>
                      ))}
                    </fieldset>
                    <CatalogueFieldFeedback
                      compact
                      id={createForm.errorId('activationMethod')}
                      error={createForm.errors.activationMethod}
                      message={createMessages.activationMethod}
                    />
                  </RecordEditorSection>
                </div>
                <RecordEditorSection title={label('roleAccess')}>
                  {selectRoles(
                    draft.roleIds,
                    (value) => createForm.field('roleIds')[1](value),
                    createForm
                  )}
                </RecordEditorSection>
                <RecordEditorActions>
                  {mode === 'create' ? (
                    <Link
                      to="/admin/users"
                      search={search ?? {}}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      {label('cancel')}
                    </Link>
                  ) : (
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
                  )}
                  <CatalogueSaveButton
                    label={label('create')}
                    pending={createForm.pending}
                    disabled={rolesDisabled}
                  />
                </RecordEditorActions>
              </fieldset>
            </form>
          )}
          {editing && access?.canEditRoles && (
            <form
              className={recordEditorSurface}
              noValidate
              aria-label={label('editRoles')}
              onSubmit={(event) => void propose('roles', event)}
            >
              {catalogueRootMessage(roleForm.errors) && (
                <Alert variant="destructive" className="m-4">
                  {catalogueRootMessage(roleForm.errors)}
                </Alert>
              )}
              <fieldset disabled={!!action || validationPending} className="min-w-0">
                <legend className="sr-only">{label('editRoles')}</legend>
                <div className="grid min-w-0 md:grid-cols-2">
                  <div className="min-w-0 border-b md:border-e md:border-b-0">
                    <RecordEditorSection
                      title={label('roleAccess')}
                      description={label('rolesHelp')}
                    >
                      {selectRoles(roleIds, setRoleIds, roleForm)}
                    </RecordEditorSection>
                  </div>
                  <RecordEditorSection title={label('auditReason')}>
                    <div className={recordEditorField}>
                      <Label htmlFor="staff-role-reason">{label('reason')}</Label>
                      <Textarea
                        id="staff-role-reason"
                        {...roleForm.bind('reason')}
                        required
                        aria-required="true"
                        maxLength={500}
                        rows={2}
                        dir="auto"
                        className="max-h-32 min-h-16 resize-y placeholder-shown:[direction:inherit]"
                        placeholder={label('reasonExample')}
                        value={reason}
                        onChange={(event) => {
                          if (!validationOwner.current && !actionRef.current)
                            setReason(event.target.value);
                        }}
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={roleForm.errorId('reason')}
                        error={roleForm.errors.reason}
                        message={roleMessages.reason}
                      />
                    </div>
                  </RecordEditorSection>
                </div>
                <RecordEditorActions>
                  {mode === 'roles' && userId ? (
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId }}
                      search={search ?? {}}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      {label('cancel')}
                    </Link>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      {label('cancel')}
                    </Button>
                  )}
                  <CatalogueSaveButton
                    label={label('saveRoles')}
                    pending={roleForm.pending}
                    disabled={rolesDisabled}
                  />
                </RecordEditorActions>
              </fieldset>
            </form>
          )}
        </>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            action.kind === 'create' ? (
              <dl className="space-y-3 rounded-lg border p-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{label('accountDetails')}</dt>
                  <dd>
                    <bdi>
                      {action.body.firstName} {action.body.lastName}
                    </bdi>
                    <bdi className="block wrap-anywhere">{action.body.username}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{label('activation')}</dt>
                  <dd>{label(action.body.activationMethod)}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground">{label('selectedRoles')}</dt>
                  <dd>{roleList(action.body.roleIds)}</dd>
                </div>
              </dl>
            ) : action.kind === 'roles' ? (
              <dl className="space-y-3 rounded-lg border p-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{label('accountTitle')}</dt>
                  <dd>
                    <bdi>{name(action.target)}</bdi>
                    <bdi className="block wrap-anywhere">{action.target.username}</bdi>
                  </dd>
                </div>
                {(
                  [
                    [
                      'rolesAdded',
                      action.body.roleIds.filter(
                        (id) => !action.target.roles.some((role) => role.roleId === id)
                      ),
                    ],
                    [
                      'rolesRemoved',
                      action.target.roles
                        .filter((role) => !action.body.roleIds.includes(role.roleId))
                        .map((role) => role.roleId),
                    ],
                    [
                      'rolesRetained',
                      action.body.roleIds.filter((id) =>
                        action.target.roles.some((role) => role.roleId === id)
                      ),
                    ],
                  ] as const
                ).map(([key, ids]) => (
                  <div
                    key={key}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-2"
                  >
                    <dt className="text-muted-foreground">{label(key)}</dt>
                    <dd className="min-w-0">{roleList(ids, action.target.roles)}</dd>
                  </div>
                ))}
                <div className="border-t pt-2">
                  <dt className="text-muted-foreground">{label('reason')}</dt>
                  <dd dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                    {action.body.reason}
                  </dd>
                </div>
              </dl>
            ) : null
          }
          confirmationDisabled={
            action.pageOffset !== offset ||
            loading ||
            error ||
            accessLoading ||
            accessError ||
            ((action.kind === 'create' || action.kind === 'roles') &&
              (optionsLoading || optionsError))
          }
          onDenied={() => {
            if (actionGeneration === workGeneration.current && actionRef.current === action)
              denyAccess();
          }}
          onUnconfirmed={() => {
            if (actionGeneration !== workGeneration.current || actionRef.current !== action) return;
            recoveryRef.current = {};
            setUnconfirmed(true);
            setSaved(false);
            setActivationNotice(false);
            clearAction();
          }}
          onValidationError={(fields) => {
            if (actionGeneration !== workGeneration.current || actionRef.current !== action)
              return false;
            return action.kind === 'create'
              ? createErrors(fields)
              : action.kind === 'roles'
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
            const data = result as Record<string, unknown> | null;
            if (action.kind === 'create') {
              const request = action.body;
              const password = data?.temporaryPassword;
              if (
                !data ||
                typeof data.userId !== 'string' ||
                !data.userId ||
                data.username !== request.username ||
                data.activationMethod !== request.activationMethod ||
                (request.activationMethod === 'tempPassword'
                  ? typeof password !== 'string' || !password.trim()
                  : password !== undefined || data.deliveryStatus !== 'queued')
              )
                throw new Error('Unconfirmed staff creation');
              setCreated({
                username: request.username,
                ...(typeof password === 'string' ? { password } : {}),
              });
              setDraft(blank());
              setShowCreate(false);
            } else if (action.kind === 'roles') {
              const expected = action.body.roleIds;
              if (
                data?.userId !== action.target.userId ||
                !Array.isArray(data.roleIds) ||
                data.roleIds.length !== expected.length ||
                new Set(data.roleIds).size !== expected.length ||
                !data.roleIds.every((role) => expected.includes(role))
              )
                throw new Error('Unconfirmed staff roles');
              if (action.target.userId === accessRef.current.userId) {
                window.location.assign('/login');
                return;
              }
            } else if (action.kind === 'activation') {
              if (data?.deliveryStatus !== 'queued')
                throw new Error('Unconfirmed activation resend');
              setActivationNotice(true);
            } else if (
              data?.userId !== action.target.userId ||
              data.username !== action.target.username ||
              data.status !== 'disabled' ||
              typeof data.disabledAt !== 'string' ||
              !Number.isFinite(Date.parse(data.disabledAt)) ||
              typeof data.alreadyDisabled !== 'boolean'
            ) {
              throw new Error('Unconfirmed staff disable');
            }
            setEditing(null);
            setSaved(true);
            refreshAccess();
          }}
        />
      )}
    </section>
  );
}
