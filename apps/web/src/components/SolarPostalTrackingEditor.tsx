import {
  useEffect,
  useRef,
  useState,
  type AriaAttributes,
  type ComponentProps,
  type FormEvent,
} from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  DatePicker,
  FinancialReviewSummary,
  Input,
  Textarea,
  datePickerCalendarDate,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import { postalCalendarDate, postalDateInput } from '../lib/solar-postal-tracking.js';
import {
  confirmedSolarTracking,
  definitiveSolarTrackingRejection,
  emptySolarTracking,
  solarTrackingCommand,
  solarTrackingDraft,
  solarTrackingReview,
  solarTrackingSnapshot,
  type SolarTrackingCommand,
  type SolarTrackingDraft,
  type SolarTrackingReview,
  type SolarTrackingSnapshot,
} from '../lib/solar-tracking-form.js';
import { SolarPostalTrackingSummary } from './SolarPostalTrackingSummary.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

function TrackingDateControl({
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  ...props
}: ComponentProps<typeof DatePicker> & Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'>) {
  return (
    <DatePicker
      {...props}
      {...(id ? { id } : {})}
      triggerProps={{
        ...props.triggerProps,
        'aria-invalid': invalid,
        'aria-describedby': describedBy,
      }}
    />
  );
}
interface Proposal {
  review: SolarTrackingReview;
  action: TeamAction;
  snapshot: SolarTrackingSnapshot;
  body: SolarTrackingCommand;
  generation: number;
  attempted: boolean;
  settled: boolean;
  unconfirmed: boolean;
}
export function SolarPostalTrackingEditor({
  requestId,
  onSaved,
  onDenied,
}: {
  requestId: string;
  onSaved: () => void;
  onDenied: () => void;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const actor = useAccountUser();
  const copy = (key: string) => tSolar(key, locale);
  const scopeKey = JSON.stringify([actor, requestId]);
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const callbacks = useRef({ onSaved, onDenied });
  callbacks.current = { onSaved, onDenied };
  const [detail, setDetail] = useState<SolarTrackingSnapshot | null>(null);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const shownDetail = acceptedScope === scopeKey ? detail : null;
  const detailRef = useRef(detail);
  detailRef.current = shownDetail;
  const profile = useRef<string | null>(null);
  const messages = {
    estimatedArrivalDate: copy('postalArrivalInvalid'),
    trackingUrl: copy('postalTrackingUrlInvalid'),
    note: copy('postalTrackingNoteInvalid'),
  };
  const form = useZodForm<SolarTrackingDraft>(
    async () => {
      const capturedGeneration = generation.current;
      const sendDate = detailRef.current?.sendDate ?? null;
      const schemas = await import('../lib/solar-tracking-form-schemas.js');
      return capturedGeneration === generation.current
        ? schemas.solarTrackingSchema(messages, sendDate)
        : schemas.inactiveSolarTrackingSchema;
    },
    {
      defaultValues: emptySolarTracking,
      validationUnavailableMessage: copy('progressValidationUnavailable'),
    }
  );
  const fieldErrors = useActionFieldErrors(form, messages, copy('postalTrackingSaveError'));
  const dirty = useRef(false);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const proposalRef = useRef<Proposal | null>(null);
  const recovering = useRef<Proposal | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const path = `/api/admin/solar/requests/${encodeURIComponent(requestId)}/postal/tracking`;
  function closeProposal() {
    const current = proposalRef.current;
    if (
      current &&
      current.generation === generation.current &&
      current.attempted &&
      (!current.settled || current.unconfirmed)
    ) {
      recovering.current = current;
      setUnconfirmed(true);
    }
    proposalRef.current = null;
    setProposal(null);
    commandPendingRef.current = false;
    setCommandPending(false);
  }
  function deny() {
    ++generation.current;
    detailRef.current = null;
    setDetail(null);
    setAcceptedScope(null);
    recovering.current = null;
    setUnconfirmed(false);
    closeProposal();
    dirty.current = false;
    form.reset(emptySolarTracking);
    setError('load');
    callbacks.current.onDenied();
  }
  useEffect(() => {
    profile.current = null;
    detailRef.current = null;
    setDetail(null);
    setAcceptedScope(null);
    recovering.current = null;
    setUnconfirmed(false);
    closeProposal();
    dirty.current = false;
    form.reset(emptySolarTracking);
    setError(null);
    preparingRef.current = false;
    setPreparing(false);
    return () => {
      ++generation.current;
    };
  }, [scopeKey]);
  useEffect(() => {
    const controller = new AbortController();
    const token = generation.current;
    const recoveryAtRead = commandPendingRef.current ? null : recovering.current;
    detailRef.current = null;
    setDetail(null);
    setError(null);
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted || token !== generation.current) return null;
        if ([401, 403, 404].includes(response.status)) {
          deny();
          return null;
        }
        if (!response.ok) throw new Error('tracking');
        const value: unknown = await response.json();
        if (controller.signal.aborted || token !== generation.current) return null;
        if (
          !solarTrackingSnapshot(value) ||
          value.requestId !== requestId ||
          typeof value.canEdit !== 'boolean'
        )
          throw new Error('tracking');
        return value;
      })
      .then((value) => {
        if (controller.signal.aborted || token !== generation.current || !value) return;
        if (profile.current && profile.current !== value.profileId) {
          ++generation.current;
          recovering.current = null;
          setUnconfirmed(false);
          dirty.current = false;
          form.reset(solarTrackingDraft(value));
        }
        profile.current = value.profileId;
        detailRef.current = value;
        setAcceptedScope(scopeKey);
        setDetail(value);
        if (
          recoveryAtRead &&
          recoveryAtRead === recovering.current &&
          !commandPendingRef.current &&
          confirmedSolarTracking(value, recoveryAtRead.snapshot, recoveryAtRead.body)
        ) {
          recovering.current = null;
          setUnconfirmed(false);
          dirty.current = false;
          form.reset(solarTrackingDraft(value));
          callbacks.current.onSaved();
        } else if (!dirty.current && !recovering.current) form.reset(solarTrackingDraft(value));
      })
      .catch(() => {
        if (!controller.signal.aborted && token === generation.current) {
          detailRef.current = null;
          setDetail(null);
          setError('load');
        }
      });
    return () => controller.abort();
  }, [path, scopeKey, revision]);
  function reload() {
    if (commandPendingRef.current) return;
    closeProposal();
    ++generation.current;
    preparingRef.current = false;
    setPreparing(false);
    detailRef.current = null;
    setDetail(null);
    setRevision((value) => value + 1);
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    const captured = detailRef.current;
    if (
      !captured?.canEdit ||
      preparingRef.current ||
      commandPendingRef.current ||
      proposalRef.current ||
      recovering.current ||
      form.isSubmissionPending()
    )
      return;
    const token = generation.current;
    const raw = { ...form.getValues() };
    preparingRef.current = true;
    setPreparing(true);
    setError(null);
    try {
      await form.handleSubmit(
        async () => {
          if (
            token !== generation.current ||
            captured !== detailRef.current ||
            !detailRef.current?.canEdit ||
            JSON.stringify(raw) !== JSON.stringify(form.getValues())
          )
            return;
          const body = solarTrackingCommand(raw, captured.revision, crypto.randomUUID());
          const response = await fetch(`${path}/review`, {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          });
          const value: unknown = await response.json().catch(() => null);
          if (token !== generation.current) return;
          if ([401, 403, 404].includes(response.status)) {
            deny();
            return;
          }
          if (!response.ok) {
            const data = value as { error?: { code?: unknown; fields?: unknown[] } } | null;
            if (
              response.status === 400 &&
              data?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(data.error.fields) &&
              fieldErrors(data.error.fields)
            )
              return;
            throw new Error('review');
          }
          if (!solarTrackingReview(value, captured, body)) throw new Error('review');
          const next: Proposal = {
            review: value,
            snapshot: { ...captured },
            body,
            generation: token,
            attempted: false,
            settled: false,
            unconfirmed: false,
            action: {
              title: copy('postalTrackingReviewTitle'),
              description: copy('postalTrackingReviewDescription'),
              path,
              method: 'POST',
              successStatus: 200,
              body: { ...body, expectedReviewHash: value.hash },
              conflictMessage: copy('postalTrackingChanged'),
              errorMessages: Object.fromEntries(
                [
                  ErrorCodes.VALIDATION_INPUT_INVALID.code,
                  ErrorCodes.CONFLICT_STATE.code,
                  ErrorCodes.CONFLICT_VERSION.code,
                  ErrorCodes.NOT_FOUND_RESOURCE.code,
                ].map((code) => [
                  code,
                  (error: unknown) => {
                    const current = proposalRef.current;
                    if (
                      current?.action === next.action &&
                      current.generation === generation.current &&
                      definitiveSolarTrackingRejection(error)
                    ) {
                      current.settled = true;
                      if (code === ErrorCodes.NOT_FOUND_RESOURCE.code) deny();
                    }
                    return code.startsWith('CONFLICT:')
                      ? copy('postalTrackingChanged')
                      : copy('postalTrackingSaveError');
                  },
                ])
              ),
            },
          };
          proposalRef.current = next;
          setProposal(next);
        },
        () => {
          if (token === generation.current) {
            preparingRef.current = false;
            setPreparing(false);
          }
        }
      )();
    } catch {
      if (token === generation.current) setError('save');
    } finally {
      if (token === generation.current) {
        preparingRef.current = false;
        setPreparing(false);
      }
    }
  }
  const locked =
    preparing || commandPending || form.formState.isSubmitting || !!proposal || unconfirmed;
  const estimate = form.watch('estimatedArrivalDate');
  const formatted = (value: string | null) =>
    postalCalendarDate(value, locale) ?? copy('postalNotRecorded');
  const message = (name: keyof SolarTrackingDraft) => (
    <div className="grid">
      <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
        {messages[name]}
      </p>
      <FormMessage className="col-start-1 row-start-1" />
    </div>
  );
  return (
    <section className="space-y-4 border-t pt-4" aria-label={copy('postalTrackingUpdate')}>
      <h3 className="text-lg font-semibold">{copy('postalTrackingUpdate')}</h3>
      {!detail && !error && <p role="status">{copy('loading')}</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {copy(error === 'load' ? 'postalTrackingLoadError' : 'postalTrackingSaveError')}
          </AlertDescription>
        </Alert>
      )}
      {unconfirmed && (
        <Alert variant="destructive">
          <AlertDescription>{copy('postalTrackingUnconfirmed')}</AlertDescription>
        </Alert>
      )}
      <Button
        id="postal-tracking-reload"
        type="button"
        variant="outline"
        disabled={commandPending}
        onClick={reload}
      >
        {copy('postalTrackingReload')}
      </Button>
      {unconfirmed && shownDetail && recovering.current && (
        <Button
          type="button"
          variant="outline"
          disabled={commandPending || !!proposal || preparing}
          onClick={() => {
            if (commandPendingRef.current || proposalRef.current || !recovering.current) return;
            const next = { ...recovering.current, generation: generation.current };
            recovering.current = next;
            proposalRef.current = next;
            setProposal(next);
          }}
        >
          {copy('postalTrackingRetry')}
        </Button>
      )}
      {shownDetail && (
        <>
          <SolarPostalTrackingSummary tracking={shownDetail} />
          {!shownDetail.canEdit && <p>{copy('postalTrackingBlocked')}</p>}
          {shownDetail.canEdit && (
            <Form {...form}>
              <form
                id="postal-tracking-form"
                noValidate
                className="space-y-4"
                aria-label={copy('postalTrackingReview')}
                onSubmit={(event) => void review(event)}
              >
                {form.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('progressValidationUnavailable')}</AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={form.control}
                  name="estimatedArrivalDate"
                  render={({ field }) => (
                    <FormItem id="postal-arrival-estimate">
                      <FormLabel id="postal-arrival-estimate-label">
                        {copy('postalArrivalEstimate')}
                      </FormLabel>
                      <FormControl>
                        <TrackingDateControl
                          locale={locale}
                          timezone={time.timezone}
                          disabled={locked || time.status !== 'ready'}
                          {...(field.value
                            ? { value: datePickerCalendarDate(field.value, time.timezone) }
                            : {})}
                          {...(shownDetail.sendDate
                            ? {
                                minDate: datePickerCalendarDate(
                                  shownDetail.sendDate,
                                  time.timezone
                                ),
                              }
                            : {})}
                          triggerProps={{
                            ref: field.ref,
                            name: field.name,
                            'aria-labelledby': 'postal-arrival-estimate-label',
                          }}
                          onBlur={field.onBlur}
                          onChange={(value) => {
                            dirty.current = true;
                            field.onChange(postalDateInput(value, time.timezone));
                          }}
                        />
                      </FormControl>
                      {estimate && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={locked}
                          onClick={() => {
                            dirty.current = true;
                            form.setValue('estimatedArrivalDate', '', {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            });
                          }}
                        >
                          {copy('postalClearEstimate')}
                        </Button>
                      )}
                      <FormDescription>{copy('postalEstimateHelp')}</FormDescription>
                      {message('estimatedArrivalDate')}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="trackingUrl"
                  render={({ field }) => (
                    <FormItem id="postal-tracking-url">
                      <FormLabel>{copy('postalTrackingUrl')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="url"
                          dir="ltr"
                          disabled={locked}
                          onChange={(event) => {
                            dirty.current = true;
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <FormDescription>{copy('postalTrackingUrlHelp')}</FormDescription>
                      {message('trackingUrl')}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem id="postal-tracking-note">
                      <FormLabel>{copy('postalTrackingNote')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          disabled={locked}
                          onChange={(event) => {
                            dirty.current = true;
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <FormDescription>{copy('postalTrackingNoteHelp')}</FormDescription>
                      {message('note')}
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  loading={preparing}
                  disabled={locked || time.status !== 'ready'}
                >
                  {copy('postalTrackingReview')}
                </Button>
              </form>
            </Form>
          )}
        </>
      )}
      {proposal && proposal.generation === generation.current && (
        <TeamActionDialog
          action={proposal.action}
          onClose={() => {
            if (proposalRef.current === proposal && proposal.generation === generation.current)
              closeProposal();
          }}
          onPendingChange={(pending) => {
            if (proposalRef.current !== proposal || proposal.generation !== generation.current)
              return;
            commandPendingRef.current = pending;
            if (pending) proposal.attempted = true;
            setCommandPending(pending);
          }}
          onDenied={() => {
            if (proposalRef.current === proposal && proposal.generation === generation.current)
              deny();
          }}
          onValidationError={(fields) => {
            if (proposalRef.current !== proposal || proposal.generation !== generation.current)
              return false;
            if (!fieldErrors(fields)) return false;
            proposal.settled = true;
            return true;
          }}
          onUnconfirmed={() => {
            if (proposalRef.current !== proposal || proposal.generation !== generation.current)
              return;
            recovering.current = proposal;
            proposal.unconfirmed = true;
            setUnconfirmed(true);
          }}
          onSuccess={async (value) => {
            if (proposalRef.current !== proposal || proposal.generation !== generation.current)
              return;
            if (!confirmedSolarTracking(value, proposal.snapshot, proposal.body))
              throw new Error('receipt');
            proposal.settled = true;
            proposal.unconfirmed = false;
            recovering.current = null;
            setUnconfirmed(false);
            dirty.current = false;
            form.reset(solarTrackingDraft(value));
            detailRef.current = { ...value, canEdit: proposal.snapshot.canEdit === true };
            setDetail(detailRef.current);
            callbacks.current.onSaved();
          }}
          summary={
            <FinancialReviewSummary
              title={copy('postalTrackingReviewTitle')}
              total={{
                label: copy('postalTrackingUpdate'),
                value: copy('postalTrackingReviewDescription'),
              }}
              rows={[
                {
                  id: 'courier',
                  label: copy('postalCourier'),
                  value: proposal.review.data.courier ?? copy('postalNotRecorded'),
                },
                {
                  id: 'tracking',
                  label: copy('postalTracking'),
                  value: (
                    <bdi dir="ltr">
                      {proposal.review.data.trackingNumber ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'sent',
                  label: copy('postalSendDate'),
                  value: formatted(proposal.review.data.sendDate),
                },
                {
                  id: 'previous-estimate',
                  label: copy('postalTrackingPrevious'),
                  value: formatted(proposal.review.data.previousEstimatedArrivalDate),
                },
                {
                  id: 'estimate',
                  label: copy('postalArrivalEstimate'),
                  value: formatted(proposal.review.data.estimatedArrivalDate),
                },
                {
                  id: 'previous-url',
                  label: copy('postalTrackingPreviousUrl'),
                  value: (
                    <bdi dir="ltr" className="break-all">
                      {proposal.review.data.previousTrackingUrl ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'url',
                  label: copy('postalTrackingUrl'),
                  value: (
                    <bdi dir="ltr" className="break-all">
                      {proposal.review.data.trackingUrl ?? copy('postalNotRecorded')}
                    </bdi>
                  ),
                },
                {
                  id: 'previous-note',
                  label: copy('postalTrackingPreviousNote'),
                  value: proposal.review.data.previousNote ?? copy('postalNotRecorded'),
                },
                {
                  id: 'note',
                  label: copy('postalTrackingNote'),
                  value: proposal.review.data.note ?? '',
                },
              ]}
            />
          }
        />
      )}
    </section>
  );
}
