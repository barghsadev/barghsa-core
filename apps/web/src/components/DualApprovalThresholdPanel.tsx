import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
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
  validThreshold,
  thresholdDefaults,
  thresholdValues,
  thresholdBasis,
  thresholdFields,
  matchesThresholdReceipt,
  type ThresholdSetting,
  type ThresholdDraft,
} from '../lib/limit-settings-form.js';
const path = '/api/admin/config/dual-approval-threshold';
export default function DualApprovalThresholdPanel(props: CatalogueEditorProps = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) =>
    t(`admin.receiptThreshold.${key === 'readError' ? 'unavailable' : key}`, locale);
  const messages = { thresholdIrR: label('invalid') };
  const editor = useCatalogueEditor<ThresholdSetting, ThresholdDraft>({
    ...props,
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
  if (editor.denied) return null;
  return (
    <section
      aria-labelledby="receipt-threshold-title"
      className="space-y-3 rounded-lg border bg-card p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 id="receipt-threshold-title" className="text-lg font-semibold">
        {label('title')}
      </h2>
      <p id="receipt-threshold-hint" className="text-sm">
        {label('description')}
      </p>
      <p className="text-sm">{label('stepUp')}</p>
      <CatalogueEditorStatus
        {...editor}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
      />
      {editor.resource.data && (
        <form
          noValidate
          aria-label={label('title')}
          aria-busy={editor.pending || undefined}
          className="space-y-3"
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
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
          {error && <Alert variant="destructive">{error}</Alert>}
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-3 border-0 p-0">
            <Label htmlFor="receipt-threshold">{label('label')}</Label>
            <Input
              id="receipt-threshold"
              {...editor.bind('thresholdIrR')}
              inputMode="numeric"
              dir="ltr"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              aria-describedby={`receipt-threshold-hint receipt-threshold-value ${editor.errorId('thresholdIrR')}`}
            />
            <p id="receipt-threshold-value" className="text-xl font-semibold">
              {value === null ? '—' : numbers.money(value)}
            </p>
            {editor.feedback('thresholdIrR')}
            {value === 0 && <p>{label('disabled')}</p>}
            <CatalogueSaveButton
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
          {label('retry')}
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
                <bdi>
                  {numbers.money(Number((body as { threshold_irr: number }).threshold_irr))}
                </bdi>
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesThresholdReceipt(result, body))) return;
            editor.resource.accept(result as ThresholdSetting);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
