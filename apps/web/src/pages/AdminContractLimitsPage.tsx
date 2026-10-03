import { t } from '@barghsa/i18n/admin-ui';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { SettingsFormSection } from '../components/SettingsFormSection.js';
import {
  CatalogueEditorStatus,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor } from '../hooks/useCatalogueEditor.js';
import { boundedCatalogueInteger, record } from '../lib/catalogue-form.js';
import {
  contractLimitFields,
  contractLimitDefaults,
  contractLimitValues,
  contractLimitBasis,
  contractLimitBody,
  validContractLimits,
  matchesContractLimitReceipt,
  type ContractLimitDraft,
} from '../lib/limit-settings-form.js';
const path = '/api/admin/config/contract-electricity-limits';
export default function AdminContractLimitsPage() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    label = (key: string) => t(`admin.contractLimits.${key}`, locale);
  const messages = {
    maxQuantityIncreasePercent: label('invalidPercent'),
    maxContractDuration: label('invalidDuration'),
    leadTimeDays: label('invalidLeadTime'),
  };
  const editor = useCatalogueEditor<ContractElectricityLimits, ContractLimitDraft>({
    identity: 'contract-electricity-limits',
    path,
    validate: validContractLimits,
    basis: contractLimitBasis,
    defaults: contractLimitDefaults,
    values: contractLimitValues,
    messages,
    label,
    schema: async () => {
      const { integerSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return integerSettingsSchema<ContractLimitDraft>(
        messages,
        contractLimitFields,
        boundedCatalogueInteger
      );
    },
  });
  const error = catalogueRootMessage(editor.errors),
    body = editor.action?.body;
  // An unchanged recovery read preserves the already reviewed proposal.
  const refresh = () => (editor.denied ? editor.refresh() : editor.resource.retry());
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button variant="outline" disabled={editor.resource.loading} onClick={refresh}>
          {label('refresh')}
        </Button>
      </header>
      <CatalogueEditorStatus
        {...editor}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
        refresh={refresh}
        busy={editor.pending}
      />
      {editor.resource.data && (
        <SettingsFormSection
          title={t('admin.settings.contractTerms', locale)}
          description={label('scope')}
          noValidate
          aria-busy={editor.pending || undefined}
          className="max-w-xl"
          saved={editor.saved}
          savedMessage={label('saved')}
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('save'),
              description: label('confirm'),
              path,
              method: 'PUT',
              body: contractLimitBody(draft),
              forbiddenMessage: label('forbidden'),
            }))
          }
          actions={
            <CatalogueSaveButton
              label={label(editor.pending ? 'working' : 'save')}
              pending={editor.pending}
              disabled={editor.disabled}
            />
          }
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <fieldset disabled={editor.disabled} className="min-w-0 space-y-5 border-0 p-0">
            {contractLimitFields.map(({ key }) => {
              const [raw, setRaw] = editor.field(key),
                help = `contract-limit-help-${key}`;
              return (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`contract-limit-${key}`}>{label(key)}</Label>
                  <Input
                    id={`contract-limit-${key}`}
                    {...editor.bind(key)}
                    inputMode="numeric"
                    dir="ltr"
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                    aria-describedby={`${help} ${editor.errorId(key)}`}
                  />
                  <p id={help} className="text-sm text-muted-foreground">
                    {label(`${key}Help`)}
                  </p>
                  {editor.feedback(key)}
                </div>
              );
            })}
          </fieldset>
        </SettingsFormSection>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onDenied={editor.onDenied}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-3 rounded border p-3">
              {record(body) &&
                contractLimitFields.map(({ key, wire }) => (
                  <p key={key}>
                    {label(key)}: <bdi>{numbers.number(Number(body[wire]))}</bdi>
                  </p>
                ))}
              <Button
                type="button"
                variant="outline"
                disabled={editor.resource.loading}
                onClick={refresh}
              >
                {label('refresh')}
              </Button>
              {editor.resource.error && (
                <div role="alert">
                  <p>{label('readError')}</p>
                  <Button type="button" variant="outline" onClick={refresh}>
                    {label('retry')}
                  </Button>
                </div>
              )}
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (!editor.verifyReceipt(matchesContractLimitReceipt(result, body))) return;
            editor.resource.accept(result as ContractElectricityLimits);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
