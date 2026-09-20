import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const target = '11111111-2222-4333-8444-555555555555';
const revision = 'a'.repeat(64);
function request(permissions: string[], isAdmin = false): AuthenticatedRequest {
  return {
    session: { userId: 'actor', permissions, isAdmin },
    ip: '127.0.0.1',
  } as AuthenticatedRequest;
}

// Each domain uses the same tripwire so denied requests cannot reach any service.
function fixture() {
  const call = vi.fn().mockResolvedValue({
    userId: target,
    username: 'staff@example.com',
    activationMethod: 'link',
    deliveryStatus: 'queued',
    roleIds: [],
    previousRoleIds: [],
  });
  const admin = {
    resendStaffActivation: call,
    createStaffUser: call,
    updateStaffRoles: call,
    listStaff: call,
    disableStaff: call,
    listStaffRoles: call,
    getEffectivePermissions: call,
    getProfileVerificationMode: call,
    setProfileVerificationMode: call,
  };
  const brand = { getActiveConfig: call, listConfigs: call };
  const tos = {
    listVersions: call,
    getVersion: call,
    createVersion: call,
    updateVersion: call,
    publishVersion: call,
    deleteVersion: call,
  };
  const templates = { list: call, getById: call, publish: call, unpublish: call, delete: call };
  return {
    call,
    controller: new AdminController(
      admin as never,
      brand as never,
      tos as never,
      templates as never,
      {} as never
    ),
  };
}

type Operation = {
  name: string;
  permission: string;
  invoke: (controller: AdminController, req: AuthenticatedRequest) => Promise<unknown>;
};
const operations: Operation[] = [
  {
    name: 'resend activation',
    permission: 'admin:users:create',
    invoke: (c, r) => c.resendStaffActivation(target, r),
  },
  {
    name: 'create staff',
    permission: 'admin:users:create',
    invoke: (c, r) =>
      c.createStaffUser(
        {
          username: 'staff@example.com',
          firstName: 'Test',
          lastName: 'Staff',
          activationMethod: 'link',
        },
        r
      ),
  },
  {
    name: 'replace roles',
    permission: 'admin:roles:edit',
    invoke: (c, r) => c.updateStaffRoles(target, { roleIds: [] }, r),
  },
  {
    name: 'list staff',
    permission: 'admin:staff:view',
    invoke: (c, r) => c.listStaff(undefined, undefined, r),
  },
  {
    name: 'disable staff',
    permission: 'admin:staff:edit',
    invoke: (c, r) => c.disableStaff(target, r),
  },
  { name: 'list roles', permission: 'admin:roles:edit', invoke: (c, r) => c.listRoles(r) },
  {
    name: 'effective permissions',
    permission: 'admin:roles:edit',
    invoke: (c, r) => c.getEffectivePermissions(target, r),
  },
  {
    name: 'read verification mode',
    permission: 'admin:config:read',
    invoke: (c, r) => c.getProfileVerificationMode(r),
  },
  {
    name: 'change verification mode',
    permission: 'admin:config:write',
    invoke: (c, r) =>
      c.setProfileVerificationMode({ mode: 'MANUAL', action: 'draft', expectedVersion: 0 }, r),
  },
  {
    name: 'read active branding',
    permission: 'admin:branding:read',
    invoke: (c, r) => c.getActiveBrandConfig(r),
  },
  {
    name: 'list branding drafts',
    permission: 'admin:branding:read',
    invoke: (c, r) => c.listBrandConfigs(r),
  },
  { name: 'list terms', permission: 'admin:tos:edit', invoke: (c, r) => c.listTosVersions(r) },
  {
    name: 'read terms draft',
    permission: 'admin:tos:edit',
    invoke: (c, r) => c.getTosVersion(target, r),
  },
  {
    name: 'create terms draft',
    permission: 'admin:tos:edit',
    invoke: (c, r) =>
      c.createTosVersion({ versionId: 'v2', contentFa: 'شرایط', contentEn: 'Terms' }, r),
  },
  {
    name: 'update terms draft',
    permission: 'admin:tos:edit',
    invoke: (c, r) =>
      c.updateTosVersion(target, { contentEn: 'Updated', expectedRevision: revision }, r),
  },
  {
    name: 'publish terms',
    permission: 'admin:tos:edit',
    invoke: (c, r) =>
      c.publishTosVersion(target, { changeType: 'major', expectedRevision: revision }, r),
  },
  {
    name: 'discard terms',
    permission: 'admin:tos:edit',
    invoke: (c, r) => c.deleteTosVersion(target, r, revision),
  },
  {
    name: 'list templates',
    permission: 'admin:notifications:edit',
    invoke: (c, r) => c.listNotificationTemplates(undefined, undefined, undefined, r),
  },
  {
    name: 'read template',
    permission: 'admin:notifications:edit',
    invoke: (c, r) => c.getNotificationTemplate(target, r),
  },
  {
    name: 'publish template',
    permission: 'admin:notifications:edit',
    invoke: (c, r) => c.publishNotificationTemplate(target, r),
  },
  {
    name: 'unpublish template',
    permission: 'admin:notifications:edit',
    invoke: (c, r) => c.unpublishNotificationTemplate(target, r),
  },
  {
    name: 'discard template',
    permission: 'admin:notifications:edit',
    invoke: (c, r) => c.deleteNotificationTemplate(target, r),
  },
];

