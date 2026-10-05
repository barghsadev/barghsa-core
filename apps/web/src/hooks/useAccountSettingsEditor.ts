import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { tAccountSettingsForms } from '@barghsa/i18n/account-settings-forms';
import { useAccountUser } from './useAccountUser.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import { withCsrf } from '../lib/csrf.js';
import { toast } from '../lib/toast-api.js';
import {
  accountDestination,
  accountSettingsUser,
  accountChallenge,
  accountMessage,
  accountCommandConfirmed,
  accountErrorCode,
  accountWriteDenied,
  accountWriteRejected,
  emptyUsername,
  emptyContact,
  type UsernameValues,
  type ContactValues,
  type AccountSettingsUser,
  type AccountChallenge,
  type AccountCommand,
  type ContactType,
} from '../lib/account-settings-form.js';

type Family = AccountCommand['family'];
type Capture = { command: AccountCommand; previousUsername: string; checked: boolean };
export function useAccountSettingsEditor(locale: Locale) {
  const actor = useAccountUser(),
    copy = (key: string) => tAccountSettingsForms(key, locale);
  const current = useRef(actor);
  current.current = actor;
  const alive = useRef(true),
    withdrawn = useRef(false),
    generation = useRef(0);
  const owner = useRef<Family | 'read' | null>(null),
    capture = useRef<Capture | null>(null);
  const sending = useRef(false);
  const [user, setUser] = useState<AccountSettingsUser | null>(null);
  const source = useRef(user);
  source.current = user;
  const [loading, setLoading] = useState(true),
    [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [canRestart, setCanRestart] = useState(false);
  const [showUsername, setShowUsername] = useState(false);
  const [contactType, setContactType] = useState<ContactType | null>(null);
  const [usernameChallenge, setUsernameChallenge] = useState<AccountChallenge | null>(null);
  const [contactChallenge, setContactChallenge] = useState<AccountChallenge | null>(null);
  const usernameBinding = useRef(usernameChallenge);
  usernameBinding.current = usernameChallenge;
  const contactBinding = useRef(contactChallenge);
  contactBinding.current = contactChallenge;
  const contactKind = useRef(contactType);
  contactKind.current = contactType;
  function permitted(token = actor): token is string {
    return !!token && alive.current && !withdrawn.current && current.current === token;
  }
  function withdraw() {
    withdrawn.current = true;
    generation.current++;
    owner.current = null;
    capture.current = null;
    sending.current = false;
    source.current = null;
    setUser(null);
    setLocked(false);
    setBusy(false);
    setLoading(false);
    setUncertain(false);
    setCanRestart(false);
    setShowUsername(false);
    setContactType(null);
    setUsernameChallenge(null);
    setContactChallenge(null);
    usernameForm.reset(emptyUsername);
    contactForm.reset(emptyContact);
    setError(copy('forbidden'));
  }
  const coordination = {
    isLocked: () => !!owner.current,
    isCurrent: () => permitted(),
  };
  const usernameForm = useZodForm<UsernameValues>(
    async () => {
      const token = actor,
        schema = await import('../lib/contract-review-signature-form-schemas.js');
      return permitted(token)
        ? schema.usernameSettingsSchema(copy, !!usernameBinding.current)
        : schema.inactiveAccountSettingsSchema;
    },
    { defaultValues: emptyUsername, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const contactForm = useZodForm<ContactValues>(
    async () => {
      const token = actor,
        schema = await import('../lib/contract-review-signature-form-schemas.js');
      return permitted(token)
        ? schema.contactSettingsSchema(copy, !!contactBinding.current, contactKind.current)
        : schema.inactiveAccountSettingsSchema;
    },
    { defaultValues: emptyContact, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const scope = actor ?? '';
  const usernameFeedback = useSettingsFormFeedback(
    usernameForm,
    scope,
    locked,
    coordination,
    {
      newUsername: copy('usernameInvalid'),
      otp: copy('otpInvalid'),
      previousOtp: copy('otpInvalid'),
    },
    copy('error'),
    !!user && user.userId === actor && showUsername
  );
  const contactFeedback = useSettingsFormFeedback(
    contactForm,
    scope,
    locked,
    coordination,
    {
      contactValue: copy(contactType === 'email' ? 'emailInvalid' : 'mobileInvalid'),
      otp: copy('otpInvalid'),
    },
    copy('error'),
    !!user && user.userId === actor && !!contactType
  );
  function claim(which: Family | 'read') {
    if (
      !permitted() ||
      owner.current ||
      (which !== 'read' && (!source.current || source.current.userId !== actor))
    )
      return false;
    owner.current = which;
    setLocked(true);
    setError(null);
    return true;
  }
  function release(which: Family | 'read', token: string | null) {
    if (permitted(token) && owner.current === which && !capture.current) {
      owner.current = null;
      setLocked(false);
    }
  }
  async function readUser(token: string): Promise<AccountSettingsUser> {
    const response = await fetch('/api/auth/user', { credentials: 'include' });
    if (!permitted(token)) throw new Error('Obsolete account read');
    if ([401, 403].includes(response.status)) {
      withdraw();
      throw new Error('Account unavailable');
    }
    if (!response.ok) throw new Error('Account read failed');
    const value: unknown = await response.json();
    if (!permitted(token)) throw new Error('Obsolete account read');
    if (value && typeof value === 'object' && 'userId' in value && value.userId !== token) {
      withdraw();
      throw new Error('Account changed');
    }
    const parsed = accountSettingsUser(value, token);
    if (!parsed) throw new Error('Invalid account receipt');
    return parsed;
  }
  function acceptUser(next: AccountSettingsUser) {
    source.current = next;
    setUser(next);
  }
  function clearFamily(family: Family) {
    if (family === 'username') {
      setShowUsername(false);
      setUsernameChallenge(null);
      usernameBinding.current = null;
      usernameForm.reset(emptyUsername);
    } else {
      setContactType(null);
      contactKind.current = null;
      setContactChallenge(null);
      contactBinding.current = null;
      contactForm.reset(emptyContact);
    }
  }
  function complete(held: Capture, next: AccountSettingsUser) {
    if (!permitted(held.command.actor) || capture.current !== held) return false;
    acceptUser(next);
    clearFamily(held.command.family);
    capture.current = null;
    setUncertain(false);
    setCanRestart(false);
    setError(null);
    toast.success(
      t(
        held.command.family === 'username'
          ? 'settings.username.success'
          : 'settings.contact.success',
        locale
      )
    );
    return true;
  }
  async function refresh() {
    if (loading) return;
    if (!claim('read')) return;
    const token = actor!;
    setBusy(true);
    try {
      const next = await readUser(token);
      if (permitted(token)) acceptUser(next);
    } catch {
      if (permitted(token)) setError(t('settings.profile.error.loadRetry', locale));
    } finally {
      if (permitted(token)) setBusy(false);
      release('read', token);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      capture.current = null;
      owner.current = null;
    };
  }, []);
  useEffect(() => {
    withdrawn.current = false;
    capture.current = null;
    owner.current = null;
    sending.current = false;
    source.current = null;
    setUser(null);
    setLocked(false);
    setBusy(false);
    setUncertain(false);
    setCanRestart(false);
    setError(null);
    clearFamily('username');
    clearFamily('contact');
    const read = ++generation.current,
      token = actor;
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void readUser(token)
      .then((next) => {
        if (permitted(token) && read === generation.current) acceptUser(next);
      })
      .catch(() => {
        if (permitted(token) && read === generation.current)
          setError(t('settings.profile.error.loadRetry', locale));
      })
      .finally(() => {
        if (permitted(token) && read === generation.current) setLoading(false);
      });
  }, [actor]);
  async function send(command: AccountCommand) {
    const base = source.current;
    if (!base || !permitted(command.actor) || owner.current !== command.family || capture.current)
      return;
    const held: Capture = {
      command: { ...command, body: Object.freeze({ ...command.body }) },
      previousUsername: base.username,
      checked: false,
    };
    capture.current = held;
    sending.current = true;
    setBusy(true);
    try {
      const path =
        command.family === 'username' ? '/api/auth/change-username' : '/api/auth/add-contact';
      const response = await fetch(path + (command.stage === 'send' ? '/send-otp' : ''), {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(held.command.body),
      });
      if (!permitted(command.actor) || capture.current !== held) return;
      const value: unknown = await response.json().catch(() => null);
      if (!permitted(command.actor) || capture.current !== held) return;
      if (accountWriteDenied(response.status, value)) {
        withdraw();
        return;
      }
      if (accountWriteRejected(response.status, value)) {
        capture.current = null;
        setError(copy('error'));
        const code = accountErrorCode(value);
        if (command.stage === 'send' && code === 'AUTH:CHANGE_USERNAME:INVALID') {
          if (command.family === 'username') usernameFeedback.fields(['newUsername']);
          else contactFeedback.fields(['contactValue']);
        }
        if (
          command.family === 'username' &&
          ['AUTH:CHANGE_USERNAME:SAME', 'AUTH:CHANGE_USERNAME:TAKEN'].includes(code ?? '')
        )
          toast.error(
            t(
              code === 'AUTH:CHANGE_USERNAME:SAME'
                ? 'settings.username.error.same'
                : 'settings.username.error.taken',
              locale
            )
          );
        return;
      }
      if (response.status !== 200) throw new Error('Unknown account command outcome');
      if (command.stage === 'send') {
        const binding = accountChallenge(value, command, held.previousUsername);
        if (!binding) throw new Error('Invalid challenge receipt');
        if (command.family === 'username') {
          usernameBinding.current = binding;
          setUsernameChallenge(binding);
        } else {
          contactBinding.current = binding;
          setContactChallenge(binding);
        }
        capture.current = null;
        toast.success(
          t(
            command.family === 'username'
              ? 'settings.username.pairSent'
              : 'settings.contact.otpSent',
            locale
          ).replace('{destination}', binding.destination)
        );
      } else {
        if (!accountMessage(value)) throw new Error('Invalid verification receipt');
        const next = await readUser(command.actor);
        if (!permitted(command.actor) || capture.current !== held) return;
        acceptUser(next);
        if (!accountCommandConfirmed(command, next))
          throw new Error('Unconfirmed account mutation');
        complete(held, next);
      }
    } catch {
      if (permitted(command.actor) && capture.current === held) {
        setUncertain(true);
        setError(copy('uncertain'));
      }
    } finally {
      if (permitted(command.actor) && (capture.current === held || !capture.current)) {
        sending.current = false;
        setBusy(false);
        release(command.family, command.actor);
      }
    }
  }
  async function prepareUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!showUsername || !claim('username')) return;
    const token = actor;
    try {
      await usernameForm.handleSubmit(async (raw) => {
        if (!permitted(token) || owner.current !== 'username') return;
        const binding = usernameBinding.current,
          destination = binding?.destination ?? accountDestination(raw.newUsername);
        if (!destination) return;
        await send({
          family: 'username',
          stage: binding ? 'verify' : 'send',
          actor: token,
          destination,
          body: binding
            ? {
                newUsername: destination,
                otpChallengeId: binding.challengeId,
                otp: raw.otp,
                previousOtp: raw.previousOtp,
              }
            : { newUsername: destination },
        });
      }, usernameFeedback.invalid)(event);
    } finally {
      release('username', token);
    }
  }
  async function prepareContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactKind.current || !claim('contact')) return;
    const token = actor;
    try {
      await contactForm.handleSubmit(async (raw) => {
        if (!permitted(token) || owner.current !== 'contact' || !contactKind.current) return;
        const type = contactKind.current,
          binding = contactBinding.current;
        const destination = binding?.destination ?? accountDestination(raw.contactValue, type);
        if (!destination) return;
        await send({
          family: 'contact',
          stage: binding ? 'verify' : 'send',
          actor: token,
          destination,
          contactType: type,
          body: binding
            ? {
                contactType: type,
                contactValue: destination,
                otpChallengeId: binding.challengeId,
                otp: raw.otp,
              }
            : { contactType: type, contactValue: destination },
        });
      }, contactFeedback.invalid)(event);
    } finally {
      release('contact', token);
    }
  }
  async function confirm() {
    const held = capture.current;
    if (!held || sending.current || !permitted(held.command.actor)) return;
    sending.current = true;
    setBusy(true);
    setCanRestart(false);
    try {
      const next = await readUser(held.command.actor);
      if (!permitted(held.command.actor) || capture.current !== held) return;
      acceptUser(next);
      held.checked = true;
      if (accountCommandConfirmed(held.command, next)) complete(held, next);
      else {
        setError(copy('mismatch'));
        setCanRestart(true);
      }
    } catch {
      if (permitted(held.command.actor) && capture.current === held) setError(copy('uncertain'));
    } finally {
      if (permitted(held.command.actor) && (capture.current === held || !capture.current)) {
        sending.current = false;
        setBusy(false);
        release(held.command.family, held.command.actor);
      }
    }
  }
  function restart() {
    const held = capture.current;
    if (!held?.checked || sending.current || !permitted(held.command.actor)) return;
    if (held.command.family === 'username') {
      usernameBinding.current = null;
      setUsernameChallenge(null);
      usernameForm.setValue('otp', '');
      usernameForm.setValue('previousOtp', '');
      usernameForm.clearErrors();
    } else {
      contactBinding.current = null;
      setContactChallenge(null);
      contactForm.setValue('otp', '');
      contactForm.clearErrors();
    }
    capture.current = null;
    setUncertain(false);
    setCanRestart(false);
    setError(null);
    release(held.command.family, held.command.actor);
  }
  function openUsername() {
    if (permitted() && !owner.current) setShowUsername(true);
  }
  function openContact(type: ContactType) {
    if (!permitted() || owner.current || contactKind.current) return;
    contactKind.current = type;
    setContactType(type);
    contactForm.reset({ ...emptyContact, contactValue: source.current?.[type] ?? '' });
  }
  function cancel(family: Family) {
    if (permitted() && !owner.current) clearFamily(family);
  }
  return {
    user: permitted() && user?.userId === actor ? user : null,
    loading,
    locked,
    busy,
    error,
    uncertain,
    canRestart,
    copy,
    usernameForm,
    contactForm,
    usernameFeedback,
    contactFeedback,
    usernameValues: usernameForm.watch(),
    contactValues: contactForm.watch(),
    showUsername,
    contactType,
    usernameChallenge,
    contactChallenge,
    prepareUsername,
    prepareContact,
    openUsername,
    openContact,
    cancel,
    refresh,
    confirm,
    restart,
    canEdit: () => permitted() && !owner.current,
    canRead: () => permitted() && !owner.current,
  };
}
