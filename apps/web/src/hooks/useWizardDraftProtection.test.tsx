import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWizardDraftProtection } from './useWizardDraftProtection.js';

const router = vi.hoisted(() => ({ guard: null as unknown }));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (guard: unknown) => {
    router.guard = guard;
    return { status: 'idle' };
  },
}));
type Guard = {
  shouldBlockFn: (change: {
    current: { pathname: string; search?: Record<string, unknown> };
    next: { pathname: string; search?: Record<string, unknown> };
  }) => boolean;
  enableBeforeUnload: () => boolean;
};
const departure = {
  current: { pathname: '/solar/requests/new' },
  next: { pathname: '/settings/addresses' },
};
const data = { first: 'one', second: 'two' };
async function harness(
  saveDraft: (step: number, draftData: typeof data) => Promise<unknown>,
  extraDirty = false
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    go = vi.fn(async () => {});
  let result: ReturnType<typeof useWizardDraftProtection<typeof data>>;
  function Harness({ step, profileId }: { step: number; profileId: string }) {
    result = useWizardDraftProtection({
      profileId,
      data,
      step,
      ready: true,
      saveDraft,
      go,
      extraDirty,
      saveDisabled: extraDirty,
    });
    return null;
  }
  const render = async (step: number, profileId = 'profile') => {
    await act(async () => root.render(<Harness step={step} profileId={profileId} />));
  };
  await render(1);
  return {
    get current() {
      return result!;
    },
    get guard() {
      return router.guard as Guard;
    },
    go,
    render,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it('treats JSONB key reordering as an unchanged draft', async () => {
  const view = await harness(vi.fn());
  try {
    await act(async () => view.current.markSaved({ second: 'two', first: 'one' }, 1));
    expect(view.current.dirty).toBe(false);
    expect(view.guard.shouldBlockFn(departure)).toBe(false);
    expect(view.guard.enableBeforeUnload()).toBe(false);
  } finally {
    await view.close();
  }
});
it('allows navigation immediately after the confirmed save, before React renders', async () => {
  const view = await harness(vi.fn(async () => ({})));
  try {
    expect(view.guard.shouldBlockFn(departure)).toBe(true);
    let blocked = true;
    await act(async () => {
      await view.current.save().then((saved) => {
        expect(saved).toBe(true);
        blocked = view.guard.shouldBlockFn(departure);
      });
    });
    expect(blocked).toBe(false);
    expect(view.current.dirty).toBe(false);
  } finally {
    await view.close();
  }
});
it('serializes rapid commands and prevents stale steps from moving the wizard', async () => {
  let finish!: () => void;
  const saving = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const view = await harness(saving);
  try {
    let pending!: Promise<boolean>, repeated!: Promise<boolean>;
    await act(async () => {
      pending = view.current.save(2);
      repeated = view.current.save(2);
    });
    expect(await repeated).toBe(false);
    expect(saving).toHaveBeenCalledTimes(1);
    expect(
      view.guard.shouldBlockFn({
        current: { pathname: '/solar/requests/new', search: { step: 1 } },
        next: { pathname: '/solar/requests/new', search: { step: 2 } },
      })
    ).toBe(true);
    expect(view.current.busy).toBe(true);
    expect(view.guard.shouldBlockFn(departure)).toBe(true);
    await view.render(3);
    await act(async () => {
      finish();
      await pending;
    });
    expect(await pending).toBe(false);
    expect(view.go).not.toHaveBeenCalled();
    expect(view.current.busy).toBe(false);
    expect(view.current.dirty).toBe(true);
  } finally {
    await view.close();
  }
});
it('blocks saving an unfinished address while keeping explicit departure protection', async () => {
  const saving = vi.fn(async () => ({}));
  const view = await harness(saving, true);
  try {
    await act(async () => view.current.markSaved(data, 1));
    expect(view.current.dirty).toBe(true);
    expect(await view.current.save()).toBe(false);
    expect(saving).not.toHaveBeenCalled();
    expect(view.guard.shouldBlockFn(departure)).toBe(true);
    expect(view.guard.enableBeforeUnload()).toBe(true);
  } finally {
    await view.close();
  }
});

it('starts a new profile scope without letting the old completion unlock its command', async () => {
  const finishes: Array<() => void> = [];
  const view = await harness(vi.fn(() => new Promise<void>((resolve) => finishes.push(resolve))));
  try {
    let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => {
      first = view.current.save(2);
    });
    await view.render(1, 'second');
    expect(view.current.busy).toBe(false);
    await act(async () => {
      second = view.current.save(2);
    });
    await act(async () => {
      finishes[0]!();
      await first;
    });
    expect(await first).toBe(false);
    expect(view.current.busy).toBe(true);
    await act(async () => {
      finishes[1]!();
      await second;
    });
    expect(await second).toBe(true);
    expect(view.current.busy).toBe(false);
    expect(view.go).toHaveBeenCalledTimes(1);
  } finally {
    await view.close();
  }
});
