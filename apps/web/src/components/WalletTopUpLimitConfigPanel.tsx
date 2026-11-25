import { lazy, Suspense, useState } from 'react';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tWalletLimit as t } from '@barghsa/i18n/wallet-limit';
import { Alert, Input, Label, ListRefreshButton, LoadingStatus } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor } from '../hooks/useCatalogueEditor.js';
import type { FinancialLimitViewProps } from '../pages/AdminFinancialLimitPage.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import {
  RecordEditorActions,
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
  validWalletLimit,
  walletLimitDefaults,
  walletLimitValues,
  walletLimitBasis,
  walletLimitFields,
  matchesWalletLimitReceipt,
  type WalletLimitSetting,
  type WalletLimitDraft,
} from '../lib/limit-settings-form.js';
const WalletLimitRecovery = lazy(() => import('./WalletLimitRecovery.js'));
const path = '/api/admin/config/wallet-top-up-limit';

export default function WalletTopUpLimitConfigPanel({
  view = 'edit',
  overviewActions,
  ...props
}: FinancialLimitViewProps = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) =>
    t(
      `admin.walletLimit.${({ readError: 'loadFailed', retry: 'reload', working: 'saving' } as Record<string, string>)[key] ?? key}`,
      locale
    ).replace('{max}', numbers.number(Number.MAX_SAFE_INTEGER));
  const [recoveryPending, setRecoveryPending] = useState(false);
  const messages = { limitIrR: label('invalid') };
  const editor = useCatalogueEditor<WalletLimitSetting, WalletLimitDraft>({
    ...props,
    disabled: props.disabled || recoveryPending,
    identity: 'wallet-top-up-limit',
    path,
    validate: validWalletLimit,
    basis: walletLimitBasis,
    defaults: walletLimitDefaults,
    values: walletLimitValues,
    messages,
    label,
    schema: async () => {
      const { integerSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return integerSettingsSchema<WalletLimitDraft>(messages, walletLimitFields, limitAmount);
    },
  });
  const [raw, setRaw] = editor.field('limitIrR'),
    value = limitAmount(raw),
    error = catalogueRootMessage(editor.errors),
    body = editor.action?.body;
  const current = editor.resource.data;
  if (editor.denied) return null;
  return (
    <section
      className={recordEditorSurface}
      data-testid="wallet-top-up-limit-panel"
      aria-labelledby="wallet-top-up-limit-heading"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="space-y-3 px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="wallet-top-up-limit-heading" className="text-base font-semibold">
              {label(view === 'edit' ? 'title' : 'current')}
            </h2>
            <p className="text-sm text-muted-foreground">{label('description')}</p>
          </div>
          {!editor.resource.error && (
            <ListRefreshButton
              label={label('reload')}
              disabled={editor.busy}
              refreshing={editor.resource.loading}
              onClick={editor.refresh}
            />
          )}
        </div>
        <p
          className="rounded-lg border border-warning/20 bg-warning-soft px-3 py-2 text-sm"
          role="note"
          id="online-top-up-limit-warning"
          data-testid="wallet-top-up-limit-warning"
        >
          {label('warning')}
        </p>
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
            <dl data-testid="wallet-top-up-limit-current" className="space-y-1">
              <dt className="sr-only">{label('current')}</dt>
              <dd className="break-words text-xl font-semibold tabular-nums">
                {numbers.money(current.limitIrR)}
              </dd>
              <dd className="text-sm text-muted-foreground">
                {label('version').replace('{version}', numbers.number(current.version))}
              </dd>
            </dl>
            {current.limitIrR === 0 && (
              <p role="note" className="text-sm text-destructive">
                {label('blockedCurrent')}
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
              ...(limitAmount(draft.limitIrR) === 0 ? { risk: 'destructive' as const } : {}),
              title: label('save'),
              description: label('warning'),
              path,
              method: 'PUT',
              body: { limit_irr: limitAmount(draft.limitIrR), expected_version: current.version },
              conflictMessage: label('conflict'),
            }))
          }
        >
          <fieldset disabled={editor.disabled} className="min-w-0 border-0 p-0">
            <div className={`${recordEditorGrid} items-start gap-y-4 px-4 py-4 sm:px-6`}>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="online-top-up-limit">{label('label')}</Label>
                <Input
                  id="online-top-up-limit"
                  data-testid="wallet-top-up-limit-input"
                  {...editor.bind('limitIrR')}
                  className="max-w-56 tabular-nums"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  aria-describedby={`online-top-up-limit-toman online-top-up-limit-warning ${editor.errorId('limitIrR')}`}
                />
                <p
                  id="online-top-up-limit-toman"
                  className="text-sm text-muted-foreground"
                  data-testid="wallet-top-up-limit-toman"
                >
                  {value === null
                    ? '—'
                    : label('toman').replace(
                        '{amount}',
                        numbers.irrDigits((BigInt(value) / 10n).toString())
                      )}
                </p>
                {value === 0 && <p className="text-sm text-destructive">{label('blocked')}</p>}
                {editor.feedback('limitIrR')}
              </div>
              <dl
                className="min-w-0 rounded-lg bg-muted/40 px-3 py-2"
                data-testid="wallet-top-up-limit-current"
              >
                <dt className="text-sm text-muted-foreground">{label('current')}</dt>
                <dd className="break-words font-semibold tabular-nums">
                  {numbers.money(current.limitIrR)}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {label('version').replace('{version}', numbers.number(current.version))}
                </dd>
              </dl>
            </div>
            <RecordEditorActions>
              <CatalogueSaveButton
                testId="wallet-top-up-limit-save"
                label={label(editor.pending ? 'working' : 'save')}
                pending={editor.pending}
                disabled={editor.disabled}
              />
            </RecordEditorActions>
          </fieldset>
        </form>
      )}
      {current && view === 'history' && (
        <div id="wallet-limit-recovery" className="border-t px-4 py-4 sm:px-6">
          <Suspense fallback={<LoadingStatus>{label('loading')}</LoadingStatus>}>
            <WalletLimitRecovery
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
                      <bdi>{numbers.money(current.limitIrR)}</bdi>
                    </dd>
                  </div>
                )}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
                  <dt>{label('proposed')}</dt>
                  <dd className="font-semibold">
                    <bdi>{numbers.money(Number((body as { limit_irr: number }).limit_irr))}</bdi>
                  </dd>
                </div>
              </dl>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesWalletLimitReceipt(result, body))) return;
            editor.resource.accept(result as WalletLimitSetting);
            editor.complete();
            editor.resource.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
