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
  Input,
  Label,
} from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import type { GeographyDraft } from '../lib/geography-form-values.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
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
  readReady = true,
  recovery,
  onDenied,
}: {
  readReady?: boolean;
  recovery?: React.ReactNode;
  onDenied?: () => void;
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
  const native = useWizardForm<GeographyDraft>(
    async () =>
      (await import('../lib/geography-form-schemas.js')).geographySchema({
        nameFa: t('invalidFa'),
        nameEn: t('invalidEn'),
        status: t('invalidStatus'),
        nameLength: t('nameLength'),
      }),
    () => ({
      nameFa: modal.province?.nameFa ?? '',
      nameEn: modal.province?.nameEn ?? '',
      status: modal.province?.status ?? 'active',
    }),
    t('validationUnavailable')
  );
  const [nameFa, setNameFa] = native.field('nameFa');
  const [nameEn, setNameEn] = native.field('nameEn');
  const [status, setStatus] = native.field('status');
  const busy = native.pending;
  const fieldErrors = useActionFieldErrors(
    native.form,
    {
      nameFa: t('invalidFa'),
      nameEn: t('invalidEn'),
      ...(modal.kind === 'edit' ? { status: t('invalidStatus') } : {}),
    },
    t('requestFailed')
  );
  const invalidFocus = useRef<keyof GeographyDraft | null>(null);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const mounted = useRef(false),
    inFlight = useRef(false);
  const latest = useRef({ readReady, modal, provinceId, locale, generation: 0 });
  if (
    latest.current.readReady !== readReady ||
    latest.current.modal !== modal ||
    latest.current.provinceId !== provinceId ||
    latest.current.locale !== locale
  )
    latest.current = {
      readReady,
      modal,
      provinceId,
      locale,
      generation: latest.current.generation + 1,
    };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current.generation += 1;
    };
  }, []);
  useEffect(() => {
    if (!busy && invalidFocus.current && mounted.current) {
      const field = invalidFocus.current;
      invalidFocus.current = null;
      native.form.setFocus(field);
    }
  }, [busy, native.errors, native.form]);
  const deactivating = modal.kind === 'deactivate';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || inFlight.current || !readReady) return;
    inFlight.current = true;
    const generation = latest.current.generation;
    native.setValidationPending(true);
    native.form.clearErrors();
    setError(null);
    try {
      if (!deactivating) {
        const valid = await native.form.trigger();
        if (
          !mounted.current ||
          latest.current.generation !== generation ||
          !latest.current.readReady
        )
          return;
        if (!valid) {
          invalidFocus.current =
            (['nameFa', 'nameEn', 'status'] as const).find(
              (field) => native.form.getFieldState(field).invalid
            ) ?? null;
          return;
        }
      }
      const draft = native.form.getValues();
      if (deactivating && modal.province) {
        if (provinceId) await deactivateCity(provinceId, modal.province.id);
        else await deactivateProvince(modal.province.id);
      } else if (provinceId)
        await saveCity(provinceId, modal.province, {
          nameFa: draft.nameFa.trim(),
          nameEn: draft.nameEn.trim(),
          status: draft.status,
        });
      else
        await saveProvince(modal.province, {
          nameFa: draft.nameFa.trim(),
          nameEn: draft.nameEn.trim(),
          status: draft.status,
        });
      if (
        mounted.current &&
        latest.current.modal === modal &&
        latest.current.provinceId === provinceId
      )
        onSaved();
    } catch (cause) {
      if (
        !mounted.current ||
        latest.current.modal !== modal ||
        latest.current.provinceId !== provinceId
      )
        return;
      if (cause instanceof GeographyRequestError && cause.code === 'denied') {
        onDenied?.();
        return;
      }
      if (!deactivating && cause instanceof GeographyRequestError && fieldErrors([...cause.fields]))
        return;
      setError(failureKey(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) native.setValidationPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
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
          {error && (
            <Alert variant="destructive" role="alert" id="province-error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          {catalogueRootMessage(native.errors) && (
            <Alert variant="destructive">{catalogueRootMessage(native.errors)}</Alert>
          )}
          {!deactivating && (
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <legend className="sr-only">{t(modal.kind === 'add' ? 'add' : 'editTitle')}</legend>
              <div className="flex flex-col gap-2">
                <Label htmlFor="province-name-fa">{t('nameFa')}</Label>
                <Input
                  {...native.bind('nameFa')}
                  id="province-name-fa"
                  ref={(node) => {
                    firstField.current = node;
                    native.bind('nameFa').ref(node);
                  }}
                  dir="rtl"
                  lang="fa"
                  value={nameFa}
                  onChange={(event) => {
                    if (!inFlight.current) setNameFa(event.target.value);
                  }}
                  maxLength={100}
                  required
                />
                <CatalogueFieldFeedback
                  id={native.errorId('nameFa')}
                  error={native.errors.nameFa}
                  message={t('invalidFa')}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="province-name-en">{t('nameEn')}</Label>
                <Input
                  {...native.bind('nameEn')}
                  id="province-name-en"
                  dir="ltr"
                  lang="en"
                  value={nameEn}
                  onChange={(event) => {
                    if (!inFlight.current) setNameEn(event.target.value);
                  }}
                  maxLength={100}
                  required
                />
                <CatalogueFieldFeedback
                  id={native.errorId('nameEn')}
                  error={native.errors.nameEn}
                  message={t('invalidEn')}
                />
              </div>
              {modal.kind === 'edit' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="province-status">{t('status')}</Label>
                  <select
                    {...native.bind('status')}
                    id="province-status"
                    className={selectClass}
                    value={status}
                    onChange={(event) => {
                      if (!inFlight.current) setStatus(event.target.value as 'active' | 'inactive');
                    }}
                  >
                    <option value="active">{t('active')}</option>
                    <option value="inactive">{t('inactive')}</option>
                  </select>
                  <CatalogueFieldFeedback
                    id={native.errorId('status')}
                    error={native.errors.status}
                    message={t('invalidStatus')}
                  />
                </div>
              )}
            </fieldset>
          )}
          {recovery}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!inFlight.current) onClose();
              }}
            >
              {t('cancel')}
            </Button>
            {deactivating ? (
              <Button
                type="submit"
                variant={deactivating ? 'destructive' : 'default'}
                disabled={busy || !readReady}
                aria-busy={busy || undefined}
              >
                {busy && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
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
            ) : (
              <CatalogueSaveButton
                label={t(busy ? 'saving' : modal.kind === 'add' ? 'create' : 'save')}
                pending={busy}
                disabled={busy || !readReady}
              />
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
