import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { readWithCurrentAccount } from './account-session-read.js';
import { SessionController } from './session.controller.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { TrustedDevicesController } from './trusted-devices.controller.js';

const database = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => database.pool }));

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const actor = {
  userId: 'session-boundary-reader',
  sessionId: randomUUID(),
  csrfToken: randomUUID(),
};
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  database.pool = fixture.pool;
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test-only')",
    [actor.userId]
  );
}, 30_000);
afterAll(async () => {
  await fixture?.close();
  database.pool = undefined;
});

it('rejects missing and disabled read owners before calling the private reader', async () => {
  const read = vi.fn();
  await expect(
    readWithCurrentAccount({ ...actor, userId: 'missing-fixture-user' }, read)
  ).rejects.toMatchObject({ status: 401 });
  const disabled = 'disabled-fixture-user';
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,disabled_at) VALUES($1,$1,'test-only',now())",
    [disabled]
  );
  await expect(readWithCurrentAccount({ ...actor, userId: disabled }, read)).rejects.toMatchObject({
    status: 401,
  });
  expect(read).not.toHaveBeenCalled();
});

it('fails closed on a change during the read and keeps the previous session intact after rollback', async () => {
  await fixture.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '30 minutes')",
    [actor.sessionId, actor.userId, actor.csrfToken, randomUUID()]
  );
  const revisedProof = randomUUID();
  const read = vi.fn(async (client: import('pg').PoolClient) => {
    await client.query('UPDATE sessions SET csrf_token=$1 WHERE session_id=$2', [
      revisedProof,
      actor.sessionId,
    ]);
    return 'private-account-result';
  });
  await expect(readWithCurrentAccount(actor, read)).rejects.toMatchObject({
    status: 403,
    response: { error: ErrorCodes.AUTHZ_CSRF_INVALID.code },
  });
  expect(read).toHaveBeenCalledOnce();
  expect(
    (
      await fixture.pool.query('SELECT csrf_token FROM sessions WHERE session_id=$1', [
        actor.sessionId,
      ])
    ).rows
  ).toEqual([{ csrf_token: actor.csrfToken }]);
  await expect(readWithCurrentAccount(actor, async () => 'current-private-result')).resolves.toBe(
    'current-private-result'
  );
});

function auth(network: Partial<Pick<AuthenticatedRequest, 'ip' | 'socket' | 'cookies'>> = {}) {
  return {
    session: { ...actor, operatingContext: 'customer' },
    ...network,
  } as AuthenticatedRequest;
}

it('rejects invalid context input before calling the mutation or changing cookies', async () => {
  const service = { switchOperatingContext: vi.fn() };
  const controller = new SessionController(service as never);
  const cookie = vi.fn();
  const response = { cookie } as unknown as Response;
  for (const body of [undefined, { context: 'operator' }, { context: 'staff', userId: 'other' }]) {
    await expect(controller.switchContext(body, auth(), response)).rejects.toMatchObject({
      status: 400,
      response: { error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
    });
  }
  expect(service.switchOperatingContext).not.toHaveBeenCalled();
  expect(cookie).not.toHaveBeenCalled();
});

it('returns rotated cookies with socket or unknown attribution', async () => {
  const next = {
    sessionId: randomUUID(),
    csrfToken: randomUUID(),
    refreshToken: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const service = { switchOperatingContext: vi.fn().mockResolvedValue(next) };
  const controller = new SessionController(service as never);
  for (const [request, address] of [
    [
      auth({ socket: { remoteAddress: '192.0.2.15' } as AuthenticatedRequest['socket'] }),
      '192.0.2.15',
    ],
    [auth(), 'unknown'],
  ] as const) {
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    await expect(
      controller.switchContext({ context: 'staff' }, request, response as unknown as Response)
    ).resolves.toEqual({ operatingContext: 'staff' });
    expect(service.switchOperatingContext).toHaveBeenLastCalledWith(
      actor.sessionId,
      actor.userId,
      'customer',
      'staff',
      address
    );
    expect(response.cookie.mock.calls.map(([name, value]) => [name, value])).toEqual([
      ['barghsa_session', next.sessionId],
      ['barghsa_refresh', next.refreshToken],
      ['barghsa_csrf', next.csrfToken],
    ]);
  }
});

it('uses only a checked device cookie for read proof and validates revocations before delegation', async () => {
  const service = {
    getTrustedDevices: vi.fn().mockResolvedValue([]),
    revokeDeviceTrust: vi.fn().mockResolvedValue({ revoked: true }),
  };
  const controller = new TrustedDevicesController(service as never);
  const request = auth();
  const revocation = { status: 400, response: { error: ErrorCodes.VALIDATION_INPUT_INVALID.code } };
  for (const id of ['', 'a'.repeat(129)]) {
    expect(() => controller.revoke(id, request)).toThrow(expect.objectContaining(revocation));
  }
  expect(() => controller.revokeAll(request, { userId: 'other' })).toThrow(
    expect.objectContaining(revocation)
  );
  expect(service.revokeDeviceTrust).not.toHaveBeenCalled();
  await expect(controller.revoke('legacy-device', request)).resolves.toEqual({ revoked: true });
  await expect(controller.revokeAll(request)).resolves.toEqual({ revoked: true });
  expect(service.revokeDeviceTrust.mock.calls).toEqual([
    [actor.userId, actor.sessionId, 'legacy-device', null],
    [actor.userId, actor.sessionId, null, null],
  ]);
  const proof = 'a'.repeat(64);
  await controller.list(auth({ cookies: { barghsa_device: proof } }));
  await controller.list(request);
  expect(service.getTrustedDevices.mock.calls).toEqual([
    [actor.userId, createHash('sha256').update(proof).digest('hex')],
    [actor.userId, null],
  ]);
});
