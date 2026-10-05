import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import { authResponseRecord } from '../lib/auth-responses.js';
import { authErrorCode, rateLimitMessage, retryAfterSeconds } from '../lib/auth-errors.js';
import {
  emptyRecovery,
  normalizeRecoveryUsername,
  recoveryPasswordValid,
  recoveryChallenge,
  recoveryAuthorization,
  recoveryResetReceipt,
  type RecoveryStage,
  type RecoveryValues,
} from '../lib/password-recovery-form.js';
type Capture = {
  generation: number;
  stage: RecoveryStage;
  challengeId: string;
  authorization: { token: string; expiresAt: number } | null;
};
export function usePasswordRecoveryForm(
  locale: Locale,
  numberStyle: 'locale' | 'persian' | 'western',
  completed: () => Promise<void>
) {
  const copy = (key: string) => passwordRecoveryText(key, locale);
  const uncertainRef = useRef(false);
  const alive = useRef(true),
    generation = useRef(0),
    owner = useRef<Capture | null>(null),
    abort = useRef<AbortController | null>(null);
  const [challenge, setChallenge] = useState<{ id: string; destination: string } | null>(null);
  const [authorization, setAuthorization] = useState<{ token: string; expiresAt: number } | null>(
    null
  );
  const authority = useRef({ challenge, authorization });
  authority.current = { challenge, authorization };
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0),
    [attemptUntil, setAttemptUntil] = useState(0),
    [now, setNow] = useState(Date.now);
  const cooldown = Math.max(0, Math.ceil((resendUntil - now) / 1000));
  const attemptCooldown = Math.max(0, Math.ceil((attemptUntil - now) / 1000));
  const uiStage = useRef<RecoveryStage>('request');
  uiStage.current = authorization ? 'reset' : challenge ? 'verify' : 'request';
  const current = (capture: Capture) =>
    alive.current && owner.current === capture && generation.current === capture.generation;
  const form = useZodForm<RecoveryValues>(
    async () => {
      const capture = owner.current,
        validationGeneration = generation.current,
        selectedStage = capture?.stage ?? uiStage.current;
      const module = await import('../lib/contract-review-signature-form-schemas.js');
      // Releasing an invalid submit must not turn an overlapping blur into a valid draft.
      return alive.current && validationGeneration === generation.current
        ? module.passwordRecoverySchema(
            selectedStage,
            {
              username: copy('usernameInvalid'),
              otp: copy('codeInvalid'),
              password: t('auth.register.passwordRequirements', locale),
              confirmation: t('auth.resetPassword.mismatch', locale),
            },
            // Keep the deferred validator independent of its lazy route chunk.
            {
              username: (value) => !!normalizeRecoveryUsername(value).type,
              password: recoveryPasswordValid,
            }
          )
        : module.inactivePasswordRecoverySchema;
    },
    { defaultValues: emptyRecovery, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const feedback = useSettingsFormFeedback(
    form,
    String(generation.current),
    locked,
    { isCurrent: () => alive.current, isLocked: () => !!owner.current },
    {},
    t('auth.forgotPassword.error.generic', locale)
  );
  const resetForm = form.reset;
  const stage: RecoveryStage = authorization ? 'reset' : challenge ? 'verify' : 'request';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      owner.current = null;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const until = Math.max(resendUntil, attemptUntil);
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const value = Date.now();
      setNow(value);
      if (value >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendUntil, attemptUntil]);
  const expiry = useRef(() => {});
  expiry.current = () => {
    generation.current++;
    owner.current = null;
    abort.current?.abort();
    authority.current = { challenge: authority.current.challenge, authorization: null };
    setAuthorization(null);
    setBusy(false);
    setLocked(false);
    setUncertain(false);
    uncertainRef.current = false;
    resetForm({ ...form.getValues(), otp: '', password: '', confirmation: '' });
    setError(t('auth.otp.error.expired', locale));
  };
  useEffect(() => {
    if (!authorization) return;
    const timer = setTimeout(
      () => expiry.current(),
      Math.max(0, authorization.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [authorization]);
  function release(capture: Capture) {
    if (!current(capture)) return;
    owner.current = null;
    setBusy(false);
    setLocked(false);
  }
  function unknown(capture: Capture) {
    if (!current(capture)) return;
    uncertainRef.current = true;
    setUncertain(true);
    setError(copy('uncertain'));
  }
  async function perform(action: RecoveryStage, event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!alive.current || owner.current) return;
    if (action === 'request' ? Date.now() < resendUntil : Date.now() < attemptUntil) return;
    const accepted = authority.current;
    if (
      action !== 'request' &&
      (!accepted.challenge ||
        (action === 'reset' && !accepted.authorization) ||
        (action === 'verify' && !!accepted.authorization))
    )
      return;
    if (
      action === 'reset' &&
      accepted.authorization &&
      accepted.authorization.expiresAt <= Date.now()
    ) {
      expiry.current();
      return;
    }
    const capture: Capture = {
      generation: generation.current,
      stage: action,
      challengeId: accepted.challenge?.id ?? '',
      authorization: accepted.authorization,
    };
    owner.current = capture;
    setLocked(true);
    setBusy(true);
    setError(null);
    try {
      await form.handleSubmit(async (values) => {
        if (!current(capture)) return;
        if (
          capture.stage === 'reset' &&
          (!capture.authorization || capture.authorization.expiresAt <= Date.now())
        ) {
          expiry.current();
          return;
        }
        const destination = normalizeRecoveryUsername(values.username).normalized;
        const payload =
          action === 'request'
            ? { username: destination }
            : action === 'verify'
              ? { challengeId: capture.challengeId, otp: values.otp }
              : {
                  challengeId: capture.challengeId,
                  resetToken: capture.authorization!.token,
                  newPassword: values.password,
                };
        const path =
          action === 'request'
            ? 'forgot-password'
            : action === 'verify'
              ? 'reset-password/verify'
              : 'reset-password';
        try {
          const controller = new AbortController();
          abort.current = controller;
          const response = await publicAuthFetch('/api/auth/' + path, {
            signal: controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
            body: JSON.stringify(payload),
          });
          const body = authResponseRecord(await response.json().catch(() => null));
          if (!current(capture)) return;
          if (response.status !== 200) {
            if (![400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
              unknown(capture);
              return;
            }
            const code = authErrorCode(body);
            const messages: Record<string, string> = {
              'AUTH:OTP:INVALID': 'auth.otp.error.invalid',
              'AUTH:OTP:EXPIRED': 'auth.otp.error.expired',
              'AUTH:OTP:CONSUMED': 'auth.otp.error.consumed',
              'AUTH:OTP:MAX_ATTEMPTS': 'auth.otp.error.maxAttempts',
              'AUTH:REGISTER:WEAK_PASSWORD': 'auth.register.passwordRequirements',
              'AUTH:LOGIN:PASSWORD_REUSED': 'auth.login.error.passwordReused',
              'AUTH:DELIVERY:UNAVAILABLE': 'auth.otp.error.deliveryUnavailable',
            };
            if (response.status === 429) {
              const at = Date.now();
              setNow(at);
              (action === 'request' ? setResendUntil : setAttemptUntil)(
                at + (retryAfterSeconds(response) ?? 60) * 1000
              );
              setError(rateLimitMessage(response, locale, numberStyle));
            } else setError(t(messages[code ?? ''] ?? 'auth.forgotPassword.error.generic', locale));
            release(capture);
            return;
          }
          if (action === 'request') {
            const id = recoveryChallenge(body);
            if (!id) {
              unknown(capture);
              return;
            }
            generation.current++;
            owner.current = null;
            authority.current = { challenge: { id, destination }, authorization: null };
            setChallenge({ id, destination });
            setAuthorization(null);
            resetForm({ ...values, otp: '', password: '', confirmation: '' });
            const at = Date.now();
            setNow(at);
            setResendUntil(at + 60_000);
            setBusy(false);
            setLocked(false);
          } else if (action === 'verify') {
            const accepted = recoveryAuthorization(body, capture.challengeId);
            if (!accepted) {
              unknown(capture);
              return;
            }
            authority.current = { ...authority.current, authorization: accepted };
            setAuthorization(accepted);
            form.setValue('otp', '');
            release(capture);
            generation.current++;
          } else {
            if (!recoveryResetReceipt(body)) {
              unknown(capture);
              return;
            }
            generation.current++;
            owner.current = null;
            resetForm(emptyRecovery);
            authority.current = { challenge: null, authorization: null };
            setChallenge(null);
            setAuthorization(null);
            setBusy(false);
            setLocked(false);
            await completed();
          }
        } catch {
          unknown(capture);
        }
      }, feedback.invalid)(event);
    } finally {
      if (current(capture)) {
        setBusy(false);
        if (!uncertainRef.current) release(capture);
      }
    }
  }
  function restart() {
    if (!alive.current || busy || !uncertainRef.current) return;
    generation.current++;
    owner.current = null;
    abort.current?.abort();
    authority.current = { challenge: null, authorization: null };
    setChallenge(null);
    setAuthorization(null);
    setError(null);
    setUncertain(false);
    uncertainRef.current = false;
    setLocked(false);
    setBusy(false);
    resetForm({ ...emptyRecovery, username: form.getValues('username') });
  }
  return {
    form,
    feedback,
    stage,
    challenge,
    authorization,
    busy,
    locked,
    uncertain,
    error,
    cooldown,
    attemptCooldown,
    perform,
    restart,
    clearError: () => {
      if (!owner.current && alive.current) setError(null);
    },
    canEdit: (expected?: RecoveryStage) =>
      alive.current &&
      !owner.current &&
      (!expected ||
        expected ===
          (authority.current.authorization
            ? 'reset'
            : authority.current.challenge
              ? 'verify'
              : 'request')),
  };
}
