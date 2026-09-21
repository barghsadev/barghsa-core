import { useState, useId, type FormEvent } from 'react';
import { Button, Field, FieldGroup, FieldLabel, Input, NativeSelect, Textarea } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractDraftChoices } from './ContractDraftChoices.js';

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
  const [title, setTitle] = useState(typeof original.title === 'string' ? original.title : '');
  const [text, setText] = useState(typeof original.text === 'string' ? original.text : '');
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
  const changed = !existing || JSON.stringify(content) !== JSON.stringify(original);
  function save(event: FormEvent) {
    event.preventDefault();
    if (
      !changed ||
      !reason.trim() ||
      (!existing && (!profileId || !title.trim() || !text.trim())) ||
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
