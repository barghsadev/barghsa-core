type ToastOptions = Parameters<typeof import('sonner').toast.success>[1];
type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';
type ToastDispatcher = Record<ToastKind, (message: string, options?: ToastOptions) => unknown> &
  Pick<typeof import('sonner').toast, 'dismiss'>;
type ToastRequest = { kind: ToastKind; message: string; options?: ToastOptions };

let dispatcher: ToastDispatcher | null = null;
let pending: ToastRequest[] = [];
const listeners = new Set<() => void>();
let revision = 0;
export const getToastRevision = () => revision;

export function sendToast(kind: ToastKind, message: string, options?: ToastOptions) {
  if (dispatcher) {
    dispatcher[kind](message, options);
    return;
  }
  pending.push({ kind, message, options });
  for (const listener of listeners) listener();
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    sendToast('success', message, options);
  },
  error(message: string, options?: ToastOptions) {
    sendToast('error', message, options);
  },
  dismiss() {
    revision++;
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
