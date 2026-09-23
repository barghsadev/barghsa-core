import { tSaving } from '@barghsa/i18n/saving';

export function AcceptedSavingAgreement({
  snapshot,
  updated,
  locale,
}: {
  snapshot: string;
  updated: boolean;
  locale: 'en' | 'fa';
}) {
  return (
    <section className="space-y-3">
      {updated && (
        <p role="status" className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
          {tSaving('agreementUpdatedNotice', locale)}
        </p>
      )}
      <details className="rounded-md border p-4">
        <summary className="cursor-pointer font-medium">
          {tSaving('acceptedAgreement', locale)}
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm">{snapshot}</p>
      </details>
    </section>
  );
}
