import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', undefined);
  vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', undefined);
});

afterEach(() => vi.unstubAllEnvs());

it('uses a 30-minute idle window and 24-hour absolute window by default', async () => {
  vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '');
  const settings = await import('./session-lifetime.js');

  expect(settings.SESSION_IDLE_TIMEOUT_MS).toBe(1_800_000);
  expect(settings.SESSION_ABSOLUTE_TIMEOUT_MS).toBe(86_400_000);
});

it('uses shorter configured idle and absolute windows', async () => {
  vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '5');
  vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '2');
  const settings = await import('./session-lifetime.js');

  expect(settings.SESSION_IDLE_TIMEOUT_MS).toBe(300_000);
  expect(settings.SESSION_ABSOLUTE_TIMEOUT_MS).toBe(7_200_000);
});

it.each([
  ['SESSION_IDLE_TIMEOUT_MINUTES', '0'],
  ['SESSION_IDLE_TIMEOUT_MINUTES', '31'],
  ['SESSION_ABSOLUTE_TIMEOUT_HOURS', '0'],
  ['SESSION_ABSOLUTE_TIMEOUT_HOURS', '25'],
  ['SESSION_IDLE_TIMEOUT_MINUTES', '5.5'],
  ['SESSION_ABSOLUTE_TIMEOUT_HOURS', 'garbage'],
])('rejects invalid %s=%s', async (key, value) => {
  vi.stubEnv(key, value);
  await expect(import('./session-lifetime.js')).rejects.toThrow(key);
});
