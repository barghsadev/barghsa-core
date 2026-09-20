import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  GeographyRequestError,
  importCities,
  listCities,
  type City,
  type Province,
} from '../lib/geography-api.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';

function ImportCitiesDialog({
  province,
  trigger,
  onClose,
  onSaved,
}: {
  province: Province;
  trigger: HTMLElement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split('\t').map((cell) => cell.trim()));
  const valid =
    rows.length > 0 &&
    rows.length <= 200 &&
    rows.every(
      (row) =>
        row.length === 2 &&
        !!row[0] &&
        row[0].length <= 100 &&
        /^[\u0600-\u06FF\u200C\s]+$/.test(row[0]) &&
        !!row[1] &&
        row[1].length <= 100 &&
        /^[a-zA-Z\s]+$/.test(row[1])
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!valid) {
      setError('importInvalid');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await importCities(
        province.id,
        rows.map((row) => ({ nameFa: row[0]!, nameEn: row[1]! }))
      );
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof GeographyRequestError && cause.code === 'conflict'
          ? 'cityConflict'
          : 'requestFailed'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={field}
        finalFocus={() => trigger}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{t('importCities')}</DialogTitle>
          <DialogDescription>{t('importDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
          <Field>
            <FieldLabel htmlFor="city-import-rows">{t('importRows')}</FieldLabel>
            <Textarea
              id="city-import-rows"
              ref={field}
              rows={8}
              maxLength={41000}
              disabled={busy}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-invalid={error === 'importInvalid'}
              aria-describedby={error ? 'city-import-error' : undefined}
            />
          </Field>
          {valid && <p role="status">{t('importCount').replace('{count}', number(rows.length))}</p>}
          {error && (
            <Alert variant="destructive" role="alert" id="city-import-error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t(busy ? 'saving' : 'importCities')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CitiesPanel({ province }: { province: Province }) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const [cities, setCities] = useState<City[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState<GeographyModal | null>(null);
  const [importTrigger, setImportTrigger] = useState<HTMLElement | null>(null);
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
    setError(false);
    listCities(province.id, { search, status, page }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCities(result.cities);
        setTotal(result.total);
        const lastPage = Math.max(1, Math.ceil(result.total / 20));
        if (page > lastPage) setPage(lastPage);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [province.id, search, status, page, revision]);
  function saved() {
    setModal(null);
    setImportTrigger(null);
    setRevision((value) => value + 1);
  }
  return (
    <section
      id={`cities-${province.id}`}
      aria-label={`${t('cities')} — ${locale === 'fa' ? province.nameFa : province.nameEn}`}
      className="flex flex-col gap-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {t('cities')} — {locale === 'fa' ? province.nameFa : province.nameEn}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={(event) =>
              setModal({ kind: 'add', province: null, trigger: event.currentTarget })
            }
          >
            {t('addCity')}
          </Button>
          <Button variant="outline" onClick={(event) => setImportTrigger(event.currentTarget)}>
            {t('importCities')}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-4">
        <Input
          aria-label={t('citySearch')}
          placeholder={t('citySearch')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="max-w-sm"
        />
        <select
          aria-label={t('filterStatus')}
          className="h-10 rounded-md border border-input bg-background px-3"
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
      {loading && <p role="status">{t('cityLoading')}</p>}
      {error && (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {t('requestFailed')}
            <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <table className="w-full text-sm" aria-busy={loading}>
        <caption className="sr-only">{t('cities')}</caption>
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
          {!loading && !error && cities.length === 0 && (
            <tr>
              <td colSpan={4} className="p-4 text-center">
                {t('cityEmpty')}
              </td>
            </tr>
          )}
          {cities.map((city) => (
            <tr key={city.id} className="border-t">
              <td className="p-3" lang="fa" dir="rtl">
                {city.nameFa}
              </td>
              <td className="p-3" lang="en" dir="ltr">
                {city.nameEn}
              </td>
              <td className="p-3">{t(city.status)}</td>
              <td className="p-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={(event) =>
                      setModal({ kind: 'edit', province: city, trigger: event.currentTarget })
                    }
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={(event) =>
                      setModal({
                        kind: city.status === 'active' ? 'deactivate' : 'edit',
                        province: city,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    {t(city.status === 'active' ? 'deactivate' : 'activate')}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > 20 && (
        <nav aria-label={t('cities')} className="flex flex-wrap items-center justify-between gap-4">
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
              onClick={() => setPage((p) => p - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={loading || page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </nav>
      )}
      {modal && (
        <GeographyDialog
          provinceId={province.id}
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {importTrigger && (
        <ImportCitiesDialog
          province={province}
          trigger={importTrigger}
          onClose={() => setImportTrigger(null)}
          onSaved={saved}
        />
      )}
    </section>
  );
}
