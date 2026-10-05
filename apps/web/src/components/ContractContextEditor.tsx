import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, Button, Input, Textarea } from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useContractAuthoringCommand } from '../hooks/useContractAuthoringCommand.js';
import { isoToDatetimeLocal } from '../lib/due-at-override.js';
import {
  contractAuthoringSource,
  contractContextScope,
  contractContextBody,
  type ContractContextValues,
} from '../lib/contract-authoring-form.js';
import type {
  ContractActivationData,
  ContractDetailData,
  ContractVersion,
} from '../lib/contracts.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { TeamActionDialog } from './TeamActionDialog.js';
type Props = {
  context: ContractActivationData;
  version: ContractVersion;
  source: ContractDetailData;
  onChanged: () => void;
  coordination?: ContractFormCoordination | undefined;
  onDenied?: (() => void) | undefined;
};
export function ContractContextEditor(props: Props) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return (
    <ContextEditor
      key={JSON.stringify([
        actor,
        revision,
        contractContextScope(props.context),
        contractAuthoringSource({ contract: props.source, version: props.version }),
      ])}
      {...props}
    />
  );
}
function ContextEditor(props: Props) {
  const locale = useLocale(),
    time = useAccountTime(),
    word = (key: string) => contractText(key, locale);
  const [open, setOpen] = useState(false),
    [zone, setZone] = useState<string | null>(null),
    [locked, setLocked] = useState(false),
    owner = useRef(false);
  useEffect(() => {
    if (open && !zone && time.status === 'ready') setZone(time.timezone);
  }, [open, zone, time.status, time.timezone]);
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <Button
        className="self-start"
        variant="outline"
        aria-expanded={open}
        disabled={locked || !!props.coordination?.blocked()}
        onClick={() => {
          if (owner.current || props.coordination?.blocked()) return;
          if (!open && time.status === 'ready') setZone(time.timezone);
          setOpen(!open);
        }}
      >
        {word('editContext')}
      </Button>
      {open && (
        <>
          {time.notice}
          {zone && (
            <Editor
              {...props}
              initialZone={zone}
              time={time}
              onLocked={(value) => {
                owner.current = value;
                setLocked(value);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
function Editor({
  context,
  version,
  source,
  onChanged,
  coordination,
  onDenied,
  initialZone,
  time,
  onLocked,
}: Props & {
  initialZone: string;
  time: ReturnType<typeof useAccountTime>;
  onLocked: (value: boolean) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale),
    copy = (key: string) => tContractAuthoring(key, locale);
  const actor = useAccountUser(),
    revision = useProfileContextRevision(),
    scope = JSON.stringify([
      actor,
      revision,
      contractContextScope(context),
      contractAuthoringSource({ contract: source, version }),
    ]),
    current = useRef(scope);
  current.current = scope;
  const [displayZone, setDisplayZone] = useState(initialZone),
    [withdrawn, setWithdrawn] = useState(false);
  const alive = useRef(true),
    zone = useRef<string | null>(null);
  zone.current = time.status === 'ready' ? time.timezone : null;
  const form = useZodForm<ContractContextValues>(
    async () => {
      const token = scope,
        capturedZone = zone.current;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current &&
        current.current === token &&
        capturedZone &&
        zone.current === capturedZone
        ? schema.contractContextSchema(
            (values) => contractContextBody(context, values, capturedZone),
            copy
          )
        : schema.inactiveContractContextSchema;
    },
    {
      defaultValues: {
        serviceStartsAt: isoToDatetimeLocal(context.serviceStartsAt, initialZone),
        serviceEndsAt: isoToDatetimeLocal(context.serviceEndsAt, initialZone),
        initialInvoiceId: context.initialInvoiceId ?? '',
        changeDescription: '',
      },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const showFields = useActionFieldErrors(
    form,
    {
      changeDescription: copy('reasonInvalid'),
      initialInvoiceId: copy('invoiceInvalid'),
      serviceStartsAt: copy('startInvalid'),
      serviceEndsAt: copy('endInvalid'),
    },
    word('error')
  );
  const command = useContractAuthoringCommand({
    scope,
    coordination,
    onLocked,
    onSaved: () => {
      form.setValue('changeDescription', '');
      onChanged();
    },
    onFields: showFields,
    error: word('error'),
    onDenied: () => {
      setWithdrawn(true);
      form.reset();
      onDenied?.();
    },
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (time.status !== 'ready' || time.timezone === displayZone || command.locked) return;
    for (const field of ['serviceStartsAt', 'serviceEndsAt'] as const)
      if (form.getValues(field) === isoToDatetimeLocal(context[field], displayZone))
        form.setValue(field, isoToDatetimeLocal(context[field], time.timezone));
    setDisplayZone(time.timezone);
  }, [time.status, time.timezone, displayZone, command.locked]);
  const values = form.watch(),
    changed =
      values.serviceStartsAt !== isoToDatetimeLocal(context.serviceStartsAt, displayZone) ||
      values.serviceEndsAt !== isoToDatetimeLocal(context.serviceEndsAt, displayZone) ||
      values.initialInvoiceId.trim().toLowerCase() !== (context.initialInvoiceId ?? '');
  async function save(event: FormEvent) {
    event.preventDefault();
    const capturedZone = zone.current;
    if (
      !actor ||
      withdrawn ||
      current.current !== scope ||
      !capturedZone ||
      displayZone !== capturedZone ||
      !command.begin()
    )
      return;
    const raw = JSON.stringify(form.getValues());
    try {
      await form.handleSubmit((valid) => {
        if (
          !alive.current ||
          current.current !== scope ||
          zone.current !== capturedZone ||
          raw !== JSON.stringify(form.getValues()) ||
          !version.content ||
          !changed
        )
          return;
        command.capture(
          {
            title: word('saveContext'),
            description: word(
              context.state === 'ChangesRequested'
                ? 'contextResubmitNotice'
                : 'contextVersionNotice'
            ),
            path: `/api/admin/contracts/${context.contractId}`,
            method: 'PATCH',
            successStatus: 200,
            body: {
              expectedVersionId: version.id,
              content: version.content,
              activationContext: contractContextBody(context, valid, capturedZone),
              changeDescription: valid.changeDescription.trim(),
              idempotencyKey: crypto.randomUUID(),
            },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('denied'),
          },
          { kind: 'context', actor, existing: { contract: source, version }, body: {} }
        );
      })(event);
    } finally {
      command.finish();
    }
  }
  if (withdrawn)
    return (
      <Alert variant="destructive">
        <AlertDescription>{word('denied')}</AlertDescription>
      </Alert>
    );
  const fields = [
    ['serviceStartsAt', 'contract-context-start', 'prerequisite.serviceStart', 'dateHelp'],
    ['serviceEndsAt', 'contract-context-end', 'serviceEndsAt', 'dateHelp'],
    ['initialInvoiceId', 'contract-context-invoice', 'contextInvoice', null],
    ['changeDescription', 'contract-context-reason', 'contextReason', 'reasonHelp'],
  ] as const;
  return (
    <>
      <Form {...form}>
        <form
          data-testid="contract-context-form"
          noValidate
          onSubmit={(event) => void save(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">{word('contextVersionNotice')}</p>
          <p className="text-sm">
            {word('contextTimezone')}: <bdi>{displayZone}</bdi>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([name, id, label, help]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem id={id}>
                    <FormLabel>{word(label)}</FormLabel>
                    <FormControl>
                      {name === 'changeDescription' ? (
                        <Textarea {...field} disabled={command.frozen} />
                      ) : (
                        <Input
                          {...field}
                          type={name === 'initialInvoiceId' ? 'text' : 'datetime-local'}
                          dir="ltr"
                          disabled={command.frozen || time.status !== 'ready'}
                        />
                      )}
                    </FormControl>
                    {help && <FormDescription>{copy(help)}</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{word('contextOptional')}</p>
          {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
          <Button
            type="submit"
            className="self-start"
            loading={command.preparing}
            disabled={
              !changed ||
              command.locked ||
              !!coordination?.blocked() ||
              time.status !== 'ready' ||
              zone.current !== displayZone
            }
          >
            {word('saveContext')}
          </Button>
        </form>
      </Form>
      {command.failed && (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      )}
      {command.uncertain && (
        <Alert variant="destructive">
          <AlertDescription>{copy('uncertain')}</AlertDescription>
        </Alert>
      )}
      {command.uncertain && (
        <Button
          data-testid="contract-context-retry"
          variant="outline"
          disabled={!!command.action}
          onClick={command.retry}
        >
          {copy('retryCaptured')}
        </Button>
      )}
      {command.action && command.dialog && (
        <TeamActionDialog action={command.action} {...command.dialog} />
      )}
    </>
  );
}
