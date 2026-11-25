import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, Button, PageLoading, Textarea } from '@barghsa/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, useZodForm } from '@barghsa/ui/form';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { formatInTimezone } from '@barghsa/i18n/date-time';
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
import { CompactFieldFeedback } from './CompactFieldFeedback.js';
import { ContractInvoicePicker } from './ContractInvoicePicker.js';
import { RecordDateTimeField } from './RecordDateTimeField.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';
type Props = {
  context: ContractActivationData;
  version: ContractVersion;
  source: ContractDetailData;
  onChanged: () => void;
  coordination?: ContractFormCoordination | undefined;
  onDenied?: (() => void) | undefined;
  recordPage?: boolean;
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
  const [zone, setZone] = useState(() => (time.status === 'ready' ? time.timezone : null));
  useEffect(() => {
    if (!zone && time.status === 'ready') setZone(time.timezone);
  }, [zone, time.status, time.timezone]);
  return (
    <>
      {time.notice}
      {zone ? (
        <Editor {...props} initialZone={zone} time={time} />
      ) : (
        time.status === 'loading' && <PageLoading label={word('loading')} />
      )}
    </>
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
  recordPage,
}: Props & {
  initialZone: string;
  time: ReturnType<typeof useAccountTime>;
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
    onSaved: () => {
      form.setValue('changeDescription', '');
      onChanged();
    },
    onFields: showFields,
    error: word('error'),
    success: word('statusHistoryUnknown'),
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
  const dates = [
    [
      'serviceStartsAt',
      'contract-context-start',
      'prerequisite.serviceStart',
      'startDateHelp',
      'startInvalid',
    ],
    ['serviceEndsAt', 'contract-context-end', 'serviceEndsAt', 'endDateHelp', 'endInvalid'],
  ] as const;
  const disabled = command.frozen || time.status !== 'ready' || !!coordination?.blocked();
  const reviewed = command.action?.body as
    | {
        activationContext: ReturnType<typeof contractContextBody>;
        changeDescription: string;
      }
    | undefined;
  return (
    <>
      {recordPage && <RecordCommandGuard blocked={command.navigationBlocked} />}
      <Form {...form}>
        <form
          data-testid="contract-context-form"
          noValidate
          onSubmit={(event) => void save(event)}
          className={recordEditorSurface}
        >
          <RecordEditorSection title={copy('serviceDates')}>
            <p className="text-sm text-muted-foreground">
              {word('contextTimezone')} · <bdi>{displayZone}</bdi>
            </p>
            <div className={recordEditorGrid}>
              {dates.map(([name, id, label, help, validation]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <FormItem id={id}>
                      <FormLabel>{word(label)}</FormLabel>
                      <FormControl>
                        <RecordDateTimeField
                          {...field}
                          label={word(label)}
                          locale={locale}
                          timezone={displayZone}
                          disabled={disabled}
                          clearable
                        />
                      </FormControl>
                      <CompactFieldFeedback
                        help={copy(help)}
                        validationMessage={copy(validation)}
                        invalid={fieldState.invalid}
                      />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </RecordEditorSection>
          <div className="grid border-b lg:grid-cols-2">
            <div className="min-w-0 border-b px-4 py-4 sm:px-6 lg:border-e lg:border-b-0">
              <ContractInvoicePicker
                contractId={context.contractId}
                versionId={version.id}
                profileId={source.profileId}
                control={form.control}
                disabled={disabled}
                formatDate={time.format}
              />
            </div>
            <RecordEditorSection
              title={copy('reviewSection')}
              description={word(
                context.state === 'ChangesRequested'
                  ? 'contextResubmitNotice'
                  : 'contextVersionNotice'
              )}
            >
              <FormField
                control={form.control}
                name="changeDescription"
                render={({ field, fieldState }) => (
                  <FormItem id="contract-context-reason">
                    <FormLabel>{word('contextReason')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        className="min-h-16"
                        placeholder={copy('reasonExample')}
                        aria-required="true"
                        disabled={command.frozen}
                      />
                    </FormControl>
                    <CompactFieldFeedback
                      help={copy('reasonHelp')}
                      validationMessage={copy('reasonInvalid')}
                      invalid={fieldState.invalid}
                    />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
            </RecordEditorSection>
          </div>
          <RecordEditorActions>
            <Button
              type="submit"
              loading={command.preparing}
              disabled={!changed || command.locked || disabled || zone.current !== displayZone}
            >
              {word('saveContext')}
            </Button>
          </RecordEditorActions>
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
        <TeamActionDialog
          action={command.action}
          {...command.dialog}
          summary={
            reviewed && (
              <dl className="grid gap-2.5 rounded-lg border bg-muted/25 p-3 text-sm sm:grid-cols-2">
                {dates.map(([name, , label]) => (
                  <div key={name}>
                    <dt className="text-muted-foreground">{word(label)}</dt>
                    <dd>
                      {reviewed.activationContext[name]
                        ? formatInTimezone(reviewed.activationContext[name], displayZone, locale)
                        : word('noValue')}
                    </dd>
                  </div>
                ))}
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-muted-foreground">{copy('initialInvoice')}</dt>
                  <dd className="wrap-anywhere">
                    <bdi>
                      {reviewed.activationContext.initialInvoiceId ?? copy('noLinkedInvoice')}
                    </bdi>
                  </dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-muted-foreground">{word('contextReason')}</dt>
                  <dd className="whitespace-pre-wrap wrap-anywhere">
                    {reviewed.changeDescription}
                  </dd>
                </div>
              </dl>
            )
          }
        />
      )}
    </>
  );
}
