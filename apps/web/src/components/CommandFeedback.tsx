import { useCommandFeedback } from '../hooks/useCommandFeedback.js';

/** Keep the page's persistent feedback and announce the confirmed result once. */
export function CommandFeedback({
  message,
  kind = 'success',
  className,
  as: Element = 'p',
}: {
  message: string | null;
  kind?: 'success' | 'error';
  className?: string;
  as?: 'p' | 'span';
}) {
  useCommandFeedback(kind === 'success' ? { success: message } : { error: message });
  return message ? (
    <Element role={kind === 'success' ? 'status' : 'alert'} className={className}>
      {message}
    </Element>
  ) : null;
}
