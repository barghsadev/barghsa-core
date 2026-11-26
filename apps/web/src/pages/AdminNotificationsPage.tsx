import {
  CopyPlus as TableCopyPlusIcon,
  Download as TableDownloadIcon,
  Eye as TableEyeIcon,
  Inbox,
  Pencil as TablePencilIcon,
  Send,
  Trash2 as TableTrash2Icon,
  Upload as TableUploadIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CatalogueChoicePicker } from '../components/CatalogueChoicePicker.js';
import { sendToast, toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { Link } from '@tanstack/react-router';
import { useDestructiveConfirm } from '../hooks/useDestructiveConfirm.js';
import {
  NOTIFICATION_TYPE_REGISTRY,
  notificationSubjectRequiredForPublish,
  parseTemplateEventKey,
} from '@barghsa/shared/notifications';
import { renderTemplatePreview } from '../lib/template-preview.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Button,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
  Input,
  Label,
  Textarea,
  DateCell,
  TextCell,
  buttonVariants,
} from '@barghsa/ui';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { t as workspaceText } from '@barghsa/i18n/workspace';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import {
  notificationEventTitle,
  notificationFormText,
  type NotificationFormKey,
} from '@barghsa/i18n/notification-forms';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  catalogueRootMessage,
  CatalogueSaveButton,
} from '../components/CatalogueEditorFeedback.js';
import {
  emptyNotificationDraft,
  normalizeNotificationVariables,
  notificationVariableIssues,
  notificationInvalidFields,
  type NotificationDraft,
} from '../lib/notification-form.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import type { FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import TemplatePreviewPanel from '../components/TemplatePreviewPanel.js';
import BrandedEmailPreview from '../components/BrandedEmailPreview.js';
import { NotificationVariableFields } from '../components/NotificationVariableFields.js';
import {
  notificationTemplateActions,
  notificationTemplateRoutes,
  type NotificationTemplateView,
} from '../lib/template-catalogue-routes.js';
import { failedNotificationPageSearch } from '../lib/notification-panel-query.js';

import {
  responseRecord,
  validTemplate,
  templateBasis,
  type NotificationTemplate,
} from '../lib/content-catalogues.js';
function savedTemplate(
  value: unknown,
  status: NotificationTemplate['status'],
  id?: string
): NotificationTemplate {
  if (
    !validTemplate(value) ||
    value.status !== status ||
    value.isActive !== (status === 'active') ||
    (id !== undefined && value.id !== id)
  )
    throw new Error('Invalid template acknowledgement');
  return value;
}

type TemplateChannel = 'email' | 'sms' | 'in_app';
type TemplateLocale = 'fa' | 'en';

const LOCALE_LABELS: Record<TemplateLocale, string> = {
  fa: 'فارسی',
  en: 'English',
};

/**
 * Legacy suggestions supplement event keys already loaded from saved templates.
 * New keys may be entered without waiting for a frontend release.
 */
const KNOWN_EVENT_KEYS = [
  'welcome_email',
  'profile_verified',
  'profile_rejected',
  'password_changed',
  'otp_generated',
  'invoice_available',
  'invoice_paid',
  'invoice_overdue',
  'wallet_credited',
  'wallet_debited',
  'contract_signed',
  'contract_expiring',
  'subscription_renewed',
  'subscription_expired',
  'support_ticket_created',
  'support_ticket_resolved',
  'agent_assigned',
];
const REGISTERED_EVENT_KEYS = Object.keys(NOTIFICATION_TYPE_REGISTRY).sort();

const CHANNEL_OPTIONS: TemplateChannel[] = ['email', 'sms', 'in_app'];
const LOCALE_OPTIONS: TemplateLocale[] = ['fa', 'en'];

type NotificationPageProps = {
  view?: NotificationTemplateView;
  templateId?: string;
  routeSearch?: Record<string, unknown>;
  onSettled?: (id?: string) => void;
  queries?: ListQueryBinding;
  previewQueries?: ListQueryBinding;
};

export default function AdminNotificationsPage(props: NotificationPageProps = {}) {
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedNotificationsPage key={JSON.stringify([account, revision])} {...props} />;
}

/**
 * Admin notification template editor page (T-09.04.01).
 *
 * Lists all notification templates, allows creating/editing drafts,
 * publishing active templates, and unpublishing.
 */
