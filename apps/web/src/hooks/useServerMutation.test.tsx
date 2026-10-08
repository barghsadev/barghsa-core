import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { connectToast, toast } from '../lib/toast-api.js';
import { DiscardedServerMutation, useServerMutation } from './useServerMutation.js';

const scope = (owner: string) => ({
  context: 'account' as const,
  ownerId: owner,
  accountId: owner,
  revision: 0,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(
  write: (value: string) => Promise<string>,
  keys?: (owner: string) => readonly ServerQueryKey[]
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 5 }, queries: { staleTime: Infinity } },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    success = vi.fn(),
    error = vi.fn(),
    dismiss = vi.fn();
  toast.dismiss();
  const disconnect = connectToast({ success, error, dismiss });
  let mutation!: ReturnType<typeof useServerMutation<string, string>>;
  function Harness({ owner }: { owner: string | null }) {
    mutation = useServerMutation({
      mutationKey: owner ? queryKeys.preferences.detail(scope(owner), 'notifications') : null,
      isCurrent: () => owner !== null,
      write,
      invalidate: owner ? (keys?.(owner) ?? [queryKeys.preferences.all(scope(owner))]) : [],
      successMessage: 'انتخاب‌ها ذخیره شد.',
      errorMessage: 'ذخیره تأیید نشد.',
    });
    return <span>{mutation.data ?? 'no accepted result'}</span>;
  }
  const render = (owner: string | null) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Harness owner={owner} />
        </QueryClientProvider>
      )
    );
  await render('a');
  return {
    client,
    root,
    host,
    success,
    error,
    render,
    get mutation() {
      return mutation;
    },
    async close() {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      disconnect();
      toast.dismiss();
      vi.unstubAllGlobals();
    },
  };
}

it('never retries writes and invalidates only captured owner keys after either outcome', async () => {
  let fail = true;
  const write = vi.fn(async (value: string) => {
    if (fail) throw new Error('PRIVATE-RESPONSE');
    return value;
  });
  const test = await setup(write),
    readA = vi.fn(async () => 'server a'),
    readB = vi.fn(async () => 'server b');
  const a = new QueryObserver(test.client, {
    queryKey: queryKeys.preferences.detail(scope('a'), 'notifications'),
    queryFn: readA,
  });
  const b = new QueryObserver(test.client, {
    queryKey: queryKeys.preferences.detail(scope('b'), 'notifications'),
    queryFn: readB,
  });
  const stopA = a.subscribe(() => {}),
    stopB = b.subscribe(() => {});
  try {
    await vi.waitFor(() => expect(readA).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(readB).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(test.mutation.mutateAsync('requested')).rejects.toThrow('PRIVATE-RESPONSE');
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(test.error).toHaveBeenCalledExactlyOnceWith('ذخیره تأیید نشد.', undefined);
    expect(test.success).not.toHaveBeenCalled();
    expect(readA).toHaveBeenCalledTimes(2);
    expect(readB).toHaveBeenCalledTimes(1);
    fail = false;
    await act(async () => {
      expect(await test.mutation.mutateAsync('confirmed')).toBe('confirmed');
    });
    expect(test.success).toHaveBeenCalledExactlyOnceWith('انتخاب‌ها ذخیره شد.', undefined);
    expect(readA).toHaveBeenCalledTimes(3);
    expect(readB).toHaveBeenCalledTimes(1);
  } finally {
    stopA();
    stopB();
    await test.close();
  }
});

it('refuses stale completed results, feedback and invalidation after an actor change', async () => {
  const held = deferred<string>(),
    write = vi.fn(() => held.promise),
    test = await setup(write);
  const invalidation = vi.spyOn(test.client, 'invalidateQueries');
  try {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = test.mutation.mutateAsync('captured').catch((error) => error);
    });
    expect(write).toHaveBeenCalledTimes(1);
    await test.render('b');
    await act(async () => held.resolve('PRIVATE-OLD-ACTOR'));
    expect(await pending).toBeInstanceOf(DiscardedServerMutation);
    expect(test.host.textContent).toBe('no accepted result');
    expect(test.success).not.toHaveBeenCalled();
    expect(test.error).not.toHaveBeenCalled();
    expect(invalidation).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

it('refuses missing actors and unrelated-owner invalidation before dispatch', async () => {
  const write = vi.fn(async () => 'confirmed'),
    test = await setup(write, () => [queryKeys.preferences.all(scope('other'))]);
  try {
    await expect(test.mutation.mutateAsync('intent')).rejects.toThrow('same owner');
    expect(write).not.toHaveBeenCalled();
    await test.render(null);
    await expect(test.mutation.mutateAsync('intent')).rejects.toBeInstanceOf(
      DiscardedServerMutation
    );
    expect(write).not.toHaveBeenCalled();
    expect(test.success).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

it('does not convert a confirmed save into an uncertain write when cache refresh rejects', async () => {
  const test = await setup(async () => 'confirmed');
  vi.spyOn(test.client, 'invalidateQueries').mockRejectedValue(new Error('refresh failed'));
  try {
    await act(async () => {
      expect(await test.mutation.mutateAsync('intent')).toBe('confirmed');
    });
    expect(test.success).toHaveBeenCalledTimes(1);
    expect(test.error).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

it('leaves exact financial cache values untouched while a write is pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const client = new QueryClient(),
    walletScope = {
      context: 'customer' as const,
      ownerId: 'profile',
      accountId: 'actor',
      revision: 0,
    },
    key = queryKeys.wallet.balance(walletScope);
  client.setQueryData(key, '9007199254740993');
  const held = deferred<string>(),
    host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mutation!: ReturnType<typeof useServerMutation<string, string>>;
  function Harness() {
    mutation = useServerMutation({
      mutationKey: queryKeys.wallet.detail(walletScope, 'payment'),
      write: () => held.promise,
      isCurrent: () => true,
      invalidate: [queryKeys.wallet.all(walletScope)],
      successMessage: 'confirmed',
      errorMessage: 'uncertain',
    });
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      )
    );
    let pending!: Promise<string>;
    await act(async () => {
      pending = mutation.mutateAsync('intent');
    });
    expect(client.getQueryData(key)).toBe('9007199254740993');
    await act(async () => held.resolve('confirmed'));
    expect(await pending).toBe('confirmed');
    expect(client.getQueryData(key)).toBe('9007199254740993');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    toast.dismiss();
    vi.unstubAllGlobals();
  }
});
