import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const draftId = '11111111-2222-4333-8444-555555555555';
function request(permissions = ['admin:branding:edit']): AuthenticatedRequest {
  return {
    session: { userId: 'trusted-actor', permissions, isAdmin: false },
  } as AuthenticatedRequest;
}
function fixture() {
  const save = vi.fn().mockResolvedValue({ id: draftId, status: 'draft', version: 3 });
  const activate = vi.fn().mockResolvedValue({ id: draftId, status: 'active', version: 3 });
  return {
    save,
    activate,
    controller: new AdminController(
      {} as never,
      { upsertDraft: save, activateDraft: activate } as never,
      {} as never,
      {} as never,
      {} as never
    ),
  };
}
describe('branding authority and version boundaries', () => {
  it.each([[], ['admin:config:read'], ['admin:tos:edit']].map((permissions) => ({ permissions })))(
    'denies unauthorized saving and activation $permissions',
    async ({ permissions }) => {
      const { controller, save, activate } = fixture();
      await expect(
        controller.upsertBrandConfig({ expectedVersion: 0, config: {} }, request(permissions))
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        controller.activateBrandConfig(request(permissions), { draftId, expectedVersion: 3 })
      ).rejects.toMatchObject({ status: 403 });
      expect(save).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    }
  );
  it('binds activation to the saved draft/version and current actor', async () => {
    const { controller, activate } = fixture();
    const req = request();
    await controller.activateBrandConfig(req, { draftId, expectedVersion: 3, actor: 'forged' });
    expect(activate).toHaveBeenCalledWith('trusted-actor', draftId, 3);
    req.session.permissions = [];
    await expect(
      controller.activateBrandConfig(req, { draftId, expectedVersion: 3 })
    ).rejects.toMatchObject({ status: 403 });
    expect(activate).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    {},
    { draftId, expectedVersion: 0 },
    { draftId, expectedVersion: 1.5 },
    { draftId, expectedVersion: 2147483648 },
    { draftId: 'invalid', expectedVersion: 3 },
  ])('rejects invalid activation %j', async (body) => {
    const { controller, activate } = fixture();
    await expect(controller.activateBrandConfig(request(), body)).rejects.toMatchObject({
      status: 400,
    });
    expect(activate).not.toHaveBeenCalled();
  });
  it.each([
    'http://example.test/logo.png',
    'https://user@example.test/logo.png',
    'https://user:password@example.test/logo.png',
    'javascript:alert(1)',
    '/temporary/logo.png',
    'invalid',
  ])('rejects unsafe or temporary asset URL %s', async (logoUrl) => {
    const { controller, save } = fixture();
    await expect(
      controller.upsertBrandConfig({ expectedVersion: 0, config: { logoUrl } }, request())
    ).rejects.toMatchObject({ status: 400 });
    expect(save).not.toHaveBeenCalled();
  });
  it.each([
    'https://example.test/logo.png',
    `/api/public/branding/assets/${draftId}/${'a'.repeat(64)}`,
  ])('accepts persistent asset URLs without caller authority fields', async (logoUrl) => {
    const { controller, save } = fixture();
    await controller.upsertBrandConfig(
      {
        expectedVersion: 2,
        logoUploadKey: 'upload-key',
        config: { appTitle: 'Reviewed title', logoUrl },
        actor: 'forged',
        status: 'active',
      },
      request()
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ appTitle: 'Reviewed title', logoUrl }),
      'trusted-actor',
      2,
      'upload-key'
    );
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });
  it.each([
    { expectedVersion: -1, config: {} },
    { expectedVersion: 0, config: { primaryColor: 'red' } },
    { expectedVersion: 0, config: { numberStyle: 'arbitrary' } },
    { expectedVersion: 0, config: { darkMode: 'false' } },
  ])('rejects malformed saved configuration %j', async (body) => {
    const { controller, save } = fixture();
    await expect(controller.upsertBrandConfig(body, request())).rejects.toMatchObject({
      status: 400,
    });
    expect(save).not.toHaveBeenCalled();
  });
});
