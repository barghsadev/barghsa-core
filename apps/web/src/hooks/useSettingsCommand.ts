import { useEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';
import { inputErrorFields } from '../lib/input-error-fields.js';
import { readWithDeadline } from '../lib/server-query-client.js';
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
    sending = useRef<AbortController | null>(null);
  const capture = useRef<{
    command: SettingsCommand;
    json: string | undefined;
    attempted: boolean;
    acknowledged: boolean;
    uncertain: boolean;
  } | null>(null);
  const [locked, setLocked] = useState<SettingsOwner | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState<'ready' | 'uncertain' | 'confirmation'>('ready'),
    [error, setError] = useState('');
  function clearAttempt() {
    owner.current = null;
    capture.current = null;
    sending.current?.abort();
    sending.current = null;
  }
  function reset() {
    clearAttempt();
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
      clearAttempt();
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
      attempted: false,
      acknowledged: false,
      uncertain: false,
    };
    return true;
  }
  function heldCurrent(held: NonNullable<typeof capture.current>) {
    if (!isCurrent() || capture.current !== held) return false;
    if (!authorized(held.command)) {
      coordination.denied();
      return false;
    }
    return true;
  }
  async function accept(held: NonNullable<typeof capture.current>, value: unknown) {
    if (!heldCurrent(held)) return false;
    const controller = sending.current;
    capture.current = null;
    setPhase('ready');
    try {
      await held.command.accepted(value);
    } finally {
      if (isCurrent() && sending.current === controller && owner.current === held.command.owner) {
        owner.current = null;
        setLocked(null);
      }
    }
    return isCurrent() && sending.current === controller;
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
    const { command, json } = held;
    if (readOnly && !command.confirmation) return false;
    const controller = new AbortController();
    sending.current = controller;
    setBusy(true);
    setError('');
    try {
      if (readOnly || held.acknowledged || (!command.keyed && held.attempted))
        return await confirm(held);
      held.attempted = true;
      const receipt = await readWithDeadline(controller.signal, async (signal) => {
        const init: RequestInit = {
          method: command.method,
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          signal,
        };
        if (json !== undefined) init.body = json;
        const response = await fetch(command.path, init);
        const { status } = response;
        if ([401, 403, 404].includes(status)) return null;
        const value: unknown = await response.json();
        return { status, value };
      });
      if (!heldCurrent(held)) return false;
      if (!receipt) {
        coordination.denied();
        return false;
      }
      const { status, value } = receipt;
      if (status === command.status && command.receipt(value)) {
        held.acknowledged = true;
        return command.confirmation ? await confirm(held) : await accept(held, value);
      }
      const fields = inputErrorFields(value, status).fields;
      if (!held.uncertain && status === 400 && Array.isArray(fields) && command.fields?.(fields)) {
        reset();
        return false;
      }
    } catch {
      if (!heldCurrent(held)) return false;
    } finally {
      if (isCurrent() && sending.current === controller) {
        sending.current = null;
        setBusy(false);
      }
    }
    held.uncertain = true;
    setPhase(held.acknowledged || !command.keyed ? 'confirmation' : 'uncertain');
    setError('error');
    return false;
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
