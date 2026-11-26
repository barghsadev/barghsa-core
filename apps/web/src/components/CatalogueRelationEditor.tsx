import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SearchIcon } from 'lucide-react';
import {
  Alert,
  Button,
  ComboBox,
  ComboBoxInput,
  ComboBoxItem,
  ComboBoxPopup,
  Input,
  Label,
  ListRefreshButton,
} from '@barghsa/ui';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { policyPriority } from '../lib/knowledge-policy-form.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import type { MembershipCommand, RelationOwner } from '../lib/catalogue-membership.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';

export type ReviewedMembershipCommand = MembershipCommand & {
  memberTitle: string;
  groupTitle: string;
  currentPriority?: string;
  newPriority?: string;
};

export function CatalogueMembershipReview({
  command,
  locale,
  refresh,
}: {
  command: ReviewedMembershipCommand;
  locale: 'fa' | 'en';
  refresh?: { label: string; disabled: boolean; onClick: () => void } | undefined;
}) {
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  return (
    <div className="relative">
      <dl
        className={`grid min-w-0 gap-x-4 gap-y-2 rounded-lg border bg-muted/25 p-3 text-sm sm:grid-cols-2 ${refresh ? 'pe-14' : ''}`}
      >
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{copy('membershipMember')}</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">
            <bdi>{command.memberTitle}</bdi>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{copy('membershipGroup')}</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">
            <bdi>{command.groupTitle}</bdi>
          </dd>
        </div>
        {command.currentPriority !== undefined && (
          <div>
            <dt className="text-xs text-muted-foreground">{copy('currentPriority')}</dt>
            <dd>
              <bdi>{command.currentPriority}</bdi>
            </dd>
          </div>
        )}
        {command.newPriority !== undefined && (
          <div>
            <dt className="text-xs text-muted-foreground">{copy('newPriority')}</dt>
            <dd className="font-medium">
              <bdi>{command.newPriority}</bdi>
            </dd>
          </div>
        )}
      </dl>
      {refresh && <ListRefreshButton {...refresh} className="absolute end-1 top-1" />}
    </div>
  );
}

