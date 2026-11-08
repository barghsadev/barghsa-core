import { useEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';
import { inputErrorFields } from '../lib/input-error-fields.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import type { TicketCommand, TicketCoordination, TicketOwner } from '../lib/ticket-form.js';
export function useTicketCommand(
  scope: string,
  denied: () => void,
  authorized: (owner: TicketOwner) => boolean = () => true,
  onUnconfirmed?: () => void
) {
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    owner = useRef<TicketOwner | null>(null),
    capture = useRef<{
      command: TicketCommand;
      json: string;
      scope: string;
      uncertain: boolean;
    } | null>(null),
    sending = useRef<AbortController | null>(null);
  const [locked, setLocked] = useState<TicketOwner | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  function reset() {
    owner.current = null;
    capture.current = null;
    sending.current?.abort();
    sending.current = null;
    setLocked(null);
    setBusy(false);
    setUncertain(false);
    setError('');
  }
  function isCurrent() {
    return alive.current && current.current === scope;
  }
  function release(which: TicketOwner) {
    if (isCurrent() && owner.current === which && !capture.current) {
      owner.current = null;
      setLocked(null);
      setBusy(false);
    }
  }
  const coordination: TicketCoordination = {
    claim(which) {
      if (!isCurrent() || owner.current || !authorized(which)) return false;
      owner.current = which;
      setLocked(which);
      setBusy(true);
      setError('');
      return true;
    },
    release,
    isLocked(which) {
      return !!owner.current && (!which || owner.current !== which);
    },
    isCurrent,
    denied() {
      if (!isCurrent()) return;
      reset();
      denied();
    },
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      owner.current = null;
      capture.current = null;
      sending.current?.abort();
      sending.current = null;
    };
  }, []);
  useEffect(() => {
    reset();
  }, [scope]);
  useEffect(() => {
    if (owner.current && isCurrent() && !authorized(owner.current)) coordination.denied();
  }, [authorized, locked, scope]);
  async function send(): Promise<boolean> {
    const held = capture.current;
    if (!held || sending.current || !isCurrent() || held.scope !== scope) return false;
    if (!authorized(held.command.owner)) {
      coordination.denied();
      return false;
    }
    const controller = new AbortController();
    sending.current = controller;
    setBusy(true);
    setError('');
    const unconfirmed = (message: string) => {
      const first = !held.uncertain;
      held.uncertain = true;
      setUncertain(true);
      setError(message);
      if (first) onUnconfirmed?.();
    };
    try {
      const { status, value } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(held.command.path, {
          method: held.command.method,
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: held.json,
          signal,
        });
        const value: unknown = [401, 403, 404].includes(response.status)
          ? null
          : await response.json().catch(() => null);
        return { status: response.status, value };
      });
      if (!isCurrent() || capture.current !== held) return false;
      if (!authorized(held.command.owner)) {
        coordination.denied();
        return false;
      }
      if ([401, 403, 404].includes(status)) {
        coordination.denied();
        return false;
      }
      if (status === held.command.status && held.command.confirmed(value)) {
        capture.current = null;
        setUncertain(false);
        try {
          await held.command.accepted(value);
        } finally {
          if (
            isCurrent() &&
            sending.current === controller &&
            owner.current === held.command.owner
          ) {
            owner.current = null;
            setLocked(null);
          }
        }
        return isCurrent() && sending.current === controller;
      }
      const fields = inputErrorFields(value, status).fields;
      if (
        !held.uncertain &&
        status === 400 &&
        Array.isArray(fields) &&
        held.command.fields?.(fields)
      ) {
        capture.current = null;
        owner.current = null;
        setLocked(null);
        setError('');
        return false;
      }
      unconfirmed(status === 409 ? 'conflict' : 'error');
      return false;
    } catch {
      if (isCurrent() && capture.current === held) {
        if (authorized(held.command.owner)) unconfirmed('error');
        else coordination.denied();
      }
      return false;
    } finally {
      if (isCurrent() && sending.current === controller) {
        sending.current = null;
        setBusy(false);
      }
    }
  }
  async function submit(command: TicketCommand) {
    if (!isCurrent() || owner.current !== command.owner || capture.current) return false;
    capture.current = { command, json: JSON.stringify(command.body), scope, uncertain: false };
    return send();
  }
  function failed(which: TicketOwner) {
    if (!isCurrent()) return;
    release(which);
    setError('error');
  }
  return { coordination, submit, retry: send, failed, locked, busy, uncertain, error, reset };
}
