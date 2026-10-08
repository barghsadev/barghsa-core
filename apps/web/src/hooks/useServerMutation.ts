import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ServerQueryKey } from '../lib/query-keys.js';
import { toast } from '../lib/toast-api.js';

export class DiscardedServerMutation extends Error {
  constructor() {
    super('Mutation owner is no longer current');
  }
}

interface ServerMutation<T, Variables> {
  mutationKey: ServerQueryKey | null;
  write: (variables: Variables) => Promise<T>;
  isCurrent: () => boolean;
  invalidate: readonly ServerQueryKey[];
  successMessage: string | ((data: T) => string | undefined);
  errorMessage: string | ((error: Error) => string | undefined);
}

/** Writes keep their captured owner and never retry or optimistically alter cache data. */
export function useServerMutation<T, Variables>(options: ServerMutation<T, Variables>) {
  const client = useQueryClient(),
    owner = JSON.stringify(options.mutationKey),
    currentOwner = useRef(owner),
    alive = useRef(true);
  currentOwner.current = owner;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  type Capture = ServerMutation<T, Variables> & { owner: string; client: typeof client };
  type Command = { variables: Variables; captured: Capture };
  const current = (captured: Capture) =>
    alive.current &&
    currentOwner.current === captured.owner &&
    captured.client === client &&
    captured.isCurrent();
  const mutation = useMutation<T, Error, Command>({
    mutationKey: options.mutationKey ?? [],
    retry: false,
    mutationFn: ({ variables, captured }) => {
      if (!current(captured)) throw new DiscardedServerMutation();
      return captured.write(variables);
    },
    onSuccess: (data, { captured }) => {
      if (!current(captured)) return;
      const message =
        typeof captured.successMessage === 'function'
          ? captured.successMessage(data)
          : captured.successMessage;
      if (message) toast.success(message);
    },
    onError: (error, { captured }) => {
      if (!current(captured) || error instanceof DiscardedServerMutation) return;
      const message =
        typeof captured.errorMessage === 'function'
          ? captured.errorMessage(error)
          : captured.errorMessage;
      if (message) toast.error(message);
    },
    onSettled: async (_data, _error, { captured }) => {
      if (!current(captured)) return;
      await Promise.allSettled(
        captured.invalidate.map((queryKey) =>
          Promise.resolve().then(() =>
            current(captured) ? captured.client.invalidateQueries({ queryKey }) : undefined
          )
        )
      );
    },
  });
  function mutateAsync(variables: Variables) {
    if (!options.mutationKey || !options.isCurrent())
      return Promise.reject(new DiscardedServerMutation());
    for (const key of options.invalidate) {
      if (key.slice(2, 6).some((value, index) => value !== options.mutationKey![index + 2]))
        return Promise.reject(new Error('Mutation invalidation must retain the same owner'));
    }
    const captured = {
      ...options,
      mutationKey: [...options.mutationKey] as ServerQueryKey,
      invalidate: options.invalidate.map((key) => [...key] as ServerQueryKey),
      owner,
      client,
    };
    return mutation.mutateAsync({ variables, captured }).then((data) => {
      if (!current(captured)) throw new DiscardedServerMutation();
      return data;
    });
  }
  const visible = mutation.variables
    ? current(mutation.variables.captured)
    : !!options.mutationKey && options.isCurrent();
  return {
    mutateAsync,
    isPending: visible && mutation.isPending,
    data: visible ? mutation.data : undefined,
    error: visible ? mutation.error : null,
    reset: mutation.reset,
  };
}
