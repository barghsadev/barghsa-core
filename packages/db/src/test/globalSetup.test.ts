import { beforeEach, expect, it, vi } from 'vitest';
import type { TestProject } from 'vitest/node';
const state = vi.hoisted(() => ({ start: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock('@testcontainers/postgresql', () => ({
  PostgreSqlContainer: class {
    withDatabase() {
      return this;
    }
    withUsername() {
      return this;
    }
    withPassword() {
      return this;
    }
    start = state.start;
  },
}));
vi.mock('pg', () => ({
  Pool: class {
    query = state.query;
    end = state.end;
  },
}));
import { setup, startTestPostgres } from './globalSetup';
function project(env?: Record<string, string>) {
  return { config: { env } } as unknown as TestProject;
}
function container(url: string) {
  return { getConnectionUri: () => url, stop: vi.fn().mockResolvedValue(undefined) };
}
beforeEach(() => {
  vi.resetAllMocks();
  state.query.mockResolvedValue({ rows: [] });
  state.end.mockResolvedValue(undefined);
});
it('keeps project environments and teardown ownership separate', async () => {
  const first = container('postgres://fixture-one'),
    second = container('postgres://fixture-two');
  state.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const a = project({ OTHER_TEST_SETTING: 'preserved' }),
    b = project();
  const previous = process.env.TEST_DATABASE_URL;
  const closeA = await setup(a),
    closeB = await setup(b);
  expect(a.config.env).toEqual({
    OTHER_TEST_SETTING: 'preserved',
    TEST_DATABASE_URL: 'postgres://fixture-one',
  });
  expect(b.config.env).toEqual({ TEST_DATABASE_URL: 'postgres://fixture-two' });
  expect(process.env.TEST_DATABASE_URL).toBe(previous);
  await closeA();
  expect(first.stop).toHaveBeenCalledOnce();
  expect(second.stop).not.toHaveBeenCalled();
  await closeB();
  expect(second.stop).toHaveBeenCalledOnce();
  expect(state.end).toHaveBeenCalledTimes(2);
});
for (const operation of ['query', 'end'] as const) {
  it(`stops its container when bootstrap ${operation} fails`, async () => {
    const started = container('postgres://fixture-failure');
    state.start.mockResolvedValueOnce(started);
    state[operation].mockRejectedValueOnce(new Error('bootstrap failed'));
    const target = project();
    await expect(setup(target)).rejects.toThrow('bootstrap failed');
    expect(started.stop).toHaveBeenCalledOnce();
    expect(target.config.env).toBeUndefined();
  });
}

it('gives standalone callers an explicit URL and owned cleanup without global environment mutation', async () => {
  const started = container('postgres://standalone');
  state.start.mockResolvedValue(started);
  const previous = process.env.TEST_DATABASE_URL;
  const database = await startTestPostgres();
  expect(database.connectionString).toBe('postgres://standalone');
  expect(process.env.TEST_DATABASE_URL).toBe(previous);
  expect(started.stop).not.toHaveBeenCalled();
  await database.close();
  expect(started.stop).toHaveBeenCalledOnce();
});
