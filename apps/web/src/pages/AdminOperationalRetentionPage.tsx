import { retentionText } from '@barghsa/i18n/operational-retention';
import {
  defaultOperationalRetention,
  isOperationalRetention,
  operationalRetentionFields,
  type OperationalRetention,
  type OperationalRetentionView,
} from '@barghsa/shared/admin';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import {
  CatalogueEditorStatus,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { SettingsFormSection } from '../components/SettingsFormSection.js';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { useCatalogueEditor } from '../hooks/useCatalogueEditor.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { boundedCatalogueInteger, record } from '../lib/catalogue-form.js';

const path = '/api/admin/config/operational-retention';
type Draft = Record<keyof OperationalRetention, string>;
const values = (policy: OperationalRetention): Draft =>
  Object.fromEntries(
    operationalRetentionFields.map(({ key }) => [key, String(policy[key])])
  ) as Draft;
const defaults = values(defaultOperationalRetention);
const validate = (value: unknown): value is OperationalRetentionView =>
  record(value) &&
  typeof value.canEdit === 'boolean' &&
  typeof value.version === 'number' &&
  Number.isSafeInteger(value.version) &&
  value.version >= 0 &&
  isOperationalRetention(value.policy);

export default function AdminOperationalRetentionPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => retentionText(key, locale);
  const messages = Object.fromEntries(
    operationalRetentionFields.map(({ key, min, max }) => [
      key,
      label('bounds').replace('{min}', numbers.number(min)).replace('{max}', numbers.number(max)),
    ])
  ) as Draft;
  const editor = useCatalogueEditor<OperationalRetentionView, Draft>({
    identity: 'operational-retention',
    path,
    validate,
    basis: ({ version, canEdit }) => `${version}:${canEdit}`,
    defaults,
    values: ({ policy }) => values(policy),
    messages,
    label,
    schema: async () => {
      const { integerSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return integerSettingsSchema<Draft>(
        messages,
        operationalRetentionFields,
        boundedCatalogueInteger
      ).check((ctx) => {
        const ordinary = boundedCatalogueInteger(ctx.value.ordinaryTracesDays, 7, 90);
        const priority = boundedCatalogueInteger(ctx.value.priorityTracesDays, 30, 365);
        if (ordinary !== null && priority !== null && ordinary > priority) {
          ctx.issues.push({
            code: 'custom',
            input: ctx.value,
            path: ['priorityTracesDays'],
            message: label('range'),
          });
        }
      });
    },
  });
  const saved = editor.resource.data;
  const error = catalogueRootMessage(editor.errors);
  const body = editor.action?.body;
  const proposed = record(body) && isOperationalRetention(body.policy) ? body.policy : null;
  return (
    <section className="max-w-3xl space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={editor.resource.loading || editor.commandPending}
          onClick={editor.refresh}
        >
          {label('refresh')}
        </Button>
      </header>
      <CatalogueEditorStatus
        {...editor}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
        refresh={editor.refresh}
        busy={editor.pending}
      />
      {saved && (
        <SettingsFormSection
          title={label('savedPolicy')}
          description={label('applyHelp')}
          noValidate
          aria-busy={editor.pending || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (!saved.canEdit) return;
            void editor.submit(event, (draft) => ({
              title: label('save'),
              description: label('confirm'),
              path,
              method: 'PUT',
              body: {
                expectedVersion: saved.version,
                policy: Object.fromEntries(
                  operationalRetentionFields.map(({ key, min, max }) => [
                    key,
                    boundedCatalogueInteger(draft[key], min, max),
                  ])
                ),
              },
              conflictMessage: label('stale'),
              forbiddenMessage: label('forbidden'),
            }));
          }}
          actions={
            <>
              {saved.canEdit && (
                <CatalogueSaveButton
                  label={label(editor.pending ? 'working' : 'save')}
                  pending={editor.pending}
                  disabled={editor.disabled}
                />
              )}
              <a
                className="text-sm font-medium text-primary underline underline-offset-4"
                href={`${path}/export`}
              >
                {label('export')}
              </a>
            </>
          }
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          {!saved.canEdit && (
            <p className="mb-4 text-sm text-muted-foreground">{label('readOnly')}</p>
          )}
          <fieldset
            disabled={editor.disabled || !saved.canEdit}
            className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2"
          >
            {operationalRetentionFields.map(({ key }) => {
              const [raw, setRaw] = editor.field(key);
              const id = `retention-${key}`;
              return (
                <div key={key} className="space-y-2">
                  <Label htmlFor={id}>{label(key)}</Label>
                  <Input
                    id={id}
                    {...editor.bind(key)}
                    inputMode="numeric"
                    dir="ltr"
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                    aria-describedby={editor.errorId(key)}
                  />
                  {editor.feedback(key)}
                </div>
              );
            })}
          </fieldset>
          <Alert className="mt-4">{label('legal')}</Alert>
        </SettingsFormSection>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          confirmationDisabled={!editor.ready || editor.uncertain || !saved?.canEdit}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          summary={
            proposed && (
              <dl className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                {operationalRetentionFields.map(({ key }) => (
                  <div key={key}>
                    <dt className="text-sm text-muted-foreground">{label(key)}</dt>
                    <dd>
                      <bdi>{numbers.number(proposed[key])}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            )
          }
          onSuccess={async (result) => {
            const matches =
              validate(result) &&
              result.canEdit &&
              record(body) &&
              typeof body.expectedVersion === 'number' &&
              result.version === body.expectedVersion + 1 &&
              proposed !== null &&
              operationalRetentionFields.every(({ key }) => result.policy[key] === proposed[key]);
            if (!editor.verifyReceipt(matches)) return;
            editor.resource.accept(result as OperationalRetentionView);
            editor.complete();
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
