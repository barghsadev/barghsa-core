import { getDbPool } from '@barghsa/db';
import { expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { recheckStaffAuthorityAfter, withStaffReadAuthority } from './staff-read-authority.js';

vi.mock('@barghsa/db', () => ({ getDbPool: vi.fn() }));

const actor = { userId: 'reader', sessionId: 'staff-session', csrfToken: 'fixture-csrf' };
const permission = 'admin:branding:read';

function fixture(context = 'staff') {
  const active = vi.fn(() => true);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM users WHERE')) return { rows: [{ user_id: actor.userId }] };
    if (sql.includes('FROM user_roles')) return { rows: [{ permissions: [permission] }] };
    if (sql.includes('SELECT csrf_token'))
      return { rows: [{ active: active(), csrf_token: actor.csrfToken }] };
    if (sql.includes('SELECT current_setting')) return { rows: [{ context }] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  vi.mocked(getDbPool).mockReturnValue({
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as ReturnType<typeof getDbPool>);
  return { active, client, query };
}

it('prevents a current customer context from reading with a staff grant', async () => {
  const { client, query } = fixture('customer');
  const read = vi.fn();
  await expect(withStaffReadAuthority(actor, permission, read)).rejects.toMatchObject({
    status: 403,
  });
  expect(read).not.toHaveBeenCalled();
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledOnce();
});

it('withholds the result if the current session expires during the read', async () => {
  const { active, client, query } = fixture();
  const read = vi.fn(async () => {
    active.mockReturnValue(false);
    return 'private branding asset';
  });
  await expect(withStaffReadAuthority(actor, permission, read)).rejects.toMatchObject({
    status: 401,
    response: { error: ErrorCodes.AUTH_UNAUTHENTICATED.code },
  });
  expect(read).toHaveBeenCalledWith(client);
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledOnce();
});

it('returns external data only after checking the exact staff permission and live session', async () => {
  const { active, client, query } = fixture();
  const read = vi.fn(async () => 'visible data');
  await expect(recheckStaffAuthorityAfter(actor, permission, read)).resolves.toBe('visible data');
  expect(query).toHaveBeenLastCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledOnce();
  expect(active).toHaveBeenCalledTimes(2);
  await expect(
    recheckStaffAuthorityAfter(actor, 'admin:branding:edit', read)
  ).rejects.toMatchObject({ status: 403 });
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
});
