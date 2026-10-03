import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { $ZodType } from 'zod/v4/core';
import type { FieldPath, FieldValues } from '@barghsa/ui/form';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';
import { useWizardForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';

export interface SavingEditorProps {
  disabled?: boolean;
  refreshVersion?: number;
  onBusyChange?: (busy: boolean) => void;
  onDenied?: () => void;
}
type SavingCatalogueEditor<Data, Draft extends FieldValues> = ReturnType<
  typeof useWizardForm<Draft>
> & {
  resource: ReturnType<typeof useCatalogueResource<Data>>;
  action: TeamAction | null;
  busy: boolean;
  ready: boolean;
  uncertain: boolean;
  saved: boolean;
  denied: boolean;
  disabled: boolean;
  submit: (event: FormEvent, capture: (draft: Draft) => TeamAction) => Promise<void>;
  propose: (action: TeamAction) => void;
  close: () => void;
  verifyReceipt: (matches: boolean) => boolean;
  refresh: () => void;
  complete: () => void;
  onDenied: () => void;
  onValidationError: (fields: unknown[]) => boolean;
  feedback: (field: FieldPath<Draft>) => ReactNode;
};

/** The two saving catalogue editors share draft, permission and captured-action ownership. */
export function useSavingCatalogueEditor<Data, Draft extends FieldValues>(
  options: SavingEditorProps & {
    identity: string;
    path: string;
    validate: (value: unknown) => value is Data;
    basis: (value: Data) => string;
    defaults: Draft;
    values: (value: Data) => Draft;
    schema: (value: Data | null) => Promise<$ZodType<Draft, Draft>>;
    messages: Record<FieldPath<Draft>, string>;
    label: (key: string) => string;
  }
): SavingCatalogueEditor<Data, Draft> {
  const { identity, path, validate, basis, defaults, values, messages, label } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const generation = useRef(0),
    source = useRef<{ identity: string; basis: string } | null>(null);
  const command = useRef<{ action: TeamAction; generation: number } | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [saved, setSaved] = useState(false);
  const data = useRef<Data | null>(null);
  const editor = useWizardForm<Draft>(
    () => callbacks.current.schema(data.current),
    defaults,
    label('validationUnavailable')
  );
  const { reset, clearErrors, setFocus } = editor.form;
  const invalidFocus = useRef<FieldPath<Draft> | null>(null);
  const deny = useCallback(() => {
    generation.current++;
    source.current = null;
    command.current = null;
    invalidFocus.current = null;
    data.current = null;
    reset(defaults);
    setAction(null);
    setUncertain(false);
    setSaved(false);
    callbacks.current.onDenied?.();
  }, [reset, defaults]);
  const scope = useCatalogueScope(deny);
  const resource = useCatalogueResource(scope, path, validate);
  const refreshVersion = useRef(options.refreshVersion);
  useEffect(() => {
    if (refreshVersion.current === options.refreshVersion) return;
    refreshVersion.current = options.refreshVersion;
    generation.current++;
    command.current = null;
    invalidFocus.current = null;
    setAction(null);
    setSaved(false);
    resource.retry();
  }, [options.refreshVersion, resource.retry]);
  data.current = resource.data;
  const pending = editor.pending || editor.form.formState.isSubmitting;
  const busy = pending || action !== null;
  const ready =
    !scope.denied && !!resource.data && !resource.error && !resource.loading && !options.disabled;
  const live = useRef({ identity, ready, uncertain });
  live.current = { identity, ready, uncertain };
  useEffect(() => {
    if (source.current?.identity !== identity) {
      generation.current++;
      source.current = null;
      command.current = null;
      invalidFocus.current = null;
      reset(defaults);
      setAction(null);
      setUncertain(false);
      setSaved(false);
    }
    if (!resource.data) return;
    const accepted = basis(resource.data);
    if (source.current?.basis !== accepted) {
      generation.current++;
      command.current = null;
      invalidFocus.current = null;
      reset(values(resource.data));
      setAction(null);
    }
    source.current = { identity, basis: accepted };
    setUncertain(false);
  }, [identity, resource.data, basis, values, reset, defaults]);
  useEffect(() => {
    return () => {
      generation.current++;
      command.current = null;
      source.current = null;
    };
  }, []);
  useEffect(() => {
    if (pending || !invalidFocus.current) return;
    const field = invalidFocus.current;
    invalidFocus.current = null;
    setFocus(field);
  }, [pending, setFocus]);
  useEffect(() => {
    options.onBusyChange?.(busy);
    return () => options.onBusyChange?.(false);
  }, [busy, options.onBusyChange]);
  const fieldErrors = useActionFieldErrors(editor.form, messages, label('invalid'));
  function close() {
    command.current = null;
    setAction(null);
  }
  function propose(next: TeamAction) {
    if (
      !live.current.ready ||
      live.current.identity !== identity ||
      live.current.uncertain ||
      command.current
    )
      return;
    command.current = { action: next, generation: generation.current };
    setSaved(false);
    setAction(next);
  }
  async function submit(event: FormEvent, capture: (draft: Draft) => TeamAction) {
    event.preventDefault();
    if (!ready || uncertain || command.current || editor.isPending()) return;
    const version = generation.current;
    editor.setValidationPending(true);
    setSaved(false);
    try {
      await editor.form.handleSubmit(
        (draft) => {
          if (
            version !== generation.current ||
            !live.current.ready ||
            live.current.identity !== identity
          )
            return;
          propose(capture(draft));
        },
        (errors) => {
          if (version !== generation.current || live.current.identity !== identity) {
            clearErrors();
            return;
          }
          invalidFocus.current =
            (Object.keys(errors).find((field) => field in messages) as FieldPath<Draft>) ?? null;
        }
      )();
    } finally {
      editor.setValidationPending(false);
    }
  }
  const captured = command.current;
  const current = () =>
    captured !== null &&
    command.current === captured &&
    captured.generation === generation.current &&
    live.current.identity === identity &&
    !scope.denied;
  function verifyReceipt(matches: boolean) {
    if (!current()) return false;
    if (!matches) {
      setUncertain(true);
      throw new Error('Unverified saving catalogue acknowledgement');
    }
    return true;
  }
  return {
    ...editor,
    resource,
    action,
    pending,
    busy,
    ready,
    uncertain,
    saved,
    denied: scope.denied,
    disabled: !ready || busy || uncertain,
    submit,
    propose,
    close,
    verifyReceipt,
    refresh: () => {
      if (editor.isPending() || command.current) return;
      setSaved(false);
      if (scope.denied) scope.recover();
      else resource.retry();
    },
    complete: () => {
      if (current()) {
        close();
        setSaved(true);
      }
    },
    onDenied: () => {
      if (current()) scope.deny();
    },
    onValidationError: (fields: unknown[]) => current() && fieldErrors(fields),
    feedback: (field: FieldPath<Draft>) => {
      const message = editor.form.getFieldState(field).error?.message;
      return (
        <p
          id={editor.errorId(field)}
          role={message ? 'alert' : undefined}
          aria-hidden={message ? undefined : true}
          className={`text-sm text-destructive ${message ? '' : 'invisible'}`}
        >
          {typeof message === 'string' ? message : messages[field]}
        </p>
      );
    },
  };
}
