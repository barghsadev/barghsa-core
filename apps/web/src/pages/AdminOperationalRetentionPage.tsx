import { retentionText } from '@barghsa/i18n/operational-retention';
import { Link } from '@tanstack/react-router';
import {
  defaultOperationalRetention,
  isOperationalRetention,
  operationalRetentionFields,
  type OperationalRetention,
  type OperationalRetentionView,
} from '@barghsa/shared/admin';
import {
  Alert,
  Badge,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  ListRefreshButton,
  LoadingStatus,
  buttonVariants,
} from '@barghsa/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  CatalogueEditorStatus,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { SettingsFormSection } from '../components/SettingsFormSection.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import { useCatalogueEditor } from '../hooks/useCatalogueEditor.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { boundedCatalogueInteger, record } from '../lib/catalogue-form.js';

const path = '/api/admin/config/operational-retention';
const ConfigRecovery = lazy(async () => {
  const { default: Recovery } = await import('../components/ConfigRecovery.js');
  return { default: Recovery<OperationalRetention> };
});
const policyBasis = (policy: OperationalRetention) =>
  operationalRetentionFields.map(({ key }) => policy[key]).join(':');
type Draft = Record<keyof OperationalRetention, string>;
const values = (policy: OperationalRetention): Draft =>
  Object.fromEntries(
    operationalRetentionFields.map(({ key }) => [key, String(policy[key])])
  ) as Draft;
const defaults = values(defaultOperationalRetention);
const traceFields = operationalRetentionFields.filter(({ key }) => key.endsWith('TracesDays'));
const policyGroups = [
  {
    label: 'logsAndMetrics',
    fields: operationalRetentionFields.filter((field) => !traceFields.includes(field)),
  },
  { label: 'traces', fields: traceFields },
] as const;
const validate = (value: unknown): value is OperationalRetentionView =>
  record(value) &&
  typeof value.canEdit === 'boolean' &&
  typeof value.version === 'number' &&
  Number.isSafeInteger(value.version) &&
  value.version >= 0 &&
  isOperationalRetention(value.policy);

