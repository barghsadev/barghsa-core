import { useState, type FormEvent } from 'react';
import { Button, Field, FieldGroup, FieldLabel, Input, Textarea } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { datetimeLocalToIso, isoToDatetimeLocal, isInvoiceUuid } from '../lib/due-at-override.js';
import type { ContractActivationData, ContractVersion } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

export function ContractContextEditor({
  context,
  version,
  onChanged,
}: {
  context: ContractActivationData;
  version: ContractVersion;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const word = (key: string) => contractText(key, locale);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <Button
        className="self-start"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {word('editContext')}
      </Button>
      {open ? (
        <>
          {time.notice}
          {time.status === 'ready' ? (
            <Editor
              key={time.timezone}
              context={context}
              version={version}
              timezone={time.timezone}
              onChanged={onChanged}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Editor({
  context,
  version,
  timezone,
  onChanged,
}: {
  context: ContractActivationData;
  version: ContractVersion;
  timezone: string;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const originalStart = isoToDatetimeLocal(context.serviceStartsAt, timezone);
  const originalEnd = isoToDatetimeLocal(context.serviceEndsAt, timezone);
  const [start, setStart] = useState(originalStart),
    [end, setEnd] = useState(originalEnd);
  const [invoice, setInvoice] = useState(context.initialInvoiceId ?? '');
  const [reason, setReason] = useState(''),
    [invalid, setInvalid] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const changed =
    start !== originalStart ||
    end !== originalEnd ||
    invoice.trim().toLowerCase() !== (context.initialInvoiceId ?? '');
  function save(event: FormEvent) {
    event.preventDefault();
    // Preserve seconds and the original instant when a field was not edited.
    const startsAt =
      start === originalStart
        ? context.serviceStartsAt
        : start
          ? datetimeLocalToIso(start, timezone)
          : null;
    const endsAt =
      end === originalEnd ? context.serviceEndsAt : end ? datetimeLocalToIso(end, timezone) : null;
    if (
      !changed ||
      !reason.trim() ||
      !version.content ||
      (invoice.trim() && !isInvoiceUuid(invoice)) ||
      (start && !startsAt) ||
      (end && !endsAt) ||
      (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
      title: word('saveContext'),
      description: word(
        context.state === 'ChangesRequested' ? 'contextResubmitNotice' : 'contextVersionNotice'
      ),
      path: `/api/admin/contracts/${context.contractId}`,
      method: 'PATCH',
      body: {
        expectedVersionId: version.id,
        content: version.content,
        activationContext: {
          initialInvoiceId: invoice.trim().toLowerCase() || null,
          serviceStartsAt: startsAt,
          serviceEndsAt: endsAt,
        },
        changeDescription: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  return (
    <>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{word('contextVersionNotice')}</p>
        <p className="text-sm">
          {word('contextTimezone')}: <bdi>{timezone}</bdi>
        </p>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="contract-context-start">
              {word('prerequisite.serviceStart')}
            </FieldLabel>
            <Input
              id="contract-context-start"
              type="datetime-local"
              dir="ltr"
              value={start}
              aria-invalid={invalid}
              onChange={(event) => setStart(event.target.value)}
            />
          </Field>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="contract-context-end">{word('serviceEndsAt')}</FieldLabel>
            <Input
              id="contract-context-end"
              type="datetime-local"
              dir="ltr"
              value={end}
              aria-invalid={invalid}
              onChange={(event) => setEnd(event.target.value)}
            />
          </Field>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="contract-context-invoice">{word('contextInvoice')}</FieldLabel>
            <Input
              id="contract-context-invoice"
              dir="ltr"
              value={invoice}
              aria-invalid={invalid}
              onChange={(event) => setInvoice(event.target.value)}
            />
          </Field>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="contract-context-reason">{word('contextReason')}</FieldLabel>
            <Textarea
              id="contract-context-reason"
              value={reason}
              maxLength={1000}
              aria-invalid={invalid}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">{word('contextOptional')}</p>
        {invalid ? <p role="alert">{word('contextInvalid')}</p> : null}
        <Button type="submit" className="self-start" disabled={!changed}>
          {word('saveContext')}
        </Button>
      </form>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
