import { expect, it, vi } from 'vitest';
import { staffOrderRead } from './staff-order-read.js';
const state = vi.hoisted(() => ({
  events: [] as string[],
  clients: [] as Array<{ query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({
    connect: async () => {
      state.events.push('connect');
      return state.clients.shift()!;
    },
  }),
}));
const actor = { userId: 'reader', sessionId: 'session', csrfToken: 'csrf' };
function clients() {
  state.events = [];
  const created = [1, 2].map((id) => ({
    query: vi.fn(async (sql: string) => {
      state.events.push(`${id}:${sql}`);
      return {
        rows: sql.startsWith('SELECT user_id')
          ? [{ user_id: actor.userId, is_admin: true }]
          : sql.includes('SELECT csrf_token')
            ? [{ csrf_token: actor.csrfToken, active: true, fresh: false }]
            : [],
      };
    }),
    release: vi.fn(() => state.events.push(`${id}:release`)),
  }));
  state.clients = [...created];
  return created;
}
it('releases a conflicted snapshot before retrying a pure read once', async () => {
  const c = clients();
  const work = vi
    .fn()
    .mockRejectedValueOnce({ code: '40001' })
    .mockResolvedValueOnce({ exact: '9007199254740993' });
  expect(await staffOrderRead(actor, work, { repeatableRead: true })).toEqual({
    exact: '9007199254740993',
  });
  expect(work).toHaveBeenCalledTimes(2);
  expect(state.events.indexOf('1:release')).toBeLessThan(state.events.lastIndexOf('connect'));
  expect(c[0]!.query).toHaveBeenCalledWith('ROLLBACK');
  expect(c[0]!.query).not.toHaveBeenCalledWith('COMMIT');
  expect(c[1]!.query).toHaveBeenCalledWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  expect(c[1]!.query).toHaveBeenCalledWith('COMMIT');
  for (const client of c) expect(client.release).toHaveBeenCalledTimes(1);
});
it('surfaces a second snapshot conflict after rollback without a third read', async () => {
  const c = clients(),
    error = { code: '40001' };
  const work = vi.fn().mockRejectedValue(error);
  await expect(staffOrderRead(actor, work, { repeatableRead: true })).rejects.toBe(error);
  expect(work).toHaveBeenCalledTimes(2);
  expect(state.events.filter((event) => event === 'connect')).toHaveLength(2);
  for (const client of c) {
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  }
});
it('does not retry an ordinary queue read on a serialization error', async () => {
  const c = clients(),
    error = { code: '40001' };
  const work = vi.fn().mockRejectedValue(error);
  await expect(staffOrderRead(actor, work)).rejects.toBe(error);
  expect(work).toHaveBeenCalledTimes(1);
  expect(c[0]!.query).toHaveBeenCalledWith('ROLLBACK');
  expect(c[0]!.release).toHaveBeenCalledTimes(1);
  expect(c[1]!.query).not.toHaveBeenCalled();
});
