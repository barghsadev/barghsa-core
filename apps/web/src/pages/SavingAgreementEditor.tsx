import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { useCallback, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import {
  LoadingStatus,
  Button,
  ListRefreshButton,
  Label,
  Input,
  Textarea,
  Alert,
  buttonVariants,
} from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueEditor, type CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';
import {
  agreementDefaults,
  agreementValues,
  agreementBasis,
  validAgreementConfig,
  matchesAgreementReceipt,
  type AgreementConfig,
  type AgreementDraft,
} from '../lib/saving-catalogue-form.js';
import { record } from '../lib/catalogue-form.js';

export function SavingAgreementEditor({
  planId,
  onChanged,
  onProductRefresh,
  heading,
  mode = 'inline',
  search = {},
  ...props
}: CatalogueEditorProps & {
  planId: string;
  onChanged: () => void;
  onProductRefresh?: () => void;
  heading?: ReactNode;
  mode?: 'overview' | 'agreement' | 'activate-agreement' | 'inline';
  search?: Record<string, unknown>;
}) {
  const locale = useLocale();
  const label = (key: string) => tCatalogue(key, locale);
  const base = `/api/admin/catalogue/saving-plans/${encodeURIComponent(planId)}`;
  const validate = useCallback(
    (value: unknown): value is AgreementConfig =>
      validAgreementConfig(value) && value.planId === planId,
    [planId]
  );
  const messages = { title: label('invalidAgreementTitle'), body: label('invalidAgreementBody') };
  const editor = useCatalogueEditor<AgreementConfig, AgreementDraft>({
    ...props,
    identity: planId,
    path: `${base}/configuration`,
    validate,
    basis: agreementBasis,
    defaults: agreementDefaults,
    values: agreementValues,
    messages,
    label,
    schema: async () => {
      const { agreementFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return agreementFormSchema(messages);
    },
  });
  const rootError = editor.errors.root?.validation?.message ?? editor.errors.root?.message;
  const config = editor.resource.data;
  const agreements = config?.agreements ?? [];
  const draft = agreements.find((row) => row.status === 'draft');
  const active = agreements.find((row) => row.status === 'active');
  const inline = mode === 'inline';
  const overview = mode === 'overview';
  const publishing = mode === 'activate-agreement';
  const [title, setTitle] = editor.field('title'),
    [body, setBody] = editor.field('body');
  const action = (
    path: string,
    title: string,
    description: string,
    body?: unknown
  ): TeamAction => ({
    path,
    method: 'POST',
    title: label(title),
    description: label(description),
    ...(body === undefined ? {} : { body }),
    forbiddenMessage: label('denied'),
    conflictMessage: label('agreementConflict'),
  });
  const activation = editor.action?.path.endsWith('/activate');
  const unsaved = !!draft && (title.trim() !== draft.title || body.trim() !== draft.body);
  const canNavigate = editor.ready && !editor.busy && !editor.uncertain;
  const summary = activation
    ? draft
    : editor.action && record(editor.action.body)
      ? editor.action.body
      : null;
  return (
    <section className="space-y-3" aria-label={label('agreement')}>
      {!inline && <RecordCommandGuard blocked={() => editor.commandPending || editor.uncertain} />}
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {heading ??
          (overview || inline ? (
            <h2 className="text-lg font-semibold">{label('agreement')}</h2>
          ) : null)}
        {(!overview || editor.resource.error || editor.denied) && (
          <ListRefreshButton
            label={label(editor.resource.error || editor.denied ? 'retry' : 'refresh')}
            disabled={
              props.disabled ||
              !!editor.action ||
              editor.commandPending ||
              (!onProductRefresh && editor.pending)
            }
            onClick={editor.pending && onProductRefresh ? onProductRefresh : editor.refresh}
          />
        )}
      </header>
      {editor.denied && <Alert variant="destructive">{label('denied')}</Alert>}
      {editor.resource.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {editor.resource.error && <Alert variant="destructive">{label('agreementLoadError')}</Alert>}
      <CommandFeedback message={editor.saved ? label('saved') : null} />
      {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
      {config && (
        <>
          {(overview || inline) && (
            <p className="text-sm text-muted-foreground">{label('agreementHelp')}</p>
          )}
          {(overview || inline || publishing) && active && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer font-medium">
                {label('activeAgreement')}: {active.title}
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words">{active.body}</p>
            </details>
          )}
          {(inline || mode === 'agreement') && (
            <form
              aria-label={label('agreement')}
              noValidate
              aria-busy={editor.pending || undefined}
              onSubmit={(event) =>
                void editor.submit(event, (values) =>
                  action(`${base}/agreements/draft`, 'saveAgreement', 'confirmAgreementDraft', {
                    title: values.title.trim(),
                    body: values.body.trim(),
                  })
                )
              }
              className={recordEditorSurface}
            >
              {rootError && (
                <Alert variant="destructive" className="m-4">
                  {rootError}
                </Alert>
              )}
              <fieldset disabled={editor.disabled} className="min-w-0">
                <legend className="sr-only">{label('agreement')}</legend>
                <RecordEditorSection
                  title={label(inline ? 'agreementDraftDetails' : 'agreementContent')}
                  {...(!inline && { description: label('agreementDraftHelp') })}
                >
                  <div className={recordEditorField}>
                    <Label htmlFor="saving-agreement-title">{label('agreementTitle')}</Label>
                    <Input
                      id="saving-agreement-title"
                      dir="auto"
                      aria-required="true"
                      {...editor.bind('title')}
                      value={title}
                      placeholder={inline ? undefined : label('agreementTitleExample')}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    {(inline || editor.errors.title) && editor.feedback('title')}
                  </div>
                  <div className={recordEditorField}>
                    <Label htmlFor="saving-agreement-body">{label('agreementBody')}</Label>
                    <Textarea
                      id="saving-agreement-body"
                      {...editor.bind('body')}
                      value={body}
                      dir="auto"
                      aria-required="true"
                      rows={inline ? 4 : 3}
                      className="min-h-20 max-h-72 resize-y placeholder-shown:[direction:inherit]"
                      placeholder={label('agreementBodyExample')}
                      onChange={(event) => setBody(event.target.value)}
                    />
                    {(inline || editor.errors.body) && editor.feedback('body')}
                  </div>
                </RecordEditorSection>
                <RecordEditorActions>
                  <Button type="submit" aria-busy={editor.pending || undefined}>
                    {editor.pending && (
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {label(editor.pending ? 'working' : 'saveAgreement')}
                  </Button>
                </RecordEditorActions>
              </fieldset>
            </form>
          )}
          {!inline && !publishing && canNavigate && (overview || draft) && (
            <div className="flex flex-wrap gap-2">
              {overview && (
                <Link
                  to="/admin/catalogue/$category/$productId/configuration/{-$operation}"
                  params={{ category: 'saving_plan', productId: planId, operation: 'agreement' }}
                  search={search}
                  className={buttonVariants({ size: 'sm' })}
                >
                  {label(draft ? 'editAgreementDraft' : 'createAgreementDraft')}
                </Link>
              )}
              {draft && !unsaved && (
                <Link
                  to="/admin/catalogue/$category/$productId/configuration/{-$operation}"
                  params={{
                    category: 'saving_plan',
                    productId: planId,
                    operation: 'activate-agreement',
                  }}
                  search={search}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {label('openAgreementActivation')}
                </Link>
              )}
            </div>
          )}
          {!inline && !overview && !publishing && unsaved && (
            <p className="text-sm text-muted-foreground">{label('saveAgreementFirst')}</p>
          )}
          {publishing && !draft && (
            <p role="status" className="rounded-lg border bg-card p-4 text-sm">
              {label(active ? 'activeAgreementInUse' : 'noSavedDraft')}
            </p>
          )}
          {draft && (inline || publishing) && (
            <div className="rounded-md border p-3">
              <p className="font-medium break-words">
                {label('draftAgreement')}: {draft.title}
              </p>
              {publishing && (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {label('agreementActivationHelp')}
                  </p>
                  <p
                    dir="auto"
                    className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/45 p-3 text-sm"
                  >
                    {draft.body}
                  </p>
                </>
              )}
              {inline && unsaved && (
                <p className="mt-2 text-sm text-muted-foreground">{label('saveAgreementFirst')}</p>
              )}
              <Button
                className="mt-3"
                disabled={editor.disabled || unsaved}
                onClick={() => {
                  if (!unsaved && !editor.disabled)
                    editor.propose(
                      action(
                        `${base}/agreements/${encodeURIComponent(draft.id)}/activate`,
                        'activateAgreement',
                        'confirmAgreementActivation'
                      )
                    );
                }}
              >
                {label('activateAgreement')}
              </Button>
            </div>
          )}
          {(overview || inline) && agreements.some((row) => row.status === 'superseded') && (
            <details>
              <summary className="cursor-pointer">{label('agreementHistory')}</summary>
              <ol className="space-y-2">
                {agreements
                  .filter((row) => row.status === 'superseded')
                  .map((row) => (
                    <li key={row.id} className="border-b py-2">
                      <p className="font-medium break-words">{row.title}</p>
                      <p className="whitespace-pre-wrap break-words">{row.body}</p>
                    </li>
                  ))}
              </ol>
            </details>
          )}
        </>
      )}
      {editor.action && (
        <TeamActionDialog
          action={editor.action}
          toastErrors={inline}
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
          onPendingChange={editor.onPendingChange}
          onUnconfirmed={editor.onUnconfirmed}
          {...(activation ? {} : { onValidationError: editor.onValidationError })}
          summary={
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium break-words">{String(summary?.title ?? '')}</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                {String(summary?.body ?? '')}
              </p>
              {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
            </div>
          }
          onSuccess={async (result) => {
            const expected = activation ? draft : editor.action?.body;
            if (
              !record(expected) ||
              typeof expected.title !== 'string' ||
              typeof expected.body !== 'string' ||
              !editor.verifyReceipt(
                matchesAgreementReceipt(
                  result,
                  planId,
                  { title: expected.title, body: expected.body },
                  activation ? draft?.id : undefined
                )
              )
            )
              return;
            const received = result as NonNullable<typeof draft>;
            const next = agreements
              .filter((row) => row.status !== 'draft')
              .map((row) =>
                activation && row.status === 'active'
                  ? { ...row, status: 'superseded' as const }
                  : row
              );
            editor.resource.accept({ planId, agreements: [received, ...next] });
            editor.complete();
            if (activation) onChanged();
            else editor.resource.retry();
          }}
        />
      )}
    </section>
  );
}
