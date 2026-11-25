import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { ListSearchInput } from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { recordEditorSurface } from './RecordEditorLayout.js';
interface Props {
  locale: 'fa' | 'en';
  value: string;
  epoch: number;
  disabled: boolean;
  notIndexed?: boolean;
  headingLevel: 2 | 3;
  label: string;
  saveLabel: string;
  children?: ReactNode;
  onChange: (value: string) => void;
  onQuery: (query: string, fields: (value: unknown[]) => boolean) => Promise<void>;
}
export function CatalogueQueryEditor(props: Props) {
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(true);
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, props.locale);
  const messages = { query: copy('query') };
  const form = useWizardForm<{ query: string }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<{ query: string }>(messages, (value) =>
        !value.query.trim() || value.query.trim().length > 500 ? ['query'] : []
      );
    },
    { query: props.value },
    copy('unavailable')
  );
  const fields = useActionFieldErrors(form.form, messages, copy('invalid'));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (form.form.getValues('query') !== props.value) form.form.reset({ query: props.value });
  }, [props.value, form.form.getValues, form.form.reset]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (props.disabled || form.isPending()) return;
    const epoch = props.epoch;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit(async (value) => {
        if (!mounted.current || live.current.disabled || live.current.epoch !== epoch) return;
        await props.onQuery(value.query.trim(), fields);
      })();
    } finally {
      if (mounted.current) form.setValidationPending(false);
    }
  }
  const root = catalogueRootMessage(form.errors);
  const titleId = useId();
  const Heading = props.headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={recordEditorSurface} aria-labelledby={titleId}>
      <header className="space-y-1 border-b bg-muted/30 px-4 py-3">
        <Heading id={titleId} className="text-base font-semibold">
          {props.label}
        </Heading>
        <p className="text-sm text-muted-foreground">{copy('queryHelp')}</p>
      </header>
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="space-y-2 px-4 py-3"
        aria-busy={form.pending}
      >
        {root && <p role="alert">{root}</p>}
        <fieldset disabled={props.disabled || form.pending} className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 basis-36">
              <ListSearchInput
                {...form.bind('query')}
                id="kb-test-query"
                label={props.label}
                placeholder={copy('queryPlaceholder')}
                aria-required="true"
                value={form.values.query}
                onBlur={() => {
                  // Disabling the field for a submit can also blur it. A local check
                  // must not overwrite that submit's result or an unchanged server error.
                  if (form.isPending() || form.form.getFieldState('query').error?.type === 'server')
                    return;
                  form.form.setValue('query', form.form.getValues('query'), {
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                }}
                onChange={(event) => {
                  form.field('query')[1](event.target.value);
                  props.onChange(event.target.value);
                }}
              />
            </div>
            <CatalogueSaveButton label={props.saveLabel} pending={form.pending} disabled={false} />
          </div>
          <CatalogueFieldFeedback
            id={form.errorId('query')}
            error={form.errors.query}
            message={messages.query}
            compact
          />
        </fieldset>
        {props.notIndexed && (
          <p className="text-sm text-muted-foreground">{copy('queryNotReady')}</p>
        )}
      </form>
      {props.children}
    </section>
  );
}
