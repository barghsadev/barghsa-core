import { afterEach, expect, it, vi } from 'vitest';
import { privateLogId } from './log-privacy.js';

afterEach(() => vi.unstubAllEnvs());

it('uses stable keyed references and separates identifier kinds', () => {
  vi.stubEnv('SESSION_SECRET', 'test-log-key-a');
  const id = 'raw-identity';
  const actor = privateLogId('actor', id);
  const profile = privateLogId('profile', id);
  expect(actor).toMatch(/^actor:[a-f0-9]{32}$/);
  expect(actor).toBe(privateLogId('actor', id));
  expect(profile).toMatch(/^profile:[a-f0-9]{32}$/);
  expect(profile.split(':')[1]).not.toBe(actor.split(':')[1]);
  expect(privateLogId('actor', 'another-identity')).not.toBe(actor);

  vi.stubEnv('SESSION_SECRET', 'test-log-key-b');
  expect(privateLogId('actor', id)).not.toBe(actor);
});

it('keeps the raw identifier out of logs when the key or identifier is unavailable', () => {
  vi.stubEnv('SESSION_SECRET', undefined);
  expect(privateLogId('actor', 'raw-identity')).toBe('unavailable');

  vi.stubEnv('SESSION_SECRET', 'test-log-key');
  expect(privateLogId('profile', null)).toBe('unavailable');
});
