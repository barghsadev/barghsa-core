import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/auth';
import { registrationFormText } from '@barghsa/i18n/registration-forms';
import { normalizeRecoveryUsername } from '../lib/password-recovery-form.js';
import {
  emptyRegistration,
  registrationPasswordValid,
  type RegistrationValues,
} from '../lib/registration-form.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
export type RegistrationCapture = {
  context: string;
  generation: number;
  controller: AbortController;
  current: () => boolean;
  hold: (uncertain?: boolean) => void;
};
export function useRegistrationNativeForm(
  stage: 'register' | 'verify',
  context: string,
  locale: Locale
) {
  const draftRevision = useRef(0);
  const renderedDraft = draftRevision.current;
  const alive = useRef(true),
    generation = useRef(0),
    owner = useRef<RegistrationCapture | null>(null),
    currentContext = useRef(context);
  currentContext.current = context;
  const [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  const form = useZodForm<RegistrationValues>(
    async () => {
      const capturedGeneration = generation.current,
        capturedContext = currentContext.current;
      const module = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current &&
        generation.current === capturedGeneration &&
        currentContext.current === capturedContext
        ? module.registrationFormSchema(
            stage,
            {
              username: t('auth.register.invalidUsername', locale),
              password: t('auth.register.passwordRequirements', locale),
              tos: t('auth.register.tosRequired', locale),
              otp: registrationFormText('codeInvalid', locale),
            },
            {
              username: (value) => !!normalizeRecoveryUsername(value).type,
              password: registrationPasswordValid,
            }
          )
        : module.inactiveRegistrationSchema;
    },
    {
      defaultValues: emptyRegistration,
      validationUnavailableMessage: registrationFormText('validationUnavailable', locale),
    }
  );
  const isCurrentScope = () => alive.current && currentContext.current === context;
  const feedback = useSettingsFormFeedback(
    form,
    context,
    locked,
    { isCurrent: isCurrentScope, isLocked: () => !!owner.current },
    {},
    t('auth.register.error.generic', locale)
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
    effect: (values: RegistrationValues, capture: RegistrationCapture) => Promise<void>,
    event?: FormEvent<HTMLFormElement>,
    validate = true
  ) {
    event?.preventDefault();
    if (!isCurrentScope() || draftRevision.current !== renderedDraft || owner.current) return;
    let held = false;
    const capture: RegistrationCapture = {
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
    const perform = async (values: RegistrationValues) => {
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
  function restart() {
    if (!isCurrentScope() || busy || !uncertainRef.current) return false;
    generation.current++;
    draftRevision.current++;
    owner.current?.controller.abort();
    owner.current = null;
    form.reset({ ...emptyRegistration, username: form.getValues('username') });
    uncertainRef.current = false;
    setUncertain(false);
    setLocked(false);
    setBusy(false);
    return true;
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
    canEdit: () => isCurrentScope() && draftRevision.current === renderedDraft && !owner.current,
  };
}