interface Draft {
  memberId: string;
  priorityOverride: string;
}
type MemberOption = { id: string; title: string };
function matchableMemberName(value: string) {
  return normalizeProfileDigits(value)
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s\u200c]+/g, ' ');
}
interface Props {
  mode: 'kb' | 'policy' | 'priority';
  headingLevel?: 2 | 3;
  locale: 'en' | 'fa';
  id: string;
  value: string;
  priority?: string;
  priorityName?: string;
  savedPriority?: string;
  options?: MemberOption[];
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
  const [memberQuery, setMemberQuery] = useState('');
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
  const priorityOnly = props.mode === 'priority';
  const Heading = props.headingLevel === 2 ? 'h2' : 'h3';
  const priorityId = priorityOnly ? props.id : `${props.id}-priority`;
  const hintId = `${priorityId}-hint`;
  const priorityField = form.bind('priorityOverride');
  const memberField = form.bind('memberId');
  const { memberId } = form.values;
  const options = props.options ?? [];
  // Use the latest input even when reopening interrupts a popup close.
  const query = matchableMemberName(memberQuery);
  const selectedMember =
    options.find((option) => option.id === memberId) ??
    (memberId ? { id: memberId, title: props.labels.unavailable } : null);
  const disabled = props.disabled || form.pending;
  const resetButton = changed && !props.disabled && (
    <Button type="button" variant="outline" disabled={form.pending} onClick={reset}>
      {copy('reset')}
    </Button>
  );
  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className={priorityOnly ? 'min-w-0 space-y-2' : recordEditorSurface}
      aria-busy={form.pending}
    >
      {!priorityOnly && (
        <header className="border-b bg-muted/30 px-4 py-3">
          <Heading className="text-base font-semibold">
            {copy(props.mode === 'kb' ? 'addKnowledgeMember' : 'addPolicyMember')}
          </Heading>
        </header>
      )}
      <div className={priorityOnly ? 'space-y-2' : 'space-y-2 p-4'}>
        {changed && <Alert variant="warning">{copy('changed')}</Alert>}
        {root && <p role="alert">{root}</p>}
        <fieldset
          disabled={disabled}
          className={`grid min-w-0 gap-3 ${props.mode === 'policy' ? 'sm:grid-cols-2' : ''}`}
        >
          {props.mode !== 'priority' && (
            <div className="min-w-0 space-y-1">
              <Label htmlFor={props.id}>{props.labels.member}</Label>
              <ComboBox
                items={options}
                filteredItems={
                  query
                    ? options.filter((option) => matchableMemberName(option.title).includes(query))
                    : options
                }
                value={selectedMember}
                itemToStringLabel={(option) => option.title}
                itemToStringValue={(option) => option.id}
                isItemEqualToValue={(option, value) => option.id === value.id}
                onInputValueChange={(value, { reason }) => {
                  if (reason === 'input-change') setMemberQuery(value);
                }}
                onOpenChange={(open) => {
                  if (!open) setMemberQuery('');
                }}
                openOnInputClick
                autoHighlight
                disabled={disabled}
                onValueChange={(option) => {
                  if (disabled || (option && !options.some((row) => row.id === option.id))) return;
                  const id = option?.id ?? '';
                  form.field('memberId')[1](id);
                  props.onChange(id, form.values.priorityOverride);
                }}
              >
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <ComboBoxInput
                  id={props.id}
                  ref={memberField.ref}
                  onBlur={memberField.onBlur}
                  placeholder={copy('memberSearch')}
                  aria-required="true"
                  aria-invalid={memberField['aria-invalid']}
                  aria-describedby={memberField['aria-describedby']}
                  className="h-11 ps-9 aria-invalid:border-destructive"
                />
                <ComboBoxPopup
                  dir={props.locale === 'fa' ? 'rtl' : 'ltr'}
                  emptyMessage={copy(options.length ? 'memberNoMatches' : 'memberNone')}
                  className="max-h-[min(18rem,var(--available-height))] w-(--anchor-width) min-w-0 p-1 data-closed:animate-none"
                >
                  {(option: MemberOption) => (
                    <ComboBoxItem key={option.id} value={option} className="min-h-11">
                      <bdi className="min-w-0 [overflow-wrap:anywhere]">{option.title}</bdi>
                    </ComboBoxItem>
                  )}
                </ComboBoxPopup>
              </ComboBox>
              <CatalogueFieldFeedback
                id={form.errorId('memberId')}
                error={form.errors.memberId}
                message={messages.memberId}
                compact
              />
            </div>
          )}
          {props.mode !== 'kb' && (
            <div className="min-w-0 space-y-1">
              <Label htmlFor={priorityId}>{props.labels.priority}</Label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  {...priorityField}
                  id={priorityId}
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  className={priorityOnly ? 'w-28 max-w-full' : 'w-full'}
                  aria-label={props.priorityName}
                  aria-describedby={priorityField['aria-describedby'] ?? hintId}
                  value={form.values.priorityOverride}
                  onChange={(event) => {
                    form.field('priorityOverride')[1](event.target.value);
                    props.onChange(form.values.memberId, event.target.value);
                  }}
                />
                {priorityOnly && (
                  <Button type="submit" variant="outline" disabled={changed} loading={form.pending}>
                    {props.labels.save}
                  </Button>
                )}
              </div>
              {form.errors.priorityOverride ? (
                <CatalogueFieldFeedback
                  id={form.errorId('priorityOverride')}
                  error={form.errors.priorityOverride}
                  message={messages.priorityOverride}
                  compact
                />
              ) : (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {props.labels.inherit || copy('inheritPriorityHint')}
                </p>
              )}
            </div>
          )}
        </fieldset>
        {priorityOnly && resetButton}
      </div>
      {!priorityOnly && (
        <RecordEditorActions>
          {resetButton}
          <CatalogueSaveButton
            label={props.labels.save}
            pending={form.pending}
            disabled={props.disabled || form.pending || changed}
          />
        </RecordEditorActions>
      )}
    </form>
  );
}
