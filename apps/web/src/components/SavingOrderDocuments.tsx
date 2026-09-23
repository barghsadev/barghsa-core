import { useMemo } from 'react';
import { tSaving } from '@barghsa/i18n/saving';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import { useLocale } from '../hooks/useLocale.js';

export function SavingOrderDocuments({
  orderId,
  profileId,
  staff = false,
}: {
  orderId: string;
  profileId: string;
  staff?: boolean;
}) {
  const locale = useLocale();
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'order',
      state: '',
      category: '',
      query: '',
      profileId,
      businessRecordId: orderId,
    }),
    [orderId, profileId]
  );
  return (
    <section className="space-y-3" aria-label={tSaving('documents', locale)}>
      <h2 className="text-xl font-semibold">{tSaving('documents', locale)}</h2>
      <DocumentResults
        staff={staff}
        filters={filters}
        profileId={profileId}
        association={{ businessRecordType: 'order', businessRecordId: orderId }}
      />
    </section>
  );
}
