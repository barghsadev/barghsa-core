import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as DbModule from '@barghsa/db';
import { InputFieldException } from '../common/input-field.exception.js';
import { TicketsService } from './tickets.service.js';

const h = vi.hoisted(() => ({ connect: vi.fn(), access: vi.fn(), current: vi.fn() }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof DbModule>()),
  getDbPool: () => ({ connect: h.connect }),
}));
vi.mock('./ticket-actor.js', async (original) => ({
  ...(await original<typeof import('./ticket-actor.js')>()),
  authorizeTicketAccess: h.access,
}));
vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: h.current,
  requireSessionStepUp: vi.fn(),
}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recordId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actor = { userId: 'opaque-user', sessionId: id, csrfToken: 'current-token' };
beforeEach(() => {
  vi.resetAllMocks();
  h.access.mockResolvedValue({ canWrite: true, canAssignOthers: true });
  h.current.mockResolvedValue(undefined);
});
function fixture() {
  const state = { profile: true, record: true, ticket: true };
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('FROM profiles')
        ? state.profile
          ? [{ id: profileId }]
          : []
        : sql.includes('FROM tickets')
          ? state.ticket
            ? [{ id }]
            : []
          : /FROM (orders|contracts|invoices)/.test(sql)
            ? state.record
              ? [{ id: recordId }]
              : []
            : [],
    })),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  const service = new TicketsService();
  const choose = vi.spyOn(service['assignmentService'], 'choose');
  const seal = vi.spyOn(service['attachmentService'], 'seal');
  const notify = vi.spyOn(service['notifications'], 'create');
  return { state, client, service, choose, seal, notify };
}
function noEffects(f: ReturnType<typeof fixture>) {
  expect(f.choose).not.toHaveBeenCalled();
  expect(f.seal).not.toHaveBeenCalled();
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.client.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
    /INSERT|UPDATE tickets|DELETE|idempotency_keys|pg_advisory|audit_log|notifications/
  );
}
it('invalid creation verifies current actor, profile and published record without business work', async () => {
  const f = fixture();
  await expect(
    f.service.createTicket(
      actor.userId,
      {
        subject: '',
        body: 'Details',
        profileId,
        relatedEntityType: 'contract',
        relatedEntityId: recordId,
      },
      actor
    )
  ).rejects.toMatchObject({ fields: ['subject'] });
  expect(h.access).toHaveBeenCalledExactlyOnceWith(f.client, actor, actor.userId, false);
  expect(f.client.query).toHaveBeenCalledWith(expect.stringContaining('contract_publications'), [
    recordId,
    profileId,
  ]);
  expect(h.current).toHaveBeenCalledExactlyOnceWith(f.client, actor);
  expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  noEffects(f);
});
it.each([false, true, 'assigned'] as const)(
  '%s ticket feedback uses fresh owner or assigned scope',
  async (scope) => {
    const f = fixture();
    if (scope === 'assigned')
      h.access.mockResolvedValue({ scope: actor.userId, canWrite: true, canAssignOthers: false });
    await f.service.assertTicketFormAuthority(actor, id, !!scope);
    expect(h.access).toHaveBeenCalledExactlyOnceWith(
      f.client,
      actor,
      actor.userId,
      scope ? 'write' : false
    );
    expect(f.client.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'), [
      id,
      scope ? null : actor.userId,
      scope === 'assigned' ? actor.userId : null,
    ]);
    expect(h.current).toHaveBeenCalledOnce();
    noEffects(f);
  }
);
it.each(['profile', 'record', 'ticket'] as const)(
  'missing current %s cannot disclose owned metadata',
  async (resource) => {
    const f = fixture();
    f.state[resource] = false;
    const command =
      resource === 'ticket'
        ? f.service.assertTicketFormAuthority(actor, id, true)
        : f.service.createTicket(
            actor.userId,
            {
              subject: '',
              body: 'Details',
              profileId,
              relatedEntityType: 'invoice',
              relatedEntityId: recordId,
            },
            actor
          );
    await expect(command).rejects.toMatchObject({ status: 404 });
    expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    noEffects(f);
  }
);
it.each([401, 403])(
  'current authority %s prevents creation field feedback before resource reads',
  async (status) => {
    const f = fixture();
    h.access.mockRejectedValue(new HttpException('Current authority denied', status));
    await expect(
      f.service.createTicket(actor.userId, { subject: '', body: 'Details', profileId }, actor)
    ).rejects.toMatchObject({ status });
    expect(f.client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    noEffects(f);
  }
);
it('expiry after current resource lookup rolls back before field metadata is created', async () => {
  const f = fixture();
  h.current.mockRejectedValue(new HttpException('Expired', 401));
  await expect(
    f.service.createTicket(actor.userId, { subject: '', body: 'Details', profileId }, actor)
  ).rejects.toMatchObject({ status: 401 });
  expect(f.client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  noEffects(f);
});
it('protected, mixed and legacy actorless creation failures never run feedback queries', async () => {
  const f = fixture();
  for (const body of [
    { subject: '', body: 'Details', profileId: 'PRIVATE' },
    { subject: '', body: 'Details', idempotencyKey: 'PRIVATE' },
    { subject: null, body: 'Details' },
    { subject: '', body: 'Details', PRIVATE: true },
  ]) {
    try {
      await f.service.createTicket(actor.userId, body as never, actor);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
  }
  await expect(
    f.service.createTicket(actor.userId, { subject: '', body: 'Details' })
  ).rejects.not.toBeInstanceOf(InputFieldException);
  expect(h.connect).not.toHaveBeenCalled();
  expect(h.access).not.toHaveBeenCalled();
  noEffects(f);
});
it('malformed resource or protected create pairing is refused before SQL', async () => {
  const f = fixture();
  await expect(f.service.assertTicketFormAuthority(actor, 'PRIVATE', true)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    f.service.assertCanCreateTicket(actor, { profileId: 'PRIVATE' })
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    f.service.assertCanCreateTicket(actor, {
      relatedEntityType: 'invoice',
      relatedEntityId: recordId,
    })
  ).rejects.toMatchObject({ status: 400 });
  expect(h.connect).not.toHaveBeenCalled();
  noEffects(f);
});
