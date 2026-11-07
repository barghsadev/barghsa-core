import { afterEach, expect, it, vi } from 'vitest';
import { toast } from './useToast.js';
import { connectToast, onToastRequested } from '../lib/toast-api.js';

let disconnect = () => {};
afterEach(() => {
  toast.dismiss();
  disconnect();
});
function renderer() {
  const show = () =>
    vi.fn(
      (message: string, options?: { id?: string | number; duration?: number }) =>
        options?.id ?? message
    );
  const methods = {
    success: show(),
    error: show(),
    warning: show(),
    info: show(),
    loading: show(),
    dismiss: vi.fn(() => 1),
  };
  disconnect = connectToast(methods);
  return methods;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('queues all severities until the lazy renderer connects and clears private queued content', () => {
  const requested = vi.fn();
  const stop = onToastRequested(requested);
  toast.warning('Try again');
  toast.info('Updated');
  expect(requested).toHaveBeenCalledTimes(2);
  const view = renderer();
  expect(view.warning).toHaveBeenCalledWith('Try again', undefined);
  expect(view.info).toHaveBeenCalledWith('Updated', undefined);
  disconnect();
  toast.success('Old account');
  toast.dismiss();
  const next = renderer();
  expect(next.success).not.toHaveBeenCalled();
  stop();
});

it('replaces one persistent progress notice only after the validated operation settles', async () => {
  const view = renderer();
  const operation = deferred<{ id: string }>();
  const result = toast.promise(operation.promise, {
    loading: 'Uploading',
    success: (value) => `Uploaded ${value.id}`,
    error: 'Not confirmed',
  });
  expect(view.loading).toHaveBeenCalledWith('Uploading', {
    id: 'barghsa-current-operation',
    duration: Infinity,
  });
  expect(view.success).not.toHaveBeenCalled();
  operation.resolve({ id: 'receipt' });
  await expect(result).resolves.toEqual({ id: 'receipt' });
  expect(view.success).toHaveBeenCalledWith('Uploaded receipt', {
    id: 'barghsa-current-operation',
    duration: 6000,
  });
});

it('shows safe failure copy and retains the rejected operation for the caller', async () => {
  const view = renderer();
  const operation = deferred<void>();
  const result = toast.promise(operation.promise, {
    loading: 'Working',
    success: 'Saved',
    error: 'Check the result before retrying',
  });
  const failure = new Error('private provider token');
  const assertion = expect(result).rejects.toBe(failure);
  operation.reject(failure);
  await assertion;
  expect(view.error).toHaveBeenCalledWith('Check the result before retrying', expect.any(Object));
  expect(JSON.stringify(view.error.mock.calls)).not.toContain(failure.message);
});

it('holds a single progress identity and an older completion cannot replace a newer operation', async () => {
  const view = renderer();
  const first = deferred<void>(),
    second = deferred<void>();
  const messages = { loading: 'Working', success: 'Saved', error: 'Not confirmed' };
  const a = toast.promise(first.promise, messages),
    b = toast.promise(second.promise, messages);
  expect(view.loading.mock.calls.every((call) => call[1]?.id === 'barghsa-current-operation')).toBe(
    true
  );
  first.resolve();
  await a;
  expect(view.success).not.toHaveBeenCalled();
  second.resolve();
  await b;
  expect(view.success).toHaveBeenCalledTimes(1);
});

it('a profile-context dismissal prevents late private progress or completion from returning', async () => {
  const view = renderer();
  const operation = deferred<void>();
  const result = toast.promise(operation.promise, {
    loading: 'Old profile upload',
    success: 'Old profile saved',
    error: 'Old profile failed',
  });
  toast.dismiss();
  operation.resolve();
  await result;
  expect(view.success).not.toHaveBeenCalled();
  expect(view.error).not.toHaveBeenCalled();
});
