import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { useRef } from 'react';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { SettingsFormSection } from '../components/SettingsFormSection.js';
import { AuditLogViewer } from '../components/AuditLogViewer.js';
import {
  CatalogueEditorStatus,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueEditor, type CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { isResponseTargets, targetBasis } from '../lib/assignment-settings.js';
import {
  serviceFields,
  serviceDefaults,
  serviceValues,
  serviceBody,
  validEscalationPolicy,
  escalationBasis,
  type ServiceSettingsKind,
  type ServiceSettings,
  type ServiceDraft,
} from '../lib/service-settings-form.js';
import type { EscalationPolicies, ServiceResponseTargets } from '@barghsa/shared/admin';

const definitions = {
  targets: {
    path: '/api/admin/config/service-response-targets',
    validate: (value: unknown): value is ServiceSettings => isResponseTargets(value),
    basis: (value: ServiceSettings) => targetBasis(value as ServiceResponseTargets),
    values: (value: ServiceSettings) => serviceValues('targets', value),
  },
  escalation: {
    path: '/api/admin/config/escalation-policy',
    validate: (value: unknown): value is ServiceSettings => validEscalationPolicy(value),
    basis: (value: ServiceSettings) => escalationBasis(value as EscalationPolicies),
    values: (value: ServiceSettings) => serviceValues('escalation', value),
  },
};
export function ServiceSettingsEditor({
  kind,
  ...props
}: CatalogueEditorProps & { kind: ServiceSettingsKind }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) => tServiceSettings(`admin.${kind}.${key}`, locale);
  const definition = definitions[kind],
    fields = serviceFields(kind);
  const messages = Object.fromEntries(
    Object.keys(serviceDefaults).map((key) => [key, label('invalid')])
  ) as Record<keyof ServiceDraft, string>;
  const editor = useCatalogueEditor<ServiceSettings, ServiceDraft>({
    ...props,
    identity: kind,
    ...definition,
    defaults: serviceDefaults,
    messages,
    label,
    retainChangedDraft: true,
    schema: async () => {
      const { serviceSettingsSchema } = await import('../lib/catalogue-form-schemas.js');
      return serviceSettingsSchema(fields, messages, boundedCatalogueInteger);
    },
  });
  const refreshButton = useRef<HTMLButtonElement>(null);
  const refresh = () => (editor.denied ? editor.refresh() : editor.resource.retry());
  const currentValues = editor.resource.data ? definition.values(editor.resource.data) : null;
  const dirty =
    !!currentValues &&
    fields.some((field) =>
      [field.hours, field.enabled, ...(kind === 'escalation' ? [field.email] : [])].some(
        (key) => currentValues[key] !== editor.values[key]
      )
    );
  const title = (field: (typeof fields)[number]) => {
    const type = tServiceSettings(`admin.teams.${field.type}`, locale);
    return field.tier ? `${type} — ${label(field.tier)}` : type;
  };
  const proposal = editor.action?.body as ServiceSettings | undefined;
  const root = catalogueRootMessage(editor.errors);
  return (
    <section className="space-y-4" aria-label={label('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{label('title')}</h2>
        <Button
          ref={refreshButton}
          type="button"
          variant="outline"
          disabled={editor.resource.loading}
          onClick={refresh}
        >
          {label('refresh')}
        </Button>
      </div>
      <CatalogueEditorStatus
        {...editor}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
        refresh={refresh}
        busy={editor.pending}
      />
      {editor.stale && <Alert variant="destructive">{label('stale')}</Alert>}
      {editor.resource.data && (
        <SettingsFormSection
          title={label('formTitle')}
          description={label('note')}
          noValidate
          aria-busy={editor.pending || undefined}
          onSubmit={(event) =>
            void editor.submit(event, (draft) => ({
              title: label('save'),
              description: label('confirm'),
              path: definition.path,
              method: 'PUT',
              body: serviceBody(kind, draft),
              forbiddenMessage: label('forbidden'),
            }))
          }
          actions={
            <>
              <CatalogueSaveButton
                label={label(editor.pending ? 'working' : 'save')}
                pending={editor.pending}
                disabled={editor.disabled || !dirty}
              />
              <Button
                type="button"
                variant="outline"
                disabled={
                  editor.busy ||
                  editor.uncertain ||
                  editor.resource.loading ||
                  editor.resource.error
                }
                onClick={editor.resetToCurrent}
              >
                {label('reset')}
              </Button>
            </>
          }
        >
          {root && <Alert variant="destructive">{root}</Alert>}
          <fieldset
            disabled={editor.disabled}
            className="grid min-w-0 gap-6 border-0 p-0 md:grid-cols-2"
          >
            {fields.map((field) => {
              const [enabled, setEnabled] = editor.field(field.enabled),
                [hours, setHours] = editor.field(field.hours),
                [email, setEmail] = editor.field(field.email);
              const id = kind === 'targets' ? `target-${field.type}` : `escalation-${field.prefix}`;
              const help = `${id}-help`;
              return (
                <fieldset key={field.prefix} className="min-w-0 space-y-3 rounded-md border p-4">
                  <legend className="px-1 font-medium">{title(field)}</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${label('enabled')} — ${title(field)}`}
                      {...editor.bind(field.enabled)}
                      checked={enabled}
                      onChange={(event) => {
                        setEnabled(event.target.checked);
                        if (!event.target.checked) editor.form.clearErrors(field.hours);
                      }}
                    />
                    {label('enabled')}
                  </label>
                  <div className="space-y-2">
                    <Label htmlFor={id}>
                      {label('hours')}
                      <span className="sr-only"> — {title(field)}</span>
                    </Label>
                    <Input
                      id={id}
                      {...editor.bind(field.hours)}
                      disabled={!enabled}
                      inputMode="numeric"
                      dir="ltr"
                      value={hours}
                      onChange={(event) => setHours(event.target.value)}
                      aria-describedby={`${help} ${editor.errorId(field.hours)}`}
                    />
                    <p id={help} className="text-sm text-muted-foreground">
                      {kind === 'targets' ? label('range') : label(`${field.tier}Help`)}
                    </p>
                    {editor.feedback(field.hours)}
                  </div>
                  {kind === 'escalation' && (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">{label('inApp')}</p>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`${label('email')} — ${title(field)}`}
                          {...editor.bind(field.email)}
                          disabled={!enabled}
                          checked={email}
                          onChange={(event) => setEmail(event.target.checked)}
                        />
                        {label('email')}
                      </label>
                    </div>
                  )}
                </fieldset>
              );
            })}
          </fieldset>
        </SettingsFormSection>
      )}
      {kind === 'targets' && editor.resource.data && (
        <AuditLogViewer
          scope="service-response-targets"
          refreshKey={definition.basis(editor.resource.data)}
          onDenied={editor.deny}
        />
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          finalFocus={refreshButton}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onDenied={editor.onDenied}
          onValidationError={(keys) =>
            keys.every((key) => fields.some((field) => field.hours === key)) &&
            editor.onValidationError(keys)
          }
          summary={
            <div className="space-y-3 rounded-md border p-3">
              {proposal &&
                fields.map((field) => {
                  const values = serviceValues(kind, proposal);
                  return (
                    <p key={field.prefix}>
                      {title(field)}:{' '}
                      <bdi>
                        {values[field.enabled]
                          ? `${numbers.number(Number(values[field.hours]))} ${label('hours')}`
                          : label('disabled')}
                      </bdi>
                      {kind === 'escalation' && values[field.enabled] && (
                        <span className="block text-sm text-muted-foreground">
                          {label('inApp')}
                          {values[field.email] ? ` · ${label('email')}` : ''}
                        </span>
                      )}
                    </p>
                  );
                })}
              <Button
                type="button"
                variant="outline"
                disabled={editor.resource.loading}
                onClick={refresh}
              >
                {label('refresh')}
              </Button>
              {editor.resource.error && <Alert variant="destructive">{label('readError')}</Alert>}
              {editor.uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            if (
              !editor.verifyReceipt(
                definition.validate(result) &&
                  !!proposal &&
                  definition.basis(result) === definition.basis(proposal)
              )
            )
              return;
            editor.complete(result as ServiceSettings);
            editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
