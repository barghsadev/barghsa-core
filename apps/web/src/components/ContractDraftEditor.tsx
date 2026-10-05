import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import type DraftForm from './ContractDraftForm.js';

type ExistingDraft = { contract: ContractDetailData; version: ContractVersion };
export function ContractDraftEditor({
  existing,
  amendment = false,
  onSaved,
}: {
  existing?: ExistingDraft | undefined;
  amendment?: boolean;
  onSaved: (id: string) => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(!open)}
      >
        {word(amendment ? 'amendmentCreate' : existing ? 'draftEdit' : 'draftCreate')}
      </Button>
      {open ? (
        Form ? (
          <Form
            existing={existing}
            amendment={amendment}
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
