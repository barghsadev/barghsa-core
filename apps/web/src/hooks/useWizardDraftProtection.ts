import { useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

function draftSignature(profileId: string | null, data: object, step: number) {
  return JSON.stringify([
    profileId,
    Object.entries(data).sort(([left], [right]) => left.localeCompare(right)),
    step,
  ]);
}

/** Serializes durable wizard commands and rejects completions from an old scope. */
export function useWizardDraftProtection<T extends object>({
  profileId,
  data,
  step,
  ready,
  saveDraft,
  go,
  extraDirty = false,
  saveDisabled = false,
}: {
  profileId: string | null;
  data: T;
  step: number;
  ready: boolean;
  saveDraft: (step: number, data: T) => Promise<unknown>;
  go: (step: number, expectedStep?: number) => Promise<void>;
  extraDirty?: boolean;
  saveDisabled?: boolean;
}) {
  const signature = draftSignature(profileId, data, step);
  const latest = useRef(signature);
  const epoch = useRef(0);
  const command = useRef<symbol | null>(null);
  const ownNavigation = useRef(false);
  const completed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const savedRef = useRef('');
  const [saveError, setSaveError] = useState(false);
  useLayoutEffect(() => {
    latest.current = signature;
  }, [signature]);
  useEffect(() => {
    epoch.current++;
    command.current = null;
    completed.current = false;
    savedRef.current = '';
    setSaved('');
    setBusy(false);
    setSaveError(false);
    return () => {
      epoch.current++;
    };
  }, [profileId]);
  const markSaved = useCallback(
    (value: T, savedStep: number) => {
      savedRef.current = draftSignature(profileId, value, savedStep);
      setSaved(savedRef.current);
      setSaveError(false);
    },
    [profileId]
  );
  const dirty = ready && !completed.current && (saved !== signature || extraDirty);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !completed.current &&
      (current.pathname !== next.pathname
        ? (ready && (savedRef.current !== latest.current || extraDirty)) || !!command.current
        : !!command.current &&
          !ownNavigation.current &&
          JSON.stringify(current.search) !== JSON.stringify(next.search)),
    enableBeforeUnload: () =>
      !completed.current &&
      ((ready && (savedRef.current !== latest.current || extraDirty)) || !!command.current),
    withResolver: true,
  });
  const run = useCallback(
    async (work: (current: () => boolean, alive: () => boolean) => Promise<void>) => {
      if (command.current || completed.current || !ready) return false;
      const token = Symbol();
      const scope = epoch.current;
      command.current = token;
      setBusy(true);
      const current = () => epoch.current === scope && latest.current === signature;
      try {
        await work(current, () => epoch.current === scope);
        return current();
      } finally {
        if (command.current === token) command.current = null;
        if (epoch.current === scope) setBusy(false);
      }
    },
    [ready, signature]
  );
  const move = useCallback(
    async (target: number, expectedStep = step) => {
      ownNavigation.current = true;
      try {
        await go(target, expectedStep);
      } finally {
        ownNavigation.current = false;
      }
    },
    [go, step]
  );
  const save = useCallback(
    async (target = step) => {
      if (!profileId || saveDisabled) return false;
      let success = false;
      await run(async (current) => {
        setSaveError(false);
        try {
          await saveDraft(target, data);
          if (!current()) return;
          markSaved(data, target);
          if (target !== step) await move(target, step);
          success = true;
        } catch {
          if (current()) setSaveError(true);
        }
      });
      return success;
    },
    [profileId, saveDisabled, run, saveDraft, data, markSaved, step, move]
  );
  return { busy, dirty, saveError, save, markSaved, run, move, completed, blocker };
}
