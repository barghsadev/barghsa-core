import { useCallback } from 'react';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { Button, Label, Input, Textarea, Alert } from '@barghsa/ui';
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
  ...props
}: CatalogueEditorProps & { planId: string; onChanged: () => void }) {
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
  const summary = activation
    ? draft
    : editor.action && record(editor.action.body)
      ? editor.action.body
      : null;
  return (
    <section className="space-y-4 border-y py-5" aria-label={label('agreement')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{label('agreement')}</h2>
        <Button
          type="button"
          variant="outline"
          disabled={editor.busy || props.disabled}
          onClick={editor.refresh}
        >
          {label(editor.resource.error || editor.denied ? 'retry' : 'refresh')}
        </Button>
      </div>
      {editor.denied && <Alert variant="destructive">{label('denied')}</Alert>}
      {editor.resource.loading && <p role="status">{label('loading')}</p>}
      {editor.resource.error && <Alert variant="destructive">{label('agreementLoadError')}</Alert>}
      {editor.saved && <p role="status">{label('saved')}</p>}
      {editor.uncertain && <Alert variant="destructive">{label('unverifiedSaving')}</Alert>}
      {config && (
        <>
          <p className="text-sm text-muted-foreground">{label('agreementHelp')}</p>
          {active && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer font-medium">
                {label('activeAgreement')}: {active.title}
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words">{active.body}</p>
            </details>
          )}
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
            className="space-y-3"
          >
            {rootError && <Alert variant="destructive">{rootError}</Alert>}
            <fieldset disabled={editor.disabled} className="min-w-0 space-y-3 border-0 p-0">
              <div>
                <Label htmlFor="saving-agreement-title">{label('agreementTitle')}</Label>
                <Input
                  id="saving-agreement-title"
                  {...editor.bind('title')}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                {editor.feedback('title')}
              </div>
              <div>
                <Label htmlFor="saving-agreement-body">{label('agreementBody')}</Label>
                <Textarea
                  id="saving-agreement-body"
                  {...editor.bind('body')}
                  value={body}
                  rows={8}
                  onChange={(event) => setBody(event.target.value)}
                />
                {editor.feedback('body')}
              </div>
              <Button type="submit" aria-busy={editor.pending || undefined}>
                {editor.pending && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {label(editor.pending ? 'working' : 'saveAgreement')}
              </Button>
            </fieldset>
          </form>
          {draft && (
            <div className="rounded-md border p-3">
              <p className="font-medium break-words">
                {label('draftAgreement')}: {draft.title}
              </p>
              {unsaved && (
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
          {agreements.some((row) => row.status === 'superseded') && (
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
          confirmationDisabled={!editor.ready || editor.uncertain}
          onClose={editor.close}
          onDenied={editor.onDenied}
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
