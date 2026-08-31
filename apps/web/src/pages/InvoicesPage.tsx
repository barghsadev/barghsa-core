import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { Loader2Icon, ReceiptIcon } from 'lucide-react'
import { useLocale } from '../hooks/useLocale.js'
import {
  fetchInvoiceList,
  formatInvoiceInstant,
  formatIrr,
  roleI18nKey,
  stateI18nKey,
  type CustomerInvoiceListItem,
} from '../lib/customer-invoices.js'

/**
 * Customer invoice list (scaffolding for T-04.1.05.04).
 *
 * Lists the active profile's invoices so the customer can open a details
 * page that shows the original plus linked corrections/replacements.
 */
export function InvoicesPage() {
  const locale = useLocale()
  const isRtl = locale === 'fa'
  const [items, setItems] = useState<CustomerInvoiceListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchInvoiceList()
      .then((page) => {
        if (!cancelled) setItems(page.invoices)
      })
      .catch(() => {
        if (!cancelled) setError(t('invoices.error.load', locale))
      })
    return () => {
      cancelled = true
    }
  }, [locale])

  return (
    <div className="mx-auto max-w-3xl space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="flex items-center gap-2">
        <ReceiptIcon className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('invoices.title', locale)}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('invoices.description', locale)}
          </p>
        </div>
      </header>

      {error ? (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      ) : items === null ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('invoices.loading', locale)}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {t('invoices.empty', locale)}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.invoiceId}>
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: item.invoiceId }}
                className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-gray-900">
                    {t(roleI18nKey(item.role), locale)}
                  </p>
                  <p className="text-sm text-gray-600">
                    {t(stateI18nKey(item.state), locale)}
                  </p>
                </div>
                <p className="mt-2 text-lg font-semibold text-gray-900">
                  {formatIrr(item.totalAmount, locale)}{' '}
                  <span className="text-sm font-normal text-gray-500">
                    {t('invoices.details.currency', locale)}
                  </span>
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {t('invoices.list.issued', locale)}:{' '}
                  {formatInvoiceInstant(item.issuedAt, locale)}
                </p>
                {item.explanation ? (
                  <p className="mt-2 text-sm text-gray-700">{item.explanation}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
