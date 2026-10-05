import { useEffect, useRef, useState } from 'react';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  contractFormRejection,
  type ContractFormCoordination,
} from '../lib/contract-review-signature-form.js';
import {
  matchedContractAuthoringReceipt,
  type ContractAuthoringEvidence,
} from '../lib/contract-authoring-form.js';

type Command = {
  action: TeamAction;
  evidence: ContractAuthoringEvidence;
  scope: string;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
};
/** The two authoring forms share the existing parent owner and TeamActionDialog transaction. */
export function useContractAuthoringCommand({
  scope,
  coordination,
  onLocked,
  onSaved,
  onDenied,
  onFields,
  error,
}: {
  scope: string;
  coordination?: ContractFormCoordination | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
  onSaved: (id: string) => void;
  onDenied?: (() => void) | undefined;
  onFields: (fields: unknown[]) => boolean;
  error: string;
}) {
  const current = useRef({ scope, coordination, onLocked, onSaved, onDenied, onFields, error });
  current.current = { scope, coordination, onLocked, onSaved, onDenied, onFields, error };
  const owner = useRef<object>({}),
    alive = useRef(true),
    claiming = useRef(false);
  const command = useRef<Command | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null),
    [preparing, setPreparing] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [locked, setLocked] = useState(false),
    [failed, setFailed] = useState(false);
  function fresh() {
    return alive.current && current.current.scope === scope;
  }
  function release() {
    if (!claiming.current) return;
    claiming.current = false;
    current.current.coordination?.release(owner.current);
    current.current.onLocked?.(false);
    setLocked(false);
    setPreparing(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (claiming.current) {
        coordination?.release(owner.current);
        onLocked?.(false);
      }
    };
  }, []);
  function begin() {
    if (!fresh() || claiming.current || command.current || current.current.coordination?.blocked())
      return false;
    if (current.current.coordination && !current.current.coordination.acquire(owner.current))
      return false;
    setFailed(false);
    claiming.current = true;
    setLocked(true);
    setPreparing(true);
    current.current.onLocked?.(true);
    return true;
  }
  function finish() {
    if (fresh() && !command.current) release();
  }
  function isCurrent(captured: Command) {
    return fresh() && command.current === captured && captured.scope === scope;
  }
  function unknown(captured: Command) {
    if (!isCurrent(captured)) return;
    captured.uncertain = true;
    setUncertain(true);
    setAction(null);
    setPreparing(false);
  }
  function denied(captured?: Command) {
    if (!fresh() || (captured && !isCurrent(captured))) return;
    command.current = null;
    setAction(null);
    setUncertain(false);
    release();
    current.current.onDenied?.();
  }
  function reject(captured: Command, response: unknown) {
    if (!isCurrent(captured)) return current.current.error;
    const rejection = contractFormRejection(response);
    if (!rejection) {
      unknown(captured);
      return current.current.error;
    }
    if (rejection.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
      denied(captured);
      return current.current.error;
    }
    if (captured.uncertain) {
      unknown(captured);
      return current.current.error;
    }
    captured.rejected = true;
    command.current = null;
    setAction(null);
    release();
    const owned =
      rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(rejection.fields) &&
      current.current.onFields(rejection.fields);
    setFailed(!owned);
    return current.current.error;
  }
  function decorate(captured: Command): TeamAction {
    return {
      ...captured.action,
      errorMessages: Object.fromEntries(
        [
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          'VALIDATION:PARSE:ZOD_ERROR',
          ErrorCodes.CONFLICT_STATE.code,
          ErrorCodes.CONFLICT_VERSION.code,
          ErrorCodes.NOT_FOUND_RESOURCE.code,
        ].map((code) => [code, (response: unknown) => reject(captured, response)])
      ),
    };
  }
  function capture(next: TeamAction, evidence: ContractAuthoringEvidence) {
    if (!fresh() || !claiming.current || command.current) return;
    const immutableBody = JSON.parse(JSON.stringify(next.body)) as Record<string, unknown>;
    const captured: Command = {
      action: { ...next, body: immutableBody },
      evidence: { ...JSON.parse(JSON.stringify(evidence)), body: immutableBody },
      scope,
      attempted: false,
      uncertain: false,
      rejected: false,
    };
    command.current = captured;
    setPreparing(false);
    setAction(decorate(captured));
  }
  const displayed = command.current;
  return {
    begin,
    finish,
    capture,
    denied,
    preparing,
    locked,
    failed,
    frozen: !!displayed,
    uncertain,
    action,
    blocked: () =>
      !fresh() ||
      claiming.current ||
      !!command.current ||
      !!current.current.coordination?.blocked(),
    retry: () => {
      const captured = command.current;
      if (captured && isCurrent(captured) && !action) setAction(decorate(captured));
    },
    dialog: displayed
      ? {
          onPendingChange: (pending: boolean) => {
            if (pending && isCurrent(displayed)) displayed.attempted = true;
          },
          onUnconfirmed: () => unknown(displayed),
          onDenied: () => denied(displayed),
          onClose: () => {
            if (!isCurrent(displayed)) return;
            setAction(null);
            if (displayed.attempted && !displayed.rejected) unknown(displayed);
            else {
              command.current = null;
              release();
            }
          },
          onSuccess: async (result: unknown) => {
            if (!isCurrent(displayed)) return;
            if (!matchedContractAuthoringReceipt(result, displayed.evidence)) {
              unknown(displayed);
              throw new Error('Unconfirmed contract save');
            }
            command.current = null;
            setAction(null);
            setUncertain(false);
            release();
            current.current.onSaved(result.id);
          },
        }
      : null,
  };
}
