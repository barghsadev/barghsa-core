import { lazy, Suspense, useState, type ComponentProps } from 'react';
import { Button, PageLoading } from '@barghsa/ui';
import { tManualInvoice as t } from '@barghsa/i18n/manual-invoice';
import { useLocale } from '../hooks/useLocale.js';

const ManualInvoiceForm = lazy(() => import('./ManualInvoiceForm.js'));
export default function ManualInvoicePanel({
  recordPage = false,
  ...form
}: ComponentProps<typeof ManualInvoiceForm> & { recordPage?: boolean } = {}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <section
      id="manual-invoice-panel"
      className={recordPage ? 'min-w-0' : 'space-y-4 rounded-lg border bg-card p-6'}
      aria-labelledby={recordPage ? 'staff-invoice-heading' : 'manual-invoice-heading'}
    >
      {!recordPage && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="manual-invoice-heading" className="text-xl font-semibold">
              {t('admin.manualInvoice.title', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('admin.manualInvoice.description', locale)}
            </p>
          </div>
          {!open && (
            <Button type="button" onClick={() => setOpen(true)}>
              {t('admin.manualInvoice.new', locale)}
            </Button>
          )}
        </div>
      )}
      {(recordPage || open) && (
        <Suspense fallback={<PageLoading label={t('admin.manualInvoice.loading', locale)} />}>
          <ManualInvoiceForm {...form} />
        </Suspense>
      )}
    </section>
  );
}
