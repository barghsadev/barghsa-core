import { useEffect, useRef, type FormEvent } from 'react';
import { Input, Label } from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
interface Props {
  locale: 'fa' | 'en';
  value: string;
  epoch: number;
  disabled: boolean;
  label: string;
  saveLabel: string;
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
  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2"
      aria-busy={form.pending}
    >
      {root && <p role="alert">{root}</p>}
      <fieldset disabled={props.disabled || form.pending} className="flex min-w-0 flex-col gap-2">
        <Label htmlFor="kb-test-query">{props.label}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            {...form.bind('query')}
            id="kb-test-query"
            value={form.values.query}
            onChange={(event) => {
              form.field('query')[1](event.target.value);
              props.onChange(event.target.value);
            }}
          />
          <CatalogueSaveButton label={props.saveLabel} pending={form.pending} disabled={false} />
        </div>
        <CatalogueFieldFeedback
          id={form.errorId('query')}
          error={form.errors.query}
          message={messages.query}
        />
      </fieldset>
    </form>
  );
}
