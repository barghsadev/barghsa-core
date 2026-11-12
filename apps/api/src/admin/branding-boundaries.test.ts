import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const draftId = '11111111-2222-4333-8444-555555555555';
function request(permissions = ['admin:branding:edit']): AuthenticatedRequest {
  return {
    session: {
      operatingContext: 'staff',
      userId: 'trusted-actor',
      sessionId: '22222222-3333-4444-8555-666666666666',
      csrfToken: 'fixture-csrf',
      permissions,
      isAdmin: false,
    },
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
    await expect(
      controller.activateBrandConfig(req, { draftId, expectedVersion: 3, actor: 'forged' })
    ).rejects.toMatchObject({ status: 400 });
    expect(activate).not.toHaveBeenCalled();
    await controller.activateBrandConfig(req, { draftId, expectedVersion: 3 });
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
    const body = {
      expectedVersion: 2,
      logoUploadKey: 'upload-key',
      config: { appTitle: 'Reviewed title', logoUrl },
    };
    for (const invalid of [
      { ...body, actor: 'forged', status: 'active' },
      { ...body, config: { ...body.config, privateField: 'private-value' } },
    ]) {
      const error: unknown = await controller
        .upsertBrandConfig(invalid, request())
        .catch((cause: unknown) => cause);
      expect(error).toMatchObject({ status: 400 });
      expect(JSON.stringify(error)).not.toContain('privateField');
      expect(JSON.stringify(error)).not.toContain('private-value');
    }
    expect(save).not.toHaveBeenCalled();
    await controller.upsertBrandConfig(body, request());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ appTitle: 'Reviewed title', logoUrl }),
      request().session,
      2,
      'upload-key',
      undefined,
      undefined
    );
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });
  it.each([
    { expectedVersion: -1, config: {} },
    { expectedVersion: 0, config: { primaryColor: 'red' } },
    { expectedVersion: 0, config: { numberStyle: 'arbitrary' } },
    { expectedVersion: 0, config: { darkMode: 'false' } },
    { expectedVersion: 0, config: { themeMode: 'automatic' } },
    { expectedVersion: 0, config: { backgroundColor: '#15201c' } },
    { expectedVersion: 0, config: { darkBackgroundColor: '#f6f7f4' } },
    { expectedVersion: 0, config: { fontFamily: 'remote-font' } },
    { expectedVersion: 0, config: { borderRadiusRem: 4 } },
    { expectedVersion: 0, config: { spacingScale: 2 } },
  ])('rejects malformed saved configuration %j', async (body) => {
    const { controller, save } = fixture();
    await expect(controller.upsertBrandConfig(body, request())).rejects.toMatchObject({
      status: 400,
    });
    expect(save).not.toHaveBeenCalled();
  });
  it('accepts readable colors and bounded layout choices as a draft', async () => {
    const { controller, save } = fixture();
    await controller.upsertBrandConfig(
      {
        expectedVersion: 2,
        config: {
          backgroundColor: '#eef2e8',
          darkBackgroundColor: '#101b17',
          fontFamily: 'tahoma',
          borderRadiusRem: 1,
          spacingScale: 1.125,
        },
      },
      request()
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: '#eef2e8',
        darkBackgroundColor: '#101b17',
        fontFamily: 'tahoma',
        borderRadiusRem: 1,
        spacingScale: 1.125,
      }),
      request().session,
      2,
      undefined,
      undefined,
      undefined
    );
  });
});

it('forwards a favicon upload with the trusted actor and validates its type and bound', async () => {
  const { controller, save } = fixture();
  await controller.upsertBrandConfig(
    { expectedVersion: 2, faviconUploadKey: 'verified-favicon', config: {} },
    request()
  );
  expect(save).toHaveBeenCalledWith(
    expect.any(Object),
    request().session,
    2,
    undefined,
    'verified-favicon',
    undefined
  );
  for (const faviconUploadKey of [42, 'x'.repeat(256)]) {
    await expect(
      controller.upsertBrandConfig({ expectedVersion: 2, faviconUploadKey, config: {} }, request())
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(save).toHaveBeenCalledOnce();
});

it.each(['light', 'dark', 'system'] as const)(
  'saves explicit %s policy with a consistent legacy boolean',
  async (themeMode) => {
    const { controller, save } = fixture();
    await controller.upsertBrandConfig(
      { expectedVersion: 2, config: { themeMode, darkMode: themeMode !== 'dark' } },
      request()
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ themeMode, darkMode: themeMode === 'dark' }),
      request().session,
      2,
      undefined,
      undefined,
      undefined
    );
  }
);

it('forwards only validated dark branding and the trusted editor to the existing transaction', async () => {
  const { controller, save } = fixture();
  await controller.upsertBrandConfig(
    {
      expectedVersion: 2,
      logoDarkUploadKey: 'verified-dark-logo',
      config: {
        darkPrimaryColor: '#abcdef',
        darkSecondaryColor: '#234567',
        darkAccentColor: '#567890',
      },
    },
    request()
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      darkPrimaryColor: '#abcdef',
      darkSecondaryColor: '#234567',
      darkAccentColor: '#567890',
    }),
    request().session,
    2,
    undefined,
    undefined,
    'verified-dark-logo'
  );
  for (const field of [
    'darkPrimaryColor',
    'darkSecondaryColor',
    'darkAccentColor',
    'logoDarkUrl',
  ]) {
    await expect(
      controller.upsertBrandConfig(
        { expectedVersion: 2, config: { [field]: 'javascript:alert(1)' } },
        request()
      )
    ).rejects.toMatchObject({ status: 400 });
  }
  for (const logoDarkUploadKey of [42, 'x'.repeat(256)])
    await expect(
      controller.upsertBrandConfig({ expectedVersion: 2, logoDarkUploadKey, config: {} }, request())
    ).rejects.toMatchObject({ status: 400 });
  expect(save).toHaveBeenCalledOnce();
});
