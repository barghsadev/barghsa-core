import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TestProject } from 'vitest/node';
const state = vi.hoisted(() => ({
  start: vi.fn(),
  up: vi.fn(),
  projectName: vi.fn(),
  environment: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
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
vi.mock('testcontainers', () => ({
  DockerComposeEnvironment: class {
    withProjectName(name: string) {
      state.projectName(name);
      return this;
    }
    withEnvironment(environment: Record<string, string>) {
      state.environment(environment);
      return this;
    }
    up = state.up;
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
  vi.stubEnv('BARGHSA_TEST_POSTGRES_COMPOSE', '0');
  state.query.mockResolvedValue({ rows: [] });
  state.end.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
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

it('uses separate Compose projects, loopback ports and passwords for concurrent test runs', async () => {
  vi.stubEnv('BARGHSA_TEST_POSTGRES_COMPOSE', '1');
  const first = {
    getContainer: vi.fn().mockReturnValue({ getMappedPort: vi.fn().mockReturnValue(45231) }),
    down: vi.fn().mockResolvedValue(undefined),
  };
  const second = {
    getContainer: vi.fn().mockReturnValue({ getMappedPort: vi.fn().mockReturnValue(45232) }),
    down: vi.fn().mockResolvedValue(undefined),
  };
  state.up.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const [databaseA, databaseB] = await Promise.all([startTestPostgres(), startTestPostgres()]);
  const a = new URL(databaseA.connectionString);
  const b = new URL(databaseB.connectionString);
  expect(a).toMatchObject({ hostname: '127.0.0.1', port: '45231', pathname: '/barghsa_test' });
  expect(b).toMatchObject({ hostname: '127.0.0.1', port: '45232', pathname: '/barghsa_test' });
  expect(a.password).toMatch(/^[a-f0-9]{48}$/);
  expect(b.password).toMatch(/^[a-f0-9]{48}$/);
  expect(a.password).not.toBe(b.password);
  expect(
    state.environment.mock.calls.map(([entry]) => entry.BARGHSA_TEST_POSTGRES_PASSWORD)
  ).toEqual([a.password, b.password]);
  expect(new Set(state.projectName.mock.calls.map(([name]) => name)).size).toBe(2);
  expect(first.getContainer).toHaveBeenCalledWith('postgres-1');
  expect(second.getContainer).toHaveBeenCalledWith('postgres-1');
  expect(state.start).not.toHaveBeenCalled();
  await databaseA.close();
  expect(first.down).toHaveBeenCalledWith({ timeout: 30_000, removeVolumes: true });
  expect(second.down).not.toHaveBeenCalled();
  await databaseB.close();
  expect(second.down).toHaveBeenCalledWith({ timeout: 30_000, removeVolumes: true });
});

it('removes only the owned Compose project when mapped port discovery fails', async () => {
  vi.stubEnv('BARGHSA_TEST_POSTGRES_COMPOSE', '1');
  const down = vi.fn().mockResolvedValue(undefined);
  state.up.mockResolvedValue({
    down,
    getContainer: vi.fn().mockImplementation(() => {
      throw new Error('Container unavailable');
    }),
  });
  const target = project();
  await expect(setup(target)).rejects.toThrow('Container unavailable');
  expect(down).toHaveBeenCalledOnce();
  expect(state.query).not.toHaveBeenCalled();
  expect(target.config.env).toBeUndefined();
});
