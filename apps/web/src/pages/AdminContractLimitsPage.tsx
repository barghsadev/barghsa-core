import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import {
  Alert,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  ListRefreshButton,
  buttonVariants,
} from '@barghsa/ui';
import { ArrowRightIcon } from 'lucide-react';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { TeamActionDialog } from '../components/TeamActionDialog.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
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

export default function AdminContractLimitsPage({ view }: { view: 'overview' | 'edit' }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    label = (key: string) => tWorkspace(`admin.contractLimits.${key}`, locale);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (view === 'edit') heading.current?.focus({ preventScroll: true });
  }, [view]);
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
  const current = editor.resource.data;
  const currentLabel = tWorkspace('admin.settings.current', locale);
  const review =
    current && record(body)
      ? contractLimitFields.map(({ key, wire }) => ({
          key,
          previous: current[key],
          proposed: Number(body[wire]),
        }))
      : [];
  const changes = review.filter(({ previous, proposed }) => previous !== proposed);
  // An unchanged recovery read preserves the already reviewed proposal.
  const refresh = editor.refresh;
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="space-y-1">
          {view === 'edit' && (
            <Link
              to="/admin/contract-limits"
              disabled={editor.commandPending}
              className="touch-action w-fit text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
            >
              {label('title')}
            </Link>
          )}
          <h1
            ref={heading}
            tabIndex={view === 'edit' ? -1 : undefined}
            className="text-2xl font-semibold"
          >
            {label(view === 'edit' ? 'editTitle' : 'title')}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">{label('description')}</p>
        </div>
        <ListRefreshButton
          label={label('refresh')}
          disabled={editor.commandPending}
          refreshing={editor.resource.loading}
          onClick={refresh}
        />
      </header>
      <CatalogueEditorStatus
        {...editor}
        announceUncertain={false}
        label={label}
        loading={editor.resource.loading}
        error={editor.resource.error}
        refresh={refresh}
        busy={editor.pending}
      />
      {current && !editor.denied && view === 'overview' && (
        <div className={recordEditorSurface}>
          <RecordEditorSection title={label('savedLimits')} description={label('scope')}>
            <dl className="divide-y">
              {contractLimitFields.map(({ key }) => (
                <div key={key} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="min-w-0 text-sm">{label(key)}</dt>
                  <dd className="shrink-0 text-sm font-semibold tabular-nums">
                    <bdi>{numbers.number(current[key])}</bdi>{' '}
                    <span className="text-muted-foreground">{label(`unit.${key}`)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </RecordEditorSection>
          <RecordEditorActions
            secondary={
              <Link
                to="/admin/contract-limits/$view"
                params={{ view: 'history' }}
                className={buttonVariants({ variant: 'ghost', className: 'text-primary' })}
              >
                {label('recoveryTitle')}
              </Link>
            }
          >
            <Link
              to="/admin/contract-limits/$view"
              params={{ view: 'edit' }}
              disabled={!editor.ready}
              className={buttonVariants()}
            >
              {label('editTitle')}
            </Link>
          </RecordEditorActions>
        </div>
      )}
      {current && view === 'edit' && (
        <form
          aria-label={tWorkspace('admin.settings.contractTerms', locale)}
          noValidate
          aria-busy={editor.pending || undefined}
          className={recordEditorSurface}
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
        >
          <p className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground sm:px-6">
            {label('scope')}
          </p>
          <fieldset disabled={editor.disabled} className="m-0 min-w-0 border-0 p-0">
            <div className="divide-y px-4 sm:px-6">
              {error && (
                <Alert variant="destructive" className="my-3">
                  {error}
                </Alert>
              )}
              {contractLimitFields.map(({ key }) => {
                const [raw, setRaw] = editor.field(key),
                  help = `contract-limit-help-${key}`,
                  accepted = `contract-limit-current-${key}`,
                  binding = editor.bind(key);
                return (
                  <div
                    key={key}
                    className="grid min-w-0 gap-x-5 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <Label htmlFor={`contract-limit-${key}`}>{label(key)}</Label>
                    <div className="flex min-w-0 items-center gap-3 sm:col-start-2 sm:row-span-2 sm:row-start-1">
                      <InputGroup className="w-40 max-w-full sm:w-44">
                        <InputGroupInput
                          id={`contract-limit-${key}`}
                          {...binding}
                          className="min-w-0 tabular-nums"
                          inputMode="numeric"
                          autoComplete="off"
                          dir="ltr"
                          value={raw}
                          onChange={(event) => setRaw(event.target.value)}
                          aria-describedby={[help, accepted, binding['aria-describedby']]
                            .filter(Boolean)
                            .join(' ')}
                        />
                        <InputGroupAddon
                          align="inline-end"
                          aria-hidden="true"
                          className="whitespace-nowrap"
                        >
                          {label(`unit.${key}`)}
                        </InputGroupAddon>
                      </InputGroup>
                      <dl id={accepted} className="min-w-0 text-sm">
                        <dt className="text-muted-foreground">{currentLabel}</dt>
                        <dd className="font-medium tabular-nums">{numbers.number(current[key])}</dd>
                      </dl>
                    </div>
                    <p id={help} className="text-sm text-muted-foreground sm:col-start-1">
                      {label(`${key}Help`)}
                    </p>
                    {binding['aria-invalid'] && (
                      <div className="sm:col-span-2">{editor.feedback(key)}</div>
                    )}
                  </div>
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
          </fieldset>
        </form>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          onClose={editor.close}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          onValidationError={editor.onValidationError}
          summary={
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <dl className="min-w-0 flex-1 divide-y rounded-lg border bg-card px-3">
                  {(changes.length ? changes : review).map(({ key, previous, proposed }) => (
                    <div key={key} className="space-y-2 py-3">
                      <dt className="text-sm font-medium">{label(key)}</dt>
                      <dd className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">{currentLabel}</div>
                          <bdi className="tabular-nums">
                            {numbers.number(previous)} {label(`unit.${key}`)}
                          </bdi>
                        </div>
                        <ArrowRightIcon
                          className="size-4 text-muted-foreground rtl:rotate-180"
                          aria-hidden="true"
                        />
                        <div>
                          <div className="text-muted-foreground">{label('proposed')}</div>
                          <bdi className="font-semibold tabular-nums">
                            {numbers.number(proposed)} {label(`unit.${key}`)}
                          </bdi>
                        </div>
                      </dd>
                    </div>
                  ))}
                </dl>
                <ListRefreshButton
                  label={label('refresh')}
                  disabled={editor.commandPending}
                  refreshing={editor.resource.loading}
                  onClick={refresh}
                />
              </div>
              {editor.resource.error && (
                <div role="alert">
                  <p>{label('readError')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={editor.commandPending}
                    onClick={refresh}
                  >
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
