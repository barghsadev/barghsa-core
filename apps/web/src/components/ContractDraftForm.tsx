import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, Button, Input, NativeSelect, Textarea } from '@barghsa/ui';
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
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useContractAuthoringCommand } from '../hooks/useContractAuthoringCommand.js';
import { parseContractCommercialValue } from '../lib/contracts.js';
import {
  contractAuthoringSource,
  contractDraftContent,
  type ExistingContractDraft,
  type ContractDraftValues,
} from '../lib/contract-authoring-form.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import { ContractDraftChoices } from './ContractDraftChoices.js';
export default function DraftForm({
  existing,
  amendment,
  onSaved,
  coordination,
  onLocked,
  onDenied,
}: {
  existing?: ExistingContractDraft | undefined;
  amendment: boolean;
  onSaved: (id: string) => void;
  coordination?: ContractFormCoordination | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
  onDenied?: (() => void) | undefined;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale),
    copy = (key: string) => tContractAuthoring(key, locale);
  const actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const original = existing?.version.content ?? {},
    commercial = parseContractCommercialValue(original.commercialValue);
  const scope = JSON.stringify([
      actor,
      profileRevision,
      contractAuthoringSource(existing),
      amendment,
    ]),
    current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    profiles = useRef<string[]>([]),
    orders = useRef<string[]>([]);
  const [withdrawn, setWithdrawn] = useState(false);
  const form = useZodForm<ContractDraftValues>(
    async () => {
      const token = scope;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && current.current === token
        ? schema.contractDraftSchema(
            original,
            !!existing,
            profiles.current,
            orders.current,
            copy,
            (values) => contractDraftContent(original, values)
          )
        : schema.inactiveContractDraftSchema;
    },
    {
      defaultValues: {
        profileId: '',
        orderId: '',
        serviceType: 'electricity',
        title: typeof original.title === 'string' ? original.title : '',
        text: typeof original.text === 'string' ? original.text : '',
        commercialValueKind:
          commercial?.kind ?? (original.commercialValue === undefined ? 'unstated' : 'unsupported'),
        commercialValueAmountIrr: commercial?.kind === 'fixed' ? commercial.amountIrr : '',
        commercialValueDescription: commercial?.kind === 'variable' ? commercial.description : '',
        changeDescription: '',
      },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const showFields = useActionFieldErrors(
    form,
    {
      changeDescription: copy('reasonInvalid'),
      commercialValueAmountIrr: copy('amountInvalid'),
      commercialValueDescription: copy('descriptionInvalid'),
    },
    word('error')
  );
  const command = useContractAuthoringCommand({
    scope,
    coordination,
    onLocked,
    onSaved,
    onFields: showFields,
    error: word('error'),
    onDenied: () => {
      setWithdrawn(true);
      form.reset();
      profiles.current = [];
      orders.current = [];
      onDenied?.();
    },
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const values = form.watch(),
    content = contractDraftContent(original, values);
  const changed = !existing || JSON.stringify(content) !== JSON.stringify(original);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!actor || withdrawn || current.current !== scope || !command.begin()) return;
    const raw = JSON.stringify(form.getValues());
    try {
      await form.handleSubmit((valid) => {
        if (!alive.current || current.current !== scope || JSON.stringify(form.getValues()) !== raw)
          return;
        const nextContent = contractDraftContent(original, valid);
        if (existing && JSON.stringify(nextContent) === JSON.stringify(original)) return;
        command.capture(
          {
            title: word(amendment ? 'amendmentCreate' : existing ? 'draftSave' : 'draftCreate'),
            description: word(
              amendment
                ? 'amendmentCreateNotice'
                : existing?.contract.state === 'ChangesRequested'
                  ? 'contextResubmitNotice'
                  : 'draftSaveNotice'
            ),
            path: amendment
              ? `/api/admin/contracts/${existing!.contract.id}/amendments`
              : existing
                ? `/api/admin/contracts/${existing.contract.id}`
                : '/api/admin/contracts',
            method: existing && !amendment ? 'PATCH' : 'POST',
            successStatus: existing && !amendment ? 200 : 201,
            requiresPassword: true,
            body: {
              ...(existing
                ? { expectedVersionId: existing.version.id }
                : {
                    profileId: valid.profileId,
                    serviceType: valid.serviceType,
                    ...(valid.orderId ? { orderId: valid.orderId } : {}),
                  }),
              content: nextContent,
              changeDescription: valid.changeDescription.trim(),
              idempotencyKey: crypto.randomUUID(),
            },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('denied'),
          },
          {
            kind: amendment ? 'amendment' : existing ? 'revise' : 'create',
            actor,
            body: {},
            ...(existing ? { existing } : {}),
          }
        );
      })(event);
    } finally {
      command.finish();
    }
  }
  function textField(
    name:
      | 'title'
      | 'text'
      | 'changeDescription'
      | 'commercialValueAmountIrr'
      | 'commercialValueDescription',
    label: string,
    help?: string
  ) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem id={'contract-draft-' + name}>
            <FormLabel>{word(label)}</FormLabel>
            <FormControl>
              {name === 'title' || name === 'commercialValueAmountIrr' ? (
                <Input
                  {...field}
                  dir={name === 'commercialValueAmountIrr' ? 'ltr' : undefined}
                  inputMode={name === 'commercialValueAmountIrr' ? 'numeric' : undefined}
                  disabled={
                    command.frozen ||
                    (name === 'title' &&
                      original.title !== undefined &&
                      typeof original.title !== 'string')
                  }
                />
              ) : (
                <Textarea
                  {...field}
                  rows={name === 'text' ? 8 : 3}
                  disabled={
                    command.frozen ||
                    (name === 'text' &&
                      original.text !== undefined &&
                      typeof original.text !== 'string')
                  }
                />
              )}
            </FormControl>
            {help && <FormDescription>{copy(help)}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }
  if (withdrawn || current.current !== scope)
    return (
      <Alert variant="destructive">
        <AlertDescription>{word('denied')}</AlertDescription>
      </Alert>
    );
  return (
    <>
      <Form {...form}>
        <form
          data-testid="contract-draft-form"
          noValidate
          onSubmit={(event) => void save(event)}
          className="flex flex-col gap-4 rounded-xl border p-4"
          aria-label={word(amendment ? 'amendmentCreate' : existing ? 'draftEdit' : 'draftCreate')}
        >
          <p className="text-sm text-muted-foreground">
            {word(amendment ? 'amendmentCreateNotice' : 'draftSaveNotice')}
          </p>
          {existing ? (
            <>
              <p>{word(amendment ? 'amendmentBaseNotice' : 'draftPreserveNotice')}</p>
              {((original.title !== undefined && typeof original.title !== 'string') ||
                (original.text !== undefined && typeof original.text !== 'string')) && (
                <p>{word('draftStructuredNotice')}</p>
              )}
            </>
          ) : (
            <>
              <FormField
                control={form.control}
                name="profileId"
                render={({ field }) => (
                  <FormItem id="contract-draft-profile">
                    <FormLabel>{word('draftProfile')}</FormLabel>
                    <FormControl>
                      <ContractDraftChoices
                        {...field}
                        labelled
                        disabled={command.frozen}
                        coordination={coordination}
                        blocked={command.blocked}
                        onDenied={() => {
                          form.reset();
                          profiles.current = [];
                          orders.current = [];
                        }}
                        onOptions={(ids) => {
                          profiles.current = ids;
                        }}
                        onChange={(id) => {
                          if (command.blocked()) return;
                          field.onChange(id);
                          form.setValue('orderId', '');
                          orders.current = [];
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serviceType"
                render={({ field }) => (
                  <FormItem id="contract-draft-service">
                    <FormLabel>{word('serviceType')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        disabled={command.frozen}
                        onChange={(event) => {
                          if (command.blocked()) return;
                          field.onChange(event);
                          form.setValue('orderId', '');
                          orders.current = [];
                        }}
                      >
                        {['electricity', 'savings', 'solar'].map((value) => (
                          <option key={value} value={value}>
                            {word(value)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {values.profileId && (
                <FormField
                  control={form.control}
                  name="orderId"
                  render={({ field }) => (
                    <FormItem id="contract-draft-order">
                      <FormLabel>{word('draftOrder')}</FormLabel>
                      <FormControl>
                        <ContractDraftChoices
                          {...field}
                          key={values.profileId + ':' + values.serviceType}
                          profileId={values.profileId}
                          serviceType={values.serviceType}
                          labelled
                          disabled={command.frozen}
                          coordination={coordination}
                          blocked={command.blocked}
                          onDenied={() => {
                            form.reset();
                            profiles.current = [];
                            orders.current = [];
                          }}
                          onOptions={(ids) => {
                            orders.current = ids;
                          }}
                          onChange={(id) => {
                            if (!command.blocked()) field.onChange(id);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </>
          )}
          <p className="text-sm text-muted-foreground">{word('commercialValueNotice')}</p>
          {textField('title', 'titleField')}
          {textField('text', 'draftTerms')}
          <FormField
            control={form.control}
            name="commercialValueKind"
            render={({ field }) => (
              <FormItem id="contract-draft-value-kind">
                <FormLabel>{word('statedContractValue')}</FormLabel>
                <FormControl>
                  <NativeSelect {...field} disabled={command.frozen}>
                    {values.commercialValueKind === 'unsupported' && (
                      <option value="unsupported" disabled>
                        {word('unsupportedContractValue')}
                      </option>
                    )}
                    <option value="unstated">{word('noValue')}</option>
                    <option value="fixed">{word('fixedContractValue')}</option>
                    <option value="variable">{word('variableContractValue')}</option>
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {values.commercialValueKind === 'fixed' &&
            textField('commercialValueAmountIrr', 'fixedContractAmount', 'amountHelp')}
          {values.commercialValueKind === 'variable' &&
            textField(
              'commercialValueDescription',
              'variableContractDescription',
              'descriptionHelp'
            )}
          {textField('changeDescription', 'contextReason', 'reasonHelp')}
          {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
          {existing?.contract.state === 'ChangesRequested' && !amendment && (
            <p>{word('contextResubmitNotice')}</p>
          )}
          <Button
            type="submit"
            className="self-start"
            loading={command.preparing}
            disabled={!changed || command.locked || !!coordination?.blocked()}
          >
            {word(amendment ? 'amendmentReview' : 'draftReview')}
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
          data-testid="contract-draft-retry"
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
