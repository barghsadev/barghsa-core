import { confirmationText } from '@barghsa/i18n/confirmation';
import { Link, useBlocker } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  LoadingStatus,
  Alert,
  Button,
  Input,
  Label,
  ListRefreshButton,
  NativeSelect,
  buttonVariants,
} from '@barghsa/ui';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import {
  CatalogueEditorStatus,
  SettingsValueSkeleton,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { RouteNotFound } from '../components/RouteErrorBoundary.js';
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
  greenShareText,
  greenShareValue,
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
type Kind = 'rules' | 'recovery' | 'retention' | 'template';
type RulesSection = 'rules' | 'history' | 'retention' | 'template';
type SettingsView = 'overview' | 'edit' | 'history';
const editorKeys = {
  rules: 'editRules',
  retention: 'editRetention',
  template: 'editTemplate',
} as const;
const historyKeys = {
  rules: 'recoveryTitle',
  retention: 'retentionRecoveryTitle',
  template: 'templateRecoveryTitle',
} as const;

function OverviewActions({
  section,
  ready,
  label,
}: {
  section: keyof typeof editorKeys;
  ready: boolean;
  label: Copy;
}) {
  return (
    <RecordEditorActions
      secondary={
        section !== 'rules' && (
          <Link
            to="/admin/electricity-rules/$section/{-$view}"
            params={{ section, view: 'history' }}
            disabled={!ready}
            aria-label={label(historyKeys[section])}
            className={buttonVariants({ variant: 'ghost', className: 'text-primary' })}
          >
            {label('historyAction')}
          </Link>
        )
      }
    >
      <Link
        to="/admin/electricity-rules/$section/{-$view}"
        params={{ section, view: 'edit' }}
        disabled={!ready}
        className={buttonVariants()}
      >
        {label(editorKeys[section])}
      </Link>
    </RecordEditorActions>
  );
}

const GreenRulesRecovery = lazy(() => import('../components/GreenRulesRecovery.js'));
const ElectricitySettingRecovery = lazy(
  () => import('../components/ElectricitySettingRecovery.js')
);
function GreenEditor({
  label,
  safety,
  onChanged,
  overview,
  ...props
}: CatalogueEditorProps & {
  label: Copy;
  safety: GreenSafety | null;
  onChanged: () => void;
  overview: boolean;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const formatShare = (share: number) => {
    const decimals = greenShareText(share).split('.')[1]?.length ?? 0;
    const options = { maximumFractionDigits: Math.min(decimals, 14) };
    const ratio = share / 100;
    return share > 0 && share < 1e-14
      ? `< ${numbers.percent(1e-16, options)}`
      : numbers.percent(ratio, options);
  };
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
      return greenSettingsSchema(messages, boundedCatalogueInteger, greenShareValue, captured);
    },
  });
  const rootError = catalogueRootMessage(editor.errors);
  const body = editor.action?.body;
  const setting = editor.resource.data;
  return (
    <section className="space-y-4" aria-label={label(overview ? 'title' : 'ruleEditor')}>
      <CatalogueEditorStatus
        {...editor}
        loading={editor.resource.loading}
        loadingView={
          setting ? undefined : (
            <SettingsValueSkeleton label={label('loading')} count={overview ? 2 : 1} />
          )
        }
        error={editor.resource.error}
        label={label}
      />
      {setting && overview && (
        <div className={recordEditorSurface} data-testid="saved-electricity-rules">
          <div className="grid divide-y @3xl:grid-cols-2 @3xl:divide-x @3xl:divide-y-0 @3xl:rtl:divide-x-reverse">
            {electricityModes.map((mode) => {
              const current = setting[mode];
              return (
                <section className="min-w-0 space-y-3 p-4 sm:p-5" key={mode}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{label(mode)}</h2>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                      {label(current.mandatoryGreenEnabled ? 'enabledState' : 'disabledState')}
                    </span>
                  </div>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg bg-muted/45 p-3 text-sm">
                    <dt className="text-muted-foreground">{label('threshold')}</dt>
                    <dd className="font-semibold tabular-nums">
                      <bdi>{numbers.number(current.averagePowerThresholdKw)}</bdi>
                    </dd>
                    <dt className="text-muted-foreground">{label('share')}</dt>
                    <dd className="font-semibold tabular-nums">
                      <bdi>{formatShare(current.mandatoryGreenSharePercent)}</bdi>
                    </dd>
                  </dl>
                  {safety?.[mode].blocked && (
                    <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm">
                      {label('blocked')} {safety[mode].reasons.map(label).join(' · ')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
          <OverviewActions section="rules" label={label} ready={editor.ready} />
        </div>
      )}
      {setting && !overview && (
        <form
          aria-label={label('ruleEditor')}
          noValidate
          aria-busy={editor.pending || undefined}
          className={recordEditorSurface}
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
          {rootError && (
            <Alert variant="destructive" className="m-3">
              {rootError}
            </Alert>
          )}
          <div className="grid @3xl:grid-cols-2">
            {electricityModes.map((mode) => {
              const prefix = mode === 'simpleOrder' ? 'simple' : 'advanced';
              const [enabled, setEnabled] = editor.field(`${prefix}Enabled`),
                [threshold, setThreshold] = editor.field(`${prefix}Threshold`),
                [share, setShare] = editor.field(`${prefix}Share`);
              const effectiveThreshold = boundedCatalogueInteger(
                threshold,
                0,
                Number.MAX_SAFE_INTEGER
              );
              const current = editor.resource.data?.[mode];
              const effectiveShare = greenShareValue(share);
              return (
                <fieldset
                  key={mode}
                  disabled={editor.disabled}
                  className="min-w-0 border-t px-4 py-4 first:border-t-0 sm:px-6 @3xl:border-t-0 @3xl:border-s @3xl:first:border-s-0"
                >
                  <legend className="sr-only">{label(mode)}</legend>
                  <h2 className="text-base font-semibold">{label(mode)}</h2>
                  {current && (
                    <p className="mb-2 mt-1 text-xs text-muted-foreground">
                      {label('currentRule')}{' '}
                      {current.mandatoryGreenEnabled
                        ? label('currentRuleValues')
                            .replace('{threshold}', numbers.number(current.averagePowerThresholdKw))
                            .replace('{share}', formatShare(current.mandatoryGreenSharePercent))
                        : label('disabledState')}
                    </p>
                  )}
                  {safety?.[mode].blocked && (
                    <p
                      role="alert"
                      className="mb-3 rounded border border-warning/20 bg-warning-soft p-3 text-sm text-foreground"
                    >
                      {label('blocked')} {safety[mode].reasons.map(label).join(' · ')}
                    </p>
                  )}
                  <div className="mt-2">
                    <label
                      className="touch-label flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium"
                      htmlFor={`${mode}-enabled`}
                    >
                      <input
                        id={`${mode}-enabled`}
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        {...editor.bind(`${prefix}Enabled`)}
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                      />
                      {label('enabled')}
                    </label>
                    {editor.feedback(`${prefix}Enabled`)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <div className="row-span-3 grid min-w-0 grid-rows-subgrid">
                      <Label className="self-end" htmlFor={`${mode}-threshold`}>
                        {label('threshold')}
                      </Label>
                      <Input
                        id={`${mode}-threshold`}
                        {...editor.bind(`${prefix}Threshold`)}
                        aria-required="true"
                        dir="ltr"
                        inputMode="numeric"
                        value={threshold}
                        onChange={(event) => setThreshold(event.target.value)}
                      />
                      {editor.feedback(`${prefix}Threshold`, true)}
                    </div>
                    <div className="row-span-3 grid min-w-0 grid-rows-subgrid">
                      <Label className="self-end" htmlFor={`${mode}-share`}>
                        {label('shareWithUnit')}
                      </Label>
                      <Input
                        id={`${mode}-share`}
                        {...editor.bind(`${prefix}Share`)}
                        aria-required="true"
                        dir="ltr"
                        inputMode="decimal"
                        value={share}
                        onChange={(event) => setShare(event.target.value)}
                      />
                      {editor.feedback(`${prefix}Share`, true)}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
                    <p className="font-medium">{label('quoteImpact')}</p>
                    <p className="text-muted-foreground">
                      {!enabled || effectiveShare === 0
                        ? label('quoteImpactDisabled')
                        : effectiveThreshold === null || effectiveShare === null
                          ? label('quoteImpactPending')
                          : label('quoteImpactEnabled')
                              .replace('{threshold}', numbers.number(effectiveThreshold))
                              .replace('{share}', formatShare(effectiveShare))}
                    </p>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <RecordEditorActions>
            <CatalogueSaveButton
              label={label(editor.pending ? 'working' : 'save')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </RecordEditorActions>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
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
                      <bdi>{formatShare(body[mode].mandatoryGreenSharePercent)}</bdi>
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
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
type RecoverableEditorProps = CatalogueEditorProps & {
  label: Copy;
  onRecovered: () => void;
  showHeading?: boolean;
  view?: SettingsView | undefined;
};

function RetentionEditor({
  label,
  onRecovered,
  showHeading = true,
  view,
  ...props
}: RecoverableEditorProps) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    messages = { days: label('invalidRetention') };
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const onRecoveryBusy = (busy: boolean) => {
    setRecoveryBusy(busy);
    props.onBusyChange?.(busy);
  };
  const editor = useCatalogueEditor<RetentionSetting, RetentionDraft>({
    ...props,
    disabled: props.disabled || recoveryBusy,
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
    rootError = catalogueRootMessage(editor.errors),
    setting = editor.resource.data;
  const body = editor.action?.body;
  return (
    <section aria-label={label('draftTtlTitle')} className="space-y-3">
      {showHeading && <h2 className="text-lg font-semibold">{label('draftTtlTitle')}</h2>}
      <CatalogueEditorStatus
        {...editor}
        loading={editor.resource.loading}
        loadingView={
          setting ? undefined : <SettingsValueSkeleton label={label('loading')} count={1} />
        }
        error={editor.resource.error}
        label={label}
      />
      {setting && view === 'overview' && (
        <div className={recordEditorSurface} data-testid="saved-draft-retention">
          <div className="space-y-3 px-4 py-4 sm:px-6">
            <p className="text-sm text-muted-foreground">{label('draftTtlDescription')}</p>
            <dl className="space-y-1">
              <dt className="text-sm text-muted-foreground">{label('savedValue')}</dt>
              <dd className="text-lg font-semibold [overflow-wrap:anywhere]">
                {label('retentionDaysValue').replace('{days}', numbers.number(setting.days))}
              </dd>
            </dl>
          </div>
          <OverviewActions section="retention" label={label} ready={editor.ready} />
        </div>
      )}
      {setting && view !== 'overview' && view !== 'history' && (
        <form
          aria-label={label('draftTtlTitle')}
          noValidate
          aria-busy={editor.pending || undefined}
          className={recordEditorSurface}
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
          {rootError && (
            <Alert variant="destructive" className="m-3">
              {rootError}
            </Alert>
          )}
          <p id="draft-retention-help" className="px-4 pt-4 text-sm text-muted-foreground sm:px-6">
            {label('draftTtlDescription')}
          </p>
          <fieldset
            disabled={editor.disabled}
            className="grid min-w-0 items-start gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:px-6"
          >
            <dl className="rounded-lg bg-muted/60 px-3 py-2 sm:order-last">
              <dt className="text-xs text-muted-foreground">{label('savedValue')}</dt>
              <dd className="text-base font-semibold">
                {label('retentionDaysValue').replace('{days}', numbers.number(setting.days))}
              </dd>
            </dl>
            <div className={`${recordEditorField} max-w-40`}>
              <Label htmlFor="electricity-draft-ttl">{label('draftTtlDays')}</Label>
              <Input
                id="electricity-draft-ttl"
                {...editor.bind('days')}
                aria-describedby={`draft-retention-help ${editor.bind('days')['aria-describedby'] ?? ''}`.trim()}
                dir="ltr"
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
              {editor.feedback('days', true)}
            </div>
          </fieldset>
          <RecordEditorActions
            secondary={
              !view && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={label('retentionRecoveryTitle')}
                  aria-expanded={showRecovery}
                  aria-controls={showRecovery ? 'draft-retention-recovery' : undefined}
                  disabled={props.disabled || recoveryBusy || !!editor.action}
                  onClick={() => setShowRecovery((value) => !value)}
                >
                  {label('historyAction')}
                </Button>
              )
            }
          >
            <CatalogueSaveButton
              label={label(editor.pending ? 'working' : 'draftTtlSave')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </RecordEditorActions>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-3 rounded-lg bg-muted/60 p-3">
              {setting && validRetention(body) && (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{label('savedValue')}</dt>
                    <dd>
                      {label('retentionDaysValue').replace('{days}', numbers.number(setting.days))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{label('proposedValue')}</dt>
                    <dd className="font-semibold">
                      {label('retentionDaysValue').replace('{days}', numbers.number(body.days))}
                    </dd>
                  </div>
                </dl>
              )}
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
            return confirmationText('recorded', locale);
          }}
        />
      )}
      {setting && (view === 'history' || (!view && showRecovery)) && (
        <div id="draft-retention-recovery" className={view === 'history' ? 'min-w-0' : undefined}>
          <Suspense fallback={<LoadingStatus>{label('settingsRecoveryLoading')}</LoadingStatus>}>
            <ElectricitySettingRecovery
              setting="wizard-draft-ttl"
              showRevisions={view === 'history'}
              label={label}
              disabled={
                props.disabled ||
                !!editor.action ||
                (view === 'history' && (editor.resource.loading || !!editor.resource.error))
              }
              onBusyChange={onRecoveryBusy}
              onDenied={editor.deny}
              onActivated={onRecovered}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}
function TemplateEditor({
  label,
  onRecovered,
  showHeading = true,
  view,
  ...props
}: RecoverableEditorProps) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    messages = { versionId: label('invalidTemplate') };
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const onRecoveryBusy = (busy: boolean) => {
    setRecoveryBusy(busy);
    props.onBusyChange?.(busy);
  };
  const editor = useCatalogueEditor<TemplateSetting, TemplateDraft>({
    ...props,
    disabled: props.disabled || recoveryBusy,
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
    rootError = catalogueRootMessage(editor.errors),
    setting = editor.resource.data;
  const body = editor.action?.body,
    selected = record(body)
      ? setting?.options.find((option) => option.id === body.versionId)
      : null,
    current = setting?.options.find((option) => option.id === setting.selectedVersionId);
  const optionLabel = (option: TemplateSetting['options'][number] | null | undefined) =>
    option
      ? [
          option.name,
          `${label('templateVersion')} ${numbers.number(option.versionNumber)}`,
          ...(!option.active ? [label('templateInactive')] : []),
          ...(!option.supported ? [label('templateUnsupported')] : []),
        ].join(' · ')
      : label('templateNone');
  return (
    <section aria-label={label('templateTitle')} className="space-y-3">
      {showHeading && <h2 className="text-lg font-semibold">{label('templateTitle')}</h2>}
      <CatalogueEditorStatus
        {...editor}
        loading={editor.resource.loading}
        loadingView={
          setting ? undefined : <SettingsValueSkeleton label={label('loading')} count={1} />
        }
        error={editor.resource.error}
        label={label}
      />
      {setting && view === 'overview' && (
        <div className={recordEditorSurface} data-testid="saved-electricity-template">
          <div className="space-y-3 px-4 py-4 sm:px-6">
            <p className="text-sm text-muted-foreground">{label('templateDescription')}</p>
            <dl className="space-y-1">
              <dt className="text-sm text-muted-foreground">{label('savedValue')}</dt>
              <dd className="text-lg font-semibold [overflow-wrap:anywhere]">
                <bdi dir="auto">{optionLabel(current)}</bdi>
              </dd>
            </dl>
          </div>
          <OverviewActions section="template" label={label} ready={editor.ready} />
        </div>
      )}
      {setting && view !== 'overview' && view !== 'history' && (
        <form
          aria-label={label('templateTitle')}
          noValidate
          aria-busy={editor.pending || undefined}
          className={recordEditorSurface}
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
          {rootError && (
            <Alert variant="destructive" className="m-3">
              {rootError}
            </Alert>
          )}
          <p className="px-4 pt-4 text-sm text-muted-foreground sm:px-6">
            {label('templateDescription')}
          </p>
          <fieldset
            disabled={editor.disabled}
            className="grid min-w-0 items-start gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:px-6"
          >
            <dl className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 sm:order-last">
              <dt className="text-xs text-muted-foreground">{label('savedValue')}</dt>
              <dd className="text-sm font-semibold [overflow-wrap:anywhere]" dir="auto">
                {optionLabel(current)}
              </dd>
            </dl>
            <div className={recordEditorField}>
              <Label htmlFor="electricity-contract-template">{label('templateLabel')}</Label>
              <NativeSelect
                id="electricity-contract-template"
                {...editor.bind('versionId')}
                aria-describedby={`electricity-template-help ${editor.bind('versionId')['aria-describedby'] ?? ''}`.trim()}
                className="w-full"
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
                    {optionLabel(option)}
                  </option>
                ))}
              </NativeSelect>
              <p
                id="electricity-template-help"
                className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
              >
                {label('templatePlaceholders')}
              </p>
              {editor.feedback('versionId', true)}
            </div>
          </fieldset>
          <RecordEditorActions
            secondary={
              !view && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={label('templateRecoveryTitle')}
                  aria-expanded={showRecovery}
                  aria-controls={showRecovery ? 'contract-template-recovery' : undefined}
                  disabled={props.disabled || recoveryBusy || !!editor.action}
                  onClick={() => setShowRecovery((value) => !value)}
                >
                  {label('historyAction')}
                </Button>
              )
            }
          >
            <CatalogueSaveButton
              label={label(editor.pending ? 'working' : 'templateSave')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </RecordEditorActions>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-3 rounded-lg bg-muted/60 p-3">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{label('savedValue')}</dt>
                  <dd className="[overflow-wrap:anywhere]" dir="auto">
                    {optionLabel(current)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{label('proposedValue')}</dt>
                  <dd className="font-semibold [overflow-wrap:anywhere]" dir="auto">
                    {optionLabel(selected)}
                  </dd>
                </div>
              </dl>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesTemplateReceipt(result, body))) return;
            editor.resource.accept(result as TemplateSetting);
            editor.complete();
            editor.resource.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
      {setting && (view === 'history' || (!view && showRecovery)) && (
        <div id="contract-template-recovery" className={view === 'history' ? 'min-w-0' : undefined}>
          <Suspense fallback={<LoadingStatus>{label('settingsRecoveryLoading')}</LoadingStatus>}>
            <ElectricitySettingRecovery
              setting="electricity-contract-template"
              showRevisions={view === 'history'}
              options={setting.options}
              label={label}
              disabled={
                props.disabled ||
                !!editor.action ||
                (view === 'history' && (editor.resource.loading || !!editor.resource.error))
              }
              onBusyChange={onRecoveryBusy}
              onDenied={editor.deny}
              onActivated={onRecovered}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}
export function RoutedElectricitySettings({
  sectionParam,
  viewParam,
}: {
  sectionParam: string;
  viewParam: string | undefined;
}) {
  if (sectionParam === 'rules' && viewParam === 'edit')
    return <AdminElectricityRulesPage section="rules" view="edit" />;
  if (sectionParam === 'history' && viewParam === undefined)
    return <AdminElectricityRulesPage section="history" view="history" />;
  if (
    (sectionParam === 'retention' || sectionParam === 'template') &&
    (viewParam === undefined || viewParam === 'edit' || viewParam === 'history')
  )
    return <AdminElectricityRulesPage section={sectionParam} view={viewParam ?? 'overview'} />;
  return <RouteNotFound />;
}

function ProtectElectricitySettingsNavigation({ busy }: { busy: boolean }) {
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: () => busy });
  return null;
}

export default function AdminElectricityRulesPage({
  section,
  view,
}: { section?: RulesSection; view?: SettingsView } = {}) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.green.${key}`, locale);
  const [revision, setRevision] = useState(0),
    [active, setActive] = useState<Kind | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const rules = !section || section === 'rules';
  const focusedView = view === 'edit' || (view === 'history' && section !== 'history');
  useEffect(() => {
    if (focusedView) heading.current?.focus({ preventScroll: true });
  }, [focusedView]);
  const sectionNames = {
    rules: 'title',
    history: 'recoveryTitle',
    retention: 'draftTtlTitle',
    template: 'templateTitle',
  } as const;
  const title =
    section && section !== 'history'
      ? view === 'edit'
        ? editorKeys[section]
        : view === 'history'
          ? historyKeys[section]
          : sectionNames[section]
      : section
        ? sectionNames[section]
        : 'title';
  const backLink =
    'touch-action w-fit text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60';
  const navLink =
    'touch-action flex items-center justify-center rounded-lg px-3 py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
  const scope = useCatalogueScope(
    useCallback(() => {
      setActive(null);
      setShowRecovery(false);
    }, [])
  );
  const safety = useCatalogueResource(
    scope,
    rules ? `${base}/green-electricity-rules/safety-status` : null,
    validGreenSafety
  );
  useEffect(() => {
    if (revision) safety.retry();
  }, [revision, safety.retry]);
  const rulesBusy = useCallback(
    (busy: boolean) => setActive((value) => (busy ? 'rules' : value === 'rules' ? null : value)),
    []
  );
  const recoveryBusy = useCallback(
    (busy: boolean) =>
      setActive((value) => (busy ? 'recovery' : value === 'recovery' ? null : value)),
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
    <section
      className={`@container mx-auto min-w-0 space-y-4 ${section === 'retention' || section === 'template' ? 'max-w-3xl' : 'max-w-5xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {view && <ProtectElectricitySettingsNavigation busy={active !== null} />}
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0 space-y-1">
          {focusedView &&
            (section === 'retention' || section === 'template' ? (
              <Link
                to="/admin/electricity-rules/$section/{-$view}"
                params={{ section, view: undefined }}
                disabled={active !== null}
                className={backLink}
              >
                {label(sectionNames[section])}
              </Link>
            ) : (
              <Link to="/admin/electricity-rules" disabled={active !== null} className={backLink}>
                {label(sectionNames.rules)}
              </Link>
            ))}
          <h1
            ref={heading}
            tabIndex={focusedView ? -1 : undefined}
            className="text-2xl font-semibold"
          >
            {label(title)}
          </h1>
          {rules && <p className="text-sm text-muted-foreground">{label('description')}</p>}
        </div>
        {(view !== 'history' || scope.denied) && section !== 'history' && (
          <ListRefreshButton
            label={label('refresh')}
            onClick={() => {
              if (scope.denied) scope.recover();
              setRevision((value) => value + 1);
            }}
          />
        )}
      </header>
      {section && !focusedView && (
        <nav
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted/80 p-1 sm:flex sm:w-fit sm:flex-wrap"
          aria-label={label('title')}
        >
          <Link
            to="/admin/electricity-rules"
            disabled={active !== null}
            activeOptions={{ exact: true }}
            aria-current={section === 'rules' ? 'page' : undefined}
            aria-label={label('quoteRules')}
            className={navLink}
          >
            {label('rulesNav')}
          </Link>
          {(['retention', 'template', 'history'] as const).map((item) => (
            <Link
              key={item}
              to="/admin/electricity-rules/$section/{-$view}"
              params={{ section: item, view: undefined }}
              disabled={active !== null}
              activeOptions={{ exact: true }}
              aria-current={section === item ? 'page' : undefined}
              aria-label={label(sectionNames[item])}
              className={navLink}
            >
              {label(`${item}Nav`)}
            </Link>
          ))}
        </nav>
      )}
      {scope.denied ? (
        <Alert variant="destructive">{label('forbidden')}</Alert>
      ) : (
        <>
          {rules && (
            <>
              <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
                {label('snapshot')}
              </p>
              {safety.loading && <LoadingStatus>{label('safetyLoading')}</LoadingStatus>}
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
                overview={view === 'overview'}
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
            </>
          )}
          {!section && (
            <Button
              type="button"
              variant="outline"
              aria-expanded={showRecovery}
              aria-controls={showRecovery ? 'green-rule-recovery' : undefined}
              disabled={active !== null}
              onClick={() => setShowRecovery((value) => !value)}
            >
              {label('recoveryTitle')}
            </Button>
          )}
          {(section === 'history' || showRecovery) && (
            <div id="green-rule-recovery">
              <Suspense fallback={<LoadingStatus>{label('recoveryLoading')}</LoadingStatus>}>
                <GreenRulesRecovery
                  label={label}
                  disabled={!!active && active !== 'recovery'}
                  onBusyChange={recoveryBusy}
                  onDenied={scope.deny}
                  onActivated={() => setRevision((value) => value + 1)}
                  showRevisions={section === 'history'}
                />
              </Suspense>
            </div>
          )}
          {(!section || section === 'retention') && (
            <RetentionEditor
              label={label}
              view={view}
              showHeading={!section}
              disabled={!!active && active !== 'retention'}
              onBusyChange={retentionBusy}
              onDenied={scope.deny}
              onRecovered={() => setRevision((value) => value + 1)}
              refreshVersion={revision}
            />
          )}
          {(!section || section === 'template') && (
            <TemplateEditor
              label={label}
              view={view}
              showHeading={!section}
              disabled={!!active && active !== 'template'}
              onBusyChange={templateBusy}
              onDenied={scope.deny}
              onRecovered={() => setRevision((value) => value + 1)}
              refreshVersion={revision}
            />
          )}
        </>
      )}
    </section>
  );
}
