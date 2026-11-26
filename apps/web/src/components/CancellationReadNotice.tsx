import { useEffect, useRef } from 'react';
import { Alert, AlertDescription, Button } from '@barghsa/ui';
import { cancellationEditorMessages } from '@barghsa/i18n/cancellation-editor';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';

export function CancellationReadNotice({
  error,
  needsRead,
  loading,
  disabled,
  reasonId,
  onRefresh,
}: {
  error: string | null;
  needsRead: boolean;
  loading: boolean;
  disabled: boolean;
  reasonId: string;
  onRefresh: () => void;
}) {
  const locale = useLocale();
  const attempted = useRef(false);
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!attempted.current || loading) return;
    attempted.current = false;
    if (error || needsRead) retry.current?.focus();
    else document.getElementById(reasonId)?.focus();
  }, [error, loading, needsRead, reasonId]);

  if (!error && !needsRead) return null;
  return (
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
      <AlertDescription className="min-w-0 flex-1 basis-52 space-y-1 [&_p:not(:last-child)]:mb-0">
        {needsRead && <p>{confirmationText('unconfirmed', locale)}</p>}
        {error && <p>{error}</p>}
      </AlertDescription>
      <Button
        ref={retry}
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          attempted.current = true;
          onRefresh();
        }}
      >
        {needsRead
          ? confirmationText('checkStatus', locale)
          : cancellationEditorMessages[locale].retryRead}
      </Button>
    </Alert>
  );
}
