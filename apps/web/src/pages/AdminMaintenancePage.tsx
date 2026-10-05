import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, DatePicker, Input, Label } from '@barghsa/ui';
import {
  Form,
  FormInput,
  FormTextarea,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
} from '@barghsa/ui/form';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  isMaintenanceList,
  maintenanceDraft,
  maintenanceErrors,
  maintenancePayload,
  matchesMaintenanceReceipt,
  type MaintenanceDraft,
  type MaintenanceSetting,
} from '../lib/maintenance-form.js';

export default function AdminMaintenancePage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tMaintenance(key, locale);
  const [settings, setSettings] = useState<MaintenanceSetting[]>([]);
  const [selected, setSelected] = useState<MaintenanceSetting | null>(null);
  const [draftZone, setDraftZone] = useState(time.timezone);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const owned = useRef(false);
  const reading = useRef(true);
  const generation = useRef(0);
  const captured = useRef<{
    capability: MaintenanceSetting['capability'];
    body: ReturnType<typeof maintenancePayload>;
    generation: number;
  } | null>(null);
  const errorFocus = useRef<keyof MaintenanceDraft | null>(null);
  const form = useZodForm<MaintenanceDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<MaintenanceDraft>(
        {
          active: copy('invalidField'),
          reasonFa: copy('invalidReason'),
          reasonEn: copy('invalidReason'),
          owner: copy('invalidOwner'),
          deadline: copy('invalidDeadline'),
        },
        (value) => maintenanceErrors(value, draftZone)
      );
    },
    {
      defaultValues: maintenanceDraft(null, time.timezone),
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const draft = form.watch();
  const latest = selected ? settings.find((row) => row.capability === selected.capability) : null;
  const stale = !!selected && !!latest && JSON.stringify(latest) !== JSON.stringify(selected);
  const zoneChanged = time.status === 'ready' && draftZone !== time.timezone;
  const locked = validating || !!action || uncertain;
  const canEdit = state === 'ready' && time.status === 'ready' && !stale && !zoneChanged;

  function clearPrivate() {
    ++generation.current;
    owned.current = false;
    captured.current = null;
    errorFocus.current = null;
    setSelected(null);
    form.reset(maintenanceDraft(null, time.timezone));
    setAction(null);
    setUncertain(false);
    setSaved(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    reading.current = true;
    setState('loading');
    void fetch('/api/admin/maintenance', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error([401, 403].includes(response.status) ? 'denied' : 'error');
        const result: unknown = await response.json();
        if (!isMaintenanceList(result)) throw new Error('error');
        if (!controller.signal.aborted) {
          reading.current = false;
          setSettings(result);
          setState('ready');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        reading.current = false;
        const denied = error instanceof Error && error.message === 'denied';
        setState(denied ? 'denied' : 'error');
        if (denied) {
          setSettings([]);
          clearPrivate();
        }
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!locked && errorFocus.current) {
      form.setFocus(errorFocus.current);
      errorFocus.current = null;
    }
  }, [locked]);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );

  function edit(setting: MaintenanceSetting) {
    if (owned.current || reading.current || state !== 'ready' || time.status !== 'ready') return;
    ++generation.current;
    setSelected(setting);
    setDraftZone(time.timezone);
    form.reset(maintenanceDraft(setting, time.timezone));
    setSaved(false);
  }
  function closeAction() {
    setAction(null);
    if (!uncertain) {
      owned.current = false;
      captured.current = null;
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || owned.current || reading.current || !canEdit) return;
    owned.current = true;
    setValidating(true);
    const current = generation.current;
    try {
      await form.handleSubmit((value) => {
        if (current !== generation.current) return;
        const body = maintenancePayload(value, draftZone, selected.version);
        captured.current = { capability: selected.capability, body, generation: current };
        setAction({
          title: copy('save'),
          description: copy('confirm'),
          path: `/api/admin/maintenance/${selected.capability}`,
          method: 'PUT',
          body,
          successStatus: 200,
          forbiddenMessage: copy('denied'),
          conflictMessage: copy('versionConflict'),
        });
      })(event);
    } finally {
      setValidating(false);
      if (!captured.current) owned.current = false;
    }
  }
  function unconfirmed() {
    if (!captured.current || captured.current.generation !== generation.current) return;
    setAction(null);
    setUncertain(true);
    setSaved(false);
    refresh();
  }
  function refresh() {
    reading.current = true;
    setState('loading');
    setRevision((value) => value + 1);
  }
  function fieldError(name: keyof MaintenanceDraft) {
    return copy(
      name === 'deadline'
        ? 'invalidDeadline'
        : name === 'owner'
          ? 'invalidOwner'
          : name === 'active'
            ? 'invalidField'
            : 'invalidReason'
    );
  }
  function setDeadline(change: Partial<MaintenanceDraft['deadline']>) {
    if (owned.current) return;
    form.setValue(
      'deadline',
      { ...form.getValues('deadline'), ...change, changed: true },
      {
        shouldDirty: true,
        shouldValidate:
          !!form.formState.errors.deadline || !!form.getFieldState('deadline').isTouched,
      }
    );
  }

  return (
    <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy('adminTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy('adminDescription')}</p>
        </div>
        <Button
          variant="outline"
          disabled={validating || !!action || state === 'loading'}
          onClick={() => {
            if (!owned.current || uncertain) refresh();
          }}
        >
          {copy('refresh')}
        </Button>
      </header>
      {time.notice}
      {saved && <p role="status">{copy('saved')}</p>}
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'denied' && <p role="alert">{copy('denied')}</p>}
      {state === 'error' && <p role="alert">{copy('loadError')}</p>}
      {state === 'ready' && (
        <div className="grid gap-3 md:grid-cols-2">
          {settings.map((setting) => (
            <div
              key={setting.capability}
              className="rounded-lg border bg-card p-4 text-card-foreground"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{copy(setting.capability)}</h2>
                  <p className="text-sm text-muted-foreground">
                    {copy(setting.active ? 'active' : 'inactive')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={locked || time.status !== 'ready'}
                  onClick={() => edit(setting)}
                >
                  {copy('manage')}
                </Button>
              </div>
              {setting.active && setting.reason && (
                <p className="mt-3 break-words text-sm">{setting.reason[locale]}</p>
              )}
              {setting.active && setting.estimatedUntil && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {copy('estimatedUntil')}:{' '}
                  <time dateTime={setting.estimatedUntil}>
                    {time.format(setting.estimatedUntil)}
                  </time>
                </p>
              )}
              {setting.active && setting.owner && (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {copy('owner')}: {setting.owner}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {selected && (
        <Form {...form}>
          <form
            onSubmit={submit}
            noValidate
            onChangeCapture={(event) => {
              if (owned.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            className="max-w-2xl space-y-4 rounded-lg border bg-card p-5 text-card-foreground"
          >
            <h2 className="text-lg font-semibold">{copy(selected.capability)}</h2>
            {uncertain && (
              <div role="alert" className="space-y-3">
                <p>{copy('unconfirmed')}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={state !== 'ready' || !latest || time.status !== 'ready'}
                  onClick={() => {
                    if (!latest || reading.current || state !== 'ready' || time.status !== 'ready')
                      return;
                    ++generation.current;
                    captured.current = null;
                    owned.current = false;
                    setSelected(latest);
                    setUncertain(false);
                    form.clearErrors();
                  }}
                >
                  {copy('returnToEditing')}
                </Button>
              </div>
            )}
            {(stale || zoneChanged) && !uncertain && (
              <div role="alert" className="space-y-3">
                <p>{copy(zoneChanged ? 'zoneChanged' : 'versionConflict')}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || state !== 'ready' || !latest || time.status !== 'ready'}
                  onClick={() => {
                    if (latest) edit(latest);
                  }}
                >
                  {copy('reset')}
                </Button>
              </div>
            )}
            {zoneChanged && uncertain && <p role="alert">{copy('zoneChanged')}</p>}
            <fieldset disabled={locked || !canEdit} className="space-y-4">
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2">
                      <FormControl>
                        <input
                          type="checkbox"
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          checked={field.value}
                          onChange={(event) => field.onChange(event.target.checked)}
                        />
                      </FormControl>
                      {copy('active')}
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {draft.active && (
                <>
                  <FormTextarea
                    control={form.control}
                    name="reasonFa"
                    label={copy('reasonFa')}
                    inputProps={{ dir: 'rtl', maxLength: 500 }}
                  />
                  <FormTextarea
                    control={form.control}
                    name="reasonEn"
                    label={copy('reasonEn')}
                    inputProps={{ dir: 'ltr', maxLength: 500 }}
                  />
                  <FormInput
                    control={form.control}
                    name="owner"
                    label={copy('owner')}
                    inputProps={{ maxLength: 100 }}
                  />
                  <p className="text-sm">
                    {copy('accountTime')}: <bdi>{draftZone}</bdi>
                  </p>
                  <FormField
                    control={form.control}
                    name="deadline"
                    render={({ field }) => (
                      <FormItem id="maintenance-deadline">
                        <FormControl>
                          <div
                            role="group"
                            aria-label={copy('estimatedUntil')}
                            tabIndex={-1}
                            ref={field.ref}
                            onBlur={field.onBlur}
                          >
                            <div className="grid gap-4 sm:grid-cols-2">
                              <DatePicker
                                label={copy('returnDate')}
                                locale={locale}
                                timezone={draftZone}
                                value={draft.deadline.date}
                                disabled={locked || !canEdit}
                                onChange={(date) => setDeadline({ date })}
                              />
                              <div className="space-y-2">
                                <Label htmlFor="maintenance-time">{copy('returnTime')}</Label>
                                <Input
                                  id="maintenance-time"
                                  type="time"
                                  value={draft.deadline.time}
                                  onChange={(event) => setDeadline({ time: event.target.value })}
                                />
                              </div>
                            </div>
                          </div>
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                </>
              )}
              {form.formState.errors.root?.validation?.message && (
                <p role="alert">{form.formState.errors.root.validation.message}</p>
              )}
              <FormSubmit loading={validating} disabled={locked || !canEdit}>
                {copy('save')}
              </FormSubmit>
            </fieldset>
          </form>
        </Form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={!canEdit}
          summary={
            captured.current && (
              <dl className="space-y-2 break-words text-sm">
                <div>
                  <dt className="font-medium">{copy('service')}</dt>
                  <dd>{copy(captured.current.capability)}</dd>
                </div>
                <div>
                  <dt className="font-medium">{copy('status')}</dt>
                  <dd>{copy(captured.current.body.active ? 'active' : 'inactive')}</dd>
                </div>
                {captured.current.body.active && (
                  <>
                    <div>
                      <dt className="font-medium">{copy('reasonFa')}</dt>
                      <dd dir="rtl">{captured.current.body.reason?.fa}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">{copy('reasonEn')}</dt>
                      <dd dir="ltr">{captured.current.body.reason?.en}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">{copy('owner')}</dt>
                      <dd>{captured.current.body.owner}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">{copy('estimatedUntil')}</dt>
                      <dd>
                        <time dateTime={captured.current.body.estimatedUntil ?? undefined}>
                          {time.format(captured.current.body.estimatedUntil)}
                        </time>{' '}
                        · <bdi>{draftZone}</bdi>
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            )
          }
          onClose={closeAction}
          onUnconfirmed={unconfirmed}
          onDenied={() => {
            setSettings([]);
            clearPrivate();
            setState('denied');
          }}
          onValidationError={(fields) => {
            const map: Record<string, keyof MaintenanceDraft> = {
              active: 'active',
              reasonFa: 'reasonFa',
              reasonEn: 'reasonEn',
              owner: 'owner',
              estimatedUntil: 'deadline',
            };
            const names = fields
              .filter(
                (name): name is string => typeof name === 'string' && Object.hasOwn(map, name)
              )
              .map((name) => map[name]!);
            if (!names.length) return false;
            for (const name of names)
              form.setError(name, { type: 'server', message: fieldError(name) });
            errorFocus.current = names[0]!;
            return true;
          }}
          onSuccess={async (data) => {
            const command = captured.current;
            if (!command || command.generation !== generation.current) return;
            if (!matchesMaintenanceReceipt(data, command.capability, command.body))
              throw new Error('Unconfirmed maintenance receipt');
            clearPrivate();
            setSaved(true);
            refresh();
          }}
        />
      )}
    </section>
  );
}
