import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationTemplateService } from './notification-template.service.js';
import type { NotificationsService } from './notifications.service.js';

const actor = {
  userId: 'staff',
  sessionId: '00000000-0000-4000-8000-000000000001',
  csrfToken: 'template-fixture-csrf',
};
const sessionRow = {
  active: true,
  fresh: true,
  csrf_token: actor.csrfToken,
  step_up_verified_at: new Date('2026-09-09T00:00:00Z'),
};

const { query, send, sms, prepareSms } = vi.hoisted(() => ({
  query: vi.fn(),
  send: vi.fn(),
  sms: vi.fn(),
  prepareSms: vi.fn(),
}));
vi.mock('@barghsa/shared/notification-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@barghsa/shared/notification-delivery')>()),
  createEmailSender: () => send,
  createSmsSender: () => sms,
  prepareSmsMessage: prepareSms,
}));
vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({ query, connect: async () => ({ query, release: vi.fn() }) }),
}));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: vi.fn(),
}));

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ ...sessionRow, username: 'staff@example.test' }] });
  send.mockReset();
  send.mockRejectedValue(new Error('unavailable'));
  sms.mockReset();
  prepareSms.mockReset();
  prepareSms.mockRejectedValue(new Error('unavailable'));
});

function service(channel: 'email' | 'sms' | 'in_app') {
  const create = vi.fn().mockResolvedValue({ id: 'inbox-test' });
  const instance = new NotificationTemplateService({ create } as unknown as NotificationsService);
  const lockTemplate = vi
    .spyOn(
      instance as unknown as { lockTemplate: () => Promise<Record<string, unknown>> },
      'lockTemplate'
    )
    .mockResolvedValue({
      id: 'template',
      event_key: 'invoice.created',
      channel,
      locale: 'en',
      subject: 'Invoice',
      body_template: 'Test body',
      variables: [],
      status: 'draft',
      is_active: false,
      version: 1,
      published_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  return { instance, create, lockTemplate };
}

it.each(['email', 'sms', 'in_app'] as const)(
  'does not dispatch %s after the session expires while template settings are locked',
  async (channel) => {
    const { instance, create, lockTemplate } = service(channel);
    const template = await lockTemplate();
    lockTemplate.mockImplementation(async () => {
      query.mockResolvedValue({
        rows: [{ ...sessionRow, active: false, username: 'staff@example.test' }],
      });
      return template;
    });
    await expect(
      instance.testSend(
        'template',
        actor,
        channel === 'in_app' ? undefined : { destination: 'staff@example.test' }
      )
    ).rejects.toMatchObject({ status: 401 });
    expect(send).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
    expect(prepareSms).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_log') || sql === 'COMMIT')
    ).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  }
);

describe('truthful notification template tests', () => {
  it.each(['email', 'sms'] as const)(
    'refuses to mark %s delivered through the inbox',
    async (channel) => {
      const { instance, create } = service(channel);
      await expect(
        instance.testSend('template', actor, { destination: 'staff@example.test' })
      ).rejects.toMatchObject({ status: 503 });
      expect(create).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(
          ([sql, params]) =>
            sql.includes('UPDATE notification_templates') && params[1] === 'delivered'
        )
      ).toBe(false);
      expect(
        query.mock.calls.some(
          ([sql, params]) => sql.includes('UPDATE notification_templates') && params[1] === 'failed'
        )
      ).toBe(true);
      const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_log'));
      expect(JSON.parse(audit![1][3])).toMatchObject({
        status: 'failed',
        destinationKind: channel,
        deliveredTo: null,
      });
    }
  );
  it('still delivers an in-app test to the acting staff inbox', async () => {
    const { instance, create } = service('in_app');
    expect(await instance.testSend('template', actor)).toEqual({
      ok: true,
      destination: 'in_app',
      lastTestStatus: 'delivered',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff' }),
      expect.objectContaining({ query })
    );
  });
  it.each([undefined, 'production', 'staging', 'preview'])(
    'rejects test allowlists in %s',
    (NODE_ENV) => {
      expect(
        NotificationTemplateService.isDestinationAllowed([], 'test@example.test', {
          ...(NODE_ENV ? { NODE_ENV } : {}),
          TEST_SEND_ALLOWLIST: 'test@example.test',
        })
      ).toBe(false);
    }
  );
  it.each(['test', 'development'])(
    'permits explicit %s allowlists and own verified contacts',
    (NODE_ENV) => {
      expect(
        NotificationTemplateService.isDestinationAllowed([], 'test@example.test', {
          NODE_ENV,
          TEST_SEND_ALLOWLIST: 'test@example.test',
        })
      ).toBe(true);
      expect(
        NotificationTemplateService.isDestinationAllowed(['OWN@example.test'], 'own@example.test', {
          NODE_ENV: 'production',
        })
      ).toBe(true);
    }
  );
});

it('uses the email provider receipt and never inserts an inbox substitute', async () => {
  const { instance, create } = service('email');
  send.mockResolvedValue('email-receipt');
  expect(await instance.testSend('template', actor, { destination: 'staff@example.test' })).toEqual(
    { ok: true, destination: 'email', lastTestStatus: 'delivered' }
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      destination: 'staff@example.test',
      subject: 'Invoice',
      html: expect.stringContaining('Test body'),
    })
  );
  expect(create).not.toHaveBeenCalled();
  const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_log'));
  expect(JSON.parse(audit![1][3])).toMatchObject({
    deliveredTo: 'email',
    providerRef: 'email-receipt',
    status: 'delivered',
  });
});
it('rejects an arbitrary third-party destination before contacting the provider', async () => {
  const { instance } = service('email');
  await expect(
    instance.testSend('template', actor, { destination: 'stranger@example.test' })
  ).rejects.toMatchObject({ status: 403 });
  expect(send).not.toHaveBeenCalled();
});

