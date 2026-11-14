import { afterEach, expect, it, vi } from 'vitest';
import {
  AiModelCircuitBreaker,
  EmailCircuitBreaker,
  limitRecoveryProbeSignal,
  PROVIDER_CONFIGURATION_PAUSE,
} from './email-breaker.js';

afterEach(() => vi.unstubAllEnvs());

const now = new Date('2026-11-14T10:00:00Z');
const degraded = { degraded: true, degradedReason: 'outage', cooldownUntil: null };

it.each(['0', '101', 'invalid', '9007199254740992'])(
  'refuses an invalid configured failure threshold (%s)',
  (limit) => {
    vi.stubEnv('NOTIFICATION_PROVIDER_CIRCUIT_FAILURES', limit);
    expect(() => new EmailCircuitBreaker({ query: vi.fn() })).toThrow(
      'NOTIFICATION_PROVIDER_CIRCUIT_FAILURES must be a positive integer'
    );
  }
);

it('claims the configured timed delivery probe and returns the same lease to the provider call', async () => {
  vi.stubEnv('NOTIFICATION_PROVIDER_CIRCUIT_FAILURES', '100');
  vi.stubEnv('NOTIFICATION_PROVIDER_CIRCUIT_WINDOW_MS', '600000');
  vi.stubEnv('NOTIFICATION_PROVIDER_CIRCUIT_COOLDOWN_MS', '600000');
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [degraded] })
    .mockResolvedValueOnce({ rows: [degraded] });
  const breaker = new EmailCircuitBreaker({ query }, undefined, { now: () => now });
  const before = performance.now();
  const claim = await breaker.decision('provider');
  expect(claim).toMatchObject({
    allow: true,
    kind: 'half_open',
    probeToken: '2026-11-14T10:00:30.000Z',
  });
  expect(query.mock.calls[1]?.[1]).toEqual(['provider', now, new Date(now.getTime() + 30_000)]);
  if (!claim.allow || claim.probeDeadlineMs === undefined) throw new Error('Missing timed probe');
  expect(claim.probeDeadlineMs).toBeGreaterThanOrEqual(before + 30_000);
});

it('honors configuration pause and re-reads authority when the probe claim loses', async () => {
  const paused = { ...degraded, degradedReason: PROVIDER_CONFIGURATION_PAUSE };
  const query = vi.fn().mockResolvedValueOnce({ rows: [paused] });
  const breaker = new EmailCircuitBreaker({ query }, undefined, { now: () => now });
  await expect(breaker.decision('paused')).resolves.toMatchObject({
    allow: false,
    cooldownUntil: null,
    degradedReason: PROVIDER_CONFIGURATION_PAUSE,
  });
  expect(query).toHaveBeenCalledOnce();
  query
    .mockResolvedValueOnce({ rows: [degraded] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [paused] });
  await expect(breaker.decision('paused')).resolves.toMatchObject({
    allow: false,
    cooldownUntil: null,
    degradedReason: PROVIDER_CONFIGURATION_PAUSE,
  });
  expect(query).toHaveBeenCalledTimes(4);
});

it('keeps AI probe claims and results in the AI state table', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [degraded] });
  const breaker = new AiModelCircuitBreaker({ query }, undefined, { now: () => now });
  const claim = await breaker.decision('model');
  expect(claim).toMatchObject({
    allow: true,
    kind: 'half_open',
    probeToken: '2026-11-14T10:01:00.000Z',
  });
  expect(claim).not.toHaveProperty('probeDeadlineMs');
  expect(query.mock.calls[1]?.[0]).toContain('UPDATE ai_model_circuit_states');
  await breaker.recordConnectionTest('model', true);
  expect(query.mock.calls[2]?.[0]).toContain('UPDATE ai_model_circuit_states');
});

it('bounds an accepted probe signal and propagates caller cancellation', () => {
  const controller = new AbortController();
  const deadline = performance.now() + 30_000;
  expect(limitRecoveryProbeSignal(deadline).aborted).toBe(false);
  const signal = limitRecoveryProbeSignal(deadline, controller.signal);
  controller.abort('cancelled by caller');
  expect(signal.reason).toBe('cancelled by caller');
  expect(() => limitRecoveryProbeSignal(performance.now() - 1)).toThrow(
    'Provider recovery probe expired'
  );
});
