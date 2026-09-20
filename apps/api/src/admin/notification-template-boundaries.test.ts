import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const permission = 'admin:notifications:edit';
const template = {
  eventKey: 'invoice.issued',
  channel: 'email',
  locale: 'en',
  bodyTemplate: 'Invoice {{reference}}',
};
function request(permissions = [permission], isAdmin = false): AuthenticatedRequest {
  return {
    session: {
      userId: 'trusted-actor',
      sessionId: 'trusted-session',
      csrfToken: 'trusted-csrf',
      permissions,
      isAdmin,
    },
    ip: '127.0.0.1',
  } as AuthenticatedRequest;
}
function fixture() {
  const call = vi.fn().mockResolvedValue({ id: 'template', ok: true });
  const service = { create: call, update: call, previewFromBody: call, testSend: call, list: call };
  return {
    call,
    controller: new AdminController(
      {} as never,
      {} as never,
      {} as never,
      service as never,
      {} as never
    ),
  };
}
const operations = [
  {
    name: 'create',
    run: (c: AdminController, r: AuthenticatedRequest) => c.createNotificationTemplate(template, r),
  },
  {
    name: 'edit',
    run: (c: AdminController, r: AuthenticatedRequest) =>
      c.updateNotificationTemplate('template', { bodyTemplate: 'Updated' }, r),
  },
  {
    name: 'preview',
    run: (c: AdminController, r: AuthenticatedRequest) =>
      c.previewNotificationTemplateBody({ bodyTemplate: 'Preview' }, r),
  },
  {
    name: 'test delivery',
    run: (c: AdminController, r: AuthenticatedRequest) =>
      c.testSendNotificationTemplate('template', {}, r),
  },
];
for (const operation of operations) {
  describe(operation.name, () => {
    it.each(
      [[], ['admin:jobs:view'], ['admin:notification-providers:edit']].map((permissions) => ({
        permissions,
      }))
    )('denies unrelated capabilities %j before any service call', async ({ permissions }) => {
      const { controller, call } = fixture();
      await expect(operation.run(controller, request(permissions))).rejects.toMatchObject({
        status: 403,
      });
      expect(call).not.toHaveBeenCalled();
    });
    it.each([[permission], ['*']].map((permissions) => ({ permissions })))(
      'accepts explicit capability %j',
      async ({ permissions }) => {
        const { controller, call } = fixture();
        await operation.run(controller, request(permissions));
        expect(call).toHaveBeenCalledOnce();
      }
    );
    it('honors admin access and subsequent revocation', async () => {
      const { controller, call } = fixture();
      const req = request([], true);
      await operation.run(controller, req);
      req.session.isAdmin = false;
      await expect(operation.run(controller, req)).rejects.toMatchObject({ status: 403 });
      expect(call).toHaveBeenCalledOnce();
    });
  });
}

describe('notification template input boundaries', () => {
  it.each([
    null,
    { ...template, channel: 'push' },
    { ...template, locale: 'fr' },
    { ...template, bodyTemplate: '' },
    { ...template, variables: [42] },
  ])('rejects invalid creation %j', async (body) => {
    const { controller, call } = fixture();
    await expect(controller.createNotificationTemplate(body, request())).rejects.toMatchObject({
      status: 400,
    });
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { actor: 'forged' },
    { bodyTemplate: '' },
    { subject: 42 },
    { variables: [''] },
  ])('rejects invalid or empty edits %j', async (body) => {
    const { controller, call } = fixture();
    await expect(
      controller.updateNotificationTemplate('template', body, request())
    ).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  });
  it.each([null, { bodyTemplate: '' }, { bodyTemplate: 'Hi', sampleData: { user: {} } }])(
    'rejects malformed preview %j',
    async (body) => {
      const { controller, call } = fixture();
      await expect(
        controller.previewNotificationTemplateBody(body, request())
      ).rejects.toMatchObject({ status: 400 });
      expect(call).not.toHaveBeenCalled();
    }
  );
  it.each([{ destination: 42 }, { destination: 'a'.repeat(321) }])(
    'rejects malformed test destinations',
    async (body) => {
      const { controller, call } = fixture();
      await expect(
        controller.testSendNotificationTemplate('template', body, request())
      ).rejects.toMatchObject({ status: 400 });
      expect(call).not.toHaveBeenCalled();
    }
  );
  it('binds creation to the authenticated actor and strips caller authority fields', async () => {
    const { controller, call } = fixture();
    await controller.createNotificationTemplate(
      { ...template, userId: 'forged', status: 'active' },
      request()
    );
    expect(call).toHaveBeenCalledWith(
      { ...template, subject: null, variables: [] },
      request().session
    );
  });
  it.each([
    { subject: null },
    { bodyTemplate: 'Replacement' },
    { variables: [] },
    {
      subject: 'Updated',
      bodyTemplate: 'Body',
      variables: [{ name: 'reference', description: 'Invoice reference' }],
    },
  ])('preserves partial edits without clearing omitted fields %j', async (body) => {
    const { controller, call } = fixture();
    await controller.updateNotificationTemplate(
      'template',
      { ...body, actor: 'forged', status: 'active' },
      request()
    );
    expect(call).toHaveBeenCalledWith('template', body, request().session);
  });
  it('keeps preview sample data separate from delivery', async () => {
    const { controller, call } = fixture();
    await controller.previewNotificationTemplateBody(
      { bodyTemplate: 'Hi {{user}}', variables: ['user'], sampleData: { user: 'Example' } },
      request()
    );
    expect(call).toHaveBeenCalledWith('Hi {{user}}', ['user'], { user: 'Example' }, {});
  });
  it('trims an explicit test destination and binds the initiating actor', async () => {
    const { controller, call } = fixture();
    await controller.testSendNotificationTemplate(
      'template',
      { destination: ' test@example.test ', userId: 'forged' },
      request()
    );
    expect(call).toHaveBeenCalledWith('template', request().session, {
      destination: 'test@example.test',
    });
  });
  it('uses configured delivery when no override is supplied', async () => {
    const { controller, call } = fixture();
    await controller.testSendNotificationTemplate('template', undefined, request());
    expect(call).toHaveBeenCalledWith('template', request().session, undefined);
  });
});
