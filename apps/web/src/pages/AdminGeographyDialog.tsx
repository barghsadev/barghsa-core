import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { ConfirmationFields } from '@barghsa/ui';
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
  NativeSelect,
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
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
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
  trigger: HTMLElement | null;
};

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
  standalone = false,
}: {
  readReady?: boolean;
  recovery?: React.ReactNode;
  onDenied?: () => void;
  provinceId?: string;
  standalone?: boolean;
  modal: GeographyModal;
  onClose: () => void;
  onSaved: (record: Province | null) => void;
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
  const cancel = useRef<HTMLButtonElement>(null);
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
  const destructive =
    deactivating ||
    (modal.kind === 'edit' && modal.province?.status === 'active' && status === 'inactive');
  const gate = useRiskConfirmation(
    JSON.stringify([provinceId, modal.kind, modal.province?.id, destructive]),
    locale,
    'destructive'
  );
  const authorized = useRef(gate.allowed);
  authorized.current = gate.allowed;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if ((destructive && !authorized.current) || busy || inFlight.current || !readReady) return;
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
      if (destructive && !authorized.current) return;
      const draft = native.form.getValues();
      const values = {
        nameFa: draft.nameFa.trim(),
        nameEn: draft.nameEn.trim(),
        status: draft.status,
      };
      let saved: Province | null = null;
      if (deactivating && modal.province) {
        if (provinceId) await deactivateCity(provinceId, modal.province.id);
        else await deactivateProvince(modal.province.id);
      } else if (provinceId) saved = await saveCity(provinceId, modal.province, values);
      else saved = await saveProvince(modal.province, values);
      if (
        mounted.current &&
        latest.current.modal === modal &&
        latest.current.provinceId === provinceId
      )
        onSaved(saved);
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
  const title = t(deactivating ? 'deactivateTitle' : modal.kind === 'add' ? 'add' : 'editTitle');
  const description = deactivating
    ? t('deactivateDescription').replace(
        '{name}',
        (locale === 'fa' ? modal.province?.nameFa : modal.province?.nameEn) ?? ''
      )
    : t('formDescription');
  const actions = (
    <>
      <Button
        ref={cancel}
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
          variant="destructive"
          disabled={busy || !readReady || !gate.allowed}
          aria-busy={busy || undefined}
        >
          {busy && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {t(busy ? 'deactivating' : 'deactivate')}
        </Button>
      ) : (
        <CatalogueSaveButton
          label={t(busy ? 'saving' : modal.kind === 'add' ? 'create' : 'save')}
          pending={busy}
          disabled={busy || !readReady || (destructive && !gate.allowed)}
        />
      )}
    </>
  );
  const form = (
    <form
      onSubmit={submit}
      noValidate
      aria-label={title}
      aria-busy={busy}
      className={standalone ? recordEditorSurface : 'space-y-4'}
    >
      <div className={standalone ? 'space-y-3 px-4 py-4 sm:px-6' : 'space-y-3'}>
        {standalone && (
          <div className="space-y-1">
            <h2 className="text-base font-semibold">
              {t(deactivating ? 'status' : modal.kind === 'edit' ? 'namesAndStatus' : 'names')}
            </h2>
            {deactivating && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        )}
        {error && (
          <Alert variant="destructive" role="alert" id="province-error">
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        {catalogueRootMessage(native.errors) && (
          <Alert variant="destructive">{catalogueRootMessage(native.errors)}</Alert>
        )}
        {!deactivating && (
          <fieldset disabled={busy} className="min-w-0 space-y-3 border-0 p-0">
            <legend className="sr-only">{t(modal.kind === 'add' ? 'add' : 'editTitle')}</legend>
            <div className={recordEditorGrid}>
              <div className={recordEditorField}>
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
                  placeholder={provinceId ? 'کرج' : 'البرز'}
                  value={nameFa}
                  onChange={(event) => {
                    if (!inFlight.current) setNameFa(event.target.value);
                  }}
                  maxLength={100}
                  required
                  aria-required="true"
                />
                <CatalogueFieldFeedback
                  id={native.errorId('nameFa')}
                  error={native.errors.nameFa}
                  message={t('invalidFa')}
                  compact
                />
              </div>
              <div className={recordEditorField}>
                <Label htmlFor="province-name-en">{t('nameEn')}</Label>
                <Input
                  {...native.bind('nameEn')}
                  id="province-name-en"
                  dir="ltr"
                  lang="en"
                  placeholder={provinceId ? 'Karaj' : 'Alborz'}
                  value={nameEn}
                  onChange={(event) => {
                    if (!inFlight.current) setNameEn(event.target.value);
                  }}
                  maxLength={100}
                  required
                  aria-required="true"
                />
                <CatalogueFieldFeedback
                  id={native.errorId('nameEn')}
                  error={native.errors.nameEn}
                  message={t('invalidEn')}
                  compact
                />
              </div>
            </div>
            {modal.kind === 'edit' && (
              <div className={`${recordEditorField} max-w-xs`}>
                <Label htmlFor="province-status">{t('status')}</Label>
                <NativeSelect
                  {...native.bind('status')}
                  id="province-status"
                  className="w-full"
                  value={status}
                  onChange={(event) => {
                    if (!inFlight.current) setStatus(event.target.value as 'active' | 'inactive');
                  }}
                >
                  <option value="active">{t('active')}</option>
                  <option value="inactive">{t('inactive')}</option>
                </NativeSelect>
                <CatalogueFieldFeedback
                  id={native.errorId('status')}
                  error={native.errors.status}
                  message={t('invalidStatus')}
                  compact
                />
              </div>
            )}
          </fieldset>
        )}
        {!standalone && recovery}
        {destructive && <ConfirmationFields gate={gate} disabled={busy} />}
      </div>
      {standalone ? (
        <RecordEditorActions secondary={recovery}>{actions}</RecordEditorActions>
      ) : (
        <DialogFooter>{actions}</DialogFooter>
      )}
    </form>
  );
  if (standalone) return form;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={false}
        initialFocus={deactivating ? cancel : firstField}
        finalFocus={() => modal.trigger}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
