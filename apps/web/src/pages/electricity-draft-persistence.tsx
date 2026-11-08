import { useCallback, useRef, useState } from 'react';
import { Button, ConfirmationFields } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { commercialFetch } from '../lib/commercial-fetch.js';
import { withCsrf } from '../lib/csrf.js';
import { confirmedDraftReceipt, uuidReference } from '../lib/form-receipt.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type Mode = 'simple' | 'advanced';
type Revision = string | null;
type DraftInput = { profileId: string; currentStep: number; data: object };
type Command = {
  profileId: string;
  input?: DraftInput;
  revision: Revision;
  leave: boolean;
  confirmed: () => Promise<boolean>;
};
type Recovery = { phase: 'check' | 'retry' | 'stale'; command: Command };

export function electricityDraftPath(mode: Mode, profileId?: string) {
  const path = `/api/electricity/drafts/${mode}/guarded`;
  return profileId ? `${path}?profileId=${encodeURIComponent(profileId)}` : path;
}

function draftPacket(value: unknown) {
  if (!value || typeof value !== 'object' || !('revision' in value))
    throw new Error('Draft revision unavailable');
  return {
    revision: value.revision === null ? null : uuidReference(value.revision),
    value: value as Record<string, unknown>,
  };
}

export function useElectricityDraftPersistence(mode: Mode) {
  const revision = useRef<Revision | undefined>(undefined);
  const active = useRef<AbortController | null>(null);
  const unresolved = useRef(false);
  const [working, setWorking] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const retire = useCallback(() => {
    active.current?.abort();
    active.current = null;
    revision.current = undefined;
    unresolved.current = false;
  }, []);

  function hold(value: Recovery | null) {
    unresolved.current = value !== null;
    setRecovery(value);
  }
  const reset = useCallback(() => {
    retire();
    setWorking(false);
    setRecovery(null);
  }, [retire]);
  const readRevision = useCallback((value: unknown) => {
    revision.current = draftPacket(value).revision;
  }, []);

  async function send(command: Command, retrying: boolean) {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    try {
      const response = await readWithDeadline(controller.signal, async (signal) => {
        const headers = withCsrf({
          'X-Draft-Revision': command.revision ?? 'initial',
          ...(command.input ? { 'Content-Type': 'application/json' } : {}),
        });
        const response = await fetch(
          electricityDraftPath(mode, command.input ? undefined : command.profileId),
          {
            method: command.input ? 'PUT' : 'DELETE',
            credentials: 'include',
            headers,
            signal,
            ...(command.input ? { body: JSON.stringify(command.input) } : {}),
          }
        );
        return { status: response.status, body: response.ok ? await response.json() : null };
      });
      if (controller.signal.aborted) return false;
      if (response.status === 200) {
        const packet = draftPacket(response.body);
        const matches = command.input
          ? confirmedDraftReceipt(packet.value, command.input)
          : packet.value.discarded === true &&
            packet.value.profileId === command.profileId &&
            packet.value.mode === mode;
        if (!matches || !packet.revision || packet.revision === command.revision)
          throw new Error('Draft acknowledgement unconfirmed');
        revision.current = packet.revision;
        hold(null);
        return await command.confirmed().catch(() => false);
      }
      if (!retrying && response.status >= 400 && response.status < 500 && response.status !== 409)
        return false;
      hold({ phase: 'check', command });
    } catch {
      if (!controller.signal.aborted) hold({ phase: 'check', command });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setWorking(false);
      }
    }
    return false;
  }

  async function recover() {
    if (!recovery || recovery.phase === 'stale' || active.current) return false;
    const { command } = recovery;
    if (recovery.phase === 'retry') return (await send(command, true)) && command.leave;
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    try {
      const packet = await readWithDeadline(controller.signal, async (signal) => {
        const response = await commercialFetch(electricityDraftPath(mode, command.profileId), {
          credentials: 'include',
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error('Draft unavailable');
        return draftPacket(await response.json());
      });
      if (controller.signal.aborted) return false;
      const matches =
        (packet.revision !== null || command.revision === null) &&
        (command.input
          ? confirmedDraftReceipt(packet.value, command.input)
          : packet.value.currentStep === 1 && packet.value.data === null);
      if (matches) {
        revision.current = packet.revision;
        hold(null);
        return (await command.confirmed()) && command.leave;
      }
      hold({ phase: packet.revision === command.revision ? 'retry' : 'stale', command });
    } catch {
      // Keep the captured command while the current saved state is unavailable.
    } finally {
      if (active.current === controller) {
        active.current = null;
        setWorking(false);
      }
    }
    return false;
  }

  const save = (input: DraftInput, confirmed: Command['confirmed'], leave: boolean) =>
    unresolved.current || revision.current === undefined
      ? Promise.resolve(false)
      : send(
          { profileId: input.profileId, input, revision: revision.current, confirmed, leave },
          false
        );
  const discard = (profileId: string) =>
    unresolved.current || revision.current === undefined
      ? Promise.resolve(false)
      : send(
          { profileId, revision: revision.current, confirmed: async () => true, leave: true },
          false
        );

  return {
    active,
    unresolved,
    working,
    recovery: recovery?.phase,
    discardRetry: recovery?.phase === 'retry' && !recovery.command.input,
    reset,
    retire,
    readRevision,
    save,
    discard,
    recover,
  };
}

const copy = {
  en: {
    stale: 'Saved progress has changed. Reload it to continue.',
    reload: 'Reload saved progress',
    retry: 'Retry the reviewed draft change',
  },
  fa: {
    stale: 'پیشرفت ذخیره‌شده تغییر کرده است. برای ادامه آن را دوباره بارگذاری کنید.',
    reload: 'بارگذاری دوباره پیشرفت ذخیره‌شده',
    retry: 'تلاش دوباره برای تغییر بررسی‌شده',
  },
};

export function ElectricityDraftRecovery({
  phase,
  locale,
  working,
  discardRetry,
  onAction,
}: {
  phase: Recovery['phase'];
  locale: 'en' | 'fa';
  working: boolean;
  discardRetry: boolean;
  onAction: () => void;
}) {
  const messages = copy[locale];
  const gate = useRiskConfirmation(phase, locale, 'destructive');
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">
        {phase === 'stale' ? messages.stale : confirmationText('unconfirmed', locale)}
      </p>
      {discardRetry && <ConfirmationFields gate={gate} disabled={working} />}
      <Button
        type="button"
        variant={discardRetry ? 'destructive' : 'outline'}
        disabled={working || (discardRetry && !gate.allowed)}
        onClick={onAction}
      >
        {phase === 'stale'
          ? messages.reload
          : phase === 'retry'
            ? messages.retry
            : confirmationText('checkStatus', locale)}
      </Button>
    </div>
  );
}
