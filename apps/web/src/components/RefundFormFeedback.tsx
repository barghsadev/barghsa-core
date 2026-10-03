import { Alert, AlertDescription } from '@barghsa/ui';
export function RefundFieldFeedback({
  id,
  error,
  message,
}: {
  id: string;
  error?: { message?: string | undefined } | undefined;
  message: string;
}) {
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
