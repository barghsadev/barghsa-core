import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm, type DefaultValues, type FieldValues } from '@barghsa/ui/form';
import type { $ZodType } from 'zod/v4/core';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
import type { Locale } from '@barghsa/i18n/app';
import { useAccountUser } from './useAccountUser.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import { useProfileContextRevision, useProfileContextReset } from '../lib/profile-context.js';
import { accountWriteDenied, accountWriteRejected } from '../lib/account-settings-form.js';
import { withCsrf } from '../lib/csrf.js';
import { queryKeys } from '../lib/query-keys.js';
import { DiscardedServerMutation, useServerMutation } from './useServerMutation.js';

class PreferenceWriteError extends Error {
  constructor(readonly outcome: 'denied' | 'rejected' | 'uncertain') {
    super('Preference save did not confirm the captured choices');
  }
}

export function usePreferenceSettingsOwner() {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  const key = JSON.stringify([actor, revision]);
  const current = useRef(key);
  current.current = key;
  const alive = useRef(true),
    owner = useRef<string | null>(null),
    withdrawn = useRef(false);
  const [locked, setLocked] = useState(false),
    [denied, setDenied] = useState(false);
  const isCurrent = () => !!actor && alive.current && current.current === key && !withdrawn.current;
  function deny() {
    if (current.current !== key || !alive.current) return;
    withdrawn.current = true;
    owner.current = null;
    setLocked(false);
    setDenied(true);
  }
  useProfileContextReset(deny);
  useEffect(() => {
    owner.current = null;
    withdrawn.current = false;
    setLocked(false);
    setDenied(false);
  }, [key]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      owner.current = null;
    };
  }, []);
  return {
    key,
    locked,
    denied,
    isCurrent,
    isLocked: () => !!owner.current,
    owns: (name: string) => isCurrent() && owner.current === name,
    claim(name: string) {
      if (!isCurrent() || owner.current) return false;
      owner.current = name;
      setLocked(true);
      return true;
    },
    release(name: string) {
      if (isCurrent() && owner.current === name) {
        owner.current = null;
        setLocked(false);
      }
    },
    deny,
  };
}
type Owner = ReturnType<typeof usePreferenceSettingsOwner>;
type SchemaModule = typeof import('../lib/contract-review-signature-form-schemas.js');
type Options<Values, Source> = {
  successMessage: string;
  family: string;
  path: string;
  initial: Values;
  parse(value: unknown): Source | null;
  values(source: Source): Values;
  body(values: Values): Record<string, unknown>;
  confirmed(source: Source, values: Values): boolean;
  schema(module: SchemaModule, source: Source | null): $ZodType<Values, Values>;
  accepted?: () => void;
};
export function usePreferenceSettingsForm<Values extends FieldValues, Source>(
  scope: Owner,
  locale: Locale,
  options: Options<Values, Source>
) {
  const copy = (key: string) => tPreferenceSettingsForms(key, locale);
  const actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const source = useRef<Source | null>(null),
    sequence = useRef(0),
    checking = useRef(false);
  const capture = useRef<{ key: string; values: Values; checked: boolean } | null>(null);
  const activeOptions = useRef(options);
  activeOptions.current = options;
  const [result, setResult] = useState<{ key: string; value: Source } | null>(null);
  const [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [checked, setChecked] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm<Values>(
    async () => {
      const module = await import('../lib/contract-review-signature-form-schemas.js');
      return scope.isCurrent()
        ? activeOptions.current.schema(module, source.current)
        : module.inactivePreferenceSettingsSchema<Values>();
    },
    {
      defaultValues: options.initial as DefaultValues<Values>,
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const resetForm = form.reset;
  const feedback = useSettingsFormFeedback(
    form,
    scope.key,
    scope.locked,
    scope,
    {},
    copy('error'),
    !!result && scope.isCurrent()
  );
  const ready = scope.isCurrent() && result?.key === scope.key && !loading && !loadFailed;
  const queryScope = actor
    ? { context: 'account' as const, ownerId: actor, accountId: actor, revision: profileRevision }
    : null;
  const mutation = useServerMutation<Source, NonNullable<typeof capture.current>>({
    mutationKey: queryScope ? queryKeys.preferences.detail(queryScope, options.family) : null,
    isCurrent: scope.isCurrent,
    invalidate: queryScope ? [queryKeys.preferences.all(queryScope)] : [],
    successMessage: options.successMessage,
    errorMessage: (failure) =>
      failure instanceof PreferenceWriteError && failure.outcome === 'rejected'
        ? copy('rejectedToast')
        : failure instanceof DiscardedServerMutation ||
            (failure instanceof PreferenceWriteError && failure.outcome === 'denied')
          ? undefined
          : copy('uncertainToast'),
    write: async (held) => {
      if (!scope.owns(options.family) || capture.current !== held)
        throw new DiscardedServerMutation();
      const response = await fetch(options.path, {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(options.body(held.values)),
      });
      if (!scope.owns(options.family) || capture.current !== held)
        throw new DiscardedServerMutation();
      const body: unknown = await response.json().catch(() => null);
      if (!scope.owns(options.family) || capture.current !== held)
        throw new DiscardedServerMutation();
      if (accountWriteDenied(response.status, body) || response.status === 404) {
        scope.deny();
        throw new PreferenceWriteError('denied');
      }
      const receipt = response.status === 200 ? options.parse(body) : null;
      if (receipt && options.confirmed(receipt, held.values)) return receipt;
      throw new PreferenceWriteError(
        accountWriteRejected(response.status, body) ? 'rejected' : 'uncertain'
      );
    },
  });
  async function read(signal?: AbortSignal): Promise<Source | null> {
    const attempt = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch(options.path, {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
      if (!scope.isCurrent() || signal?.aborted || sequence.current !== attempt) return null;
      if ([401, 403].includes(response.status)) {
        scope.deny();
        return null;
      }
      if (!response.ok) throw new Error('Settings unavailable');
      const value = options.parse(await response.json());
      if (!scope.isCurrent() || signal?.aborted || sequence.current !== attempt) return null;
      if (!value) throw new Error('Invalid settings');
      if (!source.current) form.reset(options.values(value));
      source.current = value;
      setResult({ key: scope.key, value });
      return value;
    } catch {
      if (scope.isCurrent() && !signal?.aborted && sequence.current === attempt)
        setLoadFailed(true);
      return null;
    } finally {
      if (scope.isCurrent() && !signal?.aborted && sequence.current === attempt) setLoading(false);
    }
  }
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const readCurrent = useRef(read);
  readCurrent.current = read;
  useEffect(() => {
    sequence.current++;
    source.current = null;
    capture.current = null;
    checking.current = false;
    setResult(null);
    resetForm(activeOptions.current.initial);
    setError(null);
    setSaved(false);
    setBusy(false);
    setUncertain(false);
    setChecked(false);
    setLoadFailed(false);
    if (scope.denied || !activeScope.current.isCurrent()) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void readCurrent.current(controller.signal);
    return () => {
      controller.abort();
      sequence.current++;
    };
  }, [scope.key, scope.denied, resetForm]);
  function accept(value: Source) {
    if (!scope.owns(options.family)) return;
    sequence.current++;
    source.current = value;
    setResult({ key: scope.key, value });
    form.reset(options.values(value));
    capture.current = null;
    setError(null);
    setSaved(true);
    setUncertain(false);
    setChecked(false);
    setLoadFailed(false);
    options.accepted?.();
    scope.release(options.family);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || capture.current || !scope.claim(options.family)) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await form.handleSubmit(async (raw) => {
        if (!scope.owns(options.family)) return;
        const values = JSON.parse(JSON.stringify(raw)) as Values;
        const held = { key: scope.key, values, checked: false };
        capture.current = held;
        try {
          const receipt = await mutation.mutateAsync(held);
          if (scope.owns(options.family) && capture.current === held) accept(receipt);
        } catch (failure) {
          if (scope.owns(options.family) && capture.current === held) {
            if (failure instanceof PreferenceWriteError && failure.outcome === 'rejected') {
              capture.current = null;
              setError(copy('error'));
              scope.release(options.family);
              return;
            }
            setUncertain(true);
            setError(copy('uncertain'));
          }
        }
      }, feedback.invalid)(event);
    } catch {
      if (scope.owns(options.family)) setError(copy('validationUnavailable'));
    } finally {
      if (scope.isCurrent()) {
        setBusy(false);
        if (!capture.current) scope.release(options.family);
      }
    }
  }
  async function refresh() {
    if (capture.current || !scope.claim(options.family)) return;
    try {
      await read();
    } finally {
      scope.release(options.family);
    }
  }
  async function confirm() {
    const held = capture.current;
    if (!held || !scope.owns(options.family) || checking.current) return;
    checking.current = true;
    held.checked = false;
    setChecked(false);
    setBusy(true);
    setError(null);
    try {
      const value = await read();
      if (!scope.owns(options.family) || capture.current !== held) return;
      if (value && options.confirmed(value, held.values)) accept(value);
      else {
        held.checked = !!value;
        setChecked(!!value);
        setError(copy(value ? 'mismatch' : 'uncertain'));
      }
    } finally {
      if (scope.isCurrent()) {
        checking.current = false;
        setBusy(false);
      }
    }
  }
  function restart() {
    if (!capture.current?.checked || checking.current || busy || !scope.owns(options.family))
      return;
    capture.current = null;
    setUncertain(false);
    setChecked(false);
    setError(null);
    scope.release(options.family);
  }
  return {
    form,
    feedback,
    submit,
    refresh,
    confirm,
    restart,
    ready,
    loading,
    loadFailed,
    busy,
    uncertain,
    checked,
    saved,
    error,
    copy,
    source: scope.isCurrent() && result?.key === scope.key ? result.value : null,
    locked: scope.locked || !ready,
  };
}
