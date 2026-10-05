import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/auth';
import { loginFormText } from '@barghsa/i18n/login-forms';
import { normalizeRecoveryUsername, recoveryPasswordValid } from '../lib/password-recovery-form.js';
import { emptyLogin, type LoginValues, type LoginStage } from '../lib/login-form.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
export type LoginCapture = {
  context: string;
  generation: number;
  controller: AbortController;
  current: () => boolean;
  hold: (uncertain?: boolean) => void;
};
export function useLoginNativeForm(stage: LoginStage, context: string, locale: Locale) {
  const draftRevision = useRef(0);
  const renderedDraft = draftRevision.current;
  const alive = useRef(true),
    generation = useRef(0),
    owner = useRef<LoginCapture | null>(null),
    currentContext = useRef(context);
  currentContext.current = context;
  const [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  const form = useZodForm<LoginValues>(
    async () => {
      const capturedGeneration = generation.current,
        capturedContext = currentContext.current;
      const module = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current &&
        generation.current === capturedGeneration &&
        currentContext.current === capturedContext
        ? module.loginFormSchema(
            stage,
            {
              username: t('auth.register.invalidUsername', locale),
              password: loginFormText('passwordRequired', locale),
              newPassword: t('auth.register.error.weakPassword', locale),
              confirmation: t('auth.register.error.passwordsDoNotMatch', locale),
              otp: loginFormText('codeInvalid', locale),
            },
            {
              username: (value) => !!normalizeRecoveryUsername(value).type,
              password: recoveryPasswordValid,
            }
          )
        : module.inactiveLoginSchema;
    },
    {
      defaultValues: emptyLogin,
      validationUnavailableMessage: loginFormText('validationUnavailable', locale),
    }
  );
  const isCurrentScope = () => alive.current && currentContext.current === context;
  const feedback = useSettingsFormFeedback(
    form,
    context,
    locked,
    { isCurrent: isCurrentScope, isLocked: () => !!owner.current },
    {},
    t('auth.login.error.generic', locale)
  );
  useEffect(() => {
    alive.current = true;
    setBusy(false);
    setLocked(false);
    setUncertain(false);
    uncertainRef.current = false;
    return () => {
      alive.current = false;
      generation.current++;
      owner.current?.controller.abort();
      owner.current = null;
    };
  }, [context]);
  async function run(
    effect: (values: LoginValues, capture: LoginCapture) => Promise<void>,
    event?: FormEvent<HTMLFormElement>,
    validate = true
  ) {
    event?.preventDefault();
    if (!isCurrentScope() || draftRevision.current !== renderedDraft || owner.current) return;
    let held = false;
    const capture: LoginCapture = {
      context,
      generation: generation.current,
      controller: new AbortController(),
      current: () =>
        isCurrentScope() && owner.current === capture && generation.current === capture.generation,
      hold: (unknown = true) => {
        if (!capture.current()) return;
        held = true;
        uncertainRef.current = unknown;
        setUncertain(unknown);
      },
    };
    owner.current = capture;
    setLocked(true);
    setBusy(true);
    const perform = async (values: LoginValues) => {
      if (capture.current()) await effect({ ...values }, capture);
    };
    try {
      if (validate) await form.handleSubmit(perform, feedback.invalid)(event);
      else await perform(form.getValues());
    } finally {
      if (capture.current()) {
        setBusy(false);
        if (!held) {
          owner.current = null;
          setLocked(false);
        }
      }
    }
  }
  function replaceDraft(values: LoginValues, capture?: LoginCapture) {
    if (
      !isCurrentScope() ||
      draftRevision.current !== renderedDraft ||
      (capture ? !capture.current() : !!owner.current)
    )
      return false;
    generation.current++;
    draftRevision.current++;
    owner.current?.controller.abort();
    owner.current = null;
    form.reset(values);
    uncertainRef.current = false;
    setUncertain(false);
    setLocked(false);
    setBusy(false);
    return true;
  }
  function restart() {
    if (!isCurrentScope() || busy || !uncertainRef.current || !owner.current) return false;
    return replaceDraft({ ...emptyLogin, username: form.getValues('username') }, owner.current);
  }
  return {
    form,
    draftKey: String(draftRevision.current),
    feedback,
    busy,
    locked,
    uncertain,
    run,
    restart,
    replaceDraft,
    canEdit: () => isCurrentScope() && draftRevision.current === renderedDraft && !owner.current,
  };
}
