import { Alert, Button } from '@barghsa/ui';
type Copy = (key: string) => string;
export function CatalogueEditorStatus({
  label,
  loading,
  error,
  denied,
  saved,
  uncertain,
  refresh,
  busy,
}: {
  label: Copy;
  loading: boolean;
  error: boolean;
  denied: boolean;
  saved: boolean;
  uncertain: boolean;
  refresh: () => void;
  busy: boolean;
}) {
  return (
    <>
      {loading && <p role="status">{label('loading')}</p>}
      {denied && <Alert variant="destructive">{label('forbidden')}</Alert>}
      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive p-3">
          <p>{label('readError')}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
            {label('retry')}
          </Button>
        </div>
      )}
      {saved && <p role="status">{label('saved')}</p>}
      {uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
    </>
  );
}
export function CatalogueSaveButton({
  label,
  pending,
  disabled,
  testId,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  testId?: string;
}) {
  return (
    <Button data-testid={testId} type="submit" disabled={disabled} aria-busy={pending || undefined}>
      {pending && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {label}
    </Button>
  );
}
export function catalogueRootMessage(errors: {
  root?: Record<string, { message?: string }> & { message?: string };
}) {
  return errors.root?.validation?.message ?? errors.root?.message;
}
