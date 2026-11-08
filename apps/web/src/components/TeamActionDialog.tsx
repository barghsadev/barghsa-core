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
import { confirmationText } from '@barghsa/i18n/confirmation';
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
  ConfirmationFields,
  useConfirmationGate,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { StepUpAuthGate } from './StepUpAuthGate.js';
import { getProfileContextRevision } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';

export interface TeamAction {
  title: string;
  description: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  risk?: 'destructive' | 'financial' | 'both';
  body?: unknown;
  successStatus?: number;
  signsOut?: boolean;
  requiresPassword?: boolean;
  requiresOtp?: boolean;
  /** Override the deadline inherited by callers with an unconfirmed-result handler. */
  responseDeadline?: true | number;
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
  onCommandDispatch,
  risk: reviewRisk,
}: (
  | { action: TeamAction; verification?: never; selection?: never }
  | {
      action?: never;
      verification: Pick<TeamAction, 'title' | 'description'>;
      selection?: ReactNode;
    }
) & {
  onClose: () => void;
  /** Return localized feedback only after validating the receipt for the current command. */
  onSuccess: (result: unknown) => Promise<void | string>;
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
  focusConfirmation?: boolean;
  summary?: ReactNode;
  confirmationDisabled?: boolean;
  onDenied?: (status?: 401 | 403) => void;
  onValidationError?: (fields: unknown[]) => boolean;
  onUnconfirmed?: () => void;
  onPendingChange?: (pending: boolean) => void;
  /** Report dispatch separately from verification. A step-up refusal clears dispatch. */
  onCommandDispatch?: (dispatched: boolean) => void;
  /** For verification-only flows, the caller owns the reviewed command. */
  risk?: TeamAction['risk'];
}) {
  const locale = useLocale();
  const copy = action ?? verification;
  const risk = action?.risk ?? reviewRisk;
  const destructive = risk === 'destructive' || risk === 'both' || action?.method === 'DELETE';
  const financial = risk === 'financial' || risk === 'both';
  const gate = useConfirmationGate(action ?? verification, {
    ...(destructive
      ? {
          confirmation: {
            phrase: confirmationText('phrase', locale),
            label: confirmationText('typePhrase', locale),
          },
        }
      : {}),
    ...(financial ? { acknowledgement: confirmationText('acknowledge', locale) } : {}),
  });
  const cancel = useRef<HTMLButtonElement>(null);
  const numbers = useNumberFormatting(locale);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const requestTransport = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const currentAction = useRef(action);
  const canConfirm = useRef(!confirmationDisabled && gate.allowed);
  currentAction.current = action;
  canConfirm.current = !confirmationDisabled && gate.allowed;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestTransport.current?.abort();
    };
  }, []);

  const [needsPassword, setNeedsPassword] = useState(!action || action.requiresPassword === true);
  const [needsOtp, setNeedsOtp] = useState(action?.requiresOtp === true);
  const [password, setPassword] = useState('');
  const [invalidPassword, setInvalidPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const focusPasswordFor = useRef<TeamAction | null>(null);
  useEffect(() => {
    const challenged = focusPasswordFor.current;
    if (!challenged || !needsPassword || busy) return;
    focusPasswordFor.current = null;
    if (challenged === action) passwordInput.current?.focus();
  }, [action, busy, needsPassword]);

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
    if (!canConfirm.current || inFlight.current || retryAt > Date.now()) return;
    const profileRevision = getProfileContextRevision();
    const transport = new AbortController();
    requestTransport.current = transport;
    inFlight.current = true;
    setBusy(true);
    onPendingChange?.(true);
    setError(null);
    setInvalidPassword(false);
    const owned = () =>
      mounted.current &&
      currentAction.current === action &&
      getProfileContextRevision() === profileRevision;
    const showError = (message: string, uncertain = false) => {
      setError(message);
      if (owned())
        sendToast(
          uncertain ? 'warning' : 'error',
          uncertain ? confirmationText('unconfirmed', locale) : message
        );
    };
    let commandSent = false;
    try {
      if (!otpVerified && (needsPassword || !action)) {
        const verified = await readWithDeadline(transport.signal, (signal) =>
          fetch('/api/auth/step-up', {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ password }),
            signal,
          })
        );
        if (!owned() || !canConfirm.current) return;
        setPassword('');
        if (rateLimited(verified)) return;
        if (!verified.ok) {
          setInvalidPassword(true);
          showError(t('team.passwordError', locale));
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
      const deadline = action.responseDeadline ?? (onUnconfirmed ? true : undefined);
      const dispatch = async (signal?: AbortSignal) => {
        commandSent = true;
        onCommandDispatch?.(true);
        const response = await fetch(action.path, {
          method: action.method,
          credentials: 'include',
          headers: withCsrf({
            ...(multipart ? {} : { 'Content-Type': 'application/json' }),
            'Accept-Language': locale,
          }),
          ...(requestBody === undefined ? {} : { body: requestBody }),
          ...(signal ? { signal } : {}),
        });
        return { response, data: await response.json().catch(() => null) };
      };
      const { response, data } = await (deadline
        ? readWithDeadline(
            transport.signal,
            dispatch,
            typeof deadline === 'number' ? deadline : undefined
          )
        : dispatch());
      if (!owned()) return;
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
      if (
        response.status === 403 &&
        (code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code || data?.requiresStepUp === true)
      ) {
        commandSent = false;
        onCommandDispatch?.(false);
        if (data?.requiresOtp === true || action.requiresOtp) setNeedsOtp(true);
        else {
          focusPasswordFor.current = action;
          setNeedsPassword(true);
        }
        return;
      }
      if ((response.status === 401 || response.status === 403) && onDenied) {
        onDenied(response.status);
        return;
      }
      if (rateLimited(response)) return;
      if (!response.ok) {
        commandSent = false;
        const uncertain = response.status >= 500 || (!!deadline && response.status === 408);
        if (uncertain) onUnconfirmed?.();
        if (
          response.status === 400 &&
          code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
          Array.isArray(data?.error?.fields) &&
          onValidationError?.(data.error.fields)
        ) {
          onClose();
          return;
        }
        const mappedMessage =
          typeof code === 'string' &&
          action.errorMessages &&
          Object.hasOwn(action.errorMessages, code)
            ? action.errorMessages[code]
            : undefined;
        showError(
          (typeof mappedMessage === 'function' ? mappedMessage(data) : mappedMessage) ??
            (response.status === 409
              ? (action.conflictMessage ?? t('team.conflict', locale))
              : response.status === 403
                ? (action.forbiddenMessage ?? t('team.forbidden', locale))
                : t('team.error', locale)),
          uncertain
        );
        return;
      }
      if (action.successStatus !== undefined && response.status !== action.successStatus) {
        onUnconfirmed?.();
        showError(t('team.error', locale), true);
        return;
      }
      if (action.signsOut || data?.sessionRevoked === true) {
        window.location.assign('/login');
        return;
      }
      const message = await onSuccess(data);
      if (message && getProfileContextRevision() === profileRevision) sendToast('success', message);
      if (owned()) onClose();
    } catch {
      if (owned()) {
        if (commandSent) onUnconfirmed?.();
        showError(t('team.error', locale), commandSent);
      }
    } finally {
      requestTransport.current = null;
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
        {...(destructive || financial ? { initialFocus: cancel } : {})}
      >
        {needsOtp ? (
          <div className="space-y-4">
            <DialogHeader className="pr-8">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            {summary}
            <ConfirmationFields gate={gate} disabled={busy} />
            <StepUpAuthGate
              disabled={confirmationDisabled || !gate.allowed || busy}
              {...(onDenied ? { onDenied } : {})}
              onVerified={async () => {
                if (!mounted.current || !canConfirm.current || currentAction.current !== action)
                  return;
                setNeedsOtp(false);
                setNeedsPassword(false);
                await submit(undefined, true);
              }}
            />
            <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onClose}>
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
            {error && (
              <Alert
                id={invalidPassword ? 'team-step-up-password-error' : undefined}
                variant="destructive"
              >
                {error}
              </Alert>
            )}
            {summary}
            <ConfirmationFields gate={gate} disabled={busy} />
            {needsPassword && (
              <div className="space-y-2">
                <Label htmlFor="team-step-up-password">{t('team.password', locale)}</Label>
                <Input
                  ref={passwordInput}
                  id="team-step-up-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-required="true"
                  aria-invalid={invalidPassword || undefined}
                  aria-describedby={invalidPassword ? 'team-step-up-password-error' : undefined}
                  autoFocus={!destructive && !financial}
                  value={password}
                  disabled={busy}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (invalidPassword) {
                      setInvalidPassword(false);
                      setError(null);
                    }
                  }}
                />
              </div>
            )}
            {remaining > 0 && (
              <p role="status">
                {t('team.retryAfter', locale).replace('{seconds}', numbers.number(remaining))}
              </p>
            )}
            <DialogFooter>
              <Button
                ref={cancel}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                {t('team.cancel', locale)}
              </Button>
              <Button
                type="submit"
                aria-busy={busy || undefined}
                autoFocus={focusConfirmation && !needsPassword && !destructive && !financial}
                variant={destructive ? 'destructive' : financial ? 'warning' : 'default'}
                disabled={
                  confirmationDisabled ||
                  !gate.allowed ||
                  busy ||
                  remaining > 0 ||
                  (needsPassword && !password)
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
