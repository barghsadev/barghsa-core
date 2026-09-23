import { useCallback, useEffect, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';

export interface DraftSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface FormDraft<T> {
  currentStep: number;
  data: T | null;
  updatedAt: string | null;
}

/** A profile-scoped backend draft. A failed save never replaces valid local input. */
export function useFormDraft<T>(key: string | null, schema: DraftSchema<T>) {
  const [draft, setDraft] = useState<FormDraft<T> | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
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
          !('data' in result) ||
          (result.data !== null && !schema.safeParse(result.data).success)
        ) {
          throw new Error('Invalid draft');
        }
        return result as FormDraft<T>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setDraft(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, schema, retryCount]);

  const save = useCallback(
    async (currentStep: number, data: T) => {
      if (!key) throw new Error('Draft key unavailable');
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid draft input');
      const response = await fetch(key, {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId: new URL(key, window.location.origin).searchParams.get('profileId'),
          currentStep,
          data: parsed.data,
        }),
      });
      if (!response.ok) throw new Error('Draft save failed');
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('currentStep' in result) ||
        result.currentStep !== currentStep ||
        !('data' in result) ||
        !schema.safeParse(result.data).success
      )
        throw new Error('Invalid saved draft');
      setDraft(result as FormDraft<T>);
    },
    [key, schema]
  );

  return { draft, loading, error, save, retry: () => setRetryCount((value) => value + 1) };
}
