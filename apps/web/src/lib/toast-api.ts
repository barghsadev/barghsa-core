type ToastOptions = Parameters<typeof import('sonner').toast.success>[1];
type ToastDispatcher = Pick<typeof import('sonner').toast, 'success' | 'error' | 'dismiss'>;
type ToastRequest = { kind: 'success' | 'error'; message: string; options?: ToastOptions };

let dispatcher: ToastDispatcher | null = null;
let pending: ToastRequest[] = [];
const listeners = new Set<() => void>();

function send(kind: ToastRequest['kind'], message: string, options?: ToastOptions) {
  if (dispatcher) {
    dispatcher[kind](message, options);
    return;
  }
  pending.push({ kind, message, options });
  for (const listener of listeners) listener();
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    send('success', message, options);
  },
  error(message: string, options?: ToastOptions) {
    send('error', message, options);
  },
  dismiss() {
    pending = [];
    dispatcher?.dismiss();
  },
};

export function onToastRequested(listener: () => void): () => void {
  listeners.add(listener);
  if (pending.length) listener();
  return () => listeners.delete(listener);
}

export function connectToast(next: ToastDispatcher): () => void {
  dispatcher = next;
  for (const request of pending) next[request.kind](request.message, request.options);
  pending = [];
  return () => {
    if (dispatcher === next) dispatcher = null;
  };
}
