import { ConflictException, ForbiddenException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { canTransitionState, runBusinessTransition } from './business-transition.js';

it('rejects undeclared and inherited states before reading guards or causing effects', async () => {
  const transitions = { pending: ['approved'], approved: [] };
  const guard = vi.fn(),
    effect = vi.fn(),
    notify = vi.fn();
  for (const from of ['approved', 'missing', '__proto__', 'constructor']) {
    expect(canTransitionState(transitions, from, 'approved')).toBe(false);
    await expect(
      runBusinessTransition({
        from,
        to: 'approved',
        canTransition: (a, b) => canTransitionState(transitions, a, b),
        conflict: 'Reload',
        guard,
        effect,
        notify,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  }
  expect(guard).not.toHaveBeenCalled();
  expect(effect).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

it('awaits the current guard and passes its confirmed context through effects and notification', async () => {
  const events: string[] = [];
  const context = { reviewHash: 'confirmed', profileId: 'owner' };
  let release!: (value: typeof context) => void;
  const guarded = new Promise<typeof context>((resolve) => {
    release = resolve;
  });
  const response = { status: 'approved', id: 'original-reference' };
  const pending = runBusinessTransition({
    from: 'pending',
    to: 'approved',
    canTransition: () => true,
    conflict: 'Reload',
    guard: () => {
      events.push('guard');
      return guarded;
    },
    effect: async (confirmed) => {
      expect(confirmed).toBe(context);
      events.push('effect');
      return response;
    },
    notify: async (result, confirmed) => {
      expect(result).toBe(response);
      expect(confirmed).toBe(context);
      events.push('notify');
    },
  });
  expect(events).toEqual(['guard']);
  release(context);
  expect(await pending).toBe(response);
  expect(events).toEqual(['guard', 'effect', 'notify']);
});

it.each(['permission', 'review', 'prerequisite'] as const)(
  'causes no effect or notification when the %s guard rejects',
  async () => {
    const failure = new ForbiddenException('Current guard denied');
    const effect = vi.fn(),
      notify = vi.fn();
    await expect(
      runBusinessTransition({
        from: 'pending',
        to: 'approved',
        canTransition: () => true,
        conflict: 'Reload',
        guard: async () => {
          throw failure;
        },
        effect,
        notify,
      })
    ).rejects.toBe(failure);
    expect(effect).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  }
);

it('does not notify after a failed effect and propagates failure to the transaction owner', async () => {
  const failure = new Error('State/audit failed'),
    notify = vi.fn();
  await expect(
    runBusinessTransition({
      from: 'pending',
      to: 'approved',
      canTransition: () => true,
      conflict: 'Reload',
      guard: () => 'confirmed',
      effect: async () => {
        throw failure;
      },
      notify,
    })
  ).rejects.toBe(failure);
  expect(notify).not.toHaveBeenCalled();
});

it('does not return success before notification completes and propagates its failure for rollback', async () => {
  const failure = new Error('Notification insert failed');
  const effects: string[] = [];
  await expect(
    runBusinessTransition({
      from: 'pending',
      to: 'approved',
      canTransition: () => true,
      conflict: 'Reload',
      guard: () => 'confirmed',
      effect: async () => {
        effects.push('state-and-audit');
        return 'saved';
      },
      notify: async () => {
        effects.push('notification');
        throw failure;
      },
    })
  ).rejects.toBe(failure);
  expect(effects).toEqual(['state-and-audit', 'notification']);
});
