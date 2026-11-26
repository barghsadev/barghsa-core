import { CommandFeedback } from '../components/CommandFeedback.js';
import { Link } from '@tanstack/react-router';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { standardMaintenanceNotice } from '@barghsa/i18n/maintenance-public';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Badge,
  LoadingStatus,
  Button,
  DatePicker,
  Input,
  Label,
  ListRefreshButton,
  buttonVariants,
} from '@barghsa/ui';
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
import { MaintenanceRecovery } from '../components/MaintenanceRecovery.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { toast } from '../lib/toast-api.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import {
  isMaintenanceList,
  isMaintenanceView,
  maintenanceDeadline,
  maintenanceDraft,
  maintenanceErrors,
  maintenancePayload,
  matchesMaintenanceReceipt,
  type MaintenanceDraft,
  type MaintenanceRecoveryDraft,
  type MaintenanceSetting,
} from '../lib/maintenance-form.js';

type Workspace =
  | { view: 'list' }
  | {
      view: 'detail' | 'editor';
      capability: MaintenanceSetting['capability'];
      showDetail: (replace?: boolean) => void;
    };
const maintenancePath = '/api/admin/maintenance';

export default function AdminMaintenancePage({ workspace }: { workspace?: Workspace } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tMaintenance(key, locale);
  const capability = workspace && workspace.view !== 'list' ? workspace.capability : undefined;
  const [settings, setSettings] = useState<MaintenanceSetting[]>([]);
  const [canWrite, setCanWrite] = useState(!capability);
  const [selected, setSelected] = useState<MaintenanceSetting | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<MaintenanceRecoveryDraft | null>(null);
  const [draftZone, setDraftZone] = useState(time.timezone);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const owned = useRef(false);
  const initializedEditor = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reading = useRef(true);
  const generation = useRef(0);
  const captured = useRef<{
    capability: MaintenanceSetting['capability'];
    body: ReturnType<typeof maintenancePayload>;
    generation: number;
  } | null>(null);
  const errorFocus = useRef<keyof MaintenanceDraft | null>(null);
  const otherNotice = useRef<{ fa: string; en: string } | null>(null);
  const form = useZodForm<MaintenanceDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<MaintenanceDraft>(
        {
          active: copy('invalidField'),
          publishReason: copy('invalidField'),
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
  const canEdit =
    canWrite && state === 'ready' && time.status === 'ready' && !stale && !zoneChanged;
  const deadlineId = 'maintenance-deadline';
  const deadlineErrorId = form.formState.errors.deadline ? `${deadlineId}-message` : undefined;

  function resetDraft(setting: MaintenanceSetting | null, zone: string) {
    otherNotice.current = null;
    form.reset(maintenanceDraft(setting, zone));
  }

  function changeNotice(publish: boolean) {
    if (owned.current || publish === form.getValues('publishReason')) return;
    const next = otherNotice.current;
    otherNotice.current = { fa: form.getValues('reasonFa'), en: form.getValues('reasonEn') };
    form.setValue('reasonFa', next?.fa ?? '', { shouldDirty: true });
    form.setValue('reasonEn', next?.en ?? '', { shouldDirty: true });
    form.setValue('publishReason', publish, { shouldDirty: true });
    form.clearErrors(['reasonFa', 'reasonEn', 'publishReason']);
  }

  function clearPrivate() {
    ++generation.current;
    initializedEditor.current = false;
    owned.current = false;
    captured.current = null;
    errorFocus.current = null;
    setSelected(null);
    setRecoveryOpen(false);
    setRecoveryDraft(null);
    resetDraft(null, time.timezone);
    setAction(null);
    setValidating(false);
    setUncertain(false);
    setSaved(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    reading.current = true;
    setState('loading');
    void readWithDeadline(controller.signal, async (signal) => {
      const response = await fetch(
        capability ? `${maintenancePath}/${capability}` : maintenancePath,
        {
          credentials: 'include',
          signal,
        }
      );
      if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'denied' : 'error');
      const result: unknown = await response.json();
      if (capability) {
        if (!isMaintenanceView(result) || result.capability !== capability)
          throw new Error('error');
        return { settings: [result], canWrite: result.canEdit };
      }
      if (!isMaintenanceList(result)) throw new Error('error');
      return { settings: result, canWrite: true };
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          reading.current = false;
          if (!result.canWrite) clearPrivate();
          setCanWrite(result.canWrite);
          setSettings(result.settings);
          setState('ready');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        reading.current = false;
        const denied = error instanceof Error && error.message === 'denied';
        setState(denied ? 'denied' : 'error');
        if (denied) {
          setCanWrite(false);
          setSettings([]);
          clearPrivate();
        }
      });
    return () => controller.abort();
  }, [capability, revision]);
  useEffect(() => {
    if (capability) heading.current?.focus({ preventScroll: true });
  }, [capability, workspace?.view]);
  useEffect(() => {
    if (
      workspace?.view === 'editor' &&
      canWrite &&
      !initializedEditor.current &&
      state === 'ready' &&
      time.status === 'ready' &&
      settings[0]
    ) {
      initializedEditor.current = true;
      edit(settings[0]);
    }
  }, [workspace?.view, canWrite, settings, state, time.status, time.timezone]);
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
    setRecoveryOpen(false);
    setRecoveryDraft(null);
    setDraftZone(time.timezone);
    resetDraft(setting, time.timezone);
    setSaved(false);
  }
  function loadRecovery(draft: MaintenanceRecoveryDraft) {
    if (
      !selected ||
      !canEdit ||
      owned.current ||
      reading.current ||
      draft.baseVersion !== selected.version ||
      draft.setting.capability !== selected.capability
    )
      return;
    ++generation.current;
    setRecoveryDraft(draft);
    setRecoveryOpen(false);
    resetDraft(draft.setting, draftZone);
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
        const body = maintenancePayload(value, draftZone, selected.version, recoveryDraft?.id);
        captured.current = { capability: selected.capability, body, generation: current };
        setAction({
          ...(value.active ? { risk: 'destructive' as const } : {}),
          title: copy(recoveryDraft ? 'activateRecovery' : 'save'),
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
      if (current === generation.current) {
        setValidating(false);
        if (!captured.current) owned.current = false;
      }
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
          : name === 'active' || name === 'publishReason'
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

  const activeSettings = settings
    .filter((setting) => setting.active)
    .sort((first, second) =>
      (first.estimatedUntil ?? '').localeCompare(second.estimatedUntil ?? '')
    );
  const availableSettings = settings.filter((setting) => !setting.active);
  const routeFor = (value: MaintenanceSetting['capability'], action?: 'edit') => ({
    to: '/admin/maintenance/$capability/{-$action}' as const,
    params: { capability: value, action },
  });
  const statusDetails = (setting: MaintenanceSetting) => (
    <>
      <Badge variant={setting.active ? 'outline' : 'secondary'}>
        {copy(setting.active ? 'active' : 'inactive')}
      </Badge>
      {setting.active && setting.estimatedUntil && (
        <p className="mt-2 text-sm text-muted-foreground">
          {copy('estimatedUntil')} ·{' '}
          <time dateTime={setting.estimatedUntil}>{time.format(setting.estimatedUntil)}</time>
        </p>
      )}
      {setting.active && setting.reason && (
        <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">
          {setting.reason[locale]}
        </p>
      )}
    </>
  );
  const serviceCard = (setting: MaintenanceSetting) => (
    <li key={setting.capability} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          <Link {...routeFor(setting.capability)} className="text-primary hover:underline">
            {copy(setting.capability)}
          </Link>
        </h3>
        <Link
          {...routeFor(setting.capability, 'edit')}
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
          aria-label={`${copy('manage')} · ${copy(setting.capability)}`}
        >
          {copy('manage')}
        </Link>
      </div>
      {statusDetails(setting)}
    </li>
  );
  const currentSetting = capability ? settings[0] : undefined;
  const proposedDeadline =
    selected && draft.active ? maintenanceDeadline(draft.deadline, draftZone) : null;

  return (
    <section
      className={`min-w-0 space-y-4 ${workspace?.view === 'editor' ? 'mx-auto w-full max-w-3xl' : ''}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          {capability && (
            <Link
              to="/admin/maintenance"
              className="mb-2 inline-flex text-sm text-primary hover:underline"
            >
              {copy('adminTitle')}
            </Link>
          )}
          <h1
            ref={heading}
            tabIndex={capability ? -1 : undefined}
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {capability ? copy(capability) : copy('adminTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy('adminDescription')}</p>
        </div>
        <ListRefreshButton
          label={copy('refresh')}
          disabled={validating || !!action}
          refreshing={state === 'loading'}
          onClick={() => {
            if (!owned.current || uncertain) refresh();
          }}
        />
      </header>
      {time.notice}
      <CommandFeedback message={saved ? copy('saved') : null} />
      {state === 'loading' && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {state === 'denied' && <p role="alert">{copy('denied')}</p>}
      {state === 'error' && <p role="alert">{copy('loadError')}</p>}
      {state === 'ready' && workspace?.view === 'list' && (
        <div className="space-y-6">
          <section aria-labelledby="maintenance-paused">
            <h2 id="maintenance-paused" className="mb-3 text-lg font-semibold">
              {copy('pausedServices')}
            </h2>
            {activeSettings.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">{activeSettings.map(serviceCard)}</ul>
            ) : (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                {copy('noActive')}
              </p>
            )}
          </section>
          {!!availableSettings.length && (
            <section aria-labelledby="maintenance-available">
              <h2 id="maintenance-available" className="mb-3 text-lg font-semibold">
                {copy('availableServices')}
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">{availableSettings.map(serviceCard)}</ul>
            </section>
          )}
        </div>
      )}
      {state === 'ready' && workspace?.view === 'detail' && currentSetting && (
        <div className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          {statusDetails(currentSetting)}
          <dl className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{copy('savedSetting')}</dt>
              <dd>
                {copy('revision').replace('{version}', numbers.number(currentSetting.version))}
              </dd>
            </div>
            {currentSetting.updatedAt && (
              <div>
                <dt className="text-muted-foreground">{copy('updated')}</dt>
                <dd>
                  <time dateTime={currentSetting.updatedAt}>
                    {time.format(currentSetting.updatedAt)}
                  </time>
                </dd>
              </div>
            )}
            {currentSetting.owner && (
              <div>
                <dt className="text-muted-foreground">{copy('owner')}</dt>
                <dd className="[overflow-wrap:anywhere]">
                  <bdi>{currentSetting.owner}</bdi>
                </dd>
              </div>
            )}
          </dl>
          {canWrite && (
            <Link
              {...routeFor(currentSetting.capability, 'edit')}
              className={buttonVariants({ className: 'min-h-11' })}
            >
              {copy('manage')}
            </Link>
          )}
        </div>
      )}
      {state === 'ready' && workspace?.view === 'editor' && !canWrite && (
        <div className="space-y-3">
          <p role="alert">{copy('readOnly')}</p>
          <Link
            {...routeFor(workspace.capability)}
            className={buttonVariants({ variant: 'outline' })}
          >
            {copy('viewSetting')}
          </Link>
        </div>
      )}
      {!workspace && state === 'ready' && (
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
            className={recordEditorSurface}
          >
            <RecordEditorSection
              title={copy(workspace ? 'editSetting' : selected.capability)}
              description={copy('appliesImmediately')}
            >
              {recoveryDraft && <p className="text-sm">{copy('recoveryEditing')}</p>}
              {uncertain && (
                <div role="alert" className="space-y-3">
                  <p>{copy('unconfirmed')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={state !== 'ready' || !latest || time.status !== 'ready'}
                    onClick={() => {
                      if (
                        !latest ||
                        reading.current ||
                        state !== 'ready' ||
                        time.status !== 'ready'
                      )
                        return;
                      ++generation.current;
                      captured.current = null;
                      owned.current = false;
                      if (latest.version !== selected.version) setRecoveryDraft(null);
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
            </RecordEditorSection>
            <fieldset disabled={locked || !canEdit} className="m-0 min-w-0 border-0 p-0">
              <div className="px-4 py-2 sm:px-6">
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem>
                      <label className="touch-label flex cursor-pointer items-center gap-2 text-sm font-medium">
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
              </div>
              {draft.active && (
                <>
                  <RecordEditorSection title={copy('noticeContent')}>
                    <FormField
                      control={form.control}
                      name="publishReason"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div
                              role="radiogroup"
                              aria-label={copy('publicNotice')}
                              aria-describedby="maintenance-notice-help"
                              ref={field.ref}
                              tabIndex={-1}
                              onBlur={field.onBlur}
                              className="grid gap-2 sm:grid-cols-2"
                            >
                              {(['standardNotice', 'writeNotice'] as const).map((key) => {
                                const publish = key === 'writeNotice';
                                return (
                                  <label
                                    key={key}
                                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                                  >
                                    <input
                                      type="radio"
                                      name={field.name}
                                      className="size-4 shrink-0 accent-primary"
                                      checked={field.value === publish}
                                      onChange={() => changeNotice(publish)}
                                    />
                                    {copy(key)}
                                  </label>
                                );
                              })}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p id="maintenance-notice-help" className="text-sm text-muted-foreground">
                      {copy(draft.publishReason ? 'publicMessageHelp' : 'privateMessageHelp')}
                    </p>
                    <div className={recordEditorGrid}>
                      <FormTextarea
                        control={form.control}
                        name="reasonFa"
                        itemClassName="[&>[data-slot=form-message]]:min-h-5"
                        label={copy(draft.publishReason ? 'reasonFa' : 'privateReasonFa')}
                        inputProps={{
                          dir: 'rtl',
                          rows: 2,
                          maxLength: 500,
                          placeholder: tMaintenance(
                            draft.publishReason ? 'reasonExample' : 'privateExample',
                            'fa'
                          ),
                          'aria-required': true,
                        }}
                      />
                      <FormTextarea
                        control={form.control}
                        name="reasonEn"
                        itemClassName="[&>[data-slot=form-message]]:min-h-5"
                        label={copy(draft.publishReason ? 'reasonEn' : 'privateReasonEn')}
                        inputProps={{
                          dir: 'ltr',
                          rows: 2,
                          maxLength: 500,
                          placeholder: tMaintenance(
                            draft.publishReason ? 'reasonExample' : 'privateExample',
                            'en'
                          ),
                          'aria-required': true,
                        }}
                      />
                    </div>
                  </RecordEditorSection>
                  <RecordEditorSection
                    title={copy('returnPlan')}
                    description={copy('returnPlanHelp')}
                  >
                    <FormInput
                      control={form.control}
                      itemClassName="max-w-sm"
                      name="owner"
                      label={copy('owner')}
                      inputProps={{
                        maxLength: 100,
                        placeholder: copy('ownerExample'),
                        'aria-required': true,
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      {copy('accountTime')}: <bdi>{draftZone}</bdi>
                    </p>
                    <FormField
                      control={form.control}
                      name="deadline"
                      render={({ field }) => (
                        <FormItem id={deadlineId}>
                          <FormControl>
                            <div
                              role="group"
                              aria-label={copy('estimatedUntil')}
                              tabIndex={-1}
                              ref={field.ref}
                              onBlur={field.onBlur}
                            >
                              <div className={recordEditorGrid}>
                                <div className={recordEditorField}>
                                  <Label htmlFor="maintenance-date">{copy('returnDate')}</Label>
                                  <DatePicker
                                    id="maintenance-date"
                                    className="min-h-11"
                                    label={copy('returnDate')}
                                    locale={locale}
                                    timezone={draftZone}
                                    value={draft.deadline.date}
                                    disabled={locked || !canEdit}
                                    triggerProps={{
                                      'aria-required': true,
                                      'aria-describedby': deadlineErrorId,
                                    }}
                                    onChange={(date) => setDeadline({ date })}
                                  />
                                </div>
                                <div className={recordEditorField}>
                                  <Label htmlFor="maintenance-time">{copy('returnTime')}</Label>
                                  <Input
                                    id="maintenance-time"
                                    type="time"
                                    dir="ltr"
                                    aria-required="true"
                                    aria-describedby={deadlineErrorId}
                                    value={draft.deadline.time}
                                    onChange={(event) => setDeadline({ time: event.target.value })}
                                  />
                                </div>
                              </div>
                            </div>
                          </FormControl>
                          <FormMessage reserveSpace className="min-h-5" />
                        </FormItem>
                      )}
                    />
                  </RecordEditorSection>
                </>
              )}
              {form.formState.errors.root?.validation?.message && (
                <p role="alert" className="px-4 py-2 text-sm text-destructive sm:px-6">
                  {form.formState.errors.root.validation.message}
                </p>
              )}
              {workspace?.view === 'editor' && currentSetting && (
                <RecordEditorSection title={copy('publicNotice')}>
                  <dl className="grid min-w-0 overflow-hidden rounded-lg border text-sm sm:grid-cols-2">
                    <div className="min-w-0 space-y-1 px-3 py-2.5">
                      <dt className="text-muted-foreground">
                        {tWorkspace('admin.settings.current', locale)}
                      </dt>
                      <dd>{statusDetails(currentSetting)}</dd>
                    </div>
                    <div className="min-w-0 space-y-1 border-t bg-primary/5 px-3 py-2.5 sm:border-s sm:border-t-0">
                      <dt className="text-muted-foreground">
                        {tWorkspace('admin.settings.draft', locale)}
                      </dt>
                      <dd className="space-y-2">
                        <Badge variant={draft.active ? 'outline' : 'secondary'}>
                          {copy(draft.active ? 'active' : 'inactive')}
                        </Badge>
                        {draft.active && (
                          <>
                            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                              {draft.publishReason
                                ? (locale === 'fa' ? draft.reasonFa : draft.reasonEn).trim() ||
                                  copy('messagePending')
                                : standardMaintenanceNotice[locale]}
                            </p>
                            {proposedDeadline && (
                              <p className="text-muted-foreground">
                                {copy('estimatedUntil')} ·{' '}
                                <time dateTime={proposedDeadline}>
                                  {time.format(proposedDeadline)}
                                </time>
                              </p>
                            )}
                          </>
                        )}
                      </dd>
                    </div>
                  </dl>
                </RecordEditorSection>
              )}
              <RecordEditorActions>
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    clearPrivate();
                    if (workspace?.view === 'editor') workspace.showDetail();
                  }}
                >
                  {confirmationText('cancel', locale)}
                </Button>
                <FormSubmit loading={validating} disabled={locked || !canEdit}>
                  {copy(recoveryDraft ? 'activateRecovery' : 'save')}
                </FormSubmit>
              </RecordEditorActions>
            </fieldset>
          </form>
        </Form>
      )}
      {selected && (
        <Button
          type="button"
          variant="ghost"
          className="text-primary"
          aria-controls={recoveryOpen ? 'maintenance-history' : undefined}
          aria-expanded={recoveryOpen}
          disabled={locked || !canEdit}
          onClick={() => setRecoveryOpen((open) => !open)}
        >
          {copy('history')}
        </Button>
      )}
      {selected && recoveryOpen && (
        <div id="maintenance-history">
          <MaintenanceRecovery
            key={`${selected.capability}:${selected.version}`}
            setting={selected}
            disabled={locked || !canEdit}
            formatTime={time.format}
            onLoad={loadRecovery}
            onDenied={() => {
              setSettings([]);
              clearPrivate();
              setState('denied');
            }}
          />
        </div>
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
                      <dt className="font-medium">{copy('publicNotice')}</dt>
                      <dd>
                        {copy(
                          captured.current.body.publishReason === false
                            ? 'standardNotice'
                            : 'customNotice'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">
                        {copy(
                          captured.current.body.publishReason === false
                            ? 'privateReasonFa'
                            : 'reasonFa'
                        )}
                      </dt>
                      <dd dir="rtl">{captured.current.body.reason?.fa}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">
                        {copy(
                          captured.current.body.publishReason === false
                            ? 'privateReasonEn'
                            : 'reasonEn'
                        )}
                      </dt>
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
              publishReason: 'publishReason',
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
            if (workspace?.view === 'editor') {
              toast.success(copy('saved'));
              workspace.showDetail(true);
              return;
            }
            setSaved(true);
            refresh();
          }}
        />
      )}
    </section>
  );
}
