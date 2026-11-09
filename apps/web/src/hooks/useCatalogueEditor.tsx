import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { $ZodType } from 'zod/v4/core';
import type { FieldPath, FieldValues } from '@barghsa/ui/form';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';
import { useWizardForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';

export interface CatalogueEditorProps {
  disabled?: boolean;
  refreshVersion?: number;
  contextBasis?: string;
  retainChangedDraft?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDenied?: (status?: 401 | 403) => void;
}
type CatalogueEditor<Data, Draft extends FieldValues> = ReturnType<typeof useWizardForm<Draft>> & {
  resource: ReturnType<typeof useCatalogueResource<Data>>;
  action: TeamAction | null;
  busy: boolean;
  ready: boolean;
  uncertain: boolean;
  commandPending: boolean;
  saved: boolean;
  stale: boolean;
  resetToCurrent: () => void;
  deny: (status?: 401 | 403) => void;
  denied: boolean;
  disabled: boolean;
  submit: (event: FormEvent, capture: (draft: Draft) => TeamAction) => Promise<void>;
  propose: (action: TeamAction) => void;
  close: () => void;
  verifyReceipt: (matches: boolean) => boolean;
  refresh: () => void;
  complete: (value?: Data) => void;
  onDenied: (status?: 401 | 403) => void;
  onPendingChange: (pending: boolean) => void;
  onUnconfirmed: () => void;
  onValidationError: (fields: unknown[]) => boolean;
  feedback: (field: FieldPath<Draft>) => ReactNode;
};

/** Catalogue and configuration editors share draft, permission and captured-action ownership. */
export function useCatalogueEditor<Data, Draft extends FieldValues>(
  options: CatalogueEditorProps & {
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
): CatalogueEditor<Data, Draft> {
  const { path, validate, basis, defaults, values, messages, label } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const generation = useRef(0),
    source = useRef<string | null>(null);
  const command = useRef<{ action: TeamAction; generation: number } | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [stale, setStale] = useState(false);
  const [requiredRead, setRequiredRead] = useState<number | null>(null),
    [saved, setSaved] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const uncertain = requiredRead !== null;
  const data = useRef<Data | null>(null);
  const editor = useWizardForm<Draft>(
    () => callbacks.current.schema(data.current),
    defaults,
    label('validationUnavailable')
  );
  const { reset, clearErrors, setFocus } = editor.form;
  const dirtyDraft = useRef(false);
  dirtyDraft.current = editor.form.formState.isDirty;
  const invalidFocus = useRef<FieldPath<Draft> | null>(null);
  const deny = useCallback(
    (status?: 401 | 403) => {
      generation.current++;
      source.current = null;
      command.current = null;
      invalidFocus.current = null;
      data.current = null;
      commandPendingRef.current = false;
      setCommandPending(false);
      reset(defaults);
      setAction(null);
      setRequiredRead(null);
      setSaved(false);
      setStale(false);
      callbacks.current.onDenied?.(status);
    },
    [reset, defaults]
  );
  const scope = useCatalogueScope(deny);
  const resource = useCatalogueResource(scope, path, validate);
  const identity = JSON.stringify([options.identity, resource.ownerKey]);
  const nextReadAttempt = resource.nextReadAttempt;
  const refreshVersion = useRef(options.refreshVersion);
  useEffect(() => {
    if (refreshVersion.current === options.refreshVersion) return;
    refreshVersion.current = options.refreshVersion;
    generation.current++;
    command.current = null;
    if (commandPendingRef.current) {
      const required = nextReadAttempt();
      setRequiredRead((previous) => previous ?? required);
      commandPendingRef.current = false;
      setCommandPending(false);
    }
    invalidFocus.current = null;
    setAction(null);
    setSaved(false);
    resource.retry();
  }, [options.refreshVersion, resource.retry, nextReadAttempt]);
  const contextBasis = useRef(options.contextBasis);
  useEffect(() => {
    if (contextBasis.current === options.contextBasis) return;
    contextBasis.current = options.contextBasis;
    generation.current++;
    command.current = null;
    if (commandPendingRef.current) {
      const required = nextReadAttempt();
      setRequiredRead((previous) => previous ?? required);
      commandPendingRef.current = false;
      setCommandPending(false);
    }
    invalidFocus.current = null;
    setAction(null);
  }, [options.contextBasis, nextReadAttempt]);
  data.current = resource.data;
  const pending = editor.pending || editor.form.formState.isSubmitting;
  const busy = pending || action !== null;
  const ready =
    !scope.denied &&
    !!resource.data &&
    !resource.error &&
    !resource.loading &&
    !options.disabled &&
    !stale;
  const live = useRef({ identity, ready, uncertain });
  live.current = { identity, ready, uncertain };
  const acceptedOwner = useRef<string | null>(null);
  useEffect(() => {
    if (acceptedOwner.current !== identity) {
      acceptedOwner.current = identity;
      generation.current++;
      source.current = null;
      command.current = null;
      invalidFocus.current = null;
      commandPendingRef.current = false;
      setCommandPending(false);
      reset(defaults);
      setAction(null);
      setRequiredRead(null);
      setSaved(false);
      setStale(false);
    }
    if (!resource.data || commandPending) return;
    if (
      requiredRead !== null &&
      (resource.loading ||
        resource.error ||
        resource.readAttempt === null ||
        resource.readAttempt < requiredRead)
    )
      return;
    const accepted = basis(resource.data);
    if (requiredRead !== null || source.current !== accepted) {
      generation.current++;
      command.current = null;
      invalidFocus.current = null;
      if (source.current !== accepted) {
        if (source.current !== null && callbacks.current.retainChangedDraft && dirtyDraft.current)
          setStale(true);
        else {
          reset(values(resource.data));
          setStale(false);
        }
      }
      setAction(null);
    }
    source.current = accepted;
    setRequiredRead(null);
  }, [
    identity,
    resource.data,
    resource.loading,
    resource.error,
    resource.readAttempt,
    commandPending,
    requiredRead,
    basis,
    values,
    reset,
    defaults,
  ]);
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
    commandPendingRef.current = false;
    setCommandPending(false);
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
  function unconfirmed() {
    if (!current()) return;
    const required = nextReadAttempt();
    setRequiredRead((previous) => previous ?? required);
  }
  function verifyReceipt(matches: boolean) {
    if (!current()) return false;
    if (!matches) {
      unconfirmed();
      throw new Error('Unverified catalogue acknowledgement');
    }
    return true;
  }
  return {
    ...editor,
    field: (name) => {
      const [value, update] = editor.field(name);
      return [
        value,
        (next) => {
          setSaved(false);
          update(next);
        },
      ];
    },
    resource,
    action,
    pending,
    busy,
    ready,
    uncertain,
    commandPending,
    saved,
    stale,
    deny: scope.deny,
    resetToCurrent: () => {
      if (!resource.data || busy || uncertain || scope.denied) return;
      generation.current++;
      reset(values(resource.data));
      setStale(false);
      setSaved(false);
    },
    denied: scope.denied,
    disabled: !ready || busy || uncertain,
    submit,
    propose,
    close: () => {
      if (current()) close();
    },
    verifyReceipt,
    refresh: () => {
      if (editor.isPending() || commandPendingRef.current) return;
      setSaved(false);
      if (scope.denied) scope.recover();
      else resource.retry();
    },
    complete: (value) => {
      if (current()) {
        if (value !== undefined) {
          source.current = basis(value);
          reset(values(value));
          resource.accept(value);
          setStale(false);
        }
        close();
        setSaved(true);
      }
    },
    onDenied: (status) => {
      if (current()) scope.deny(status);
    },
    onPendingChange: (pending) => {
      if (!current()) return;
      commandPendingRef.current = pending;
      setCommandPending(pending);
    },
    onUnconfirmed: unconfirmed,
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
