import { Fragment, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, Input } from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { GeographyRequestError, listProvinces, type Province } from '../lib/geography-api.js';
import { CitiesPanel } from './CitiesPanel.js';
import { GeographyDialog, type GeographyModal } from './GeographyDialog.js';
const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';
function failureKey(error: unknown): GeographyTextKey {
  return error instanceof GeographyRequestError ? error.code : 'requestFailed';
}
export default function AdminGeographyPage() {
  const locale = useLocale();
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const { number } = useNumberFormatting(locale);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const [modal, setModal] = useState<GeographyModal | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listProvinces({ search, status, page }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setProvinces(result.provinces);
        setTotal(result.total);
        const lastPage = Math.max(1, Math.ceil(result.total / 20));
        if (page > lastPage) setPage(lastPage);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(failureKey(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, status, page, revision]);
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return (
    <section
      className="flex flex-col gap-4 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-labelledby="province-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="province-heading" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <Button
          onClick={(event) =>
            setModal({ kind: 'add', province: null, trigger: event.currentTarget })
          }
        >
          {t('add')}
        </Button>
      </header>
      <div className="flex flex-wrap gap-4">
        <Input
          className="max-w-sm"
          aria-label={t('search')}
          placeholder={t('search')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <select
          className={selectClass}
          aria-label={t('filterStatus')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('all')}</option>
          <option value="active">{t('active')}</option>
          <option value="inactive">{t('inactive')}</option>
        </select>
      </div>
      {error && (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {t(error)}
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && <p role="status">{t('loading')}</p>}
      <div
        className="overflow-x-auto rounded-md border bg-card text-card-foreground"
        aria-busy={loading}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(['nameFa', 'nameEn', 'status', 'actions'] as const).map((key) => (
                <th key={key} scope="col" className="p-3 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && !error && provinces.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center">
                  {t('empty')}
                </td>
              </tr>
            )}
            {provinces.map((province) => (
              <Fragment key={province.id}>
                <tr className="border-t">
                  <td className="p-3" dir="rtl" lang="fa">
                    {province.nameFa}
                  </td>
                  <td className="p-3" dir="ltr" lang="en">
                    {province.nameEn}
                  </td>
                  <td className="p-3">{t(province.status)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        aria-expanded={expanded === province.id}
                        aria-controls={`cities-${province.id}`}
                        onClick={() => setExpanded(expanded === province.id ? null : province.id)}
                      >
                        {t('cities')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={(event) =>
                          setModal({ kind: 'edit', province, trigger: event.currentTarget })
                        }
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={(event) =>
                          setModal({
                            kind: province.status === 'active' ? 'deactivate' : 'edit',
                            province,
                            trigger: event.currentTarget,
                          })
                        }
                      >
                        {t(province.status === 'active' ? 'deactivate' : 'activate')}
                      </Button>
                    </div>
                  </td>
                </tr>
                {expanded === province.id && (
                  <tr>
                    <td colSpan={4} className="border-t p-4">
                      <CitiesPanel province={province} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <nav aria-label={t('title')} className="flex flex-wrap items-center justify-between gap-4">
          <p>
            {t('range')
              .replace('{from}', number((page - 1) * 20 + 1))
              .replace('{to}', number(Math.min(page * 20, total)))
              .replace('{total}', number(total))}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={loading || page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </nav>
      )}
      {modal && (
        <GeographyDialog
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
