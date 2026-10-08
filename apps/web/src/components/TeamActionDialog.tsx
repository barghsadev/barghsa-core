import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import { t } from '@barghsa/i18n/workspace';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { StepUpAuthGate } from './StepUpAuthGate.js';

export interface TeamAction {
  title: string;
  description: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  successStatus?: number;
  signsOut?: boolean;
  requiresPassword?: boolean;
  requiresOtp?: boolean;
  conflictMessage?: string;
  forbiddenMessage?: string;
  errorMessages?: Record<string, string | ((response: unknown) => string)>;
}

/** The action is captured when opened; successful verification retries that same action. */
export function TeamActionDialog({
  action,
  verification,
  selection,
  summary,
  confirmationDisabled = false,
  focusConfirmation = false,
  onClose,
  onSuccess,
  finalFocus,
  onDenied,
  onValidationError,
  onUnconfirmed,
  onPendingChange,
}: (
  | { action: TeamAction; verification?: never; selection?: never }
  | {
      action?: never;
      verification: Pick<TeamAction, 'title' | 'description'>;
      selection?: ReactNode;
    }
) & {
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void>;
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
  focusConfirmation?: boolean;
  summary?: ReactNode;
  confirmationDisabled?: boolean;
  onDenied?: (status?: 401 | 403) => void;
  onValidationError?: (fields: unknown[]) => boolean;
  onUnconfirmed?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const locale = useLocale();
  const copy = action ?? verification;
  const numbers = useNumberFormatting(locale);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentAction = useRef(action);
  const canConfirm = useRef(!confirmationDisabled);
  currentAction.current = action;
  canConfirm.current = !confirmationDisabled;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [needsPassword, setNeedsPassword] = useState(!action || action.requiresPassword === true);
  const [needsOtp, setNeedsOtp] = useState(action?.requiresOtp === true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [retryAt, setRetryAt] = useState(0),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  function rateLimited(response: Response) {
    if (response.status !== 429) return false;
    const header = response.headers.get('retry-after');
    const delay =
      header && Number.isFinite(Number(header))
        ? Number(header) * 1000
        : header
          ? Date.parse(header) - Date.now()
          : 1000;
    const milliseconds = Number.isFinite(delay) ? Math.max(1000, delay) : 1000;
    setRemaining(Math.ceil(milliseconds / 1000));
    setRetryAt(Date.now() + milliseconds);
    return true;
  }
  async function submit(event?: FormEvent, otpVerified = false) {
    event?.preventDefault();
    if (needsOtp && !otpVerified) return;
    if (confirmationDisabled || inFlight.current || retryAt > Date.now()) return;
    inFlight.current = true;
    setBusy(true);
    onPendingChange?.(true);
    setError(null);
    let commandSent = false;
    try {
      if (!otpVerified && (needsPassword || !action)) {
        const verified = await fetch('/api/auth/step-up', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ password }),
        });
        if (!mounted.current || !canConfirm.current || currentAction.current !== action) return;
        setPassword('');
        if (rateLimited(verified)) return;
        if (!verified.ok) {
          setError(t('team.passwordError', locale));
          return;
        }
        setNeedsPassword(false);
      }
      if (!action) {
        setNeedsPassword(false);
        await onSuccess({ verified: true });
        return;
      }
      const multipart = action.body instanceof FormData;
      const requestBody =
        action.body === undefined
          ? undefined
          : action.body instanceof FormData
            ? action.body
            : JSON.stringify(action.body);
      commandSent = true;
      const response = await fetch(action.path, {
        method: action.method,
        credentials: 'include',
        headers: withCsrf({
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          'Accept-Language': locale,
        }),
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
      const data = await response.json().catch(() => null);
      if (!mounted.current || currentAction.current !== action) return;
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
      if (
        response.status === 403 &&
        (code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code || data?.requiresStepUp === true)
      ) {
        if (data?.requiresOtp === true || action.requiresOtp) setNeedsOtp(true);
        else setNeedsPassword(true);
        return;
      }
      if ((response.status === 401 || response.status === 403) && onDenied) {
        onDenied(response.status);
        return;
      }
      if (rateLimited(response)) return;
      if (!response.ok) {
        commandSent = false;
        if (response.status >= 500) onUnconfirmed?.();
        if (
          response.status === 400 &&
          code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
          Array.isArray(data?.error?.fields) &&
          onValidationError?.(data.error.fields)
        ) {
          onClose();
          return;
        }
        const mappedMessage = action.errorMessages?.[code];
        setError(
          (typeof mappedMessage === 'function' ? mappedMessage(data) : mappedMessage) ??
            (response.status === 409
              ? (action.conflictMessage ?? t('team.conflict', locale))
              : response.status === 403
                ? (action.forbiddenMessage ?? t('team.forbidden', locale))
                : t('team.error', locale))
        );
        return;
      }
      if (action.successStatus !== undefined && response.status !== action.successStatus) {
        onUnconfirmed?.();
        setError(t('team.error', locale));
        return;
      }
      if (action.signsOut || data?.sessionRevoked === true) {
        window.location.assign('/login');
        return;
      }
      await onSuccess(data);
      if (mounted.current && currentAction.current === action) onClose();
    } catch {
      if (mounted.current && currentAction.current === action) {
        if (commandSent) onUnconfirmed?.();
        setError(t('team.error', locale));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && currentAction.current === action) onPendingChange?.(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        showCloseButton={!busy}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        finalFocus={finalFocus}
      >
        {needsOtp ? (
          <div className="space-y-4">
            <DialogHeader className="pr-8">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            {summary}
            <StepUpAuthGate
              disabled={confirmationDisabled || busy}
              {...(onDenied ? { onDenied } : {})}
              onVerified={async () => {
                if (!mounted.current || !canConfirm.current || currentAction.current !== action)
                  return;
                setNeedsOtp(false);
                setNeedsPassword(false);
                await submit(undefined, true);
              }}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('team.cancel', locale)}
            </Button>
          </div>
        ) : selection && !needsPassword ? (
          selection
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader className="pr-8">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            {error && <Alert variant="destructive">{error}</Alert>}
            {summary}
            {needsPassword && (
              <div className="space-y-2">
                <Label htmlFor="team-step-up-password">{t('team.password', locale)}</Label>
                <Input
                  id="team-step-up-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
            {remaining > 0 && (
              <p role="status">
                {t('team.retryAfter', locale).replace('{seconds}', numbers.number(remaining))}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t('team.cancel', locale)}
              </Button>
              <Button
                type="submit"
                aria-busy={busy || undefined}
                autoFocus={focusConfirmation && !needsPassword}
                disabled={
                  confirmationDisabled || busy || remaining > 0 || (needsPassword && !password)
                }
              >
                {busy && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {t(busy ? 'team.working' : 'team.confirm', locale)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