function OwnedNotificationsPage({
  queries,
  previewQueries,
  view,
  templateId,
  routeSearch,
  onSettled,
}: NotificationPageProps) {
  const uiLocale = useLocale();
  const numbers = useNumberFormatting(uiLocale);
  const time = useAccountTime(uiLocale, !view || view === 'list' || view === 'detail');
  const channelLabels: Record<TemplateChannel, string> = {
    email: t('admin.notifications.channelEmail', uiLocale),
    sms: t('admin.notifications.channelSms', uiLocale),
    in_app: t('admin.notifications.channelInApp', uiLocale),
  };
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<'template' | 'test' | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  const operationInFlight = useRef(false);
  const mounted = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const mutationRequests = useRef(new Set<AbortController>());
  const refreshTemplates = useRef<() => Promise<void>>(async () => {});
  const initializedRoute = useRef(false);
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
    onUnconfirmed: () => void;
    current: () => boolean;
    onValidationError?: (fields: unknown[]) => boolean;
  } | null>(null);

  // Filters
  const [localEventKey, setFilterEventKey] = useState('');
  const [eventFilterInvalid, setEventFilterInvalid] = useState(false);
  const filterEventKey = queries ? queries.query.filters.eventKey || '' : localEventKey;
  const [localLocale, setFilterLocale] = useState<string>('');
  const [localChannel, setFilterChannel] = useState<string>('');
  const [localStatus, setFilterStatus] = useState<string>('');
  const filterLocale = queries ? queries.query.filters.locale || '' : localLocale;
  const filterChannel = queries ? queries.query.filters.channel || '' : localChannel;
  const filterStatus = queries ? queries.query.filters.status || '' : localStatus;
  const criteria = JSON.stringify([filterEventKey, filterLocale, filterChannel, filterStatus]);
  const previousCriteria = useRef(criteria);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const messages = Object.fromEntries(
    Object.keys(emptyNotificationDraft).map((key) => [
      key,
      notificationFormText(key as keyof NotificationDraft, uiLocale),
    ])
  ) as Record<keyof NotificationDraft, string>;
  const editorForm = useWizardForm<NotificationDraft>(
    async () => {
      const { notificationFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return notificationFormSchema(messages, notificationInvalidFields);
    },
    emptyNotificationDraft,
    notificationFormText('validationUnavailable', uiLocale)
  );
  const applyEditorErrors = useActionFieldErrors(editorForm.form, messages, messages.bodyTemplate);
  const [eventKey, setEventKey] = editorForm.field('eventKey');
  const [customEventEntry, setCustomEventEntry] = useState(false);
  const [channel, setChannel] = editorForm.field('channel');
  const [locale, setLocale] = editorForm.field('locale');
  const [subject, setSubject] = editorForm.field('subject');
  const subjectBeforeSms = useRef('');
  const subjectRef = useRef<HTMLInputElement>(null);
  // The event field can change modes on blur. Validate the draft rather than the transient search.
  const eventBinding = {
    name: 'eventKey',
    ref: editorForm.form.register('eventKey').ref,
    'aria-invalid': !!editorForm.errors.eventKey || undefined,
    'aria-describedby': editorForm.errors.eventKey ? editorForm.errorId('eventKey') : undefined,
  };
  const [bodyTemplate, setBodyTemplate] = editorForm.field('bodyTemplate');
  const [variableRows, setVariableRows] = editorForm.field('variables');
  const registerVariableFields = editorForm.form.register;
  const variableFieldsRef = useCallback(
    (node: HTMLDivElement | null) => {
      registerVariableFields('variables').ref(
        node
          ? {
              focus: () => {
                const field =
                  node.querySelector<HTMLElement>('[aria-invalid="true"]') ??
                  node.querySelector<HTMLElement>('[data-variable-name]') ??
                  node.querySelector<HTMLElement>('[data-variable-add]');
                field?.focus();
              },
            }
          : null
      );
    },
    [registerVariableFields]
  );
  const [editorUncertain, setEditorUncertain] = useState(false);
  const [editorRecovered, setEditorRecovered] = useState(false);
  const feedback = (name: keyof NotificationDraft) => (
    <p
      id={editorForm.errorId(name)}
      role={editorForm.errors[name] ? 'alert' : undefined}
      className={`min-h-5 text-sm text-destructive ${editorForm.errors[name] ? '' : 'invisible'}`}
    >
      {editorForm.errors[name]?.message ?? ' '}
    </p>
  );
  const [saving, setSaving] = useState(false);

  // Publish confirm state
  const [publishId, setPublishId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishSubjectRejectedId, setPublishSubjectRejectedId] = useState<string | null>(null);
  const publishSubjectActionRef = useRef<HTMLAnchorElement>(null);

  // Test-send state
  const [testSending, setTestSending] = useState(false);
  const testSendInFlight = useRef(false);
  const editorGeneration = useRef(0);
  const busyTokens = useRef({ save: 0, test: 0, publish: 0, row: 0 });
  const [savedContent, setSavedContent] = useState('');
  const [editBasis, setEditBasis] = useState<string | null>(null);
  const publishBasis = useRef<string | null>(null);
  const [testSendMsg, setTestSendMsg] = useState<string | null>(null);
  const [testDestination, setTestDestination] = useState('');
  const [testDestinationIssue, setTestDestinationIssue] = useState<NotificationFormKey | null>(
    null
  );
  const testDestinationRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const parsedVariables = normalizeNotificationVariables(variableRows);
  const savedEventKeys = [
    ...new Set([...KNOWN_EVENT_KEYS, ...templates.map((row) => row.eventKey)]),
  ]
    .filter((key) => !Object.hasOwn(NOTIFICATION_TYPE_REGISTRY, key))
    .sort();
  const showCustomEvent =
    customEventEntry ||
    (!!eventKey &&
      !Object.hasOwn(NOTIFICATION_TYPE_REGISTRY, eventKey) &&
      !savedEventKeys.includes(eventKey));
  const selectedEventTitle = notificationEventTitle(eventKey, uiLocale);
  const contentSignature = JSON.stringify([subject, bodyTemplate, parsedVariables]);
  const unsavedContent =
    contentSignature !== savedContent || notificationVariableIssues(variableRows).some(Boolean);

  useEffect(() => {
    if (testDestinationIssue !== 'testDestinationForbidden' || testSending || protectedAction)
      return;
    const frame = requestAnimationFrame(() => testDestinationRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [testDestinationIssue, testSending, protectedAction]);

  useEffect(() => {
    if (view === 'edit' && showEditor && window.location.hash === '#notification-template-subject')
      subjectRef.current?.focus();
  }, [view, showEditor]);

  useEffect(() => {
    if (!publishSubjectRejectedId || protectedAction) return;
    const frame = requestAnimationFrame(() => publishSubjectActionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [publishSubjectRejectedId, protectedAction]);

  const resetEditorBusy = useCallback(() => {
    busyTokens.current.save++;
    busyTokens.current.test++;
    testSendInFlight.current = false;
    setSaving(false);
    editorForm.setValidationPending(false);
    setTestSending(false);
  }, []);
  const resetCatalogueBusy = useCallback(() => {
    for (const request of mutationRequests.current) request.abort();
    mutationRequests.current.clear();
    busyTokens.current.publish++;
    busyTokens.current.row++;
    operationInFlight.current = false;
    setPublishing(false);
  }, []);

  const clearPrivate = useCallback(() => {
    editorGeneration.current++;
    resetEditorBusy();
    resetCatalogueBusy();
    listRequest.current?.abort();
    setTemplates([]);
    setAccepted(false);
    setUnconfirmed(null);
    setLoading(false);
    setLoadFailed(true);
    setError(null);
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    setPublishId(null);
    setPublishSubjectRejectedId(null);
    setProtectedAction(null);
    editorForm.form.reset(emptyNotificationDraft);
    subjectBeforeSms.current = '';
    setEditorUncertain(false);
    setSavedContent('');
    setTestDestination('');
    setTestDestinationIssue(null);
    setTestSendMsg(null);
    initializedRoute.current = false;
  }, [resetEditorBusy, resetCatalogueBusy]);
  const scope = useCatalogueScope(clearPrivate);
  const record = templateId ? templates.find((row) => row.id === templateId) : undefined;
  const recordEditable = record?.status === 'draft' && record.publishedAt == null;
  const listView = !view || view === 'list';
  const filterView = listView || view === 'compare';
  const selectedFilterCount = [filterLocale, filterChannel, filterStatus].filter(Boolean).length;
  const read = useStaffQueryRead('notifications');
  const confirmDestruction = useDestructiveConfirm(uiLocale, scope.version);
  const ready =
    accepted &&
    !loading &&
    !loadFailed &&
    !scope.denied &&
    !unconfirmed &&
    (!filterView || previousCriteria.current === criteria);
  const selectedTemplate = editId ? templates.find((r) => r.id === editId) : null;
  const showSubject = channel !== 'sms' || Boolean(selectedTemplate?.subject);
  const subjectHint =
    channel === 'in_app'
      ? 'inboxTitleHint'
      : channel === 'sms'
        ? 'legacySmsSubjectHint'
        : 'emailPublishSubjectHint';
  const publishTarget = publishId
    ? templates.find((template) => template.id === publishId)
    : view === 'publish' && recordEditable
      ? record
      : undefined;
  const publishNeedsSubject =
    !!publishTarget &&
    (publishTarget.id === publishSubjectRejectedId ||
      notificationSubjectRequiredForPublish(publishTarget.channel, publishTarget.subject));
  const stale =
    !!editId && (selectedTemplate ? templateBasis(selectedTemplate) : null) !== editBasis;
  const editorLive = useRef({ ready, stale, viewOnly, editorUncertain });
  editorLive.current = { ready, stale, viewOnly, editorUncertain };
  const selectedRef = useRef({ editId, editBasis, publishId, unconfirmed });
  selectedRef.current = { editId, editBasis, publishId, unconfirmed };
  useEffect(() => {
    const requests = mutationRequests.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      editorGeneration.current++;
      listRequest.current?.abort();
      for (const request of requests) request.abort();
      requests.clear();
    };
  }, []);
  const clearFilterWork = useCallback(() => {
    setEventFilterInvalid(false);
    editorGeneration.current++;
    resetEditorBusy();
    resetCatalogueBusy();
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    setProtectedAction(null);
    setPublishId(null);
    setPublishSubjectRejectedId(null);
    setTestSendMsg(null);
    setAccepted(false);
    setTemplates([]);
  }, [resetEditorBusy, resetCatalogueBusy]);
  const changeFilter = (apply: () => void) => {
    if (!queries) clearFilterWork();
    apply();
  };
  useEffect(() => {
    if (previousCriteria.current === criteria) return;
    previousCriteria.current = criteria;
    if (queries && (!view || view === 'list' || view === 'compare')) clearFilterWork();
  }, [criteria, clearFilterWork, queries, view]);
  const fetchTemplates = useCallback(async () => {
    if (scope.denied) return;
    const epoch = scope.version;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!view || view === 'list' || view === 'compare') {
        if (filterEventKey) params.set('eventKey', filterEventKey);
        if (filterLocale) params.set('locale', filterLocale);
        if (filterChannel) params.set('channel', filterChannel);
        if (filterStatus) params.set('status', filterStatus);
      }
      const qs = params.toString();
      const packet = await read(
        templateId
          ? `/api/admin/notifications/templates/${templateId}`
          : `/api/admin/notifications/templates${qs ? `?${qs}` : ''}`,
        templateId ? 'detail' : 'list',
        request.signal,
        async (res) => {
          if (res.status === 401 || res.status === 403) return null;
          if (templateId && res.status === 404) return { payload: null, missing: true };
          if (!res.ok) throw new Error('Templates unavailable');
          return { payload: (await res.json()) as unknown, missing: false };
        },
        epoch
      );
      if (request.signal.aborted || scope.live.current !== epoch) return;
      if (!packet) {
        scope.deny();
        return;
      }
      if (packet.missing) {
        clearFilterWork();
        initializedRoute.current = false;
        setMissing(true);
        setLoadFailed(true);
        return;
      }
      const data = templateId ? [packet.payload] : packet.payload;
      if (
        !Array.isArray(data) ||
        !data.every(
          (row) =>
            validTemplate(row) &&
            (templateId
              ? row.id === templateId
              : !params.has('eventKey') || row.eventKey === filterEventKey)
        ) ||
        new Set(data.map((r) => r.id)).size !== data.length
      )
        throw new Error();
      if (!request.signal.aborted && scope.live.current === epoch) {
        const selection = selectedRef.current;
        if (
          selection.editId &&
          selection.editBasis !==
            (data.find((r) => r.id === selection.editId)
              ? templateBasis(data.find((r) => r.id === selection.editId)!)
              : null)
        ) {
          editorGeneration.current++;
          resetEditorBusy();
          setProtectedAction(null);
          setTestSendMsg(null);
        }
        if (
          selection.publishId &&
          (selection.unconfirmed ||
            publishBasis.current !==
              (data.find((r) => r.id === selection.publishId)
                ? templateBasis(data.find((r) => r.id === selection.publishId)!)
                : null))
        ) {
          busyTokens.current.publish++;
          setPublishing(false);
          setPublishId(null);
          setProtectedAction(null);
          refreshButton.current?.focus();
        }
        if (editorLive.current.editorUncertain) setEditorRecovered(true);
        setPublishSubjectRejectedId(null);
        setTemplates(data);
        setMissing(false);
        setAccepted(true);
        setLoadFailed(false);
        setUnconfirmed(null);
      }
    } catch {
      if (!request.signal.aborted && scope.live.current === epoch) {
        setLoadFailed(true);
      }
    } finally {
      if (!request.signal.aborted && scope.live.current === epoch) setLoading(false);
    }
  }, [
    filterEventKey,
    filterLocale,
    filterChannel,
    filterStatus,
    view,
    templateId,
    scope.denied,
    scope.live,
    scope.version,
    scope.deny,
    resetEditorBusy,
    clearFilterWork,
    read,
  ]);

  useEffect(() => {
    refreshTemplates.current = fetchTemplates;
    void fetchTemplates();
    return () => listRequest.current?.abort();
  }, [fetchTemplates]);

  const acceptReceipt = (row: NotificationTemplate | null, id?: string) => {
    listRequest.current?.abort();
    const next = templatesRef.current.filter((r) => r.id !== (id ?? row?.id));
    if (row && ((view && view !== 'list') || !filterEventKey || row.eventKey === filterEventKey))
      next.unshift(row);
    templatesRef.current = next;
    setTemplates(next);
    setAccepted(true);
  };
  function showTestDestinationDenial(path: string, status: number | undefined, code: unknown) {
    if (
      !path.endsWith('/test-send') ||
      status !== 403 ||
      code !== 'NOTIFICATION_TEMPLATE_TEST_DESTINATION_FORBIDDEN'
    )
      return false;
    setTestDestinationIssue('testDestinationForbidden');
    return true;
  }
  async function mutateTemplate(
    action: Pick<TeamAction, 'path' | 'method' | 'body'>,
    titleKey: string,
    errorKey: string,
    onSuccess: (result: unknown) => Promise<void>,
    isCurrent: () => boolean = () => true,
    onValidationError?: (fields: unknown[]) => boolean
  ) {
    const epoch = scope.version;
    const profileRevision = getProfileContextRevision();
    const id = action.path.split('/templates/')[1]?.split('/')[0];
    const selected = id ? templatesRef.current.find((r) => r.id === id) : null;
    const basis = selected ? templateBasis(selected) : null;
    const current = () =>
      mounted.current &&
      scope.live.current === epoch &&
      getProfileContextRevision() === profileRevision &&
      isCurrent() &&
      (!id || templatesRef.current.some((r) => r.id === id && templateBasis(r) === basis));
    const payload = action.body === undefined ? undefined : JSON.stringify(action.body);
    const captured = {
      ...action,
      responseDeadline: true as const,
      ...(action.method === 'DELETE' ? { successStatus: 204 } : {}),
      ...(payload === undefined ? {} : { body: JSON.parse(payload) as unknown }),
    };
    let outcomeUnconfirmed = false;
    const markUnconfirmed = () => {
      if (!current()) return;
      outcomeUnconfirmed = true;
      listRequest.current?.abort();
      setLoading(false);
      setUnconfirmed(action.path.endsWith('/test-send') ? 'test' : 'template');
      if (onValidationError && !action.path.endsWith('/publish')) {
        setEditorRecovered(false);
        setEditorUncertain(true);
      }
    };
    const request = new AbortController();
    mutationRequests.current.add(request);
    try {
      const { res, data } = await readWithDeadline(request.signal, async (signal) => {
        const res = await fetch(captured.path, {
          method: captured.method,
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          ...(payload === undefined ? {} : { body: payload }),
          signal,
        });
        const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
        return { res, data };
      }).catch((error: unknown) => {
        markUnconfirmed();
        throw error;
      });
      if (!current()) return;
      const record = responseRecord(data);
      const code =
        typeof record?.error === 'string' ? record.error : responseRecord(record?.error)?.code;
      if (
        res.status === 403 &&
        (code === 'AUTHZ:STEP_UP_REQUIRED' || record?.requiresStepUp === true)
      ) {
        setProtectedAction({
          action: {
            ...captured,
            title: t(titleKey, uiLocale),
            description: t('admin.notifications.confirmAction', uiLocale),
            requiresPassword: true,
          },
          current,
          onUnconfirmed: markUnconfirmed,
          ...(onValidationError
            ? { onValidationError: (fields: unknown[]) => current() && onValidationError(fields) }
            : {}),
          onSuccess: async (result) => {
            if (!current()) return;
            await onSuccess(result);
          },
        });
        return;
      }
      if (showTestDestinationDenial(action.path, res.status, code)) return;
      if (res.status === 401 || res.status === 403) {
        scope.deny();
        return;
      }
      const fields = responseRecord(record?.error)?.fields;
      if (res.status === 400 && Array.isArray(fields) && onValidationError?.(fields)) return;
      if (!res.ok) {
        if (res.status >= 500) markUnconfirmed();
        throw new Error();
      }
      try {
        if (action.method === 'DELETE' && res.status !== 204) throw new Error();
        await onSuccess(data);
      } catch {
        markUnconfirmed();
        throw new Error();
      }
    } catch {
      if (current()) {
        const message = t(errorKey, uiLocale);
        if (outcomeUnconfirmed) sendToast('warning', confirmationText('unconfirmed', uiLocale));
        else toast.error(message);
        throw new Error(message);
      }
    } finally {
      mutationRequests.current.delete(request);
    }
  }

  function openCreate() {
    if (!ready || protectedAction || editorForm.isPending()) return;
    setEditBasis(null);
    editorForm.form.reset({
      ...emptyNotificationDraft,
      eventKey: filterEventKey,
      channel:
        CHANNEL_OPTIONS.find((option) => option === filterChannel) ??
        emptyNotificationDraft.channel,
      locale:
        LOCALE_OPTIONS.find((option) => option === filterLocale) ?? emptyNotificationDraft.locale,
    });
    setCustomEventEntry(false);
    subjectBeforeSms.current = '';
    setEditorUncertain(false);
    editorGeneration.current++;
    resetEditorBusy();
    setSavedContent('');
    setViewOnly(false);
    setEditId(null);

    setTestSendMsg(null);
    setTestDestination('');
    setTestDestinationIssue(null);
    setShowEditor(true);
  }

  function openEdit(template: NotificationTemplate, copy = false) {
    if (!ready || protectedAction || editorForm.isPending()) return;
    setEditBasis(copy ? null : templateBasis(template));
    editorForm.form.reset(emptyNotificationDraft);
    setCustomEventEntry(false);
    setEditorUncertain(false);
    editorGeneration.current++;
    resetEditorBusy();
    setSavedContent(
      JSON.stringify([
        template.subject ?? '',
        template.bodyTemplate,
        normalizeNotificationVariables(template.variables),
      ])
    );
    setViewOnly(
      !copy && (view === 'detail' || template.status !== 'draft' || template.publishedAt != null)
    );
    setEditId(copy ? null : template.id);
    setEventKey(template.eventKey);
    setChannel(template.channel);
    setLocale(template.locale);
    const copySms = copy && template.channel === 'sms';
    subjectBeforeSms.current = copySms ? (template.subject ?? '') : '';
    setSubject(copySms ? '' : (template.subject ?? ''));
    setBodyTemplate(template.bodyTemplate);
    setVariableRows(template.variables.map((variable, rowId) => ({ ...variable, rowId })));
    setTestSendMsg(null);
    setTestDestination('');
    setTestDestinationIssue(null);
    setShowEditor(true);
  }

  function closeEditor() {
    editorGeneration.current++;
    resetEditorBusy();
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    setProtectedAction(null);
  }

  function changeDraftChannel(next: TemplateChannel) {
    if (next === channel) return;
    setChannel(next);
    if (next === 'sms') {
      subjectBeforeSms.current = subject;
      setSubject('');
      editorForm.form.clearErrors('subject');
    } else if (channel === 'sms') {
      setSubject(subjectBeforeSms.current);
    }
  }

  useEffect(() => {
    if (!ready || initializedRoute.current) return;
    if (view === 'new') openCreate();
    else if (
      record &&
      (view === 'copy' || view === 'detail' || (view === 'edit' && recordEditable))
    ) {
      openEdit(record, view === 'copy');
    } else if (record && view === 'publish' && recordEditable) {
      publishBasis.current = templateBasis(record);
      setPublishId(record.id);
    } else return;
    initializedRoute.current = true;
  }, [ready, record, recordEditable, view]);

  /** Insert a {{variable}} placeholder at the caret position in the body. */
  function insertVariable(variable: string) {
    const el = bodyRef.current;
    if (!el) {
      setBodyTemplate((prev) => `${prev}{{${variable}}}`);
      return;
    }
    const start = el.selectionStart ?? bodyTemplate.length;
    const end = el.selectionEnd ?? bodyTemplate.length;
    const insert = `{{${variable}}}`;
    const next = bodyTemplate.slice(0, start) + insert + bodyTemplate.slice(end);
    setBodyTemplate(next);
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  const testSendDisabled =
    !ready ||
    stale ||
    !!protectedAction ||
    testSending ||
    saving ||
    editorForm.pending ||
    editorUncertain ||
    unsavedContent;

  async function handleTestSend() {
    if (testSendDisabled || editorForm.isPending() || !editId || testSendInFlight.current) return;
    const expectedChannel = channel;
    let destination = testDestination.trim();
    let issue: NotificationFormKey | null = null;
    if (expectedChannel === 'email') {
      if (!destination) issue = 'testEmailRequired';
      else if (testDestinationRef.current?.validity.typeMismatch) issue = 'testEmailInvalid';
    } else if (expectedChannel === 'sms') {
      destination = destination.replace(/[۰-۹٠-٩]/g, (digit) =>
        String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660))
      );
      if (!destination) issue = 'testPhoneRequired';
      else if (!/^(?:\+98|0)9[0-9]{9}$/.test(destination)) issue = 'testPhoneInvalid';
    }
    setTestDestinationIssue(issue);
    if (issue) {
      testDestinationRef.current?.focus();
      return;
    }
    setError(null);
    const token = ++busyTokens.current.test;
    testSendInFlight.current = true;
    const generation = editorGeneration.current;
    setTestSending(true);
    setTestSendMsg(null);
    try {
      const body = expectedChannel === 'in_app' ? {} : { destination };
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${editId}/test-send`, method: 'POST', body },
        'admin.notifications.testSend',
        'admin.notifications.error.testSend',
        async (result) => {
          if (generation !== editorGeneration.current) return;
          if (
            !result ||
            typeof result !== 'object' ||
            !('ok' in result) ||
            result.ok !== true ||
            !('destination' in result) ||
            result.destination !== expectedChannel ||
            !('lastTestStatus' in result) ||
            result.lastTestStatus !== 'delivered'
          ) {
            throw new Error(t('admin.notifications.error.testSend', uiLocale));
          }
          setTestSendMsg(
            t(
              expectedChannel === 'email'
                ? 'admin.notifications.testSentEmail'
                : expectedChannel === 'sms'
                  ? 'admin.notifications.testSentSms'
                  : 'admin.notifications.testSent',
              uiLocale
            )
          );
        },
        () => generation === editorGeneration.current
      );
    } catch (err) {
      if (generation === editorGeneration.current)
        setError(
          err instanceof Error ? err.message : t('admin.notifications.error.testSend', uiLocale)
        );
    } finally {
      if (token === busyTokens.current.test) {
        testSendInFlight.current = false;
        setTestSending(false);
      }
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (
      !ready ||
      stale ||
      protectedAction ||
      viewOnly ||
      saving ||
      editorUncertain ||
      editorForm.isPending()
    )
      return;
    const validationGeneration = editorGeneration.current;
    editorForm.setValidationPending(true);
    try {
      const captured: { value?: NotificationDraft } = {};
      await editorForm.form.handleSubmit((value) => {
        captured.value = value;
      })();
      if (captured.value) {
        const {
          eventKey,
          channel,
          locale,
          subject,
          bodyTemplate,
          variables: draftVariables,
        } = captured.value;
        if (
          validationGeneration !== editorGeneration.current ||
          !editorLive.current.ready ||
          editorLive.current.stale ||
          editorLive.current.viewOnly ||
          editorLive.current.editorUncertain
        )
          return;
        const token = ++busyTokens.current.save;
        setSaving(true);
        setError(null);
        const generation = editorGeneration.current;
        const variables = normalizeNotificationVariables(draftVariables);
        const expected = {
          eventKey,
          channel,
          locale,
          bodyTemplate,
          variables,
          subject: subject || null,
        };
        const id = editId;
        try {
          await mutateTemplate(
            {
              path: id
                ? `/api/admin/notifications/templates/${id}`
                : '/api/admin/notifications/templates',
              method: id ? 'PUT' : 'POST',
              body: id
                ? { subject: expected.subject, bodyTemplate, variables }
                : {
                    eventKey,
                    channel,
                    locale,
                    bodyTemplate,
                    variables,
                    ...(subject ? { subject } : {}),
                  },
            },
            id ? 'admin.notifications.update' : 'admin.notifications.create',
            'admin.notifications.error.save',
            async (result) => {
              const saved = savedTemplate(result, 'draft', id ?? undefined);
              if (
                saved.eventKey !== expected.eventKey ||
                saved.channel !== expected.channel ||
                saved.locale !== expected.locale ||
                saved.bodyTemplate !== expected.bodyTemplate ||
                (saved.subject ?? null) !== expected.subject ||
                saved.variables.length !== expected.variables.length ||
                saved.variables.some(
                  (variable, index) =>
                    variable.name !== expected.variables[index]?.name ||
                    variable.description !== expected.variables[index]?.description
                )
              )
                throw new Error();
              acceptReceipt(saved);
              toast.success(confirmationText('recorded', uiLocale));
              if (generation === editorGeneration.current) {
                closeEditor();
                if (onSettled) onSettled(saved.id);
                else await refreshTemplates.current();
              }
            },
            () => generation === editorGeneration.current,
            applyEditorErrors
          );
        } catch {
          if (generation === editorGeneration.current)
            setError(t('admin.notifications.error.save', uiLocale));
        } finally {
          if (token === busyTokens.current.save) setSaving(false);
        }
      }
    } finally {
      if (validationGeneration === editorGeneration.current) editorForm.setValidationPending(false);
    }
  }

  async function handlePublish() {
    if (
      !ready ||
      protectedAction ||
      !publishId ||
      !publishTarget ||
      publishNeedsSubject ||
      templateBasis(publishTarget) !== publishBasis.current ||
      publishing ||
      editorForm.isPending()
    )
      return;
    const token = ++busyTokens.current.publish;
    setPublishing(true);
    const epoch = scope.version;
    setError(null);
    const id = publishId;
    try {
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}/publish`, method: 'POST' },
        'admin.notifications.publish',
        'admin.notifications.error.publish',
        async (result) => {
          const saved = savedTemplate(result, 'active', id);
          const original = templatesRef.current.find((r) => r.id === id);
          if (
            !original ||
            saved.eventKey !== original.eventKey ||
            saved.channel !== original.channel ||
            saved.locale !== original.locale ||
            saved.bodyTemplate !== original.bodyTemplate ||
            saved.subject !== original.subject ||
            JSON.stringify(saved.variables) !== JSON.stringify(original.variables)
          )
            throw new Error();
          acceptReceipt(saved);
          toast.success(confirmationText('recorded', uiLocale));
          setPublishId((current) => (current === id ? null : current));
          if (onSettled) onSettled(saved.id);
          else await refreshTemplates.current();
        },
        () => token === busyTokens.current.publish,
        (fields) => {
          if (publishTarget.channel !== 'email' || !fields.includes('subject')) return false;
          setPublishSubjectRejectedId(id);
          return true;
        }
      );
    } catch {
      if (token === busyTokens.current.publish && scope.live.current === epoch && mounted.current)
        setError(t('admin.notifications.error.publish', uiLocale));
    } finally {
      if (token === busyTokens.current.publish) setPublishing(false);
    }
  }

  async function handleUnpublish(id: string) {
    if (!ready || protectedAction || operationInFlight.current) return;
    const token = ++busyTokens.current.row;
    operationInFlight.current = true;
    const epoch = scope.version;
    setError(null);
    try {
      if (
        !(await confirmDestruction(
          t('admin.notifications.unpublish', uiLocale),
          t('admin.notifications.unpublishConfirm', uiLocale)
        )) ||
        token !== busyTokens.current.row ||
        scope.live.current !== epoch ||
        !mounted.current
      )
        return;
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}/unpublish`, method: 'POST' },
        'admin.notifications.unpublish',
        'admin.notifications.error.unpublish',
        async (result) => {
          const saved = savedTemplate(result, 'archived', id);
          const original = templatesRef.current.find((r) => r.id === id);
          if (
            !original ||
            saved.eventKey !== original.eventKey ||
            saved.channel !== original.channel ||
            saved.locale !== original.locale ||
            saved.bodyTemplate !== original.bodyTemplate ||
            saved.subject !== original.subject ||
            JSON.stringify(saved.variables) !== JSON.stringify(original.variables)
          )
            throw new Error();
          acceptReceipt(saved);
          toast.success(confirmationText('recorded', uiLocale));
          await refreshTemplates.current();
        },
        () => token === busyTokens.current.row
      );
    } catch {
      if (token === busyTokens.current.row && scope.live.current === epoch && mounted.current)
        setError(t('admin.notifications.error.unpublish', uiLocale));
    } finally {
      if (token === busyTokens.current.row) operationInFlight.current = false;
    }
  }

  async function handleDelete(id: string) {
    if (!ready || protectedAction || operationInFlight.current) return;
    const token = ++busyTokens.current.row;
    operationInFlight.current = true;
    const epoch = scope.version;
    setError(null);
    try {
      if (
        !(await confirmDestruction(
          t('admin.notifications.delete', uiLocale),
          t('admin.notifications.deleteConfirm', uiLocale)
        )) ||
        token !== busyTokens.current.row ||
        scope.live.current !== epoch ||
        !mounted.current
      )
        return;
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}`, method: 'DELETE' },
        'admin.notifications.delete',
        'admin.notifications.error.delete',
        async () => {
          acceptReceipt(null, id);
          toast.success(confirmationText('recorded', uiLocale));
          if (templateId && onSettled) onSettled();
          else await refreshTemplates.current();
        },
        () => token === busyTokens.current.row
      );
    } catch {
      if (token === busyTokens.current.row && scope.live.current === epoch && mounted.current)
        setError(t('admin.notifications.error.delete', uiLocale));
    } finally {
      if (token === busyTokens.current.row) operationInFlight.current = false;
    }
  }

  const label = (key: string) => t(`admin.notifications.${key}`, uiLocale);
  const editorCopy = (key: Parameters<typeof notificationFormText>[0]) =>
    notificationFormText(key, uiLocale);
  const subjectLabel = (channel: TemplateChannel) =>
    channel === 'email'
      ? label('subject')
      : editorCopy(channel === 'in_app' ? 'inboxTitle' : 'legacySmsSubject');
  const back =
    templateId && view !== 'detail' ? (
      <Link
        to={notificationTemplateRoutes.detail}
        params={{ templateId }}
        search={routeSearch}
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {label('view')}
      </Link>
    ) : (
      <Link
        to="/admin/notifications"
        search={routeSearch}
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {label('title')}
      </Link>
    );
  const actionLink = (
    destination: 'detail' | keyof typeof notificationTemplateActions,
    id: string,
    text: string
  ) => (
    <Link
      to={
        destination === 'detail'
          ? notificationTemplateRoutes.detail
          : notificationTemplateRoutes.action
      }
      params={
        destination === 'detail'
          ? { templateId: id }
          : { templateId: id, action: notificationTemplateActions[destination] }
      }
      search={routeSearch}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {text}
    </Link>
  );
  const renderTemplateActions = (template: NotificationTemplate) => (
    <div className="flex flex-wrap gap-2">
      {template.status === 'draft' && template.publishedAt == null && (
        <>
          {view ? (
            actionLink('edit', template.id, label('edit'))
          ) : (
            <Button
              disabled={!ready || !!protectedAction || editorForm.pending}
              onClick={() => openEdit(template)}
              variant="outline"
              className="text-foreground hover:underline"
              data-table-action-tooltip={t('admin.notifications.edit', uiLocale)}
            >
              <TableActionIcon icon={TablePencilIcon}>
                {t('admin.notifications.edit', uiLocale)}
              </TableActionIcon>
            </Button>
          )}
          {view ? (
            actionLink('publish', template.id, label('publish'))
          ) : (
            <Button
              disabled={!ready || !!protectedAction || editorForm.pending}
              onClick={() => {
                if (!ready || protectedAction || editorForm.isPending()) return;
                publishBasis.current = templateBasis(template);
                setPublishId(template.id);
              }}
              variant="outline"
              className="text-foreground hover:underline"
              data-table-action-tooltip={t('admin.notifications.publish', uiLocale)}
            >
              <TableActionIcon icon={TableUploadIcon}>
                {t('admin.notifications.publish', uiLocale)}
              </TableActionIcon>
            </Button>
          )}
          <Button
            disabled={!ready || !!protectedAction || editorForm.pending}
            onClick={() => handleDelete(template.id)}
            variant="outline"
            className="text-destructive hover:underline"
            data-table-action-tooltip={t('admin.notifications.delete', uiLocale)}
          >
            <TableActionIcon icon={TableTrash2Icon}>
              {t('admin.notifications.delete', uiLocale)}
            </TableActionIcon>
          </Button>
        </>
      )}
      {(template.status !== 'draft' || template.publishedAt != null) && (
        <>
          {view === 'list'
            ? actionLink('detail', template.id, label('view'))
            : !view && (
                <Button
                  disabled={!ready || !!protectedAction || editorForm.pending}
                  onClick={() => openEdit(template)}
                  variant="outline"
                  className="text-foreground hover:underline"
                  data-table-action-tooltip={t('admin.notifications.view', uiLocale)}
                >
                  <TableActionIcon icon={TableEyeIcon}>
                    {t('admin.notifications.view', uiLocale)}
                  </TableActionIcon>
                </Button>
              )}
          {view ? (
            actionLink('copy', template.id, label('newVersion'))
          ) : (
            <Button
              disabled={!ready || !!protectedAction || editorForm.pending}
              onClick={() => openEdit(template, true)}
              variant="outline"
              className="text-foreground hover:underline"
              data-table-action-tooltip={t('admin.notifications.newVersion', uiLocale)}
            >
              <TableActionIcon icon={TableCopyPlusIcon}>
                {t('admin.notifications.newVersion', uiLocale)}
              </TableActionIcon>
            </Button>
          )}
          {template.status === 'active' && (
            <Button
              disabled={!ready || !!protectedAction || editorForm.pending}
              onClick={() => handleUnpublish(template.id)}
              variant="outline"
              className="text-foreground hover:underline"
              data-table-action-tooltip={t('admin.notifications.unpublish', uiLocale)}
            >
              <TableActionIcon icon={TableDownloadIcon}>
                {t('admin.notifications.unpublish', uiLocale)}
              </TableActionIcon>
            </Button>
          )}
        </>
      )}
    </div>
  );
  const sendTestButton = (
    <Button type="button" onClick={handleTestSend} disabled={testSendDisabled} variant="outline">
      <Send aria-hidden="true" />
      {testSending
        ? t('admin.notifications.sending', uiLocale)
        : t('admin.notifications.testSend', uiLocale)}
    </Button>
  );
  const testSendControls = (
    <div className="space-y-2.5">
      {channel === 'in_app' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox aria-hidden="true" className="size-4 shrink-0" />
            {editorCopy('testInbox')}
          </p>
          {sendTestButton}
        </div>
      ) : (
        <div className="grid min-w-0 items-end gap-x-2.5 gap-y-2 sm:grid-cols-[minmax(0,24rem)_auto] sm:justify-start">
          <div className={recordEditorField}>
            <Label htmlFor="test-destination">
              {editorCopy(channel === 'email' ? 'testEmail' : 'testPhone')}
            </Label>
            <Input
              id="test-destination"
              ref={testDestinationRef}
              aria-describedby={
                testDestinationIssue ? 'test-destination-error' : 'test-destination-hint'
              }
              aria-invalid={testDestinationIssue ? true : undefined}
              disabled={testSending || !!protectedAction}
              type={channel === 'email' ? 'email' : 'tel'}
              autoComplete={channel === 'email' ? 'email' : 'tel'}
              autoCapitalize="none"
              spellCheck={false}
              maxLength={channel === 'email' ? 320 : 32}
              value={testDestination}
              onChange={(event) => {
                setTestSendMsg(null);
                setTestDestinationIssue(null);
                setTestDestination(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void handleTestSend();
              }}
              placeholder={channel === 'email' ? 'name@example.com' : '+989123456789'}
              required
              dir="ltr"
            />
          </div>
          <p
            id={testDestinationIssue ? 'test-destination-error' : 'test-destination-hint'}
            role={testDestinationIssue ? 'alert' : undefined}
            className={`text-xs sm:col-span-2 sm:row-start-2 ${testDestinationIssue ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {editorCopy(
              testDestinationIssue ?? (channel === 'email' ? 'testEmailHint' : 'testPhoneHint')
            )}
          </p>
          <div className="sm:col-start-2 sm:row-start-1">{sendTestButton}</div>
        </div>
      )}
      {unsavedContent && (
        <p className="text-sm text-warning">{t('admin.notifications.saveBeforeTest', uiLocale)}</p>
      )}
      {testSendMsg && !unsavedContent && (
        <p role="status" className="text-sm text-success">
          {testSendMsg}
        </p>
      )}
    </div>
  );
  const pageTitle =
    view === 'new'
      ? label('createTitle')
      : view === 'edit'
        ? label('editTitle')
        : view === 'copy'
          ? label('newVersion')
          : view === 'publish'
            ? label('publishTitle')
            : view === 'preview' || view === 'compare'
              ? label('preview.title')
              : view === 'detail'
                ? record?.subject || record?.eventKey || label('view')
                : label('title');

  const isWriting = view === 'new' || view === 'edit' || view === 'copy';
  const isRecordTask = isWriting || view === 'preview' || view === 'publish';
  return (
    <div
      className={
        isWriting
          ? 'mx-auto min-w-0 max-w-5xl space-y-4'
          : isRecordTask
            ? 'mx-auto min-w-0 max-w-4xl space-y-4'
            : 'min-w-0 space-y-6'
      }
      dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {view && !listView && back}
          <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]" dir="auto">
            {pageTitle}
          </h1>
          {view === 'detail' && record?.subject && (
            <p className="wrap-anywhere text-sm text-muted-foreground">
              <bdi dir="ltr">{record.eventKey}</bdi>
            </p>
          )}
        </div>
        {isRecordTask && (
          <ListRefreshButton
            label={label('refresh')}
            ref={refreshButton}
            onClick={() => (scope.denied ? scope.recover() : void fetchTemplates())}
          />
        )}
        {view === 'list' && ready ? (
          <Link to="/admin/notifications/new" search={routeSearch} className={buttonVariants()}>
            {label('newTemplate')}
          </Link>
        ) : (
          !view &&
          !showEditor && (
            <Button
              onClick={openCreate}
              disabled={!ready || !!protectedAction || editorForm.pending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded"
            >
              {t('admin.notifications.newTemplate', uiLocale)}
            </Button>
          )
        )}
      </header>

      {view === 'list' && (
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/notifications/preview"
            search={routeSearch}
            className={buttonVariants({ variant: 'outline' })}
          >
            {label('preview.title')}
          </Link>
          <Link
            to="/admin/notifications/settings"
            search={routeSearch}
            className={buttonVariants({ variant: 'outline' })}
          >
            {label('window.title')}
          </Link>
          <Link
            to="/admin/failed-notifications/history"
            search={failedNotificationPageSearch(routeSearch ?? {})}
            className={buttonVariants({ variant: 'outline' })}
          >
            {label('history.title')}
          </Link>
          <Link
            to="/admin/failed-notifications"
            search={failedNotificationPageSearch(routeSearch ?? {})}
            className={buttonVariants({ variant: 'outline' })}
          >
            {label('deadLetter.title')}
          </Link>
        </div>
      )}

      {time.notice}
      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onSuccess={protectedAction.onSuccess}
          onClose={() => setProtectedAction(null)}
          onUnconfirmed={protectedAction.onUnconfirmed}
          onDenied={(status, code) => {
            if (!protectedAction.current()) return;
            if (showTestDestinationDenial(protectedAction.action.path, status, code))
              setProtectedAction(null);
            else scope.deny(status);
          }}
          {...(protectedAction.onValidationError
            ? { onValidationError: protectedAction.onValidationError }
            : {})}
          confirmationDisabled={
            !ready ||
            stale ||
            (editorUncertain &&
              !!protectedAction.onValidationError &&
              !protectedAction.action.path.endsWith('/publish')) ||
            !protectedAction.current()
          }
          finalFocus={() => refreshButton.current}
          summary={
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void fetchTemplates()}
            >
              {t('admin.notifications.refresh', uiLocale)}
            </Button>
          }
        />
      )}
      <ListPage>
        {!isRecordTask && (
          <ListPage.Toolbar
            className="items-start"
            search={
              filterView && (
                <form
                  className="flex min-w-0 flex-wrap items-start gap-2"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('eventKey');
                    const key = parseTemplateEventKey(value);
                    if (!key && typeof value === 'string' && value.trim()) {
                      setEventFilterInvalid(true);
                      event.currentTarget.querySelector('input')?.focus();
                      return;
                    }
                    setEventFilterInvalid(false);
                    if (key === filterEventKey) return;
                    changeFilter(() =>
                      queries
                        ? queries.setQuery({ filters: { eventKey: key } })
                        : setFilterEventKey(key)
                    );
                  }}
                >
                  <div className="min-w-0 flex-1 basis-52">
                    <ListSearchInput
                      label={t('admin.notifications.filterEvent', uiLocale)}
                      key={filterEventKey}
                      id="notification-event-filter"
                      name="eventKey"
                      type="text"
                      dir="ltr"
                      autoComplete="off"
                      maxLength={100}
                      defaultValue={filterEventKey}
                      list="notification-event-filter-options"
                      aria-invalid={eventFilterInvalid || undefined}
                      aria-describedby="notification-event-filter-hint"
                      onChange={() => setEventFilterInvalid(false)}
                      placeholder={t('admin.notifications.allEvents', uiLocale)}
                    />
                    <datalist id="notification-event-filter-options">
                      {[
                        ...new Set([
                          ...KNOWN_EVENT_KEYS,
                          ...templates.map((row) => row.eventKey),
                          filterEventKey,
                        ]),
                      ]
                        .filter(Boolean)
                        .sort()
                        .map((key) => (
                          <option key={key} value={key} />
                        ))}
                    </datalist>
                    <p
                      id="notification-event-filter-hint"
                      className="mt-1 text-xs text-muted-foreground"
                    >
                      {t(
                        eventFilterInvalid
                          ? 'admin.notifications.invalidEventFilter'
                          : 'admin.notifications.eventFilterHint',
                        uiLocale
                      )}
                    </p>
                  </div>
                  <Button type="submit" variant="outline">
                    {t('admin.notifications.applyEventFilter', uiLocale)}
                  </Button>
                </form>
              )
            }
            moreFilters={
              filterView
                ? {
                    label: workspaceText('historyFilters.label', uiLocale),
                    count: selectedFilterCount ? numbers.number(selectedFilterCount) : undefined,
                    children: (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <NativeSelect
                          aria-label={t('admin.notifications.locale', uiLocale)}
                          value={filterLocale}
                          onChange={(e) =>
                            changeFilter(() =>
                              queries
                                ? queries.setQuery({ filters: { locale: e.target.value } })
                                : setFilterLocale(e.target.value)
                            )
                          }
                          className="w-full"
                        >
                          <option value="">{t('admin.notifications.allLocales', uiLocale)}</option>
                          <option value="fa">فارسی</option>
                          <option value="en">English</option>
                        </NativeSelect>
                        <NativeSelect
                          aria-label={t('admin.notifications.channel', uiLocale)}
                          value={filterChannel}
                          onChange={(e) =>
                            changeFilter(() =>
                              queries
                                ? queries.setQuery({ filters: { channel: e.target.value } })
                                : setFilterChannel(e.target.value)
                            )
                          }
                          className="w-full"
                        >
                          <option value="">{t('admin.notifications.allChannels', uiLocale)}</option>
                          <option value="email">{channelLabels.email}</option>
                          <option value="sms">{channelLabels.sms}</option>
                          <option value="in_app">{channelLabels.in_app}</option>
                        </NativeSelect>
                        <NativeSelect
                          aria-label={t('admin.notifications.allStatus', uiLocale)}
                          value={filterStatus}
                          onChange={(e) =>
                            changeFilter(() =>
                              queries
                                ? queries.setQuery({ filters: { status: e.target.value } })
                                : setFilterStatus(e.target.value)
                            )
                          }
                          className="w-full"
                        >
                          <option value="">{t('admin.notifications.allStatus', uiLocale)}</option>
                          <option value="draft">{t('admin.notifications.draft', uiLocale)}</option>
                          <option value="active">
                            {t('admin.notifications.active', uiLocale)}
                          </option>
                          <option value="archived">
                            {t('admin.notifications.archived', uiLocale)}
                          </option>
                        </NativeSelect>
                      </div>
                    ),
                  }
                : undefined
            }
            refresh={
              <ListRefreshButton
                label={t('admin.notifications.refresh', uiLocale)}
                ref={refreshButton}
                onClick={() => (scope.denied ? scope.recover() : void fetchTemplates())}
              />
            }
          />
        )}
        <ListPage.Content
          loading={loading}
          error={loadFailed || scope.denied}
          empty={false}
          emptyView={null}
          retainContent={accepted}
          loadingView={
            isRecordTask || view === 'detail' ? (
              <RecordDetailSkeleton label={label('loading')} />
            ) : (
              <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
            )
          }
          errorView={
            <div role="alert">
              <p>
                {t(
                  scope.denied
                    ? 'admin.notifications.denied'
                    : missing
                      ? 'admin.notifications.missing'
                      : 'admin.notifications.error.load',
                  uiLocale
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => (scope.denied ? scope.recover() : void fetchTemplates())}
              >
                {t('admin.notifications.retry', uiLocale)}
              </Button>
            </div>
          }
        >
          {unconfirmed && (
            <Alert variant="destructive">
              {unconfirmed === 'test'
                ? notificationFormText('testUnconfirmed', uiLocale)
                : confirmationText('unconfirmed', uiLocale)}
            </Alert>
          )}
          {error && (
            <div
              role="alert"
              className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded relative"
            >
              {error}
              <Button
                type="button"
                aria-label={t('admin.notifications.dismissError', uiLocale)}
                onClick={() => setError(null)}
                variant="ghost"
                className="absolute top-2 end-2 text-destructive"
              >
                ✕
              </Button>
            </div>
          )}

          {accepted && !scope.denied && (
            <>
              {publishNeedsSubject && (
                <section
                  aria-label={label('publishTitle')}
                  className={`${recordEditorSurface} max-w-4xl border-warning/30`}
                >
                  <div className="bg-warning-soft px-4 py-4 sm:px-6">
                    <h2 className="text-sm font-semibold text-warning">
                      {editorCopy('publishSubjectIssue')}
                    </h2>
                  </div>
                  <RecordEditorActions>
                    <Button
                      onClick={() => (onSettled ? onSettled(templateId) : setPublishId(null))}
                      variant="outline"
                    >
                      {label('cancel')}
                    </Button>
                    <Link
                      ref={publishSubjectActionRef}
                      to={notificationTemplateRoutes.action}
                      params={{
                        templateId: publishTarget.id,
                        action: notificationTemplateActions.edit,
                      }}
                      search={routeSearch}
                      hash="notification-template-subject"
                      className={buttonVariants()}
                    >
                      {editorCopy('publishSubjectAction')}
                    </Link>
                  </RecordEditorActions>
                </section>
              )}
              {view === 'compare' && (
                <TemplatePreviewPanel
                  uiLocale={uiLocale}
                  templates={templates}
                  loading={loading}
                  ready={ready}
                  queries={previewQueries}
                />
              )}
              {record && (!isWriting || !showEditor) && (
                <div className="max-w-4xl space-y-4">
                  {(view === 'detail' || view === 'edit') && (
                    <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
                      {view !== 'detail' && (
                        <p className="font-mono text-sm [overflow-wrap:anywhere]" dir="ltr">
                          {record.eventKey}
                        </p>
                      )}
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-4">
                        {[
                          ['channel', channelLabels[record.channel]],
                          ['locale', LOCALE_LABELS[record.locale]],
                          ['col.status', label(record.status)],
                          ['preview.version', numbers.number(record.version)],
                        ].map(([key, value]) => (
                          <div key={key}>
                            <dt className="text-muted-foreground">{label(key!)}</dt>
                            <dd className="font-medium">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {view === 'detail' && (
                        <>
                          <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-3">
                            <div>
                              <dt className="text-muted-foreground">{label('col.createdAt')}</dt>
                              <dd>
                                <DateCell
                                  value={record.createdAt}
                                  format={(value) => time.format(value)}
                                />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{label('col.publishedAt')}</dt>
                              <dd>
                                <DateCell
                                  value={record.publishedAt}
                                  format={(value) => time.format(value)}
                                />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{label('col.author')}</dt>
                              <dd className="[overflow-wrap:anywhere]">
                                <TextCell value={record.createdBy} />
                              </dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                            {actionLink('preview', record.id, label('preview'))}
                            {renderTemplateActions(record)}
                          </div>
                        </>
                      )}
                    </section>
                  )}
                  {view === 'detail' && (
                    <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
                      <div>
                        <h2 className="text-sm font-medium text-muted-foreground">
                          {label('bodyTemplate')}
                        </h2>
                        <p
                          className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/45 p-3 leading-relaxed [overflow-wrap:anywhere]"
                          dir={record.locale === 'fa' ? 'rtl' : 'ltr'}
                        >
                          {record.bodyTemplate}
                        </p>
                      </div>
                      {record.variables.length > 0 && (
                        <div>
                          <h2 className="text-sm font-medium text-muted-foreground">
                            {label('variables')}
                          </h2>
                          <ul className="flex flex-wrap gap-2 pt-2">
                            {record.variables.map(({ name, description }) => (
                              <li
                                key={name}
                                className="max-w-full rounded bg-muted px-2 py-1 text-sm [overflow-wrap:anywhere]"
                              >
                                <code dir="ltr">{name}</code>
                                {description ? ' · ' + description : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {showEditor && (
                        <section
                          aria-labelledby="test-delivery-detail-title"
                          className="space-y-2.5 border-t pt-4"
                        >
                          <h2 id="test-delivery-detail-title" className="text-base font-semibold">
                            {editorCopy('testDelivery')}
                          </h2>
                          {testSendControls}
                        </section>
                      )}
                    </section>
                  )}
                  {(view === 'preview' || view === 'publish') && (
                    <TemplatePreviewPanel
                      exact
                      uiLocale={uiLocale}
                      templates={[record]}
                      loading={loading}
                      ready={ready}
                    />
                  )}
                  {(view === 'edit' || view === 'publish') && !recordEditable && (
                    <Alert>{label('immutable')}</Alert>
                  )}
                  {view === 'publish' && recordEditable && !publishId && !publishNeedsSubject && (
                    <Button
                      disabled={!ready}
                      onClick={() => {
                        publishBasis.current = templateBasis(record);
                        setPublishId(record.id);
                      }}
                    >
                      {label('reviewLatest')}
                    </Button>
                  )}
                </div>
              )}
              {/* Editor form */}
              {showEditor && view !== 'detail' && (
                <form
                  onSubmit={handleSave}
                  noValidate
                  className={recordEditorSurface}
                  aria-label={pageTitle}
                >
                  {catalogueRootMessage(editorForm.errors) && (
                    <Alert variant="destructive" className="m-4">
                      {catalogueRootMessage(editorForm.errors)}
                    </Alert>
                  )}
                  {editorUncertain && (
                    <Alert variant="destructive" className="m-4">
                      {notificationFormText('uncertain', uiLocale)}
                    </Alert>
                  )}
                  <fieldset
                    disabled={
                      saving || editorForm.pending || editorUncertain || stale || !!protectedAction
                    }
                    className="min-w-0"
                  >
                    <legend className="sr-only">{pageTitle}</legend>
                    <RecordEditorSection title={editorCopy('routing')}>
                      {editId ? (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                          <div className="col-span-2 min-w-0 sm:col-span-1">
                            <dt className="text-xs text-muted-foreground">{label('eventKey')}</dt>
                            <dd className="text-sm font-medium [overflow-wrap:anywhere]">
                              {selectedEventTitle !== eventKey && <p>{selectedEventTitle}</p>}
                              <bdi
                                id="notification-template-eventKey"
                                dir="ltr"
                                className={
                                  selectedEventTitle !== eventKey
                                    ? 'text-xs text-muted-foreground'
                                    : undefined
                                }
                              >
                                {eventKey}
                              </bdi>
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">{label('channel')}</dt>
                            <dd className="text-sm">
                              {channelLabels[channel as TemplateChannel] ?? channel}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">{label('locale')}</dt>
                            <dd className="text-sm">
                              {LOCALE_LABELS[locale as TemplateLocale] ?? locale}
                            </dd>
                          </div>
                          {record && (
                            <div className="col-span-2 sm:col-span-1">
                              <dt className="text-xs text-muted-foreground">
                                {label('preview.version')}
                              </dt>
                              <dd className="text-sm">
                                {numbers.number(record.version)} · {label(record.status)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:gap-x-4 lg:grid-cols-3">
                          <div className={`${recordEditorField} col-span-2 lg:col-span-1`}>
                            <Label htmlFor="notification-template-eventKey">
                              {showCustomEvent ? label('eventKey') : editorCopy('event')}{' '}
                              <span aria-hidden="true" className="text-destructive">
                                *
                              </span>
                            </Label>
                            {showCustomEvent ? (
                              <>
                                <Input
                                  id="notification-template-eventKey"
                                  dir="ltr"
                                  {...eventBinding}
                                  aria-describedby={[
                                    'notification-custom-event-help',
                                    editorForm.errors.eventKey && editorForm.errorId('eventKey'),
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  value={eventKey}
                                  onChange={(event) => setEventKey(event.target.value)}
                                  required
                                  aria-required="true"
                                  maxLength={100}
                                  pattern="\S+"
                                />
                                <p
                                  id="notification-custom-event-help"
                                  className="text-xs text-muted-foreground"
                                >
                                  {editorCopy('customEventHelp')}
                                </p>
                              </>
                            ) : (
                              <CatalogueChoicePicker
                                id="notification-template-eventKey"
                                locale={uiLocale}
                                options={[...REGISTERED_EVENT_KEYS, ...savedEventKeys].map(
                                  (key) => {
                                    const title = notificationEventTitle(key, uiLocale);
                                    return {
                                      id: key,
                                      title,
                                      detail: title === key ? undefined : key,
                                      searchText: `${key} ${key.replace(/[._]/g, ' ')} ${notificationEventTitle(key, uiLocale === 'fa' ? 'en' : 'fa')}`,
                                    };
                                  }
                                )}
                                selected={eventKey}
                                disabled={
                                  saving ||
                                  editorForm.pending ||
                                  editorUncertain ||
                                  stale ||
                                  !!protectedAction
                                }
                                field={eventBinding}
                                labels={{
                                  search: editorCopy('searchEvents'),
                                  noMatches: editorCopy('noMatchingEvents'),
                                  empty: editorCopy('noMatchingEvents'),
                                  unavailable: editorCopy('chooseEvent'),
                                }}
                                onChange={setEventKey}
                              />
                            )}
                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
                              {!showCustomEvent && selectedEventTitle !== eventKey && (
                                <bdi
                                  dir="ltr"
                                  className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                                >
                                  {eventKey}
                                </bdi>
                              )}
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="px-0"
                                onClick={() => {
                                  setCustomEventEntry(!showCustomEvent);
                                  editorForm.form.setValue('eventKey', '', { shouldDirty: true });
                                  editorForm.form.clearErrors('eventKey');
                                  requestAnimationFrame(() =>
                                    document
                                      .getElementById('notification-template-eventKey')
                                      ?.focus()
                                  );
                                }}
                              >
                                {editorCopy(showCustomEvent ? 'chooseEvent' : 'customEvent')}
                              </Button>
                            </div>
                            {feedback('eventKey')}
                          </div>

                          <div className={recordEditorField}>
                            <Label htmlFor="notification-template-channel">
                              {t('admin.notifications.channel', uiLocale)}{' '}
                              <span aria-hidden="true" className="text-destructive">
                                *
                              </span>
                            </Label>
                            <NativeSelect
                              id="notification-template-channel"
                              {...editorForm.bind('channel')}
                              value={channel}
                              onChange={(e) =>
                                changeDraftChannel(e.target.value as TemplateChannel)
                              }
                              className="w-full"
                              required
                              aria-required="true"
                            >
                              {CHANNEL_OPTIONS.map((c) => (
                                <option key={c} value={c}>
                                  {channelLabels[c]}
                                </option>
                              ))}
                            </NativeSelect>
                            {feedback('channel')}
                          </div>
                          <div className={recordEditorField}>
                            <Label htmlFor="notification-template-locale">
                              {t('admin.notifications.locale', uiLocale)}{' '}
                              <span aria-hidden="true" className="text-destructive">
                                *
                              </span>
                            </Label>
                            <NativeSelect
                              id="notification-template-locale"
                              {...editorForm.bind('locale')}
                              value={locale}
                              onChange={(e) => setLocale(e.target.value as TemplateLocale)}
                              className="w-full"
                              required
                              aria-required="true"
                            >
                              {LOCALE_OPTIONS.map((l) => (
                                <option key={l} value={l}>
                                  {LOCALE_LABELS[l]}
                                </option>
                              ))}
                            </NativeSelect>
                            {feedback('locale')}
                          </div>
                        </div>
                      )}
                    </RecordEditorSection>
                    <div className="@container">
                      <div className="grid min-w-0 @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                        <div className="min-w-0 border-b @3xl:border-e @3xl:border-b-0">
                          <RecordEditorSection title={editorCopy('messageContent')}>
                            {showSubject && (
                              <div className={recordEditorField}>
                                <Label htmlFor="notification-template-subject">
                                  {subjectLabel(channel)}
                                </Label>
                                <Input
                                  type="text"
                                  id="notification-template-subject"
                                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                                  {...editorForm.bind('subject')}
                                  ref={(element) => {
                                    subjectRef.current = element;
                                    editorForm.bind('subject').ref(element);
                                  }}
                                  aria-describedby={
                                    editorForm.errors.subject
                                      ? editorForm.errorId('subject')
                                      : 'notification-subject-hint'
                                  }
                                  readOnly={viewOnly || testSending}
                                  value={subject}
                                  onChange={(e) => setSubject(e.target.value)}
                                  className="w-full"
                                  maxLength={200}
                                />
                                {editorForm.errors.subject ? (
                                  feedback('subject')
                                ) : (
                                  <p
                                    id="notification-subject-hint"
                                    className="text-xs text-muted-foreground"
                                  >
                                    {editorCopy(subjectHint)}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className={recordEditorField}>
                              <Label htmlFor="notification-template-bodyTemplate">
                                {t('admin.notifications.bodyTemplate', uiLocale)}{' '}
                                <span aria-hidden="true" className="text-destructive">
                                  *
                                </span>
                              </Label>
                              <p
                                id="notification-body-hint"
                                className="text-xs text-muted-foreground mb-1"
                              >
                                {t('admin.notifications.bodyHint', uiLocale)}
                              </p>

                              <Textarea
                                id="notification-template-bodyTemplate"
                                {...editorForm.bind('bodyTemplate')}
                                ref={(element) => {
                                  bodyRef.current = element;
                                  editorForm.bind('bodyTemplate').ref(element);
                                }}
                                aria-describedby={
                                  editorForm.errors.bodyTemplate
                                    ? `notification-body-hint ${editorForm.errorId('bodyTemplate')}`
                                    : 'notification-body-hint'
                                }
                                readOnly={viewOnly || testSending}
                                value={bodyTemplate}
                                onChange={(e) => setBodyTemplate(e.target.value)}
                                className="min-h-24 max-h-72 resize-y"
                                placeholder={editorCopy('messagePlaceholder')}
                                rows={4}
                                required
                                aria-required={!viewOnly || undefined}
                                dir={locale === 'fa' ? 'rtl' : 'ltr'}
                              />
                              {parsedVariables.length > 0 && (
                                <section
                                  aria-labelledby="notification-template-variable-reference"
                                  className="space-y-2 rounded-lg bg-muted/40 p-3"
                                >
                                  <h3
                                    id="notification-template-variable-reference"
                                    className="text-xs font-semibold"
                                  >
                                    {t('admin.notifications.variables', uiLocale)}
                                  </h3>
                                  <p className="text-xs text-muted-foreground">
                                    {t('admin.notifications.insertHint', uiLocale)}
                                  </p>
                                  <ul className="flex flex-wrap gap-2">
                                    {parsedVariables.map((v) => (
                                      <li key={v.name} className="min-w-0 max-w-full">
                                        <Button
                                          type="button"
                                          disabled={viewOnly || testSending}
                                          draggable={!viewOnly && !testSending}
                                          onDragStart={(event) => {
                                            event.dataTransfer.setData(
                                              'text/plain',
                                              `{{${v.name}}}`
                                            );
                                            event.dataTransfer.effectAllowed = 'copy';
                                          }}
                                          onClick={() => insertVariable(v.name)}
                                          variant="outline"
                                          size="sm"
                                          dir="ltr"
                                          className="h-auto min-h-9 max-w-full py-1 font-mono text-xs whitespace-normal [overflow-wrap:anywhere]"
                                        >
                                          {'{{'}
                                          {v.name}
                                          {'}}'}
                                        </Button>
                                        {v.description && (
                                          <p
                                            dir="auto"
                                            className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]"
                                          >
                                            {v.description}
                                          </p>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                              )}
                              {feedback('bodyTemplate')}
                            </div>
                          </RecordEditorSection>
                          <RecordEditorSection title={editorCopy('declaredVariables')}>
                            <NotificationVariableFields
                              locale={uiLocale}
                              rows={variableRows}
                              onChange={setVariableRows}
                              onBlur={editorForm.bind('variables').onBlur}
                              fieldRef={variableFieldsRef}
                              disabled={viewOnly || testSending}
                              error={editorForm.errors.variables?.message}
                            />
                          </RecordEditorSection>
                        </div>
                        <RecordEditorSection title={label('preview')}>
                          <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/25">
                            {channel !== 'sms' && subject.trim() !== '' && (
                              <p
                                className="border-b px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]"
                                dir={locale === 'fa' ? 'rtl' : 'ltr'}
                              >
                                {channel === 'email' && (
                                  <span className="font-semibold">{label('subjectLabel')} </span>
                                )}
                                <span
                                  className={channel === 'in_app' ? 'font-semibold' : undefined}
                                >
                                  {
                                    renderTemplatePreview(
                                      subject,
                                      parsedVariables,
                                      undefined,
                                      false
                                    ).output
                                  }
                                </span>
                              </p>
                            )}
                            {!bodyTemplate.trim() ? (
                              <p className="px-3 py-2 text-sm text-muted-foreground">
                                {editorCopy('previewEmpty')}
                              </p>
                            ) : channel === 'email' ? (
                              <BrandedEmailPreview
                                body={renderTemplatePreview(bodyTemplate, parsedVariables).output}
                                locale={locale}
                                uiLocale={uiLocale}
                                title={label('preview')}
                              />
                            ) : (
                              <pre
                                className="px-3 py-2 text-sm whitespace-pre-wrap font-sans text-foreground [overflow-wrap:anywhere]"
                                dir={locale === 'fa' ? 'rtl' : 'ltr'}
                              >
                                {
                                  renderTemplatePreview(
                                    bodyTemplate,
                                    parsedVariables,
                                    undefined,
                                    false
                                  ).output
                                }
                              </pre>
                            )}
                          </div>
                        </RecordEditorSection>
                      </div>
                    </div>
                  </fieldset>
                  {(stale || editorUncertain) && (
                    <div className="space-y-2 border-t px-4 py-4 sm:px-6">
                      {stale && <p role="alert">{t('admin.notifications.stale', uiLocale)}</p>}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          !ready ||
                          (!!editId && !selectedTemplate) ||
                          (editorUncertain && !editorRecovered)
                        }
                        onClick={() =>
                          selectedTemplate ? openEdit(selectedTemplate) : openCreate()
                        }
                      >
                        {t('admin.notifications.reset', uiLocale)}
                      </Button>
                    </div>
                  )}
                  <fieldset
                    disabled={saving || editorForm.pending || !!protectedAction}
                    className="contents"
                  >
                    {editId && (
                      <RecordEditorSection title={editorCopy('testDelivery')}>
                        {testSendControls}
                      </RecordEditorSection>
                    )}
                    <RecordEditorActions>
                      <Button
                        type="button"
                        onClick={() => (onSettled ? onSettled(templateId) : closeEditor())}
                        variant="outline"
                      >
                        {t('admin.notifications.cancel', uiLocale)}
                      </Button>
                      <CatalogueSaveButton
                        pending={saving || editorForm.pending}
                        disabled={
                          !ready ||
                          stale ||
                          saving ||
                          editorForm.pending ||
                          editorUncertain ||
                          viewOnly ||
                          testSending ||
                          !!protectedAction
                        }
                        label={
                          saving || editorForm.pending
                            ? t('admin.notifications.saving', uiLocale)
                            : editId
                              ? t('admin.notifications.update', uiLocale)
                              : t('admin.notifications.create', uiLocale)
                        }
                      />
                    </RecordEditorActions>
                  </fieldset>
                </form>
              )}

              {/* Publish confirm dialog */}
              {publishId && !publishNeedsSubject && (
                <section
                  aria-label={label('publishTitle')}
                  className={`${recordEditorSurface} max-w-4xl border-warning/20`}
                >
                  <div className="space-y-2 px-4 py-4 sm:px-6">
                    {!view && <h2 className="font-semibold">{label('publishTitle')}</h2>}
                    <p className="text-sm text-muted-foreground">
                      {t('admin.notifications.publishDesc', uiLocale)}
                    </p>
                  </div>
                  <RecordEditorActions>
                    <Button
                      onClick={() => (onSettled ? onSettled(templateId) : setPublishId(null))}
                      variant="outline"
                    >
                      {t('admin.notifications.cancel', uiLocale)}
                    </Button>
                    <Button
                      onClick={handlePublish}
                      disabled={!ready || publishing || !!protectedAction}
                    >
                      {publishing
                        ? t('admin.notifications.publishing', uiLocale)
                        : t('admin.notifications.publish', uiLocale)}
                    </Button>
                  </RecordEditorActions>
                </section>
              )}

              {/* Saved versions share one catalogue and the existing editor/preview owners. */}
              {listView && (
                <OperationalQueueTable
                  locale={uiLocale}
                  rows={templates}
                  caption={t('admin.notifications.catalogue', uiLocale)}
                  scrollLabel={t('admin.notifications.catalogue', uiLocale)}
                  nameHeader={t('admin.notifications.col.event', uiLocale)}
                  cardHeading="h2"
                  tableClassName="min-w-[72rem]"
                  loading={loading}
                  emptyMessage={t('admin.notifications.empty', uiLocale)}
                  renderName={(template) => (
                    <>
                      {view ? (
                        <Link
                          to={notificationTemplateRoutes.detail}
                          params={{ templateId: template.id }}
                          search={routeSearch}
                          className="touch-action max-w-full font-mono text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                          dir="ltr"
                        >
                          {template.eventKey}
                        </Link>
                      ) : (
                        <span className="block font-mono">
                          <TextCell value={template.eventKey} />
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {t('admin.notifications.preview.version', uiLocale)}{' '}
                        {numbers.number(template.version)}
                      </span>
                    </>
                  )}
                  fields={[
                    {
                      id: 'channel',
                      label: t('admin.notifications.channel', uiLocale),
                      render: (template) => (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded ${
                            template.channel === 'email'
                              ? 'bg-blue-100 text-blue-800'
                              : template.channel === 'sms'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-muted text-foreground'
                          }`}
                        >
                          {channelLabels[template.channel]}
                        </span>
                      ),
                    },
                    {
                      id: 'locale',
                      label: t('admin.notifications.locale', uiLocale),
                      render: (template) => <TextCell value={LOCALE_LABELS[template.locale]} />,
                    },
                    {
                      id: 'status',
                      label: t('admin.notifications.col.status', uiLocale),
                      render: (template) => (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded ${
                            template.status === 'draft'
                              ? 'bg-warning-soft text-warning'
                              : template.status === 'active'
                                ? 'bg-success-soft text-success'
                                : 'bg-muted text-foreground'
                          }`}
                        >
                          {t(`admin.notifications.${template.status}`, uiLocale)}
                        </span>
                      ),
                    },
                    {
                      id: 'subject',
                      label: t('admin.notifications.col.subject', uiLocale),
                      render: (template) => (
                        <span className="block whitespace-normal [overflow-wrap:anywhere]">
                          <TextCell value={template.subject} />
                        </span>
                      ),
                    },
                    {
                      id: 'active',
                      label: t('admin.notifications.col.active', uiLocale),
                      render: (template) =>
                        template.isActive ? (
                          <span className="text-success text-sm font-medium">
                            ✓ {t('admin.notifications.active', uiLocale)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                    {
                      id: 'versionMetadata',
                      label: t('admin.notifications.col.versionMetadata', uiLocale),
                      render: (template) => (
                        <dl className="space-y-2 whitespace-normal text-sm">
                          <div>
                            <dt className="text-muted-foreground">
                              {t('admin.notifications.col.createdAt', uiLocale)}
                            </dt>
                            <dd>
                              <DateCell
                                value={template.createdAt}
                                format={(value) => time.format(value)}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              {t('admin.notifications.col.publishedAt', uiLocale)}
                            </dt>
                            <dd>
                              <DateCell
                                value={template.publishedAt}
                                format={(value) => time.format(value)}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              {t('admin.notifications.col.author', uiLocale)}
                            </dt>
                            <dd>
                              <TextCell value={template.createdBy} />
                            </dd>
                          </div>
                        </dl>
                      ),
                    },
                  ]}
                  actionHeader={t('admin.notifications.col.actions', uiLocale)}
                  renderActions={renderTemplateActions}
                />
              )}
            </>
          )}
        </ListPage.Content>
      </ListPage>
    </div>
  );
}
