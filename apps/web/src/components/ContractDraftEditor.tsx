import { useState, useId, type FormEvent } from 'react';
import { Button, Field, FieldGroup, FieldLabel, Input, NativeSelect, Textarea } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractDraftChoices } from './ContractDraftChoices.js';
import { parseContractCommercialValue } from '../lib/contracts.js';

type ExistingDraft = { contract: ContractDetailData; version: ContractVersion };
export function ContractDraftEditor({
  existing,
  onSaved,
}: {
  existing?: ExistingDraft | undefined;
  onSaved: (id: string) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {word(existing ? 'draftEdit' : 'draftCreate')}
      </Button>
      {open ? (
        <DraftForm
          existing={existing}
          onSaved={(id) => {
            setOpen(false);
            onSaved(id);
          }}
        />
      ) : null}
    </div>
  );
}

function DraftForm({
  existing,
  onSaved,
}: {
  existing?: ExistingDraft | undefined;
  onSaved: (id: string) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const fieldId = useId();
  const original = existing?.version.content ?? {};
  const originalCommercialValue = parseContractCommercialValue(original.commercialValue);
  const [title, setTitle] = useState(typeof original.title === 'string' ? original.title : '');
  const [text, setText] = useState(typeof original.text === 'string' ? original.text : '');
  const [valueKind, setValueKind] = useState<'unsupported' | 'unstated' | 'fixed' | 'variable'>(
    originalCommercialValue?.kind ??
      (original.commercialValue === undefined ? 'unstated' : 'unsupported')
  );
  const [amountIrr, setAmountIrr] = useState(
    originalCommercialValue?.kind === 'fixed' ? originalCommercialValue.amountIrr : ''
  );
  const [variableDescription, setVariableDescription] = useState(
    originalCommercialValue?.kind === 'variable' ? originalCommercialValue.description : ''
  );
  const [reason, setReason] = useState(''),
    [invalid, setInvalid] = useState(false);
  const [profileId, setProfileId] = useState(''),
    [orderId, setOrderId] = useState('');
  const [serviceType, setServiceType] = useState('electricity');
  const [action, setAction] = useState<TeamAction | null>(null);
  const canEditTitle = original.title === undefined || typeof original.title === 'string';
  const canEditText = original.text === undefined || typeof original.text === 'string';
  const content = { ...original };
  if (canEditTitle && (original.title !== undefined || title.trim()))
    content.title = title === original.title ? title : title.trim();
  if (canEditText && (original.text !== undefined || text.trim()))
    content.text = text === original.text ? text : text.trim();
  if (valueKind !== 'unsupported') {
    if (valueKind === 'fixed')
      content.commercialValue = { kind: 'fixed', amountIrr: amountIrr.trim() };
    else if (valueKind === 'variable')
      content.commercialValue = { kind: 'variable', description: variableDescription.trim() };
    else delete content.commercialValue;
  }
  const changed = !existing || JSON.stringify(content) !== JSON.stringify(original);
  function save(event: FormEvent) {
    event.preventDefault();
    const validAmount =
      /^(0|[1-9][0-9]{0,18})$/.test(amountIrr.trim()) &&
      BigInt(amountIrr.trim()) <= 9_223_372_036_854_775_807n;
    if (
      !changed ||
      !reason.trim() ||
      (!existing && (!profileId || !title.trim() || !text.trim())) ||
      (valueKind === 'fixed' && !validAmount) ||
      valueKind === 'unsupported' ||
      (valueKind === 'variable' &&
        (variableDescription.trim().length === 0 || variableDescription.trim().length > 500)) ||
      new TextEncoder().encode(JSON.stringify(content)).length > 65_536
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
      title: word(existing ? 'draftSave' : 'draftCreate'),
      description: word(
        existing?.contract.state === 'ChangesRequested'
          ? 'contextResubmitNotice'
          : 'draftSaveNotice'
      ),
      path: existing ? `/api/admin/contracts/${existing.contract.id}` : '/api/admin/contracts',
      method: existing ? 'PATCH' : 'POST',
      requiresPassword: true,
      body: {
        ...(existing
          ? { expectedVersionId: existing.version.id }
          : { profileId, serviceType, ...(orderId ? { orderId } : {}) }),
        content,
        changeDescription: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  return (
    <>
      <form
        onSubmit={save}
        className="flex flex-col gap-4 rounded-xl border p-4"
        aria-label={word(existing ? 'draftEdit' : 'draftCreate')}
      >
        <p className="text-sm text-muted-foreground">{word('draftSaveNotice')}</p>
        {existing ? (
          <p>{word('draftPreserveNotice')}</p>
        ) : (
          <>
            <ContractDraftChoices
              value={profileId}
              onChange={(id) => {
                setProfileId(id);
                setOrderId('');
              }}
            />
            <Field>
              <FieldLabel htmlFor={fieldId + '-service'}>{word('serviceType')}</FieldLabel>
              <NativeSelect
                id={fieldId + '-service'}
                value={serviceType}
                onChange={(event) => {
                  setServiceType(event.target.value);
                  setOrderId('');
                }}
              >
                {['electricity', 'savings', 'solar'].map((value) => (
                  <option key={value} value={value}>
                    {word(value)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {profileId ? (
              <ContractDraftChoices
                key={profileId}
                profileId={profileId}
                serviceType={serviceType}
                value={orderId}
                onChange={setOrderId}
              />
            ) : null}
          </>
        )}
        <FieldGroup>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={fieldId + '-title'}>{word('titleField')}</FieldLabel>
            <Input
              id={fieldId + '-title'}
              value={title}
              disabled={!canEditTitle}
              aria-invalid={invalid}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={fieldId + '-text'}>{word('draftTerms')}</FieldLabel>
            <Textarea
              id={fieldId + '-text'}
              value={text}
              rows={8}
              disabled={!canEditText}
              aria-invalid={invalid}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={fieldId + '-value-kind'}>{word('statedContractValue')}</FieldLabel>
            <NativeSelect
              id={fieldId + '-value-kind'}
              value={valueKind}
              aria-invalid={invalid}
              onChange={(event) =>
                setValueKind(event.target.value as 'unstated' | 'fixed' | 'variable')
              }
            >
              {valueKind === 'unsupported' ? (
                <option value="unsupported" disabled>
                  {word('unsupportedContractValue')}
                </option>
              ) : null}
              <option value="unstated">{word('noValue')}</option>
              <option value="fixed">{word('fixedContractValue')}</option>
              <option value="variable">{word('variableContractValue')}</option>
            </NativeSelect>
          </Field>
          {valueKind === 'fixed' ? (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor={fieldId + '-value-amount'}>
                {word('fixedContractAmount')}
              </FieldLabel>
              <Input
                id={fieldId + '-value-amount'}
                dir="ltr"
                inputMode="numeric"
                value={amountIrr}
                aria-invalid={invalid}
                onChange={(event) => setAmountIrr(event.target.value)}
              />
            </Field>
          ) : null}
          {valueKind === 'variable' ? (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor={fieldId + '-value-description'}>
                {word('variableContractDescription')}
              </FieldLabel>
              <Textarea
                id={fieldId + '-value-description'}
                value={variableDescription}
                maxLength={500}
                aria-invalid={invalid}
                onChange={(event) => setVariableDescription(event.target.value)}
              />
            </Field>
          ) : null}
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={fieldId + '-reason'}>{word('contextReason')}</FieldLabel>
            <Textarea
              id={fieldId + '-reason'}
              value={reason}
              maxLength={1000}
              aria-invalid={invalid}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">{word('commercialValueNotice')}</p>
        {!canEditTitle || !canEditText ? (
          <p role="status">{word('draftStructuredNotice')}</p>
        ) : null}
        {invalid ? <p role="alert">{word('draftInvalid')}</p> : null}
        <Button type="submit" className="self-start" disabled={!changed}>
          {word('draftReview')}
        </Button>
      </form>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const saved = result as Partial<ContractDetailData> | null;
            if (!saved?.id || !saved.currentVersion?.id) throw new Error('Missing saved contract');
            setAction(null);
            onSaved(saved.id);
          }}
        />
      ) : null}
    </>
  );
}
