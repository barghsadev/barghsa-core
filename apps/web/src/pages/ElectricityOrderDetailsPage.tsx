import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface ElectricityOrderDetail {
  orderId: string;
  profileId: string;
  commercialStatus: string;
  electricityStatus: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  fullAddress: string;
  contractId: string;
  contractState: string;
  invoiceId: string;
  invoiceState: string;
  totalIrR: string;
}

const statusKeys: Record<string, string> = {
  draft: 'electricity.order.status.draft',
  submitted: 'electricity.order.status.submitted',
  awaiting_staff_review: 'electricity.order.status.awaiting_staff_review',
  changes_requested: 'electricity.order.status.changes_requested',
  approved: 'electricity.order.status.approved',
  active: 'electricity.order.status.active',
  completed: 'electricity.order.status.completed',
  rejected: 'electricity.order.status.rejected',
  cancelled: 'electricity.order.status.cancelled',
};

export function ElectricityOrderDetailsPage({ orderId }: { orderId: string }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [detail, setDetail] = useState<ElectricityOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch(`/api/electricity/orders/${encodeURIComponent(orderId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Order unavailable');
        return response.json() as Promise<ElectricityOrderDetail>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (
          !value ||
          value.orderId !== orderId ||
          !value.contractId ||
          !value.invoiceId ||
          !/^\d+$/.test(value.totalIrR)
        )
          throw new Error('Invalid order detail');
        setDetail(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orderId, retry]);

  return (
    <main
      className="container mx-auto max-w-2xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header>
        <h1 className="text-2xl font-bold">{t('electricity.order.success.title', locale)}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('electricity.order.success.description', locale)}
        </p>
      </header>
      {loading ? (
        <p role="status">{t('electricity.order.detailLoading', locale)}</p>
      ) : error || !detail ? (
        <div role="alert" className="space-y-3">
          <p>{t('electricity.order.detailFailed', locale)}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            {t('electricity.order.retry', locale)}
          </Button>
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.success.order', locale)}</span>
                <strong className="break-all">{detail.orderId}</strong>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.profile', locale)}</span>
                <span className="break-all">{detail.profileId}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.period.selection', locale)}</span>
                <span>
                  {new Date(detail.periodStart).toLocaleDateString(locale)} –{' '}
                  {new Date(detail.periodEnd).toLocaleDateString(locale)}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.quantity', locale)}</span>
                <span>{detail.totalKwh} kWh</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.total', locale)}</span>
                <strong>{numbers.money(detail.totalIrR)}</strong>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.deliveryAddress', locale)}</span>
                <span>{detail.fullAddress}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span>{t('electricity.order.detailStatus', locale)}</span>
                <span>
                  {t(
                    statusKeys[detail.electricityStatus] ?? 'electricity.order.status.unknown',
                    locale
                  )}
                </span>
              </p>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-3">
            <a
              href="/contracts"
              className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
            >
              {t('electricity.order.success.contract', locale)}: {detail.contractId}
            </a>
            <a
              href={`/invoices/${detail.invoiceId}`}
              className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
            >
              {t('electricity.order.success.invoice', locale)}: {detail.invoiceId}
            </a>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('electricity.order.paymentOptions', locale)}</p>
            <p>{t('electricity.order.paymentAfterSubmit', locale)}</p>
          </div>
        </>
      )}
    </main>
  );
}
