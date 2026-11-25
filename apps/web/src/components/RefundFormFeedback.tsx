import { Alert, AlertDescription } from '@barghsa/ui';
export function RefundFieldFeedback({
  id,
  error,
  message,
  reserveSpace = true,
}: {
  id: string;
  error?: { message?: string | undefined } | undefined;
  message: string;
  reserveSpace?: boolean;
}) {
  if (!error && !reserveSpace) return null;
  return (
    <p
      id={id}
      role={error ? 'alert' : undefined}
      aria-hidden={!error || undefined}
      className={`text-sm text-destructive${error ? '' : ' invisible'}`}
    >
      {error?.message ?? message}
    </p>
  );
}
export function RefundFormAlert({ message }: { message?: string | undefined }) {
  return message ? (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;
}