export default function AdminOperationalRetentionPage({
  view,
}: {
  view: 'overview' | 'edit' | 'history';
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => retentionText(key, locale);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (view !== 'overview') heading.current?.focus({ preventScroll: true });
  }, [view]);
  const messages = Object.fromEntries(
    operationalRetentionFields.map(({ key, min, max }) => [
      key,
      label('bounds').replace('{min}', numbers.number(min)).replace('{max}', numbers.number(max)),
    ])
  ) as Draft;
  const editor = useCatalogueEditor<OperationalRetentionView, Draft>({
    disabled: recoveryBusy,
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
  const reviewedPolicy =
    saved && record(body) && body.expectedVersion === saved.version && proposed;
  const changes =
    saved && reviewedPolicy
      ? operationalRetentionFields.filter(({ key }) => saved.policy[key] !== reviewedPolicy[key])
      : [];
  const days = (value: number) => label('days').replace('{days}', numbers.number(value));
  const policySummary = (policy: OperationalRetention) => (
    <dl className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
      {operationalRetentionFields.map(({ key }) => (
        <div key={key}>
          <dt className="text-sm text-muted-foreground">{label(key)}</dt>
          <dd>{days(policy[key])}</dd>
        </div>
      ))}
    </dl>
  );
  const exportLink = (
    <a
      className="touch-action text-sm font-medium text-primary underline underline-offset-4"
      href={`${path}/export`}
    >
      {label('export')}
    </a>
  );
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div>
          {view !== 'overview' && (
            <Link
              to="/admin/operational-retention"
              disabled={editor.commandPending || recoveryBusy}
              className="touch-action mb-1 inline-flex text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
            >
              {label('title')}
            </Link>
          )}
          <h1
            ref={heading}
            tabIndex={view !== 'overview' ? -1 : undefined}
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {label(view === 'history' ? 'recoveryTitle' : view === 'edit' ? 'editTitle' : 'title')}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">{label('description')}</p>
        </div>
        <ListRefreshButton
          label={label('refresh')}
          disabled={editor.commandPending || recoveryBusy}
          refreshing={editor.resource.loading}
          onClick={editor.refresh}
        />
      </header>
      <CatalogueEditorStatus
        {...editor}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
        refresh={editor.refresh}
        busy={editor.pending}
      />
      {view === 'history' && saved && !saved.canEdit && (
        <p className="text-sm text-muted-foreground">{label('readOnly')}</p>
      )}
      {saved && !editor.denied && view === 'overview' && (
        <div className={recordEditorSurface}>
          <RecordEditorSection title={label('savedPolicy')} description={label('applyHelp')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">
                {label('savedVersion').replace('{version}', numbers.number(saved.version))}
              </Badge>
              {saved.canEdit && (
                <Link
                  to="/admin/operational-retention/$view"
                  params={{ view: 'edit' }}
                  disabled={!editor.ready}
                  className={buttonVariants()}
                >
                  {label('editTitle')}
                </Link>
              )}
            </div>
            {!saved.canEdit && <p className="text-sm text-muted-foreground">{label('readOnly')}</p>}
          </RecordEditorSection>
          {policyGroups.map((group) => (
            <RecordEditorSection title={label(group.label)} key={group.label}>
              <dl className="divide-y">
                {group.fields.map(({ key }) => (
                  <div key={key} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="min-w-0 text-sm">{label(key)}</dt>
                    <dd className="shrink-0 text-sm font-semibold tabular-nums">
                      {days(saved.policy[key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </RecordEditorSection>
          ))}
          <RecordEditorActions secondary={exportLink}>
            {saved.canEdit && (
              <Link
                to="/admin/operational-retention/$view"
                params={{ view: 'history' }}
                className={buttonVariants({ variant: 'ghost', className: 'text-primary' })}
              >
                {label('recoveryTitle')}
              </Link>
            )}
          </RecordEditorActions>
        </div>
      )}
      {saved && view === 'edit' && (
        <SettingsFormSection
          title={label('periods')}
          description={label('applyHelp')}
          className="@container"
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
              {exportLink}
            </>
          }
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <Badge className="mb-3" variant="outline">
            {label('savedVersion').replace('{version}', numbers.number(saved.version))}
          </Badge>
          {!saved.canEdit && (
            <p className="mb-4 text-sm text-muted-foreground">{label('readOnly')}</p>
          )}
          <fieldset
            disabled={editor.disabled || !saved.canEdit}
            className="m-0 grid min-w-0 gap-4 border-0 p-0 @2xl:grid-cols-2"
          >
            {policyGroups.map((group) => (
              <section
                key={group.label}
                aria-labelledby={`retention-${group.label}`}
                className="min-w-0 space-y-2 border-t pt-3"
              >
                <h3 id={`retention-${group.label}`} className="font-semibold">
                  {label(group.label)}
                </h3>
                <div className="divide-y rounded-lg border bg-muted/25 px-3 sm:px-4">
                  {group.fields.map(({ key, min, max }) => {
                    const [raw, setRaw] = editor.field(key);
                    const id = `retention-${key}`;
                    const binding = editor.bind(key);
                    return (
                      <div
                        key={key}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_7rem]"
                      >
                        <div className="min-w-0 space-y-1">
                          <Label htmlFor={id} className="leading-snug">
                            {label(key)}
                          </Label>
                          <p id={`${id}-range`} className="text-xs text-muted-foreground">
                            {label('allowedDays')
                              .replace('{min}', numbers.number(min))
                              .replace('{max}', numbers.number(max))}
                          </p>
                        </div>
                        <InputGroup className="bg-background">
                          <InputGroupInput
                            id={id}
                            {...binding}
                            className="min-w-0 tabular-nums"
                            inputMode="numeric"
                            dir="ltr"
                            value={raw}
                            onChange={(event) => setRaw(event.target.value)}
                            aria-describedby={[
                              `${id}-range`,
                              key === 'priorityTracesDays' && 'retention-traces-help',
                              binding['aria-describedby'],
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          />
                          <InputGroupAddon align="inline-end" aria-hidden="true">
                            {label('dayUnit')}
                          </InputGroupAddon>
                        </InputGroup>
                        {binding['aria-invalid'] && (
                          <div className="col-span-full">{editor.feedback(key, true)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {group.label === 'traces' && (
                  <p id="retention-traces-help" className="text-sm text-muted-foreground">
                    {label('traceHelp')}
                  </p>
                )}
              </section>
            ))}
          </fieldset>
          <p
            className="mt-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
            role="note"
          >
            {label('legal')}
          </p>
        </SettingsFormSection>
      )}
      {saved?.canEdit && view === 'history' && (
        <div id="retention-recovery" className="space-y-3">
          <p className="text-sm text-muted-foreground">{label('applyHelp')}</p>
          {exportLink}
          {policySummary(saved.policy)}
          <Suspense fallback={<LoadingStatus>{label('recoveryLoading')}</LoadingStatus>}>
            <ConfigRecovery
              key={saved.version}
              path={path}
              valid={isOperationalRetention}
              basis={policyBasis}
              renderValues={policySummary}
              label={label}
              disabled={
                editor.busy ||
                editor.uncertain ||
                editor.resource.loading ||
                !!editor.resource.error ||
                !!editor.action
              }
              onBusyChange={setRecoveryBusy}
              onDenied={() => {
                setRecoveryBusy(false);
                editor.onDenied();
              }}
              onActivated={editor.refresh}
            />
          </Suspense>
        </div>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          confirmationDisabled={
            !editor.ready || editor.uncertain || !saved?.canEdit || !reviewedPolicy
          }
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          summary={
            saved &&
            reviewedPolicy && (
              <section id="retention-change-review" aria-labelledby="retention-change-heading">
                <h3 id="retention-change-heading" className="mb-2 text-sm font-semibold">
                  {label('periodChanges')}
                </h3>
                {changes.length ? (
                  <ul className="divide-y rounded-lg border bg-muted/35">
                    {changes.map(({ key }) => (
                      <li key={key} className="space-y-2 px-3 py-2.5">
                        <p className="text-sm font-medium">{label(key)}</p>
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              {label('savedPeriod')}
                            </dt>
                            <dd className="tabular-nums">{days(saved.policy[key])}</dd>
                          </div>
                          <div className="border-s ps-3">
                            <dt className="text-xs text-muted-foreground">{label('newPeriod')}</dt>
                            <dd className="font-semibold tabular-nums">
                              {days(reviewedPolicy[key])}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{label('noPeriodChanges')}</p>
                )}
              </section>
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
