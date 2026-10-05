import { useEffect, useRef, useState } from 'react';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import { contractAuthoringSource } from '../lib/contract-authoring-form.js';
import type DraftForm from './ContractDraftForm.js';

type ExistingDraft = { contract: ContractDetailData; version: ContractVersion };
type Props = {
  existing?: ExistingDraft | undefined;
  amendment?: boolean;
  onSaved: (id: string) => void;
  coordination?: ContractFormCoordination | undefined;
  onDenied?: (() => void) | undefined;
};
export function ContractDraftEditor(props: Props) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return (
    <DraftEditor
      key={JSON.stringify([
        actor,
        revision,
        contractAuthoringSource(props.existing),
        props.amendment,
      ])}
      {...props}
    />
  );
}
function DraftEditor({ existing, amendment = false, onSaved, coordination, onDenied }: Props) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [open, setOpen] = useState(false);
  const owner = useRef(false),
    [locked, setLocked] = useState(false);
  const [Form, setForm] = useState<typeof DraftForm | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || Form) return;
    let cancelled = false;
    setFailed(false);
    void import('./ContractDraftForm.js')
      .then((module) => {
        const LoadedForm = module.default;
        if (!cancelled) setForm(() => LoadedForm);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, Form, retry]);
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        className="self-start"
        aria-expanded={open}
        disabled={locked || !!coordination?.blocked()}
        onClick={() => {
          if (!owner.current && !coordination?.blocked()) setOpen(!open);
        }}
      >
        {word(amendment ? 'amendmentCreate' : existing ? 'draftEdit' : 'draftCreate')}
      </Button>
      {open ? (
        Form ? (
          <Form
            existing={existing}
            amendment={amendment}
            coordination={coordination}
            onDenied={onDenied}
            onLocked={(value) => {
              owner.current = value;
              setLocked(value);
            }}
            onSaved={(id) => {
              setOpen(false);
              onSaved(id);
            }}
          />
        ) : failed ? (
          <Alert variant="destructive">
            <AlertDescription>{word('error')}</AlertDescription>
            <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
              {word('refresh')}
            </Button>
          </Alert>
        ) : (
          <PageLoading label={word('loading')} />
        )
      ) : null}
    </div>
  );
}
