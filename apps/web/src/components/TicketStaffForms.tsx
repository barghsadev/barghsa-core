import { useRef, type FormEvent } from 'react';
import { Button, NativeSelect, Textarea } from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import type { Ticket } from './TicketQueueRecords.js';
import {
  ticketTransitions,
  ticketStatusReceipt,
  ticketAssignmentReceipt,
  type TicketAssignee,
  type TicketTeam,
  type TicketAssignmentValues,
  type TicketStatusValues,
  type TicketCommandSender,
  type TicketCoordination,
  type TicketOwner,
} from '../lib/ticket-form.js';
import { useTicketFormFeedback } from '../hooks/useTicketFormFeedback.js';
export function TicketStaffForms({
  ticket,
  scope,
  locale,
  canWrite,
  canAssign,
  people,
  groups,
  optionsLoading,
  optionsError,
  refreshOptions,
  locked,
  coordination,
  send,
  onSaved,
  failed,
}: {
  ticket: Ticket;
  scope: string;
  locale: Locale;
  canWrite: boolean;
  canAssign: boolean;
  people: TicketAssignee[];
  groups: TicketTeam[];
  optionsLoading: boolean;
  optionsError: string;
  refreshOptions: () => void;
  locked: boolean;
  coordination: TicketCoordination;
  send: TicketCommandSender;
  onSaved: () => Promise<void>;
  failed: (owner: TicketOwner) => void;
}) {
  const text = (key: string) => t('tickets.' + key, locale),
    copy = (key: string) => tTicketForms(key, locale);
  const current = useRef(scope);
  current.current = scope;
  const options = useRef({ people, groups });
  options.current = { people, groups };
  const transitions = [
      ...ticketTransitions[ticket.status],
      ...(ticket.status !== 'open' ? ['open'] : []),
    ],
    offered = useRef(transitions);
  offered.current = transitions;
  const status = useZodForm<TicketStatusValues>(
    async () => {
      const token = scope;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return current.current === token && coordination.isCurrent()
        ? schema.ticketStatusSchema(copy, () => offered.current)
        : schema.inactiveTicketSchema;
    },
    {
      defaultValues: { status: transitions[0] ?? 'open', reason: '' },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const assignment = useZodForm<TicketAssignmentValues>(
    async () => {
      const token = scope;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return current.current === token && coordination.isCurrent()
        ? schema.ticketAssignmentSchema(
            copy,
            (id) => !id || options.current.groups.some((g) => g.id === id),
            (id, team) =>
              options.current.people.some((p) => p.id === id) &&
              (!team || !!options.current.groups.find((g) => g.id === team)?.members.includes(id))
          )
        : schema.inactiveTicketSchema;
    },
    {
      defaultValues: { teamId: ticket.assignedTeamId ?? '', assigneeId: ticket.assignedTo ?? '' },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const statusFeedback = useTicketFormFeedback(
    status,
    scope,
    locked,
    coordination,
    { reason: copy('reasonInvalid') },
    text('error'),
    canWrite
  );
  const assignmentFeedback = useTicketFormFeedback(
    assignment,
    scope,
    locked || optionsLoading || !!optionsError,
    coordination,
    {},
    text('error'),
    canAssign
  );
  const teamId = assignment.watch('teamId'),
    statusTarget = status.watch('status');
  async function saveStatus(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !coordination.claim('status')) return;
    const raw = { ...status.getValues() },
      source = ticket,
      token = scope;
    try {
      const submitValidated = async () => {
        if (current.current !== token || !coordination.isCurrent()) return;
        const body = {
          status: raw.status,
          reason: raw.reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        };
        await send({
          owner: 'status',
          path: '/api/staff/tickets/' + source.id + '/status',
          method: 'PATCH',
          status: 200,
          body,
          confirmed: (v) => ticketStatusReceipt(v, source, raw.status),
          fields: statusFeedback.fields,
          accepted: async (value) => {
            if (current.current !== token) return;
            const updated = value as Ticket;
            status.reset({ status: ticketTransitions[updated.status][0] ?? 'open', reason: '' });
            await onSaved();
          },
        });
      };
      await status.handleSubmit(submitValidated, (errors) => {
        statusFeedback.invalid(errors);
        coordination.release('status');
      })(e);
    } catch {
      failed('status');
    } finally {
      coordination.release('status');
    }
  }
  async function assign(e: FormEvent) {
    e.preventDefault();
    if (!canAssign || optionsLoading || optionsError || !coordination.claim('assignment')) return;
    const raw = { ...assignment.getValues() },
      source = ticket,
      token = scope;
    try {
      const submitValidated = async () => {
        if (current.current !== token || !coordination.isCurrent()) return;
        const body = {
          assigneeId: raw.assigneeId,
          ...(raw.teamId ? { teamId: raw.teamId } : {}),
          idempotencyKey: crypto.randomUUID(),
        };
        await send({
          owner: 'assignment',
          path: '/api/staff/tickets/' + source.id + '/assign',
          method: 'PUT',
          status: 200,
          body,
          confirmed: (v) => ticketAssignmentReceipt(v, source, raw.assigneeId, raw.teamId),
          accepted: async () => {
            if (current.current !== token) return;
            assignment.reset(raw);
            await onSaved();
          },
        });
      };
      await assignment.handleSubmit(submitValidated, (errors) => {
        assignmentFeedback.invalid(errors);
        coordination.release('assignment');
      })(e);
    } catch {
      failed('assignment');
    } finally {
      coordination.release('assignment');
    }
  }
  return (
    <>
      {canAssign && (
        <div className="flex flex-col gap-3">
          {optionsLoading && <p role="status">{text('loading')}</p>}
          {optionsError && (
            <div role="alert">
              <p>{text(optionsError === 'forbidden' ? 'forbidden' : 'assignmentError')}</p>
              {optionsError !== 'forbidden' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    if (!coordination.isLocked()) refreshOptions();
                  }}
                >
                  {text('retry')}
                </Button>
              )}
            </div>
          )}
          <Form {...assignment}>
            <form
              ref={assignmentFeedback.element}
              data-slot="ticket-assignment-form"
              aria-label={text('assign')}
              noValidate
              onSubmit={(e) => void assign(e)}
            >
              <fieldset
                disabled={locked || optionsLoading || !!optionsError}
                className="flex min-w-0 flex-wrap items-end gap-3"
              >
                <FormField
                  control={assignment.control}
                  name="teamId"
                  render={({ field }) => (
                    <FormItem id="ticket-team">
                      <FormLabel>{text('team')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          disabled={locked}
                          onChange={(e) => {
                            if (coordination.isLocked()) return;
                            field.onChange(e);
                            assignment.setValue('assigneeId', '');
                          }}
                        >
                          <option value="">{text('directAssignment')}</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={assignment.control}
                  name="assigneeId"
                  render={({ field }) => (
                    <FormItem id="ticket-assignee">
                      <FormLabel>{text('assignee')}</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={locked}>
                          <option value="">{text('choose')}</option>
                          {people
                            .filter(
                              (p) =>
                                !teamId ||
                                groups.find((g) => g.id === teamId)?.members.includes(p.id)
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={locked}>
                  {assignment.formState.isSubmitting && (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                    />
                  )}
                  {text(assignment.formState.isSubmitting ? 'saving' : 'assign')}
                </Button>
              </fieldset>
            </form>
          </Form>
        </div>
      )}
      {canWrite && (
        <Form {...status}>
          <form
            ref={statusFeedback.element}
            data-slot="ticket-status-form"
            aria-label={text('saveStatus')}
            noValidate
            onSubmit={(e) => void saveStatus(e)}
            className="flex flex-wrap items-end gap-3"
          >
            <fieldset disabled={locked} className="contents">
              <FormField
                control={status.control}
                name="status"
                render={({ field }) => (
                  <FormItem id="ticket-next-status">
                    <FormLabel>{text('changeStatus')}</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} disabled={locked}>
                        {!transitions.includes(statusTarget) && (
                          <option value={statusTarget} disabled>
                            {text(statusTarget)}
                          </option>
                        )}
                        {transitions.map((v) => (
                          <option key={v} value={v}>
                            {text(v)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={status.control}
                name="reason"
                render={({ field }) => (
                  <FormItem id="ticket-status-reason" className="min-w-0 flex-1 basis-full">
                    <FormLabel>{text('statusReason')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} disabled={locked} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={locked || (ticket.status === 'open' && !ticket.assignedTo)}
              >
                {status.formState.isSubmitting && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {text(status.formState.isSubmitting ? 'saving' : 'saveStatus')}
              </Button>
            </fieldset>
          </form>
        </Form>
      )}
    </>
  );
}
