import { lazy, Suspense, useState } from 'react';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { Alert, Input, Label, ListRefreshButton, LoadingStatus } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor } from '../hooks/useCatalogueEditor.js';
import type { FinancialLimitViewProps } from '../pages/AdminFinancialLimitPage.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import {
  CatalogueEditorStatus,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import {
  limitAmount,
  validThreshold,
  thresholdDefaults,
  thresholdValues,
  thresholdBasis,
  thresholdFields,
  matchesThresholdReceipt,
  type ThresholdSetting,
  type ThresholdDraft,
} from '../lib/limit-settings-form.js';
const DualApprovalThresholdRecovery = lazy(() => import('./DualApprovalThresholdRecovery.js'));
const path = '/api/admin/config/dual-approval-threshold';
export default function DualApprovalThresholdPanel({
  view = 'edit',
  overviewActions,
  ...props
}: FinancialLimitViewProps = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) =>
    t(`admin.receiptThreshold.${key === 'readError' ? 'unavailable' : key}`, locale);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const messages = { thresholdIrR: label('invalid') };
  const editor = useCatalogueEditor<ThresholdSetting, ThresholdDraft>({
    ...props,
    disabled: props.disabled || recoveryPending,
    identity: 'dual-approval-threshold',
    path,
    validate: validThreshold,
    basis: thresholdBasis,
    defaults: thresholdDefaults,
    values: thresholdValues,
    messages,
    label,
    schema: async () => {
      const { integerSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return integerSettingsSchema<ThresholdDraft>(messages, thresholdFields, limitAmount);
    },
  });
  const [raw, setRaw] = editor.field('thresholdIrR'),
    value = limitAmount(raw),
    error = catalogueRootMessage(editor.errors),
    body = editor.action?.body;
  const current = editor.resource.data;
  const thresholdBinding = editor.bind('thresholdIrR');
  if (editor.denied) return null;
  return (
    <section
      aria-labelledby="receipt-threshold-title"
      className={recordEditorSurface}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="space-y-2 px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 id="receipt-threshold-title" className="text-base font-semibold">
              {label(view === 'edit' ? 'title' : 'current')}
            </h2>
            <p id="receipt-threshold-hint" className="text-sm text-muted-foreground">
              {label('description')}
            </p>
          </div>
          {!editor.resource.error && (
            <ListRefreshButton
              label={label(editor.uncertain ? 'retry' : 'reloadValue')}
              disabled={editor.busy}
              refreshing={editor.resource.loading}
              onClick={editor.refresh}
            />
          )}
        </div>
        {view !== 'overview' && <p className="text-sm text-muted-foreground">{label('stepUp')}</p>}
        <CatalogueEditorStatus
          {...editor}
          label={label}
          loading={editor.resource.loading}
          error={editor.resource.error}
        />
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
      {current && view !== 'edit' && (
        <>
          <div className="space-y-2 border-t px-4 py-4 sm:px-6">
            <dl className="space-y-1" data-testid="approval-threshold-current">
              <dt className="sr-only">{label('current')}</dt>
              <dd className="break-words text-xl font-semibold tabular-nums">
                {numbers.money(current.thresholdIrR)}
              </dd>
            </dl>
            {current.thresholdIrR === 0 && (
              <p role="note" className="rounded-md bg-warning-soft px-2.5 py-2 text-sm">
                {label('disabled')}
              </p>
            )}
          </div>
          {view === 'overview' && overviewActions?.(editor.ready)}
        </>
      )}
      {current && view === 'edit' && (
        <form
          noValidate
          aria-label={label('title')}
          aria-busy={editor.pending || undefined}
          className="border-t"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              ...(limitAmount(draft.thresholdIrR) === 0 ? { risk: 'destructive' as const } : {}),
              title: label('save'),
              description: label(
                limitAmount(draft.thresholdIrR) === 0 ? 'disabled' : 'description'
              ),
              path,
              method: 'PUT',
              body: { threshold_irr: limitAmount(draft.thresholdIrR) },
              requiresOtp: true,
            }))
          }
        >
          <fieldset disabled={editor.disabled} className="m-0 min-w-0 border-0 p-0">
            <div className={`${recordEditorGrid} items-start gap-y-3 px-4 py-4 sm:px-6`}>
              <div className={recordEditorField}>
                <Label htmlFor="receipt-threshold">{label('label')}</Label>
                <Input
                  id="receipt-threshold"
                  {...thresholdBinding}
                  className="max-w-56 tabular-nums"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  aria-describedby={[
                    'receipt-threshold-hint',
                    'receipt-threshold-value',
                    thresholdBinding['aria-describedby'],
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
                <p
                  id="receipt-threshold-value"
                  className="break-words text-sm text-muted-foreground"
                >
                  {value === null ? '—' : numbers.money(value)}
                </p>
                {editor.feedback('thresholdIrR')}
                {value === 0 && (
                  <p className="rounded-md bg-warning-soft px-2.5 py-2 text-sm" role="note">
                    {label('disabled')}
                  </p>
                )}
              </div>
              <dl className="min-w-0 rounded-lg bg-muted/45 px-3 py-2.5">
                <dt className="text-sm text-muted-foreground">{label('current')}</dt>
                <dd className="break-words font-semibold tabular-nums">
                  {numbers.money(current.thresholdIrR)}
                </dd>
              </dl>
            </div>
            <RecordEditorActions>
              <CatalogueSaveButton
                label={label(editor.pending ? 'working' : 'save')}
                pending={editor.pending}
                disabled={editor.disabled}
              />
            </RecordEditorActions>
          </fieldset>
        </form>
      )}
      {current && view === 'history' && (
        <div id="dual-approval-threshold-recovery" className="border-t px-4 py-4 sm:px-6">
          <Suspense fallback={<LoadingStatus>{label('loading')}</LoadingStatus>}>
            <DualApprovalThresholdRecovery
              path={path}
              label={label}
              disabled={
                !!props.disabled ||
                editor.busy ||
                editor.uncertain ||
                editor.resource.loading ||
                !!editor.resource.error
              }
              onBusyChange={(busy) => {
                setRecoveryPending(busy);
                props.onBusyChange?.(busy);
              }}
              onDenied={editor.onDenied}
              onActivated={editor.resource.retry}
            />
          </Suspense>
        </div>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          confirmationDisabled={!editor.ready || editor.uncertain}
          summary={
            <div className="space-y-2 rounded border p-3">
              <dl className="space-y-2 text-sm">
                {current && (
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <dt className="text-muted-foreground">{label('current')}</dt>
                    <dd>
                      <bdi>{numbers.money(current.thresholdIrR)}</bdi>
                    </dd>
                  </div>
                )}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
                  <dt>{label('proposed')}</dt>
                  <dd className="font-semibold">
                    <bdi>
                      {numbers.money(Number((body as { threshold_irr: number }).threshold_irr))}
                    </bdi>
                  </dd>
                </div>
              </dl>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesThresholdReceipt(result, body))) return;
            editor.resource.accept(result as ThresholdSetting);
            editor.complete();
            editor.resource.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
