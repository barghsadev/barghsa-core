import { useEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';
import { inputErrorFields } from '../lib/input-error-fields.js';
import type { SettingsCoordination, SettingsOwner } from '../lib/settings-form.js';
export type SettingsCommand = {
  owner: SettingsOwner;
  path: string;
  method: 'POST' | 'PUT' | 'DELETE';
  status: number;
  body?: Record<string, unknown>;
  keyed: boolean;
  receipt: (value: unknown) => boolean;
  confirmation?: (() => Promise<unknown>) | undefined;
  confirmed?: ((value: unknown) => boolean) | undefined;
  accepted: (value: unknown) => Promise<void> | void;
  fields?: ((names: unknown[]) => boolean) | undefined;
};
export function useSettingsCommand(
  scope: string,
  onDenied: () => void,
  authorized: (command: SettingsCommand | null) => boolean = () => true
) {
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    owner = useRef<SettingsOwner | null>(null),
    sending = useRef(false);
  const capture = useRef<{
    command: SettingsCommand;
    json: string | undefined;
    scope: string;
    attempted: boolean;
    acknowledged: boolean;
    uncertain: boolean;
  } | null>(null);
  const [locked, setLocked] = useState<SettingsOwner | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<'ready' | 'uncertain' | 'confirmation'>('ready'),
    [error, setError] = useState('');
  function reset() {
    owner.current = null;
    capture.current = null;
    sending.current = false;
    setLocked(null);
    setBusy(false);
    setPhase('ready');
    setError('');
  }
  function isCurrent() {
    return alive.current && current.current === scope;
  }
  function release(which: SettingsOwner) {
    if (isCurrent() && owner.current === which && !capture.current) {
      owner.current = null;
      setLocked(null);
      setBusy(false);
    }
  }
  const coordination: SettingsCoordination = {
    claim(which) {
      if (!isCurrent() || owner.current || !authorized(null)) return false;
      owner.current = which;
      setLocked(which);
      setError('');
      return true;
    },
    release,
    isLocked: () => !!owner.current,
    isCurrent,
    denied() {
      if (!isCurrent()) return;
      reset();
      onDenied();
    },
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      owner.current = null;
      capture.current = null;
    };
  }, []);
  useEffect(() => {
    reset();
  }, [scope]);
  useEffect(() => {
    if (capture.current && isCurrent() && !authorized(capture.current.command))
      coordination.denied();
  }, [authorized, scope, locked]);
  function stage(command: SettingsCommand) {
    if (!isCurrent() || owner.current !== command.owner || capture.current || !authorized(command))
      return false;
    capture.current = {
      command,
      json: command.body ? JSON.stringify(command.body) : undefined,
      scope,
      attempted: false,
      acknowledged: false,
      uncertain: false,
    };
    return true;
  }
  function heldCurrent(held: NonNullable<typeof capture.current>) {
    if (!isCurrent() || capture.current !== held || held.scope !== scope) return false;
    if (!authorized(held.command)) {
      coordination.denied();
      return false;
    }
    return true;
  }
  async function accept(held: NonNullable<typeof capture.current>, value: unknown) {
    if (!heldCurrent(held)) return false;
    capture.current = null;
    setPhase('ready');
    setError('');
    try {
      await held.command.accepted(value);
    } finally {
      if (isCurrent() && owner.current === held.command.owner) {
        owner.current = null;
        setLocked(null);
        setBusy(false);
      }
    }
    return isCurrent();
  }
  async function confirm(held: NonNullable<typeof capture.current>) {
    if (!held.command.confirmation || !held.command.confirmed) return false;
    setPhase('confirmation');
    const value = await held.command.confirmation();
    if (!heldCurrent(held)) return false;
    if (held.command.confirmed(value)) return accept(held, value);
    setError('confirmationMismatch');
    return false;
  }
  async function send(readOnly = false): Promise<boolean> {
    const held = capture.current;
    if (!held || sending.current || !heldCurrent(held)) return false;
    if (readOnly && !held.command.confirmation) return false;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      if (readOnly || held.acknowledged || (!held.command.keyed && held.attempted))
        return await confirm(held);
      held.attempted = true;
      const response = await fetch(held.command.path, {
        method: held.command.method,
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        ...(held.json === undefined ? {} : { body: held.json }),
      });
      if (!heldCurrent(held)) return false;
      if ([401, 403, 404].includes(response.status)) {
        coordination.denied();
        return false;
      }
      const value: unknown = await response.json().catch(() => null);
      if (!heldCurrent(held)) return false;
      if (response.status === held.command.status && held.command.receipt(value)) {
        held.acknowledged = true;
        return held.command.confirmation ? await confirm(held) : await accept(held, value);
      }
      const fields = inputErrorFields(value, response.status).fields;
      if (
        !held.uncertain &&
        response.status === 400 &&
        Array.isArray(fields) &&
        held.command.fields?.(fields)
      ) {
        capture.current = null;
        owner.current = null;
        setLocked(null);
        setPhase('ready');
        setError('');
        return false;
      }
      held.uncertain = true;
      setPhase(held.command.keyed ? 'uncertain' : 'confirmation');
      setError('error');
      return false;
    } catch {
      if (heldCurrent(held)) {
        held.uncertain = true;
        setPhase(held.acknowledged || !held.command.keyed ? 'confirmation' : 'uncertain');
        setError('error');
      }
      return false;
    } finally {
      if (isCurrent() && (capture.current === held || !capture.current)) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  async function submit(command: SettingsCommand) {
    return stage(command) ? send() : false;
  }
  function cancel() {
    if (isCurrent() && !sending.current && !capture.current?.attempted) reset();
  }
  function resetCapture() {
    if (isCurrent() && !sending.current) reset();
  }
  return {
    coordination,
    stage,
    submit,
    send: () => send(),
    refreshConfirmation: () => send(true),
    cancel,
    resetCapture,
    reset,
    locked,
    busy,
    phase,
    error,
  };
}
