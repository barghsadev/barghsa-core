import { tWalletLimit as t } from '@barghsa/i18n/wallet-limit';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor, type CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';
import { TeamActionDialog } from './TeamActionDialog.js';
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
const path = '/api/admin/config/wallet-top-up-limit';
export default function WalletTopUpLimitConfigPanel(props: CatalogueEditorProps = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) =>
    t(
      `admin.walletLimit.${({ readError: 'loadFailed', retry: 'reload', working: 'saving' } as Record<string, string>)[key] ?? key}`,
      locale
    ).replace('{max}', numbers.number(Number.MAX_SAFE_INTEGER));
  const messages = { limitIrR: label('invalid') };
  const editor = useCatalogueEditor<WalletLimitSetting, WalletLimitDraft>({
    ...props,
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
      className="rounded-lg border bg-card p-6 text-card-foreground space-y-4"
      data-testid="wallet-top-up-limit-panel"
      aria-labelledby="wallet-top-up-limit-heading"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div>
        <h2 id="wallet-top-up-limit-heading" className="text-lg font-semibold">
          {label('title')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{label('description')}</p>
      </div>
      <p
        className="rounded border border-warning/20 bg-warning-soft px-3 py-2 text-sm text-foreground"
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
      {current && (
        <form
          noValidate
          aria-label={label('title')}
          aria-busy={editor.pending || undefined}
          className="space-y-4"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('save'),
              description: label('warning'),
              path,
              method: 'PUT',
              body: { limit_irr: limitAmount(draft.limitIrR), expected_version: current.version },
              conflictMessage: label('conflict'),
            }))
          }
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-4 border-0 p-0">
            <div>
              <Label htmlFor="online-top-up-limit">{label('label')}</Label>
              <Input
                id="online-top-up-limit"
                data-testid="wallet-top-up-limit-input"
                {...editor.bind('limitIrR')}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                aria-describedby={`online-top-up-limit-toman online-top-up-limit-warning ${editor.errorId('limitIrR')}`}
              />
              <p
                id="online-top-up-limit-toman"
                className="mt-1 text-sm text-muted-foreground"
                data-testid="wallet-top-up-limit-toman"
              >
                {value === null
                  ? '—'
                  : label('toman').replace(
                      '{amount}',
                      numbers.irrDigits((BigInt(value) / 10n).toString())
                    )}
              </p>
              {value === 0 && <p className="text-sm">{label('blocked')}</p>}
              {editor.feedback('limitIrR')}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="wallet-top-up-limit-current">
              {label('current')}: <bdi>{numbers.irrDigits(String(current.limitIrR))}</bdi>
              {' · '}
              {label('version').replace('{version}', numbers.number(current.version))}
            </p>
            <CatalogueSaveButton
              testId="wallet-top-up-limit-save"
              label={label(editor.pending ? 'working' : 'save')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          </fieldset>
        </form>
      )}
      {!editor.resource.error && (
        <Button
          type="button"
          variant="outline"
          disabled={editor.busy || editor.resource.loading}
          onClick={editor.refresh}
        >
          {label('reload')}
        </Button>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          confirmationDisabled={!editor.ready || editor.uncertain}
          summary={
            <div className="space-y-2 rounded border p-3">
              <p>
                {label('label')}:{' '}
                <bdi>{numbers.money(Number((body as { limit_irr: number }).limit_irr))}</bdi>
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesWalletLimitReceipt(result, body))) return;
            editor.resource.accept(result as WalletLimitSetting);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