it('records a mapped SMS receipt without an inbox substitute', async () => {
  query.mockResolvedValue({ rows: [{ ...sessionRow, username: '+989121234567' }] });
  const { instance, create } = service('sms');
  const message = {
    providerId: 'sms-provider',
    destination: '+989121234567',
    templateId: '42',
    parameters: [],
  };
  prepareSms.mockResolvedValue(message);
  sms.mockResolvedValue('123');
  expect(await instance.testSend('template', actor, { destination: '+989121234567' })).toEqual({
    ok: true,
    destination: 'sms',
    lastTestStatus: 'delivered',
  });
  expect(sms).toHaveBeenCalledWith(message);
  expect(create).not.toHaveBeenCalled();
  const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_log'));
  expect(JSON.parse(audit![1][3])).toMatchObject({ deliveredTo: 'sms', providerRef: '123' });
});

it.each(['fa', 'en'] as const)(
  'uses the same active branding in %s saved preview and test delivery',
  async (locale) => {
    const { instance, lockTemplate } = service('email');
    const template = { ...(await lockTemplate()), locale };
    lockTemplate.mockResolvedValue(template);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM brand_config'))
        return {
          rows: [
            {
              config: {
                appTitle: 'Current <brand>',
                primaryColor: '#123456',
                slogan: 'Clean power',
              },
            },
          ],
        };
      if (sql.includes('FROM notification_templates')) return { rows: [template] };
      return { rows: [{ ...sessionRow, username: 'staff@example.test' }] };
    });
    send.mockResolvedValue('email-receipt');
    const preview = await instance.preview('template');
    await instance.testSend('template', actor, { destination: 'staff@example.test' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: preview.body }));
    expect(preview.body).toContain('Current &lt;brand&gt;');
    expect(preview.body).toContain('#123456');
    expect(preview.body).toContain(`dir="${locale === 'fa' ? 'rtl' : 'ltr'}"`);
  }
);

it('does not relabel a sent email as failed when its audit cannot persist', async () => {
  const { instance } = service('email');
  send.mockResolvedValue('email-receipt');
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO audit_log')) throw new Error('audit unavailable');
    return { rows: [{ ...sessionRow, username: 'staff@example.test' }] };
  });
  await expect(
    instance.testSend('template', actor, { destination: 'staff@example.test' })
  ).rejects.toThrow('audit unavailable');
  expect(send).toHaveBeenCalledOnce();
  expect(
    query.mock.calls.some(
      ([sql, params]) => sql.includes('UPDATE notification_templates') && params[1] === 'failed'
    )
  ).toBe(false);
  expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
});