describe.each(operations)('$name capability boundary', ({ permission, invoke }) => {
  it.each([
    { permissions: [] },
    { permissions: ['admin:financial:edit'] },
    {
      permissions: [
        permission === 'admin:config:read' ? 'admin:config:write' : 'admin:config:read',
      ],
    },
  ])('denies unrelated permissions $permissions before service access', async ({ permissions }) => {
    const { controller, call } = fixture();
    await expect(invoke(controller, request(permissions))).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['capability', 'wildcard', 'platform admin'])('allows %s', async (mode) => {
    const { controller, call } = fixture();
    await invoke(
      controller,
      request(
        mode === 'capability' ? [permission] : mode === 'wildcard' ? ['*'] : [],
        mode === 'platform admin'
      )
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});

it('reports each staff capability independently and reflects revocation', () => {
  const { controller } = fixture();
  const req = request(['admin:users:create', 'admin:roles:edit']);
  expect(controller.staffAccess(req)).toEqual({
    userId: 'actor',
    canView: false,
    canCreate: true,
    canEditRoles: true,
    canDisable: false,
  });
  req.session.permissions = ['admin:staff:view'];
  expect(controller.staffAccess(req)).toEqual({
    userId: 'actor',
    canView: true,
    canCreate: false,
    canEditRoles: false,
    canDisable: false,
  });
});

it.each([
  {
    name: 'activation target',
    invoke: (c: AdminController, r: AuthenticatedRequest) => c.resendStaffActivation('bad-id', r),
  },
  {
    name: 'staff username',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.createStaffUser(
        { username: 'bad', firstName: 'A', lastName: 'B', activationMethod: 'link' },
        r
      ),
  },
  {
    name: 'staff fields',
    invoke: (c: AdminController, r: AuthenticatedRequest) => c.createStaffUser({}, r),
  },
  {
    name: 'role payload',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.updateStaffRoles(target, { roleIds: 'admin' }, r),
  },
  {
    name: 'verification mode',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.setProfileVerificationMode({ mode: 'SUCCESS' }, r),
  },
  {
    name: 'terms target',
    invoke: (c: AdminController, r: AuthenticatedRequest) => c.getTosVersion('bad-id', r),
  },
  {
    name: 'empty terms',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.createTosVersion({ versionId: 'v2', contentFa: '', contentEn: '' }, r),
  },
  {
    name: 'missing revision',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.updateTosVersion(target, { contentEn: 'Changed' }, r),
  },
  {
    name: 'empty update',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.updateTosVersion(target, { expectedRevision: revision }, r),
  },
  {
    name: 'publish without revision',
    invoke: (c: AdminController, r: AuthenticatedRequest) =>
      c.publishTosVersion(target, { changeType: 'major' }, r),
  },
  {
    name: 'delete without revision',
    invoke: (c: AdminController, r: AuthenticatedRequest) => c.deleteTosVersion(target, r, ''),
  },
])('rejects malformed $name even for an administrator', async ({ invoke }) => {
  const { controller, call } = fixture();
  await expect(invoke(controller, request([], true))).rejects.toMatchObject({ status: 400 });
  expect(call).not.toHaveBeenCalled();
});
