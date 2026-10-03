import { useCallback, useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor, type CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { boundedCatalogueInteger, record } from '../lib/catalogue-form.js';
import {
  electricityModes,
  greenDefaults,
  greenValues,
  greenBody,
  greenBasis,
  greenSafetyBasis,
  validGreenConfig,
  validGreenSafety,
  matchesGreenReceipt,
  retentionDefaults,
  retentionValues,
  retentionBasis,
  validRetention,
  templateDefaults,
  templateValues,
  templateBasis,
  validTemplateSetting,
  matchesTemplateReceipt,
  type GreenDraft,
  type GreenSafety,
  type RetentionDraft,
  type RetentionSetting,
  type TemplateDraft,
  type TemplateSetting,
} from '../lib/electricity-settings-form.js';
const base = '/api/admin/config';
type Copy = (key: string) => string;
type Kind = 'rules' | 'retention' | 'template';
function EditorStatus({
  label,
  loading,
  error,
  denied,
  saved,
  uncertain,
  refresh,
  busy,
}: {
  label: Copy;
  loading: boolean;
  error: boolean;
  denied: boolean;
  saved: boolean;
  uncertain: boolean;
  refresh: () => void;
  busy: boolean;
}) {
  return (
    <>
      {loading && <p role="status">{label('loading')}</p>}
      {denied && <Alert variant="destructive">{label('forbidden')}</Alert>}
      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive p-3">
          <p>{label('readError')}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
            {label('retry')}
          </Button>
        </div>
      )}
      {saved && <p role="status">{label('saved')}</p>}
      {uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
    </>
  );
}
function SaveButton({
  label,
  pending,
  disabled,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled} aria-busy={pending || undefined}>
      {pending && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {label}
    </Button>
  );
}
function rootMessage(errors: {
  root?: Record<string, { message?: string }> & { message?: string };
}) {
  return errors.root?.validation?.message ?? errors.root?.message;
}
function GreenEditor({
  label,
  safety,
  onChanged,
  ...props
}: CatalogueEditorProps & { label: Copy; safety: GreenSafety | null; onChanged: () => void }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const messages: Record<keyof GreenDraft, string> = {
    simpleEnabled: label('invalidActivation'),
    advancedEnabled: label('invalidActivation'),
    simpleThreshold: label('invalidThreshold'),
    advancedThreshold: label('invalidThreshold'),
    simpleShare: label('invalidShare'),
    advancedShare: label('invalidShare'),
  };
  const editor = useCatalogueEditor<GreenElectricityConfig, GreenDraft>({
    ...props,
    identity: 'green-electricity-rules',
    path: `${base}/green-electricity-rules`,
    validate: validGreenConfig,
    basis: greenBasis,
    defaults: greenDefaults,
    values: greenValues,
    messages,
    label,
    schema: async () => {
      const captured = safety;
      const { greenSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return greenSettingsSchema(messages, boundedCatalogueInteger, captured);
    },
  });
  const rootError = rootMessage(editor.errors);
  const body = editor.action?.body;
  return (
    <section className="space-y-4" aria-label={label('ruleEditor')}>
      <EditorStatus
        {...editor}
        loading={editor.resource.loading}
        error={editor.resource.error}
        label={label}
      />
      {editor.resource.data && (
        <form
          aria-label={label('ruleEditor')}
          noValidate
          aria-busy={editor.pending || undefined}
          className="space-y-5"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('save'),
              description: label('confirm'),
              path: `${base}/green-electricity-rules`,
              method: 'PUT',
              body: greenBody(draft),
              forbiddenMessage: label('forbidden'),
              errorMessages: {
                'VALIDATION:INPUT:INVALID': label('activationFailed'),
                'CONFIG:STORED_VALUE_INVALID': label('corrupt'),
              },
            }))
          }
        >
          {rootError && <Alert variant="destructive">{rootError}</Alert>}
          <div className="grid gap-5 lg:grid-cols-2">
            {electricityModes.map((mode) => {
              const prefix = mode === 'simpleOrder' ? 'simple' : 'advanced';
              const [enabled, setEnabled] = editor.field(`${prefix}Enabled`),
                [threshold, setThreshold] = editor.field(`${prefix}Threshold`),
                [share, setShare] = editor.field(`${prefix}Share`);
              return (
                <fieldset
                  key={mode}
                  disabled={editor.disabled}
                  className="min-w-0 space-y-4 rounded-lg border bg-card p-5 text-card-foreground"
                >
                  <legend className="px-2 text-lg font-semibold">{label(mode)}</legend>
                  {safety?.[mode].blocked && (
                    <p
                      role="alert"
                      className="rounded border border-warning/20 bg-warning-soft p-3 text-foreground"
                    >
                      {label('blocked')} {safety[mode].reasons.map(label).join(' · ')}
                    </p>
                  )}
                  <div>
                    <label className="flex items-center gap-2" htmlFor={`${mode}-enabled`}>
                      <input
                        id={`${mode}-enabled`}
                        type="checkbox"
                        {...editor.bind(`${prefix}Enabled`)}
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                      />
                      {label('enabled')}
                    </label>
                    {editor.feedback(`${prefix}Enabled`)}
                  </div>
                  <div>
                    <Label htmlFor={`${mode}-threshold`}>{label('threshold')}</Label>
                    <Input
                      id={`${mode}-threshold`}
                      {...editor.bind(`${prefix}Threshold`)}
                      dir="ltr"
                      inputMode="numeric"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                    />
                    {editor.feedback(`${prefix}Threshold`)}
                  </div>
                  <div>
                    <Label htmlFor={`${mode}-share`}>
                      {label('share')}: {numbers.percent(share / 100)}
                    </Label>
                    <input
                      id={`${mode}-share`}
                      {...editor.bind(`${prefix}Share`)}
                      className="w-full"
                      type="range"
                      min={0}
                      max={100}
                      step={0.1}
                      aria-valuetext={numbers.percent(share / 100)}
                      value={share}
                      onChange={(event) => setShare(Number(event.target.value))}
                    />
                    {editor.feedback(`${prefix}Share`)}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <SaveButton
            label={label(editor.pending ? 'working' : 'save')}
            pending={editor.pending}
            disabled={editor.disabled}
          />
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-3 rounded-md border p-3">
              {validGreenConfig(body) &&
                electricityModes.map((mode) => (
                  <div key={mode}>
                    <p className="font-medium">
                      {label(mode)}:{' '}
                      {label(body[mode].mandatoryGreenEnabled ? 'enabledState' : 'disabledState')}
                    </p>
                    <p>
                      {label('threshold')}:{' '}
                      <bdi>{numbers.number(body[mode].averagePowerThresholdKw)}</bdi>
                    </p>
                    <p>
                      {label('share')}:{' '}
                      <bdi>{numbers.percent(body[mode].mandatoryGreenSharePercent / 100)}</bdi>
                    </p>
                  </div>
                ))}
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesGreenReceipt(result, body))) return;
            editor.resource.accept(result as GreenElectricityConfig);
            editor.complete();
            editor.resource.retry();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
function RetentionEditor({ label, ...props }: CatalogueEditorProps & { label: Copy }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    messages = { days: label('invalidRetention') };
  const editor = useCatalogueEditor<RetentionSetting, RetentionDraft>({
    ...props,
    identity: 'wizard-draft-ttl',
    path: `${base}/wizard-draft-ttl`,
    validate: validRetention,
    basis: retentionBasis,
    defaults: retentionDefaults,
    values: retentionValues,
    messages,
    label,
    schema: async () => {
      const { retentionSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return retentionSettingsSchema(messages, boundedCatalogueInteger);
    },
  });
  const [days, setDays] = editor.field('days'),
    rootError = rootMessage(editor.errors);
  const body = editor.action?.body;
  return (
    <section
      aria-label={label('draftTtlTitle')}
      className="space-y-3 rounded-lg border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">{label('draftTtlTitle')}</h2>
      <p className="text-sm text-muted-foreground">{label('draftTtlDescription')}</p>
      <EditorStatus
        {...editor}
        loading={editor.resource.loading}
        error={editor.resource.error}
        label={label}
      />
      {editor.resource.data && (
        <form
          aria-label={label('draftTtlTitle')}
          noValidate
          aria-busy={editor.pending || undefined}
          className="space-y-3"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('draftTtlTitle'),
              description: label('draftTtlConfirm'),
              path: `${base}/wizard-draft-ttl`,
              method: 'PUT',
              body: { days: boundedCatalogueInteger(draft.days, 1, 365) },
              forbiddenMessage: label('forbidden'),
            }))
          }
        >
          {rootError && <Alert variant="destructive">{rootError}</Alert>}
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-3 border-0 p-0">
            <div className="max-w-xs">
              <Label htmlFor="electricity-draft-ttl">{label('draftTtlDays')}</Label>
              <Input
                id="electricity-draft-ttl"
                {...editor.bind('days')}
                dir="ltr"
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
              {editor.feedback('days')}
            </div>
            <SaveButton
              label={label(editor.pending ? 'working' : 'draftTtlSave')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </fieldset>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          summary={
            <div className="rounded-md border p-3">
              <p>
                {label('draftTtlDays')}:{' '}
                <bdi>{validRetention(body) ? numbers.number(body.days) : ''}</bdi>
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (
              !editor.verifyReceipt(
                validRetention(result) && validRetention(body) && result.days === body.days
              )
            )
              return;
            editor.resource.accept(result as RetentionSetting);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
function TemplateEditor({ label, ...props }: CatalogueEditorProps & { label: Copy }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    messages = { versionId: label('invalidTemplate') };
  const editor = useCatalogueEditor<TemplateSetting, TemplateDraft>({
    ...props,
    identity: 'electricity-contract-template',
    path: `${base}/electricity-contract-template`,
    validate: validTemplateSetting,
    basis: templateBasis,
    defaults: templateDefaults,
    values: templateValues,
    messages,
    label,
    schema: async (setting) => {
      const options = setting?.options ?? [];
      const { templateSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return templateSettingsSchema(messages, options);
    },
  });
  const [versionId, setVersionId] = editor.field('versionId'),
    rootError = rootMessage(editor.errors),
    setting = editor.resource.data;
  const body = editor.action?.body,
    selected = record(body)
      ? setting?.options.find((option) => option.id === body.versionId)
      : null;
  return (
    <section
      aria-label={label('templateTitle')}
      className="space-y-3 rounded-lg border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">{label('templateTitle')}</h2>
      <p className="text-sm text-muted-foreground">{label('templateDescription')}</p>
      <EditorStatus
        {...editor}
        loading={editor.resource.loading}
        error={editor.resource.error}
        label={label}
      />
      {setting && (
        <form
          aria-label={label('templateTitle')}
          noValidate
          aria-busy={editor.pending || undefined}
          className="space-y-3"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('templateTitle'),
              description: label('templateConfirm'),
              path: `${base}/electricity-contract-template`,
              method: 'PUT',
              body: draft,
              forbiddenMessage: label('forbidden'),
            }))
          }
        >
          {rootError && <Alert variant="destructive">{rootError}</Alert>}
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-3 border-0 p-0">
            <div className="max-w-lg">
              <Label htmlFor="electricity-contract-template">{label('templateLabel')}</Label>
              <select
                id="electricity-contract-template"
                {...editor.bind('versionId')}
                className="w-full rounded-md border bg-background px-3 py-2 text-foreground"
                value={versionId ?? ''}
                onChange={(event) => setVersionId(event.target.value || null)}
              >
                <option value="">{label('templateNone')}</option>
                {setting.options.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={!option.active || !option.supported}
                  >
                    {option.name} · {label('templateVersion')}{' '}
                    {numbers.number(option.versionNumber)}
                    {!option.active ? ` · ${label('templateInactive')}` : ''}
                    {!option.supported ? ` · ${label('templateUnsupported')}` : ''}
                  </option>
                ))}
              </select>
              {editor.feedback('versionId')}
            </div>
            <p className="text-sm text-muted-foreground">{label('templatePlaceholders')}</p>
            <SaveButton
              label={label(editor.pending ? 'working' : 'templateSave')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </fieldset>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          summary={
            <div className="rounded-md border p-3">
              <p className="break-words">
                {selected
                  ? `${selected.name} · ${label('templateVersion')} ${numbers.number(selected.versionNumber)}`
                  : label('templateNone')}
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesTemplateReceipt(result, body))) return;
            editor.resource.accept(result as TemplateSetting);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
export default function AdminElectricityRulesPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.green.${key}`, locale);
  const [revision, setRevision] = useState(0),
    [active, setActive] = useState<Kind | null>(null);
  const scope = useCatalogueScope(useCallback(() => setActive(null), []));
  const safety = useCatalogueResource(
    scope,
    `${base}/green-electricity-rules/safety-status`,
    validGreenSafety
  );
  useEffect(() => {
    if (revision) safety.retry();
  }, [revision, safety.retry]);
  const rulesBusy = useCallback(
    (busy: boolean) => setActive((value) => (busy ? 'rules' : value === 'rules' ? null : value)),
    []
  );
  const retentionBusy = useCallback(
    (busy: boolean) =>
      setActive((value) => (busy ? 'retention' : value === 'retention' ? null : value)),
    []
  );
  const templateBusy = useCallback(
    (busy: boolean) =>
      setActive((value) => (busy ? 'template' : value === 'template' ? null : value)),
    []
  );
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (scope.denied) scope.recover();
            setRevision((value) => value + 1);
          }}
        >
          {label('refresh')}
        </Button>
      </header>
      {scope.denied ? (
        <Alert variant="destructive">{label('forbidden')}</Alert>
      ) : (
        <>
          <p className="rounded border bg-card p-3 text-card-foreground">{label('snapshot')}</p>
          {safety.loading && <p role="status">{label('safetyLoading')}</p>}
          {safety.error && (
            <div role="alert" className="space-y-2">
              <p>{label('safetyError')}</p>
              <Button variant="outline" onClick={safety.retry}>
                {label('retry')}
              </Button>
            </div>
          )}
          <GreenEditor
            label={label}
            safety={safety.data}
            onChanged={safety.retry}
            contextBasis={greenSafetyBasis(safety.data)}
            disabled={
              (!!active && active !== 'rules') || !safety.data || safety.loading || safety.error
            }
            onBusyChange={rulesBusy}
            onDenied={scope.deny}
            refreshVersion={revision}
          />
          <RetentionEditor
            label={label}
            disabled={!!active && active !== 'retention'}
            onBusyChange={retentionBusy}
            onDenied={scope.deny}
            refreshVersion={revision}
          />
          <TemplateEditor
            label={label}
            disabled={!!active && active !== 'template'}
            onBusyChange={templateBusy}
            onDenied={scope.deny}
            refreshVersion={revision}
          />
        </>
      )}
    </section>
  );
}
