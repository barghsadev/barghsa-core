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
import { parseContractCommercialValue, type ContractCommercialValue } from '../lib/contracts.js';
import {
  contractAuthoringSource,
  contractDraftContent,
  type ExistingContractDraft,
  type ContractDraftValues,
} from '../lib/contract-authoring-form.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import { ContractDraftChoices } from './ContractDraftChoices.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { RecordEditorSection, recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from './StickyRecordEditorActions.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
export default function DraftForm({
  existing,
  amendment,
  recordPage = false,
  onSaved,
  coordination,
  onLocked,
  onDenied,
}: {
  existing?: ExistingContractDraft | undefined;
  amendment: boolean;
  recordPage?: boolean;
  onSaved: (id: string) => void;
  coordination?: ContractFormCoordination | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
  onDenied?: (() => void) | undefined;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale),
    copy = (key: string) => tContractAuthoring(key, locale);
  const numbers = useNumberFormatting(locale);
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
    success: word(existing ? 'timeline.contract.version_created' : 'timeline.contract.created'),
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
  const draftValue = parseContractCommercialValue(content.commercialValue);
  const body = command.action?.body;
  const reviewedContent =
    body && typeof body === 'object' && 'content' in body ? body.content : null;
  const reviewedValue = parseContractCommercialValue(
    reviewedContent && typeof reviewedContent === 'object' && 'commercialValue' in reviewedContent
      ? reviewedContent.commercialValue
      : undefined
  );
  const unsupportedSavedValue = original.commercialValue !== undefined && !commercial;
  const compareValue =
    !!existing &&
    (unsupportedSavedValue || JSON.stringify(commercial) !== JSON.stringify(reviewedValue));
  const displayValue = (value: ContractCommercialValue | null) =>
    value?.kind === 'fixed'
      ? numbers.money(value.amountIrr)
      : (value?.description ?? word('noValue'));
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
    help?: string,
    example?: string
  ) {
    const required = !existing || (name !== 'title' && name !== 'text');
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem id={'contract-draft-' + name} className={recordEditorField}>
            <FormLabel>{word(label)}</FormLabel>
            <FormControl>
              {name === 'title' || name === 'commercialValueAmountIrr' ? (
                <Input
                  {...field}
                  aria-required={required || undefined}
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
                  aria-required={required || undefined}
                  dir="auto"
                  rows={name === 'text' ? 5 : 2}
                  className={`resize-y placeholder-shown:[direction:inherit] ${name === 'text' ? 'min-h-24 max-h-72' : 'min-h-14'}`}
                  placeholder={example ? copy(example) : undefined}
                  disabled={
                    command.frozen ||
                    (name === 'text' &&
                      original.text !== undefined &&
                      typeof original.text !== 'string')
                  }
                />
              )}
            </FormControl>
            {help && (
              <FormDescription>
                {name === 'commercialValueAmountIrr' && draftValue?.kind === 'fixed' ? (
                  <bdi className="font-medium text-foreground [overflow-wrap:anywhere]">
                    {displayValue(draftValue)}
                  </bdi>
                ) : (
                  copy(help)
                )}
              </FormDescription>
            )}
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
      {recordPage && <RecordCommandGuard blocked={command.navigationBlocked} />}
      <Form {...form}>
        <form
          data-testid="contract-draft-form"
          noValidate
          onSubmit={(event) => void save(event)}
          className={recordEditorFormSurface}
          onFocus={keepRecordFieldVisible}
          aria-label={word(amendment ? 'amendmentCreate' : existing ? 'draftEdit' : 'draftCreate')}
        >
          {existing ? (
            <RecordEditorSection
              title={copy('sourceContract')}
              description={word(amendment ? 'amendmentBaseNotice' : 'draftPreserveNotice')}
            >
              <dl className={recordEditorGrid}>
                <div>
                  <dt className="text-sm text-muted-foreground">{word('contractNumber')}</dt>
                  <dd className="break-all font-medium">
                    <bdi>{existing.contract.contractNumber || existing.contract.id}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{word('version')}</dt>
                  <dd className="font-medium">{numbers.number(existing.version.versionNumber)}</dd>
                </div>
              </dl>
            </RecordEditorSection>
          ) : (
            <RecordEditorSection title={copy('customerAndService')}>
              <FormField
                control={form.control}
                name="profileId"
                render={({ field }) => (
                  <FormItem id="contract-draft-profile">
                    <FormControl>
                      <ContractDraftChoices
                        {...field}
                        aria-required="true"
                        label={<FormLabel>{word('draftProfile')}</FormLabel>}
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
              <div className={recordEditorGrid}>
                <FormField
                  control={form.control}
                  name="serviceType"
                  render={({ field }) => (
                    <FormItem id="contract-draft-service">
                      <FormLabel>{word('serviceType')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          className="w-full"
                          aria-required="true"
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
                        <FormControl>
                          <ContractDraftChoices
                            {...field}
                            key={values.profileId + ':' + values.serviceType}
                            profileId={values.profileId}
                            serviceType={values.serviceType}
                            label={<FormLabel>{word('draftOrder')}</FormLabel>}
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
              </div>
            </RecordEditorSection>
          )}
          <RecordEditorSection title={copy('termsSection')}>
            {((original.title !== undefined && typeof original.title !== 'string') ||
              (original.text !== undefined && typeof original.text !== 'string')) && (
              <p className="text-sm text-muted-foreground">{word('draftStructuredNotice')}</p>
            )}
            {textField('title', 'titleField')}
            {textField('text', 'draftTerms', undefined, 'termsExample')}
          </RecordEditorSection>
          <RecordEditorSection
            title={copy('contractValue')}
            description={word('commercialValueNotice')}
          >
            <div
              className={values.commercialValueKind === 'fixed' ? recordEditorGrid : 'space-y-2.5'}
            >
              <FormField
                control={form.control}
                name="commercialValueKind"
                render={({ field }) => (
                  <FormItem id="contract-draft-value-kind" className={recordEditorField}>
                    <FormLabel>{word('statedContractValue')}</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} className="w-full" disabled={command.frozen}>
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
                    <FormDescription>{copy('valueKindHelp.' + field.value)}</FormDescription>
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
                  'descriptionHelp',
                  'variableExample'
                )}
            </div>
          </RecordEditorSection>
          <RecordEditorSection
            title={copy('reviewSection')}
            description={word(
              amendment
                ? 'amendmentCreateNotice'
                : existing?.contract.state === 'ChangesRequested'
                  ? 'contextResubmitNotice'
                  : 'draftSaveNotice'
            )}
          >
            {textField('changeDescription', 'contextReason', 'reasonHelp', 'reasonExample')}
            {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
          </RecordEditorSection>
          <StickyRecordEditorActions>
            <Button
              type="submit"
              loading={command.preparing}
              disabled={!changed || command.locked || !!coordination?.blocked()}
            >
              {word(amendment ? 'amendmentReview' : 'draftReview')}
            </Button>
          </StickyRecordEditorActions>
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
        <TeamActionDialog
          action={command.action}
          {...command.dialog}
          summary={
            <section
              id="contract-draft-value-review"
              aria-labelledby="contract-draft-value-heading"
              className="space-y-2 rounded-lg border bg-muted/35 p-3"
            >
              <h3 id="contract-draft-value-heading" className="text-sm font-semibold">
                {copy('contractValue')}
              </h3>
              <dl className="grid gap-2 text-sm">
                {compareValue && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{copy('savedContractValue')}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      <bdi>
                        {unsupportedSavedValue
                          ? copy('unsupportedSavedValue')
                          : displayValue(commercial)}
                      </bdi>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('proposedContractValue')}</dt>
                  <dd className="font-medium [overflow-wrap:anywhere]">
                    <bdi>{displayValue(reviewedValue)}</bdi>
                  </dd>
                </div>
              </dl>
            </section>
          }
        />
      )}
    </>
  );
}
