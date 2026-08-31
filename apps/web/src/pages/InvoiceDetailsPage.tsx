import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { ArrowRightIcon, Loader2Icon, ReceiptIcon } from 'lucide-react'
import { useLocale } from '../hooks/useLocale.js'
import {
  InvoiceRequestError,
  fetchInvoiceDetails,
  formatInvoiceInstant,
  formatIrr,
  roleI18nKey,
  stateI18nKey,
  type CustomerInvoiceDetails,
  type CustomerInvoiceNode,
} from '../lib/customer-invoices.js'

interface InvoiceDetailsPageProps {
  invoiceId: string
}

/**
 * Customer-facing invoice details (T-04.1.05.04 / S-04.1.05).
 *
 * Shows the requested invoice together with the original and every linked
 * replacement or adjustment, each with the staff-supplied explanation of
 * the change. RTL-aware, profile-scoped via the details API.
 */
export function InvoiceDetailsPage({ invoiceId }: InvoiceDetailsPageProps) {
  const locale = useLocale()
  const isRtl = locale === 'fa'
  const [details, setDetails] = useState<CustomerInvoiceDetails | null>(null)
  const [error, setError] = useState<'not-found' | 'load' | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetails(null)
    fetchInvoiceDetails(invoiceId)
      .then((payload) => {
        if (!cancelled) setDetails(payload)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof InvoiceRequestError && err.status === 404) {
          setError('not-found')
        } else {
          setError('load')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <nav aria-label={t('invoices.details.back', locale)}>
        <Link
          to="/invoices"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowRightIcon
            className={`h-4 w-4 ${isRtl ? '' : 'rotate-180'}`}
            aria-hidden="true"
          />
          {t('invoices.details.back', locale)}
        </Link>
      </nav>

      <header className="flex items-center gap-2">
        <ReceiptIcon className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-gray-900">
          {t('invoices.details.title', locale)}
        </h1>
      </header>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('invoices.details.loading', locale)}
        </p>
      ) : error === 'not-found' ? (
        <p className="text-red-600" role="alert">
          {t('invoices.details.notFound', locale)}
        </p>
      ) : error ? (
        <p className="text-red-600" role="alert">
          {t('invoices.details.error', locale)}
        </p>
      ) : details ? (
        <InvoiceDetailsBody details={details} />
      ) : null}
    </div>
  )
}

function InvoiceDetailsBody({ details }: { details: CustomerInvoiceDetails }) {
  const locale = useLocale()
  const viewed = details.invoice
  const original = details.chain.find(
    (node) => node.invoiceId === details.originalInvoiceId,
  )
  const linked = details.chain.filter(
    (node) => node.invoiceId !== details.originalInvoiceId,
  )

  return (
    <section aria-labelledby="invoice-chain-heading" className="space-y-3">
      <div>
        <h2 id="invoice-chain-heading" className="text-lg font-semibold text-gray-900">
          {t('invoices.details.chain', locale)}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {t('invoices.details.chainDescription', locale)}
        </p>
      </div>

      {original ? (
        <InvoiceCard
          node={original}
          heading={t('invoices.details.original', locale)}
          current={original.invoiceId === details.viewedInvoiceId}
        />
      ) : (
        <InvoiceCard
          node={viewed}
          heading={t(roleI18nKey(viewed.role), locale)}
          current
          showExplanation={viewed.role !== 'original'}
        />
      )}

      {linked.map((node) => (
        <InvoiceCard
          key={node.invoiceId}
          node={node}
          heading={t(roleI18nKey(node.role), locale)}
          current={node.invoiceId === details.viewedInvoiceId}
          showExplanation
        />
      ))}
    </section>
  )
}

function InvoiceCard({
  node,
  heading,
  current,
  showExplanation = false,
}: {
  node: CustomerInvoiceNode
  heading: string
  current: boolean
  showExplanation?: boolean
}) {
  const locale = useLocale()
  const explanation = node.explanation

  return (
    <article
      data-testid={`invoice-card-${node.invoiceId}`}
      data-role={node.role}
      aria-current={current ? 'page' : undefined}
      className={`rounded-lg border bg-white p-4 shadow-sm ${
        current ? 'border-primary ring-1 ring-primary/20' : 'border-gray-200'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{heading}</h3>
        <p className="text-sm text-gray-600">
          {t(stateI18nKey(node.state), locale)}
        </p>
      </header>

      {showExplanation || explanation ? (
        <p
          data-testid={`invoice-explanation-${node.invoiceId}`}
          className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <span className="font-medium">
            {t('invoices.details.explanation', locale)}:{' '}
          </span>
          {explanation ?? t('invoices.details.noExplanation', locale)}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">{t('invoices.details.total', locale)}</dt>
          <dd className="font-medium text-gray-900">
            {formatIrr(node.totalAmount, locale)}{' '}
            {t('invoices.details.currency', locale)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">{t('invoices.details.paid', locale)}</dt>
          <dd className="font-medium text-gray-900">
            {formatIrr(node.paidAmount, locale)}{' '}
            {t('invoices.details.currency', locale)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">{t('invoices.details.issuedAt', locale)}</dt>
          <dd>{formatInvoiceInstant(node.issuedAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">{t('invoices.details.dueAt', locale)}</dt>
          <dd>{formatInvoiceInstant(node.dueAt, locale)}</dd>
        </div>
      </dl>

      {node.lines.length > 0 ? (
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">{t('invoices.details.lines', locale)}</caption>
          <thead>
            <tr className="border-b text-start text-gray-500">
              <th scope="col" className="py-1 font-medium">
                {t('invoices.details.line.description', locale)}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('invoices.details.line.quantity', locale)}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('invoices.details.line.lineTotal', locale)}
              </th>
            </tr>
          </thead>
          <tbody>
            {node.lines.map((line, index) => (
              <tr key={`${node.invoiceId}-line-${index}`} className="border-b border-gray-100">
                <td className="py-1">{line.description}</td>
                <td className="py-1">{line.quantity}</td>
                <td className="py-1">
                  {formatIrr(line.lineTotal, locale)}{' '}
                  {t('invoices.details.currency', locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!current ? (
        <p className="mt-3">
          <Link
            to="/invoices/$invoiceId"
            params={{ invoiceId: node.invoiceId }}
            className="text-sm text-primary hover:underline"
          >
            {t('invoices.details.open', locale)}
          </Link>
        </p>
      ) : null}
    </article>
  )
}
