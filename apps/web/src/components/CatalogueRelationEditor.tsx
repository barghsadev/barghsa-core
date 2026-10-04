import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { policyPriority } from '../lib/knowledge-policy-form.js';
import type { RelationOwner } from '../lib/catalogue-membership.js';

interface Draft {
  memberId: string;
  priorityOverride: string;
}
interface Props {
  mode: 'kb' | 'policy' | 'priority';
  locale: 'en' | 'fa';
  id: string;
  value: string;
  priority?: string;
  savedPriority?: string;
  options?: { id: string; title: string }[];
  basis: string;
  epoch: number;
  disabled: boolean;
  labels: { member: string; priority: string; inherit: string; save: string; unavailable: string };
  onChange: (memberId: string, priority: string) => void;
  onSubmit: (value: Draft, owner: RelationOwner) => void;
}
/** One independently validated form per assignment or priority override. */
export function CatalogueRelationEditor(props: Props) {
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, props.locale);
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(true),
    baseline = useRef(props.basis);
  const [changed, setChanged] = useState(false);
  const messages = { memberId: copy('member'), priorityOverride: copy('priority') };
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<Draft>(messages, (value) => {
        const errors: (keyof Draft)[] = [];
        if (
          live.current.mode !== 'priority' &&
          !live.current.options?.some((row) => row.id === value.memberId)
        )
          errors.push('memberId');
        if (
          live.current.mode !== 'kb' &&
          value.priorityOverride.trim() &&
          policyPriority(value.priorityOverride) === null
        )
          errors.push('priorityOverride');
        return errors;
      });
    },
    { memberId: props.value, priorityOverride: props.priority ?? '' },
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
    if (baseline.current !== props.basis) {
      if (form.form.formState.isDirty) setChanged(true);
      else baseline.current = props.basis;
    }
    const value = form.form.getValues();
    if (value.memberId !== props.value || value.priorityOverride !== (props.priority ?? ''))
      form.form.reset({ memberId: props.value, priorityOverride: props.priority ?? '' });
  }, [
    props.value,
    props.priority,
    props.basis,
    form.form.getValues,
    form.form.reset,
    form.form.formState.isDirty,
  ]);
  function reset() {
    if (!mounted.current) return;
    const next = {
      memberId: live.current.mode === 'priority' ? live.current.value : '',
      priorityOverride: live.current.mode === 'priority' ? (live.current.savedPriority ?? '') : '',
    };
    form.form.reset(next);
    baseline.current = live.current.basis;
    setChanged(false);
    live.current.onChange(next.memberId, next.priorityOverride);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (props.disabled || changed || form.isPending()) return;
    const { basis, epoch } = props;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (
          !mounted.current ||
          live.current.disabled ||
          live.current.basis !== basis ||
          live.current.epoch !== epoch
        )
          return;
        live.current.onSubmit(value, {
          fields: (names) => {
            const allowed =
              props.mode === 'kb'
                ? ['kbId']
                : props.mode === 'priority'
                  ? ['priorityOverride']
                  : ['policyId', 'priorityOverride'];
            return (
              names.every((name) => allowed.includes(name as string)) &&
              fields(
                names.map((name) => (name === 'kbId' || name === 'policyId' ? 'memberId' : name))
              )
            );
          },
          verified: (next) => {
            if (!mounted.current) return;
            if (props.mode !== 'priority') reset();
            baseline.current = next;
            setChanged(false);
          },
          reset,
        });
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
      className="flex min-w-0 flex-col gap-2"
      aria-busy={form.pending}
    >
      {changed && <p role="alert">{copy('changed')}</p>}
      {root && <p role="alert">{root}</p>}
      <fieldset
        disabled={props.disabled || form.pending}
        className="flex min-w-0 flex-wrap items-end gap-3"
      >
        {props.mode !== 'priority' && (
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={props.id}>{props.labels.member}</Label>
            <select
              {...form.bind('memberId')}
              id={props.id}
              className="max-w-full rounded-md border bg-background p-2"
              value={form.values.memberId}
              onChange={(event) => {
                form.field('memberId')[1](event.target.value);
                props.onChange(event.target.value, form.values.priorityOverride);
              }}
            >
              <option value="">{props.labels.member}</option>
              {form.values.memberId &&
                !props.options?.some((row) => row.id === form.values.memberId) && (
                  <option value={form.values.memberId}>
                    {props.labels.unavailable} ({form.values.memberId})
                  </option>
                )}
              {props.options?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
            <CatalogueFieldFeedback
              id={form.errorId('memberId')}
              error={form.errors.memberId}
              message={messages.memberId}
            />
          </div>
        )}
        {props.mode !== 'kb' && (
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={props.mode === 'priority' ? props.id : `${props.id}-priority`}>
              {props.labels.priority}
            </Label>
            <Input
              {...form.bind('priorityOverride')}
              id={props.mode === 'priority' ? props.id : `${props.id}-priority`}
              type="text"
              inputMode="numeric"
              dir="ltr"
              placeholder={props.labels.inherit}
              value={form.values.priorityOverride}
              onChange={(event) => {
                form.field('priorityOverride')[1](event.target.value);
                props.onChange(form.values.memberId, event.target.value);
              }}
            />
            <CatalogueFieldFeedback
              id={form.errorId('priorityOverride')}
              error={form.errors.priorityOverride}
              message={messages.priorityOverride}
            />
          </div>
        )}
        <CatalogueSaveButton label={props.labels.save} pending={form.pending} disabled={changed} />
        {changed && !props.disabled && (
          <Button type="button" variant="outline" onClick={reset}>
            {copy('reset')}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
