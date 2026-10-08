import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from './useServerQuery.js';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
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
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const identity = JSON.stringify([accountId, profileRevision, key]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const inputs = useRef({ key, schema, maxStep, revision: 0 });
  if (
    inputs.current.key !== key ||
    inputs.current.schema !== schema ||
    inputs.current.maxStep !== maxStep
  )
    inputs.current = { key, schema, maxStep, revision: inputs.current.revision + 1 };
  const [draft, setDraft] = useState<FormDraft<T> | null>(null);
  const [scope, setScope] = useState(identity);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const generation = useRef(0);
  const currentKey = useRef(key);
  useLayoutEffect(() => {
    currentKey.current = key;
  }, [key]);

  const profileId = key
    ? new URL(key, 'https://barghsa.invalid').searchParams.get('profileId')
    : null;
  const resource = key?.includes('/solar/') ? queryKeys.solar : queryKeys.saving;
  const queryKey = key
    ? resource.detail(
        {
          context: 'customer',
          ownerId: profileId?.trim() ? profileId : reader,
          accountId,
          revision: profileRevision,
        },
        JSON.stringify([reader, key, inputs.current.revision, retryCount])
      )
    : null;
  const query = useServerDetailQuery<{ value: unknown }>({
    queryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(key!, { credentials: 'include', signal });
      if (!response.ok) throw new Error('Draft unavailable');
      return { value: (await response.json()) as unknown };
    },
  });
  useEffect(() => {
    const epoch = ++generation.current;
    setScope(identity);
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
    void query
      .refetch()
      .then((reply) => {
        if (!reply.isSuccess || !reply.data) throw new Error('Draft unavailable');
        const result: unknown = reply.data.value;
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
        if (
          !controller.signal.aborted &&
          currentKey.current === key &&
          currentIdentity.current === identity
        )
          setDraft(result);
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          currentKey.current === key &&
          currentIdentity.current === identity
        )
          setError(true);
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          currentKey.current === key &&
          currentIdentity.current === identity
        )
          setLoading(false);
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: queryKey!, exact: true });
      if (generation.current === epoch) generation.current++;
    };
  }, [key, schema, retryCount, maxStep, identity]);

  const save = useCallback(
    async (currentStep: number, data: T) => {
      if (!key || currentKey.current !== key || currentIdentity.current !== identity)
        throw new Error('Draft key unavailable');
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
      if (
        currentKey.current !== key ||
        generation.current !== epoch ||
        currentIdentity.current !== identity
      )
        throw new Error('Draft scope changed');
      setScope(identity);
      setDraft(result as FormDraft<T>);
      return result as FormDraft<T>;
    },
    [key, schema, maxStep, identity]
  );

  return {
    draft: scope === identity ? draft : null,
    loading: scope === identity ? loading : Boolean(key),
    error: scope === identity && error,
    save,
    retry: () => setRetryCount((value) => value + 1),
  };
}
