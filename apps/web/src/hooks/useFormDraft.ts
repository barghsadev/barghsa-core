import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';
import { confirmedDraftReceipt } from '../lib/form-receipt.js';

export interface DraftSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface FormDraft<T> {
  currentStep: number;
  data: T | null;
  updatedAt: string | null;
}

/** A profile-scoped backend draft. A failed save never replaces valid local input. */
export function useFormDraft<T extends object>(
  key: string | null,
  schema: DraftSchema<T>,
  maxStep = 6
) {
  const [draft, setDraft] = useState<FormDraft<T> | null>(null);
  const [scope, setScope] = useState(key);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const generation = useRef(0);
  const currentKey = useRef(key);
  useLayoutEffect(() => {
    currentKey.current = key;
  }, [key]);

  useEffect(() => {
    const epoch = ++generation.current;
    setScope(key);
    setDraft(null);
    setError(false);
    if (!key) {
      setDraft(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch(key, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Draft unavailable');
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== 'object' ||
          !('currentStep' in result) ||
          !Number.isInteger(result.currentStep) ||
          (result.currentStep as number) < 1 ||
          (result.currentStep as number) > maxStep ||
          ((result.currentStep as number) > 1 && 'data' in result && result.data === null) ||
          !('data' in result) ||
          (result.data !== null && !schema.safeParse(result.data).success)
        ) {
          throw new Error('Invalid draft');
        }
        return result as FormDraft<T>;
      })
      .then((result) => {
        if (!controller.signal.aborted && currentKey.current === key) setDraft(result);
      })
      .catch(() => {
        if (!controller.signal.aborted && currentKey.current === key) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted && currentKey.current === key) setLoading(false);
      });
    return () => {
      controller.abort();
      if (generation.current === epoch) generation.current++;
    };
  }, [key, schema, retryCount, maxStep]);

  const save = useCallback(
    async (currentStep: number, data: T) => {
      if (!key || currentKey.current !== key) throw new Error('Draft key unavailable');
      const epoch = generation.current;
      if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > maxStep)
        throw new Error('Invalid draft step');
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid draft input');
      const profileId = new URL(key, window.location.origin).searchParams.get('profileId');
      if (!profileId) throw new Error('Draft profile unavailable');
      const input = { profileId, currentStep, data: parsed.data };
      const response = await fetch(key, {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Draft save failed');
      const result: unknown = await response.json();
      if (
        !confirmedDraftReceipt(result, input) ||
        !schema.safeParse((result as FormDraft<T>).data).success
      )
        throw new Error('Invalid saved draft');
      if (currentKey.current !== key || generation.current !== epoch)
        throw new Error('Draft scope changed');
      setScope(key);
      setDraft(result as FormDraft<T>);
      return result as FormDraft<T>;
    },
    [key, schema, maxStep]
  );

  return {
    draft: scope === key ? draft : null,
    loading: scope === key ? loading : Boolean(key),
    error: scope === key && error,
    save,
    retry: () => setRetryCount((value) => value + 1),
  };
}
