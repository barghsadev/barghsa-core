import { useId, useState } from 'react';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Label } from './label';

export interface ConfirmationRequirements {
  confirmation?: { phrase: string; label: string } | undefined;
  acknowledgement?: string | undefined;
}

/** Approval belongs to this captured intent and these exact requirements. */
export function useConfirmationGate(scope: unknown, requirements: ConfirmationRequirements) {
  const key = JSON.stringify(requirements);
  const [value, setValue] = useState({ scope, key, phrase: '', acknowledged: false });
  const current = Object.is(value.scope, scope) && value.key === key;
  if (!current) setValue({ scope, key, phrase: '', acknowledged: false });
  const phrase = current ? value.phrase : '';
  const acknowledged = current && value.acknowledged;
  return {
    ...requirements,
    phrase,
    acknowledged,
    allowed:
      (!requirements.confirmation ||
        Boolean(requirements.confirmation.phrase && phrase === requirements.confirmation.phrase)) &&
      (!requirements.acknowledgement || acknowledged),
    setPhrase: (next: string) => setValue({ scope, key, phrase: next, acknowledged }),
    setAcknowledged: (next: boolean) => setValue({ scope, key, phrase, acknowledged: next }),
  };
}

export function ConfirmationFields({
  gate,
  disabled = false,
}: {
  gate: ReturnType<typeof useConfirmationGate>;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <>
      {gate.confirmation && (
        <div className="space-y-2" data-slot="destructive-confirmation">
          <Label htmlFor={id}>{gate.confirmation.label}</Label>
          <Input
            id={id}
            autoComplete="off"
            spellCheck={false}
            value={gate.phrase}
            disabled={disabled}
            onChange={(event) => gate.setPhrase(event.target.value)}
          />
        </div>
      )}
      {gate.acknowledgement && (
        <div className="flex items-start gap-3" data-slot="financial-confirmation">
          <Checkbox
            id={`${id}-ack`}
            checked={gate.acknowledged}
            disabled={disabled}
            onCheckedChange={(checked) => gate.setAcknowledged(checked === true)}
          />
          <Label htmlFor={`${id}-ack`} className="leading-5">
            {gate.acknowledgement}
          </Label>
        </div>
      )}
    </>
  );
}
