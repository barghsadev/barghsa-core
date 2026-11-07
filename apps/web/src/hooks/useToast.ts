import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from './useLocale.js';
import { getToastRevision, sendToast, toast as basicToast } from '../lib/toast-api.js';

type Message = string | { key: Parameters<typeof feedbackText>[0] };
type Options = Parameters<typeof sendToast>[2];
const progressId = 'barghsa-current-operation';
let latest: symbol | null = null;

/** Pass a validated command promise, never a raw fetch that has not checked its receipt. */
export const toast = {
  ...basicToast,
  warning: (message: string, options?: Options) => sendToast('warning', message, options),
  info: (message: string, options?: Options) => sendToast('info', message, options),
  async promise<T>(
    operation: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); error: string }
  ): Promise<T> {
    const owner = (latest = Symbol());
    const revision = getToastRevision();
    sendToast('loading', messages.loading, { id: progressId, duration: Infinity });
    const current = () => latest === owner && revision === getToastRevision();
    try {
      const value = await operation;
      if (current())
        sendToast(
          'success',
          typeof messages.success === 'function' ? messages.success(value) : messages.success,
          { id: progressId, duration: 6000 }
        );
      return value;
    } catch (error) {
      if (current()) sendToast('error', messages.error, { id: progressId, duration: 6000 });
      throw error;
    }
  },
};

/** String messages are already localized by their domain; key messages use shared feedback copy. */
export function useToast() {
  const locale = useLocale();
  const text = (message: Message) =>
    typeof message === 'string' ? message : feedbackText(message.key, locale);
  return {
    success: (message: Message, options?: Options) => toast.success(text(message), options),
    error: (message: Message, options?: Options) => toast.error(text(message), options),
    warning: (message: Message, options?: Options) => toast.warning(text(message), options),
    info: (message: Message, options?: Options) => toast.info(text(message), options),
    dismiss: toast.dismiss,
    promise: <T>(
      operation: Promise<T>,
      messages: { loading: Message; success: Message | ((value: T) => string); error: Message }
    ) =>
      toast.promise(operation, {
        loading: text(messages.loading),
        success: typeof messages.success === 'function' ? messages.success : text(messages.success),
        error: text(messages.error),
      }),
  };
}
