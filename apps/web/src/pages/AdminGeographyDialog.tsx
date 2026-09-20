import { useRef, useState } from 'react';
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
  Input,
  Label,
} from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import {
  deactivateProvince,
  deactivateCity,
  saveCity,
  GeographyRequestError,
  saveProvince,
  type Province,
} from '../lib/geography-api.js';

export type GeographyModal = {
  kind: 'add' | 'edit' | 'deactivate';
  province: Province | null;
  trigger: HTMLElement;
};
const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';
function failureKey(error: unknown): GeographyTextKey {
  return error instanceof GeographyRequestError ? error.code : 'requestFailed';
}
export function GeographyDialog({
  provinceId,
  modal,
  onClose,
  onSaved,
}: {
  provinceId?: string;
  modal: GeographyModal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const t = (key: GeographyTextKey) =>
    geographyText(
      provinceId
        ? ((
            {
              add: 'addCity',
              editTitle: 'editCity',
              deactivateTitle: 'deactivateCity',
              formDescription: 'cityDescription',
              deactivateDescription: 'cityDeactivateDescription',
              conflict: 'cityConflict',
            } as Partial<Record<GeographyTextKey, GeographyTextKey>>
          )[key] ?? key)
        : key,
      locale
    );
  const firstField = useRef<HTMLInputElement>(null);
  const [nameFa, setNameFa] = useState(modal.province?.nameFa ?? '');
  const [nameEn, setNameEn] = useState(modal.province?.nameEn ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(modal.province?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const deactivating = modal.kind === 'deactivate';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!deactivating) {
      if (!nameFa.trim() || !/^[\u0600-\u06FF\u200C\s]+$/.test(nameFa.trim())) {
        setError('invalidFa');
        return;
      }
      if (!nameEn.trim() || !/^[a-zA-Z\s]+$/.test(nameEn.trim())) {
        setError('invalidEn');
        return;
      }
    }
    setBusy(true);
    try {
      if (deactivating && modal.province) {
        if (provinceId) await deactivateCity(provinceId, modal.province.id);
        else await deactivateProvince(modal.province.id);
      } else if (provinceId)
        await saveCity(provinceId, modal.province, {
          nameFa: nameFa.trim(),
          nameEn: nameEn.trim(),
          status,
        });
      else
        await saveProvince(modal.province, {
          nameFa: nameFa.trim(),
          nameEn: nameEn.trim(),
          status,
        });
      onSaved();
    } catch (cause) {
      setError(failureKey(cause));
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
        initialFocus={deactivating ? undefined : firstField}
        finalFocus={() => modal.trigger}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>
            {t(deactivating ? 'deactivateTitle' : modal.kind === 'add' ? 'add' : 'editTitle')}
          </DialogTitle>
          <DialogDescription>
            {deactivating
              ? t('deactivateDescription').replace(
                  '{name}',
                  (locale === 'fa' ? modal.province?.nameFa : modal.province?.nameEn) ?? ''
                )
              : t('formDescription')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-4">
          {!deactivating && (
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <legend className="sr-only">{t('editTitle')}</legend>
              <div className="flex flex-col gap-2">
                <Label htmlFor="province-name-fa">{t('nameFa')}</Label>
                <Input
                  id="province-name-fa"
                  ref={firstField}
                  dir="rtl"
                  lang="fa"
                  value={nameFa}
                  onChange={(event) => setNameFa(event.target.value)}
                  maxLength={100}
                  required
                  aria-invalid={error === 'invalidFa'}
                  aria-describedby={error === 'invalidFa' ? 'province-error' : undefined}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="province-name-en">{t('nameEn')}</Label>
                <Input
                  id="province-name-en"
                  dir="ltr"
                  lang="en"
                  value={nameEn}
                  onChange={(event) => setNameEn(event.target.value)}
                  maxLength={100}
                  required
                  aria-invalid={error === 'invalidEn'}
                  aria-describedby={error === 'invalidEn' ? 'province-error' : undefined}
                />
              </div>
              {modal.kind === 'edit' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="province-status">{t('status')}</Label>
                  <select
                    id="province-status"
                    className={selectClass}
                    value={status}
                    onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')}
                  >
                    <option value="active">{t('active')}</option>
                    <option value="inactive">{t('inactive')}</option>
                  </select>
                </div>
              )}
            </fieldset>
          )}
          {error && (
            <Alert variant="destructive" role="alert" id="province-error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={deactivating ? 'destructive' : 'default'}
              disabled={busy}
            >
              {t(
                busy
                  ? deactivating
                    ? 'deactivating'
                    : 'saving'
                  : deactivating
                    ? 'deactivate'
                    : modal.kind === 'add'
                      ? 'create'
                      : 'save'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
