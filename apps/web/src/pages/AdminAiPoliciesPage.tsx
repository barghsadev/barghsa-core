import {
  Eye as TableEyeIcon,
  Pencil as TablePencilIcon,
  Trash2 as TableTrash2Icon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import type { CatalogueRecordWorkspace } from '../lib/catalogue-workspace.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useCatalogueConfirmationRead } from '../hooks/useCatalogueConfirmationRead.js';
import { validCatalogueCount, validCataloguePriority } from '../lib/knowledge-documents.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  CatalogueMembershipReview,
  CatalogueRelationEditor,
  type ReviewedMembershipCommand,
} from '../components/CatalogueRelationEditor.js';
import { CatalogueRecordTable } from '../components/CatalogueRecordTable.js';
import {
  matchesMembership,
  memberIdsBasis,
  type MembershipCommand,
} from '../lib/catalogue-membership.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { FormField } from '@barghsa/ui/form';
import { RecordListField } from '../components/RecordListField.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  type PolicyDraft as Draft,
  invalidPolicyFields,
  policyBody,
  matchesAiCatalogueReceipt,
  policyPriority,
} from '../lib/knowledge-policy-form.js';
import type { PolicyCatalogueKind } from '../lib/catalogue-category-query.js';
import { useEffect, useState, useRef, useCallback, useMemo, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Badge,
  Alert,
  LoadingStatus,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { toast } from '../lib/toast-api.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
const types = [
  'allowed_topics',
  'disallowed_actions',
  'data_access_scope',
  'response_style',
  'content_filter',
  'output_format',
  'rate_limit',
] as const;
type PolicyType = (typeof types)[number];
type Kind = 'policies' | 'policy-groups';
interface PolicyRow {
  id: string;
  title: string;
  policyType?: PolicyType;
  rules?: Record<string, unknown>;
  enabled?: boolean;
  priority?: number;
  priorityOverride?: number | null;
  memberCount?: number;
}
interface Entry extends PolicyRow {
  description: string;
}
interface PolicyDetail extends Entry {
  members?: PolicyRow[];
  groups?: { id: string; title: string }[];
  updatedAt?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validPolicyRow(value: unknown): value is PolicyRow {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.policyType === undefined || types.includes(value.policyType as PolicyType)) &&
    (value.rules === undefined || record(value.rules)) &&
    (value.enabled === undefined || typeof value.enabled === 'boolean') &&
    validCatalogueCount(value.memberCount) &&
    validCataloguePriority(value.priority) &&
    (value.priorityOverride === undefined ||
      value.priorityOverride === null ||
      validCataloguePriority(value.priorityOverride))
  );
}
function validEntries(value: unknown): value is Entry[] {
  return (
    Array.isArray(value) &&
    value.every((row) => record(row) && typeof row.description === 'string' && validPolicyRow(row))
  );
}
function override(row: PolicyRow) {
  return row.priorityOverride === null || row.priorityOverride === undefined
    ? ''
    : String(row.priorityOverride);
}
function priorityBasis(row: PolicyRow) {
  return JSON.stringify({
    id: row.id,
    priority: row.priority,
    override: row.priorityOverride ?? null,
  });
}
function membersBasis(rows: PolicyRow[]) {
  return JSON.stringify(rows.map(priorityBasis).sort());
}
function draftFor(row?: Entry): Draft {
  const rules = row?.rules ?? {},
    items = rules.topics ?? rules.actions ?? rules.scopes ?? rules.blockedTerms;
  return {
    ...(row ? { id: row.id } : {}),
    title: row?.title ?? '',
    description: row?.description ?? '',
    policyType: row?.policyType ?? 'allowed_topics',
    enabled: row?.enabled ?? true,
    priority: String(row?.priority ?? 100),
    items: Array.isArray(items)
      ? items.filter((item): item is string => typeof item === 'string').join('\n')
      : '',
    tone: typeof rules.tone === 'string' ? rules.tone : '',
    language: typeof rules.language === 'string' ? rules.language : '',
    maxLength: typeof rules.maxLength === 'number' ? String(rules.maxLength) : '',
    requireSources: rules.requireSources === true,
    format: rules.format === 'json_object' ? 'json_object' : 'plain_text',
    maxRequests: typeof rules.maxRequests === 'number' ? String(rules.maxRequests) : '10',
    windowSeconds: typeof rules.windowSeconds === 'number' ? String(rules.windowSeconds) : '60',
  };
}
type CataloguePageProps = {
  workspace?: CatalogueRecordWorkspace;
  initialKind?: PolicyCatalogueKind;
  focusCategory?: boolean;
  onKindChange?: (value: PolicyCatalogueKind) => void;
};
export default function AdminAiPoliciesPage(props: CataloguePageProps = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return <OwnedAiPoliciesPage key={JSON.stringify([actor, contextRevision])} {...props} />;
}
function OwnedAiPoliciesPage({
  initialKind = 'policies',
  onKindChange,
  focusCategory = false,
  workspace,
}: CataloguePageProps = {}) {
  const locale = useLocale(),
    label = (key: string) => t(`admin.policies.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const [kind, setKind] = useState<Kind>(initialKind);
  const time = useAccountTime(locale);
  const recordId = workspace?.recordId;
  const isList = !workspace || workspace.view === 'list';
  const heading = useRef<HTMLHeadingElement>(null);
  const editorInitialized = useRef(false);
  const linkTo = (id: string, action?: 'edit') => ({
    to:
      kind === 'policy-groups'
        ? ('/admin/policies/groups/$recordId/{-$action}' as const)
        : ('/admin/policies/$recordId/{-$action}' as const),
    params: { recordId: id, action },
  });
  const listSearch = kind === 'policy-groups' ? { kind: 'policy-groups' as const } : {};
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const messages = Object.fromEntries(
    Object.keys(draftFor()).map((key) => [key, copy(key as Parameters<typeof copy>[0])])
  ) as Record<keyof Draft, string>;
  messages.id = copy('invalid');
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, (value) => invalidPolicyFields(value, kindRef.current));
    },
    draftFor,
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const [draftOpen, setDraftOpen] = useState(false);
  const draft = draftOpen ? form.values : null;
  const resetForm = form.form.reset;
  const setDraft = useCallback(
    (value: Draft | null) => {
      resetForm(value ?? draftFor());
      setDraftOpen(!!value);
    },
    [resetForm]
  );
  const [changed, setChanged] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [pending, setPending] = useState(false);
  const validationBusy = useRef(false),
    networkPending = useRef(false),
    requiredRead = useRef(0);
  const formCapture = useRef<{ body: Record<string, unknown>; id?: string } | null>(null);
  const actionRef = useRef<TeamAction | null>(null);
  const operationCapture = useRef<ReviewedMembershipCommand | null>(null),
    uncertainOperation = useRef<ReviewedMembershipCommand | null>(null);
  const requiredOperationRead = useRef<{ detail: number; choices: number | null }>({
    detail: 0,
    choices: null,
  });
  const [operationUncertain, setOperationUncertain] = useState(false);
  const setAction = useCallback((value: TeamAction | null) => {
    actionRef.current = value;
    if (!value) {
      formCapture.current = null;
      operationCapture.current = null;
    }
    updateAction(value);
  }, []);
  const onPendingChange = useCallback((value: boolean) => {
    networkPending.current = value;
    setPending(value);
  }, []);

  const [localSelected, setSelected] = useState<string | null>(null),
    [member, setMember] = useState(''),
    [memberPriority, setMemberPriority] = useState(''),
    [memberPriorities, setMemberPriorities] = useState<Record<string, string>>({});
  const selected = recordId ?? localSelected;
  const [action, updateAction] = useState<TeamAction | null>(null);
  const [notice, setNotice] = useState(false);
  const commandTarget = useRef<{ id: string; basis: string } | null>(null);
  const membershipBasis = useRef<string | null>(null);
  const proposedExistingMember = useRef(false);
  const generation = useRef(0),
    commandGeneration = useRef(0);
  const draftBasis = useRef<string | null>(null),
    acceptedMembers = useRef<PolicyRow[]>([]);
  const clearSelection = useCallback(() => {
    setOperationUncertain(false);
    uncertainOperation.current = null;
    requiredOperationRead.current = { detail: 0, choices: null };
    generation.current++;
    commandTarget.current = null;
    setSelected(null);
    setMember('');
    setMemberPriority('');
    setMemberPriorities({});
    acceptedMembers.current = [];
    membershipBasis.current = null;
    setAction(null);
  }, [setAction]);
  const clearWork = useCallback(() => {
    clearSelection();
    setDraft(null);
    draftBasis.current = null;
    setNotice(false);
    setChanged(false);
    setUncertain(false);
    requiredRead.current = 0;
    formCapture.current = null;
    validationBusy.current = false;
    form.setValidationPending(false);
    onPendingChange(false);
    editorInitialized.current = false;
  }, [clearSelection, setAction, setDraft, form.setValidationPending, onPendingChange]);
  const scope = useCatalogueScope(clearWork);
  const confirmationRead = useCatalogueConfirmationRead(scope);
  const collection = useCatalogueResource(
    scope,
    recordId ? null : `/api/admin/${kind}`,
    validEntries
  );
  const choices = useCatalogueResource(
    scope,
    kind === 'policy-groups' && (isList || workspace?.view === 'detail')
      ? '/api/admin/policies'
      : null,
    validEntries
  );
  const validateDetail = useCallback(
    (value: unknown): value is PolicyDetail =>
      record(value) &&
      value.id === selected &&
      validEntries([value]) &&
      (kind !== 'policy-groups' ||
        (Array.isArray(value.members) && value.members.every(validPolicyRow))) &&
      (value.groups === undefined ||
        (Array.isArray(value.groups) &&
          value.groups.every(
            (group) =>
              record(group) && typeof group.id === 'string' && typeof group.title === 'string'
          ))) &&
      (value.updatedAt === undefined ||
        (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)))),
    [kind, selected]
  );
  const selectedRead = useCatalogueResource(
    scope,
    selected ? `/api/admin/${kind}/${encodeURIComponent(selected)}` : null,
    validateDetail,
    { clearOnMissing: true }
  );
  const detail = selectedRead.data;
  const singleRow = useMemo(() => (detail ? [detail] : null), [detail]);
  const list = recordId ? { ...selectedRead, data: singleRow } : collection;
  const rows = list.data ?? [],
    policies = kind === 'policies' ? rows : (choices.data ?? []),
    members = detail?.members ?? [];
  const disabled = scope.denied || list.loading || list.error;
  useEffect(() => {
    if (!isList) heading.current?.focus({ preventScroll: true });
  }, [isList, recordId, workspace?.view]);
  useEffect(() => {
    if (disabled || editorInitialized.current) return;
    if (workspace?.view === 'create') edit(undefined, false);
    else if (workspace?.view === 'edit' && detail) edit(detail, false);
    else return;
    editorInitialized.current = true;
  }, [disabled, workspace?.view, detail]);
  const detailDisabled = disabled || selectedRead.loading || selectedRead.error;
  const memberDisabled = detailDisabled || choices.loading || choices.error;
  const work = useRef({ selected, draft, action, disabled, detailDisabled, memberDisabled });
  work.current = { selected, draft, action, disabled, detailDisabled, memberDisabled };
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    if (!list.data) return;
    const current = work.current;
    if (current.draft?.id && draftBasis.current) {
      const fresh = list.data.find((row) => row.id === current.draft?.id);
      if (!fresh || JSON.stringify(draftFor(fresh)) !== draftBasis.current) {
        generation.current++;
        setChanged(true);
        setAction(null);
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
    const command = commandTarget.current;
    if (
      command &&
      !list.data.some(
        (row) => row.id === command.id && JSON.stringify(draftFor(row)) === command.basis
      )
    ) {
      generation.current++;
      setAction(null);
      commandTarget.current = null;
    }
    if (current.selected && !list.data.some((row) => row.id === current.selected)) {
      clearSelection();
    }
  }, [list.data, clearSelection, setAction, form.setValidationPending]);
  useEffect(() => {
    if (!selectedRead.data) return;
    const next = selectedRead.data.members ?? [],
      old = acceptedMembers.current;
    if (membershipBasis.current !== null && membershipBasis.current !== membersBasis(next)) {
      if (!formCapture.current) {
        generation.current++;
        setAction(null);
      }
    }
    setMemberPriorities((previous) =>
      Object.fromEntries(
        next.map((item) => {
          const before = old.find((row) => row.id === item.id);
          return [item.id, before ? (previous[item.id] ?? override(item)) : override(item)];
        })
      )
    );
    acceptedMembers.current = next;
    membershipBasis.current = membersBasis(next);
  }, [selectedRead.data]);
  useEffect(() => {
    const pending = work.current.action;
    if (
      !choices.data ||
      !pending ||
      !record(pending.body) ||
      typeof pending.body.policyId !== 'string' ||
      proposedExistingMember.current
    )
      return;
    const id = pending.body.policyId;
    if (!choices.data.some((row) => row.id === id)) {
      generation.current++;
      setAction(null);
    }
  }, [choices.data]);
  function open(value: string) {
    if (
      disabled ||
      value === selected ||
      networkPending.current ||
      actionRef.current ||
      validationBusy.current
    )
      return;
    clearSelection();
    setSelected(value);
  }
  function edit(entry?: Entry, publish = true) {
    if (
      publish &&
      (disabled ||
        networkPending.current ||
        validationBusy.current ||
        actionRef.current ||
        uncertain)
    )
      return;
    generation.current++;
    formCapture.current = null;
    setChanged(false);
    commandTarget.current = null;
    setAction(null);
    setDraft(draftFor(entry));
    draftBasis.current = entry ? JSON.stringify(draftFor(entry)) : null;
    setNotice(false);
  }
  function refresh() {
    if (networkPending.current) return;
    if (validationBusy.current) {
      generation.current++;
      validationBusy.current = false;
      form.setValidationPending(false);
    }
    if (scope.denied) scope.recover();
    else {
      list.retry();
      choices.retry();
      if (!recordId) selectedRead.retry();
    }
  }
  function commandDisabled(path: string, body?: unknown) {
    const current = work.current;
    return path.endsWith('/members')
      ? record(body) && acceptedMembers.current.some((row) => row.id === body.policyId)
        ? current.detailDisabled
        : current.memberDisabled
      : path.includes('/members/')
        ? current.detailDisabled
        : current.disabled;
  }
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending || list.loading || choices.loading || selectedRead.loading}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {list.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {list.error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" onClick={list.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      {choices.error && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" onClick={choices.retry}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {selectedRead.error && (
        <div role="alert">
          <p>{label('detailError')}</p>
          <Button type="button" onClick={selectedRead.retry}>
            {label('detailRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    if (
      operationUncertain ||
      commandDisabled(path, body) ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const target = rows.find((row) => path === `/api/admin/${kind}/${row.id}`);
    commandTarget.current = target
      ? { id: target.id, basis: JSON.stringify(draftFor(target)) }
      : null;
    proposedExistingMember.current =
      record(body) && acceptedMembers.current.some((row) => row.id === body.policyId);
    commandGeneration.current = generation.current;
    setNotice(false);
    setAction({
      path,
      method,
      ...(method === 'PUT' && record(body) && body.enabled === false
        ? { risk: 'destructive' as const }
        : {}),
      ...(formCapture.current
        ? { successStatus: method === 'POST' ? 201 : 200, conflictMessage: copy('changed') }
        : {}),
      ...(operationCapture.current ? { successStatus: 204, conflictMessage: copy('changed') } : {}),
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        AI_POLICY_RULES_INVALID: label('invalid'),
        AI_POLICY_TYPE_WITHOUT_RULES: label('invalid'),
      },
    });
  }
  function changePolicyType(value: PolicyType) {
    form.field('policyType')[1](value);
    for (const field of ['items', 'tone', 'language', 'maxLength'] as const)
      form.field(field)[1]('');
    form.field('requireSources')[1](false);
    form.form.clearErrors([
      'items',
      'tone',
      'language',
      'maxLength',
      'requireSources',
      'format',
      'maxRequests',
      'windowSeconds',
    ]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      disabled ||
      changed ||
      uncertain ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const epoch = ++generation.current;
    validationBusy.current = true;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (epoch !== generation.current || work.current.disabled || actionRef.current || uncertain)
          return;
        validationBusy.current = false;
        const body = policyBody(value, kindRef.current);
        formCapture.current = { body, ...(value.id ? { id: value.id } : {}) };
        propose(
          `/api/admin/${kind}${value.id ? `/${value.id}` : ''}`,
          value.id ? 'PUT' : 'POST',
          label('save'),
          label('confirmSave'),
          body
        );
      })();
    } finally {
      if (epoch === generation.current) {
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
  }
  function unconfirmed() {
    if (operationCapture.current) {
      const operation = operationCapture.current;
      uncertainOperation.current = operation;
      setOperationUncertain(true);
      generation.current++;
      setAction(null);
      onPendingChange(false);
      requiredOperationRead.current = {
        detail: selectedRead.retry(),
        choices: operation.choicesRequired ? choices.retry() : null,
      };
      return;
    }
    if (!formCapture.current) return;
    setUncertain(true);
    generation.current++;
    setAction(null);
    onPendingChange(false);
    requiredRead.current = list.retry();
  }
  const operationResetDisabled =
    !operationUncertain ||
    !!action ||
    pending ||
    detailDisabled ||
    selectedRead.readAttempt === null ||
    selectedRead.readAttempt < requiredOperationRead.current.detail ||
    (requiredOperationRead.current.choices !== null &&
      (choices.loading ||
        choices.error ||
        choices.readAttempt === null ||
        choices.readAttempt < requiredOperationRead.current.choices));
  const operationRecovery = operationUncertain && (
    <div className="space-y-3">
      <Alert variant="warning">{copy('uncertain')}</Alert>
      {uncertainOperation.current && (
        <CatalogueMembershipReview command={uncertainOperation.current} locale={locale} />
      )}
      <Button
        type="button"
        variant="outline"
        disabled={operationResetDisabled}
        onClick={() => {
          if (operationResetDisabled) return;
          uncertainOperation.current?.owner?.reset();
          uncertainOperation.current = null;
          setOperationUncertain(false);
        }}
      >
        {copy('reset')}
      </Button>
    </div>
  );
  function priorityText(override: number | null | undefined, inherited: number | undefined) {
    if (override != null) return numbers.number(override);
    return inherited === undefined
      ? label('inheritPriority')
      : `${label('inheritPriority')} (${numbers.number(inherited)})`;
  }
  function proposeMembership(
    operation: MembershipCommand,
    method: 'POST' | 'DELETE',
    body?: unknown
  ) {
    if (
      operationUncertain ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current ||
      work.current.selected !== operation.groupId ||
      (operation.choicesRequired ? work.current.memberDisabled : work.current.detailDisabled)
    )
      return;
    const entry = (operation.choicesRequired ? policies : members).find(
      (item) => item.id === operation.memberId
    );
    const nextPriority = operation.expected;
    const hasNewPriority = typeof nextPriority === 'number' || nextPriority === null;
    operationCapture.current = {
      ...operation,
      memberTitle: entry?.title ?? operation.memberId,
      groupTitle: detail?.title ?? operation.groupId,
      ...(hasNewPriority && !operation.choicesRequired
        ? { currentPriority: priorityText(entry?.priorityOverride, entry?.priority) }
        : {}),
      ...(hasNewPriority ? { newPriority: priorityText(nextPriority, entry?.priority) } : {}),
    };
    propose(
      `/api/admin/policy-groups/${operation.groupId}/members${method === 'DELETE' ? `/${operation.memberId}` : ''}`,
      method,
      label(method === 'DELETE' ? 'unlink' : operation.choicesRequired ? 'link' : 'updatePriority'),
      label(
        method === 'DELETE'
          ? 'confirmUnlink'
          : operation.choicesRequired
            ? 'confirmLink'
            : 'confirmPriority'
      ),
      body
    );
  }
  const resetDisabled =
    disabled ||
    !!action ||
    form.pending ||
    pending ||
    (uncertain && (list.readAttempt === null || list.readAttempt < requiredRead.current));
  function resetDraft() {
    if (resetDisabled || !draft) return;
    generation.current++;
    const fresh = draft.id ? rows.find((row) => row.id === draft.id) : undefined;
    setDraft(draft.id && !fresh ? null : draftFor(fresh));
    draftBasis.current = fresh ? JSON.stringify(draftFor(fresh)) : null;
    setChanged(false);
    setUncertain(false);
    formCapture.current = null;
    setNotice(false);
  }
  const actionClass = buttonVariants({ variant: 'outline', className: 'min-h-11' });
  const ruleList = detail ? draftFor(detail).items.split('\n').filter(Boolean) : [];
  const ruleFacts = detail?.rules
    ? Object.entries(detail.rules).filter(
        ([key, value]) =>
          ['tone', 'language', 'maxLength', 'maxRequests', 'windowSeconds', 'format'].includes(
            key
          ) &&
          (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
      )
    : [];
  const recordActions = (entry: PolicyDetail) => (
    <div className="flex flex-wrap gap-2">
      <Link
        {...linkTo(entry.id, 'edit')}
        className={actionClass}
        aria-label={`${label('edit')} ${entry.title}`}
      >
        {label('edit')}
      </Link>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !!action || pending || operationUncertain}
        onClick={() =>
          propose(
            `/api/admin/${kind}/${entry.id}`,
            'DELETE',
            label('delete'),
            `${entry.title}. ${label('confirmDelete')}`
          )
        }
      >
        {label('delete')}
      </Button>
    </div>
  );
  const isEditor = workspace?.view === 'create' || workspace?.view === 'edit';
  const hasInlineRefresh = isEditor || (workspace?.view === 'detail' && kind === 'policy-groups');
  const actionReadIssue = list.error || choices.error || selectedRead.error || selectedRead.loading;
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col p-4 md:px-8 ${isEditor ? 'max-w-3xl gap-4' : 'max-w-5xl gap-6 md:py-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!isList && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-primary">
              <Link
                to="/admin/policies"
                search={listSearch}
                className="underline-offset-4 hover:underline"
              >
                {label(kind)}
              </Link>
              {detail && workspace?.view === 'edit' && (
                <>
                  <span aria-hidden="true">/</span>
                  <Link {...linkTo(detail.id)} className="underline-offset-4 hover:underline">
                    <bdi>{detail.title}</bdi>
                  </Link>
                </>
              )}
            </div>
          )}
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={isList ? undefined : -1}
            className="text-2xl font-semibold outline-none! [overflow-wrap:anywhere]"
          >
            {workspace?.view === 'edit'
              ? copy(kind === 'policies' ? 'editPolicy' : 'editGroup')
              : !isList && detail
                ? detail.title
                : label(
                    workspace?.view === 'create'
                      ? kind === 'policies'
                        ? 'addPolicy'
                        : 'addGroup'
                      : 'title'
                  )}
          </h1>
        </div>
        {hasInlineRefresh && (
          <ListRefreshButton
            label={label('refresh')}
            disabled={pending || list.loading || choices.loading || selectedRead.loading}
            onClick={refresh}
          />
        )}
      </header>
      {!hasInlineRefresh && (
        <div className="flex flex-wrap gap-2">
          {isList &&
            (['policies', 'policy-groups'] as const).map((value) => (
              <Button
                key={value}
                autoFocus={focusCategory && kind === value}
                disabled={pending}
                aria-pressed={kind === value}
                variant={kind === value ? 'default' : 'outline'}
                onClick={() => {
                  if (kind === value) return;
                  clearWork();
                  if (onKindChange) onKindChange(value);
                  else {
                    scope.recover();
                    setKind(value);
                  }
                }}
              >
                {label(value)}
              </Button>
            ))}
          <Button
            variant="outline"
            disabled={pending || list.loading || choices.loading || selectedRead.loading}
            onClick={refresh}
          >
            {label('refresh')}
          </Button>
        </div>
      )}
      <ListPage>
        {scope.denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            <CommandFeedback message={notice ? label('saved') : null} />
            {isList && (
              <ListPage.Toolbar>
                {workspace && !disabled && !form.pending && !action && !pending && !uncertain ? (
                  <Link {...linkTo('new')} className={buttonVariants({ className: 'min-h-11' })}>
                    {label(kind === 'policies' ? 'addPolicy' : 'addGroup')}
                  </Link>
                ) : (
                  <Button
                    disabled={disabled || form.pending || !!action || pending || uncertain}
                    onClick={() => edit()}
                  >
                    {label(kind === 'policies' ? 'addPolicy' : 'addGroup')}
                  </Button>
                )}
              </ListPage.Toolbar>
            )}
            {choices.loading && <LoadingStatus>{label('optionsLoading')}</LoadingStatus>}
            {choices.error && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button onClick={choices.retry}>{label('optionsRetry')}</Button>
              </div>
            )}
            {selectedRead.loading && <LoadingStatus>{label('detailLoading')}</LoadingStatus>}
            {!isList && !recordId && collection.loading && (
              <LoadingStatus>{label('loading')}</LoadingStatus>
            )}
            {!isList && !recordId && collection.error && (
              <div role="alert" className="space-y-2">
                <p>{label('error')}</p>
                <Button onClick={collection.retry}>{label('retry')}</Button>
              </div>
            )}
            {selectedRead.error && (
              <div role="alert">
                <p>{label(selectedRead.missing ? 'missing' : 'detailError')}</p>
                <Button onClick={selectedRead.retry}>{label('detailRetry')}</Button>
              </div>
            )}
            {draft && (
              <form
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                aria-label={label('editor')}
                className={recordEditorSurface}
              >
                {changed && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {copy('changed')}
                  </p>
                )}
                {uncertain && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {copy('uncertain')}
                  </p>
                )}
                {catalogueRootMessage(form.errors) && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {catalogueRootMessage(form.errors)}
                  </p>
                )}
                <fieldset disabled={form.pending || !!action || pending} className="min-w-0">
                  <legend className="sr-only">{label('editor')}</legend>
                  <RecordEditorSection
                    title={copy(kind === 'policies' ? 'policyDetails' : 'groupDetails')}
                  >
                    <div className={recordEditorField}>
                      <Label htmlFor="policy-title">{label('name')}</Label>
                      <Input
                        {...form.bind('title')}
                        id="policy-title"
                        dir="auto"
                        value={draft.title}
                        required
                        aria-required="true"
                        maxLength={120}
                        onChange={(event) =>
                          form.field('title')[1](event.target.value as Draft['title'])
                        }
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('title')}
                        error={form.errors.title}
                        message={messages.title}
                      />
                    </div>
                    <div className={recordEditorField}>
                      <Label htmlFor="policy-description">{label('description')}</Label>
                      <Textarea
                        {...form.bind('description')}
                        id="policy-description"
                        dir="auto"
                        rows={2}
                        placeholder={copy(
                          kind === 'policies' ? 'policyDescription' : 'groupDescription'
                        )}
                        className="max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]"
                        maxLength={2000}
                        value={draft.description}
                        onChange={(event) =>
                          form.field('description')[1](event.target.value as Draft['description'])
                        }
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('description')}
                        error={form.errors.description}
                        message={messages.description}
                      />
                    </div>
                  </RecordEditorSection>
                  {kind === 'policies' && (
                    <RecordEditorSection title={label('rules')}>
                      <div className={recordEditorGrid}>
                        <div className={recordEditorField}>
                          <Label htmlFor="policy-type">{label('type')}</Label>
                          <NativeSelect
                            {...form.bind('policyType')}
                            id="policy-type"
                            aria-required="true"
                            className="w-full"
                            value={draft.policyType}
                            onChange={(event) => changePolicyType(event.target.value as PolicyType)}
                          >
                            {types.map((type) => (
                              <option key={type} value={type}>
                                {label(type)}
                              </option>
                            ))}
                          </NativeSelect>
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId('policyType')}
                            error={form.errors.policyType}
                            message={messages.policyType}
                          />
                        </div>
                        <div className={recordEditorField}>
                          <Label htmlFor="policy-priority">{label('priority')}</Label>
                          <Input
                            {...form.bind('priority')}
                            id="policy-priority"
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            min={-1000}
                            max={1000}
                            step={1}
                            required
                            aria-required="true"
                            aria-describedby={
                              form.errors.priority
                                ? `${form.errorId('priority')} policy-priority-help`
                                : 'policy-priority-help'
                            }
                            value={draft.priority}
                            onChange={(event) =>
                              form.field('priority')[1](event.target.value as Draft['priority'])
                            }
                          />
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId('priority')}
                            error={form.errors.priority}
                            message={messages.priority}
                          />
                          <p id="policy-priority-help" className="text-xs text-muted-foreground">
                            {label('priorityHelp')}
                          </p>
                        </div>
                      </div>
                      {draft.policyType === 'response_style' ? (
                        <div className={recordEditorGrid}>
                          <div className={recordEditorField}>
                            <Label htmlFor="policy-tone">{label('tone')}</Label>
                            <Input
                              {...form.bind('tone')}
                              id="policy-tone"
                              dir="auto"
                              placeholder={copy('toneExample')}
                              required
                              aria-required="true"
                              maxLength={200}
                              value={draft.tone}
                              onChange={(event) =>
                                form.field('tone')[1](event.target.value as Draft['tone'])
                              }
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={form.errorId('tone')}
                              error={form.errors.tone}
                              message={messages.tone}
                            />
                          </div>
                          <div className={recordEditorField}>
                            <Label htmlFor="policy-language">{label('language')}</Label>
                            <Input
                              {...form.bind('language')}
                              id="policy-language"
                              dir="auto"
                              maxLength={50}
                              value={draft.language}
                              onChange={(event) =>
                                form.field('language')[1](event.target.value as Draft['language'])
                              }
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={form.errorId('language')}
                              error={form.errors.language}
                              message={messages.language}
                            />
                          </div>
                          <div className={recordEditorField}>
                            <Label htmlFor="policy-length">{label('maxLength')}</Label>
                            <Input
                              {...form.bind('maxLength')}
                              id="policy-length"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={100000}
                              step={1}
                              value={draft.maxLength}
                              onChange={(event) =>
                                form.field('maxLength')[1](event.target.value as Draft['maxLength'])
                              }
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={form.errorId('maxLength')}
                              error={form.errors.maxLength}
                              message={messages.maxLength}
                            />
                          </div>
                          <div className="self-center">
                            <label className="flex min-h-8 cursor-pointer items-center gap-2 font-medium">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                {...form.bind('requireSources')}
                                checked={draft.requireSources}
                                onChange={(event) =>
                                  form.field('requireSources')[1](event.target.checked)
                                }
                              />
                              {label('requireSources')}
                            </label>
                            {form.errors.requireSources && (
                              <CatalogueFieldFeedback
                                compact
                                id={form.errorId('requireSources')}
                                error={form.errors.requireSources}
                                message={messages.requireSources}
                              />
                            )}
                          </div>
                        </div>
                      ) : draft.policyType === 'output_format' ? (
                        <div className={recordEditorField}>
                          <Label htmlFor="policy-format">{label('format')}</Label>
                          <NativeSelect
                            {...form.bind('format')}
                            id="policy-format"
                            aria-required="true"
                            className="w-full"
                            value={draft.format}
                            onChange={(event) =>
                              form.field('format')[1](event.target.value as Draft['format'])
                            }
                          >
                            <option value="plain_text">{label('plain_text')}</option>
                            <option value="json_object">{label('json_object')}</option>
                          </NativeSelect>
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId('format')}
                            error={form.errors.format}
                            message={messages.format}
                          />
                        </div>
                      ) : draft.policyType === 'rate_limit' ? (
                        <div className={recordEditorGrid}>
                          <div className={recordEditorField}>
                            <Label htmlFor="policy-max-requests">{label('maxRequests')}</Label>
                            <Input
                              {...form.bind('maxRequests')}
                              id="policy-max-requests"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={100}
                              step={1}
                              required
                              aria-required="true"
                              value={draft.maxRequests}
                              onChange={(event) =>
                                form.field('maxRequests')[1](
                                  event.target.value as Draft['maxRequests']
                                )
                              }
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={form.errorId('maxRequests')}
                              error={form.errors.maxRequests}
                              message={messages.maxRequests}
                            />
                          </div>
                          <div className={recordEditorField}>
                            <Label htmlFor="policy-window-seconds">{label('windowSeconds')}</Label>
                            <Input
                              {...form.bind('windowSeconds')}
                              id="policy-window-seconds"
                              type="text"
                              inputMode="numeric"
                              dir="ltr"
                              min={1}
                              max={3600}
                              step={1}
                              required
                              aria-required="true"
                              value={draft.windowSeconds}
                              onChange={(event) =>
                                form.field('windowSeconds')[1](
                                  event.target.value as Draft['windowSeconds']
                                )
                              }
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={form.errorId('windowSeconds')}
                              error={form.errors.windowSeconds}
                              message={messages.windowSeconds}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className={recordEditorField}>
                          <FormField
                            control={form.form.control}
                            name="items"
                            render={({ field }) => (
                              <RecordListField
                                key={draft.policyType}
                                id="policy-items"
                                label={label(draft.policyType)}
                                value={field.value}
                                focusRef={field.ref}
                                onBlur={form.bind('items').onBlur}
                                onChange={form.field('items')[1]}
                                limit={200}
                                rowHelp={copy('policyRowsHelp')}
                                bulkHelp={label('itemsHelp')}
                                descriptionId={
                                  form.errors.items ? form.errorId('items') : undefined
                                }
                                invalid={!!form.errors.items}
                              />
                            )}
                          />
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId('items')}
                            error={form.errors.items}
                            message={messages.items}
                          />
                        </div>
                      )}
                      <label className="flex min-h-8 cursor-pointer items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          {...form.bind('enabled')}
                          checked={draft.enabled}
                          onChange={(event) => form.field('enabled')[1](event.target.checked)}
                        />
                        {label('enabled')}
                      </label>
                      {form.errors.enabled && (
                        <CatalogueFieldFeedback
                          compact
                          id={form.errorId('enabled')}
                          error={form.errors.enabled}
                          message={messages.enabled}
                        />
                      )}
                    </RecordEditorSection>
                  )}
                  <RecordEditorActions
                    secondary={
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={resetDisabled}
                        onClick={resetDraft}
                      >
                        {copy('reset')}
                      </Button>
                    }
                  >
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uncertain}
                      onClick={() => {
                        setDraft(null);
                        if (workspace && workspace.view !== 'list') {
                          if (recordId) workspace.showRecord(recordId);
                          else workspace.showList();
                        }
                      }}
                    >
                      {label('cancel')}
                    </Button>
                    <CatalogueSaveButton
                      label={label('save')}
                      pending={form.pending}
                      disabled={disabled || changed || uncertain}
                    />
                  </RecordEditorActions>
                </fieldset>
              </form>
            )}
            {isList && (
              <ListPage.Content
                loading={list.loading}
                error={list.error}
                empty={!rows.length}
                retainContent={rows.length > 0}
                loadingView={<LoadingStatus>{label('loading')}</LoadingStatus>}
                errorView={
                  <div role="alert">
                    <p>{label('error')}</p>
                    <Button onClick={list.retry}>{label('retry')}</Button>
                  </div>
                }
                emptyView={<p>{label('empty')}</p>}
              >
                <CatalogueRecordTable
                  rows={rows}
                  locale={locale}
                  caption={label(kind)}
                  nameLabel={label('name')}
                  detailsLabel={copy('tableDetails')}
                  actionsLabel={copy('tableActions')}
                  {...(workspace && {
                    renderTitle: (row: Entry) => (
                      <Link
                        {...linkTo(row.id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{row.title}</bdi>
                      </Link>
                    ),
                  })}
                  renderDetails={(row) => (
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {kind === 'policy-groups' && (
                        <p className="text-sm text-muted-foreground">
                          {label('members')}:{' '}
                          {row.memberCount === undefined ? '—' : numbers.number(row.memberCount)}
                        </p>
                      )}
                      {row.policyType && (
                        <div className="mt-2 flex flex-wrap gap-2 text-sm">
                          <span className="rounded-full bg-muted px-2 py-1">
                            {label(row.policyType)}
                          </span>
                          <span className="px-2 py-1">
                            {row.enabled === undefined
                              ? label('unavailable')
                              : label(row.enabled ? 'enabled' : 'disabled')}
                          </span>
                          <span className="px-2 py-1">
                            {label('priority')}:{' '}
                            <bdi>
                              {row.priority === undefined ? '—' : numbers.number(row.priority)}
                            </bdi>
                          </span>
                        </div>
                      )}
                      {kind === 'policies' && !row.policyType && <p>{label('unavailable')}</p>}
                    </div>
                  )}
                  renderActions={(row) => (
                    <>
                      {workspace && !action && !pending && !disabled && !form.pending ? (
                        <>
                          {kind === 'policy-groups' && (
                            <Link
                              {...linkTo(row.id)}
                              className={actionClass}
                              aria-label={`${label('open')} ${row.title}`}
                              data-table-action-tooltip={label('open')}
                            >
                              <TableActionIcon icon={TableEyeIcon}>{label('open')}</TableActionIcon>
                            </Link>
                          )}
                          <Link
                            {...linkTo(row.id, 'edit')}
                            className={actionClass}
                            aria-label={`${label('edit')} ${row.title}`}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Link>
                        </>
                      ) : (
                        <>
                          {kind === 'policy-groups' && (
                            <Button
                              variant="outline"
                              aria-label={`${label('open')} ${row.title}`}
                              disabled={disabled || form.pending || !!action || pending}
                              onClick={() => open(row.id)}
                              data-table-action-tooltip={label('open')}
                            >
                              <TableActionIcon icon={TableEyeIcon}>{label('open')}</TableActionIcon>
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            aria-label={`${label('edit')} ${row.title}`}
                            disabled={disabled || form.pending || !!action || pending}
                            onClick={() => edit(row)}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        aria-label={`${label('delete')} ${row.title}`}
                        disabled={disabled || form.pending || !!action || pending}
                        onClick={() =>
                          propose(
                            `/api/admin/${kind}/${row.id}`,
                            'DELETE',
                            label('delete'),
                            `${row.title}. ${label('confirmDelete')}`
                          )
                        }
                        data-table-action-tooltip={label('delete')}
                      >
                        <TableActionIcon icon={TableTrash2Icon}>{label('delete')}</TableActionIcon>
                      </Button>
                    </>
                  )}
                />
              </ListPage.Content>
            )}
            {workspace?.view === 'detail' && kind === 'policies' && detail && (
              <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  {detail.policyType && <Badge variant="outline">{label(detail.policyType)}</Badge>}
                  {detail.enabled !== undefined && (
                    <Badge variant="secondary">
                      {label(detail.enabled ? 'enabled' : 'disabled')}
                    </Badge>
                  )}
                </div>
                {detail.description && (
                  <p
                    dir="auto"
                    className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-muted-foreground"
                  >
                    {detail.description}
                  </p>
                )}
                {time.notice}
                <dl className="grid gap-4 border-y py-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{label('priority')}</dt>
                    <dd>{detail.priority === undefined ? '—' : numbers.number(detail.priority)}</dd>
                  </div>
                  {detail.updatedAt && (
                    <div>
                      <dt className="text-muted-foreground">{label('lastChanged')}</dt>
                      <dd>
                        <time dateTime={detail.updatedAt}>{time.format(detail.updatedAt)}</time>
                      </dd>
                    </div>
                  )}
                  {ruleFacts.map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-muted-foreground">{label(key)}</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        <bdi>
                          {typeof value === 'number'
                            ? numbers.number(value)
                            : key === 'format' &&
                                (value === 'plain_text' || value === 'json_object')
                              ? label(value)
                              : String(value)}
                        </bdi>
                      </dd>
                    </div>
                  ))}
                  {(ruleList.length > 0 || detail.rules?.requireSources === true) && (
                    <div className="sm:col-span-2">
                      <dt className="font-medium">{label('rules')}</dt>
                      <dd>
                        {ruleList.length > 0 && (
                          <ul className="list-inside list-disc [overflow-wrap:anywhere]">
                            {ruleList.map((rule, index) => (
                              <li key={`${index}:${rule}`} dir="auto">
                                {rule}
                              </li>
                            ))}
                          </ul>
                        )}
                        {detail.rules?.requireSources === true && <p>{label('requireSources')}</p>}
                      </dd>
                    </div>
                  )}
                </dl>
                <section className="space-y-2 text-sm">
                  <h2 className="font-semibold">{label('whereUsed')}</h2>
                  {detail.groups?.length ? (
                    <ul className="space-y-1">
                      {detail.groups.map((group) => (
                        <li key={group.id}>
                          <Link
                            to="/admin/policies/groups/$recordId/{-$action}"
                            params={{ recordId: group.id, action: undefined }}
                            className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
                          >
                            <bdi>{group.title}</bdi>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">{label('noGroups')}</p>
                  )}
                </section>
                {recordActions(detail)}
              </section>
            )}
            {selected &&
              kind === 'policy-groups' &&
              (!workspace || (workspace.view === 'detail' && detail)) && (
                <section
                  className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6"
                  aria-label={label('members')}
                >
                  <h2 className="break-words text-xl font-semibold">
                    {workspace ? label('members') : rows.find((row) => row.id === selected)?.title}
                  </h2>
                  {workspace && detail && recordActions(detail)}
                  {operationRecovery}
                  <CatalogueRelationEditor
                    key={selected}
                    mode="policy"
                    locale={locale}
                    id="policy-member"
                    value={member}
                    priority={memberPriority}
                    basis={memberIdsBasis(members)}
                    epoch={generation.current}
                    options={policies.filter(
                      (policy) => !members.some((item) => item.id === policy.id)
                    )}
                    disabled={
                      memberDisabled || !!action || pending || form.pending || operationUncertain
                    }
                    labels={{
                      member: label('selectPolicy'),
                      priority: label('priorityOverride'),
                      inherit: '',
                      save: label('link'),
                      unavailable: label('unavailable'),
                    }}
                    onChange={(id, priority) => {
                      setMember(id);
                      setMemberPriority(priority);
                    }}
                    onSubmit={(value, owner) =>
                      proposeMembership(
                        {
                          groupId: selected,
                          memberId: value.memberId,
                          expected: value.priorityOverride.trim()
                            ? policyPriority(value.priorityOverride)
                            : null,
                          choicesRequired: true,
                          owner,
                        },
                        'POST',
                        {
                          policyId: value.memberId,
                          ...(value.priorityOverride.trim()
                            ? { priorityOverride: policyPriority(value.priorityOverride) }
                            : {}),
                        }
                      )
                    }
                  />
                  <section
                    className={recordEditorSurface}
                    aria-labelledby="policy-group-members-title"
                  >
                    <h3
                      id="policy-group-members-title"
                      className="border-b bg-muted/30 px-4 py-3 text-base font-semibold"
                    >
                      {copy('groupMembers')}
                    </h3>
                    {members.length ? (
                      <ul className="divide-y">
                        {members.map((item) => (
                          <li
                            key={item.id}
                            className="grid min-w-0 items-start gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                          >
                            <div className="flex min-w-0 flex-col gap-1">
                              {workspace ? (
                                <Link
                                  to="/admin/policies/$recordId/{-$action}"
                                  params={{ recordId: item.id, action: undefined }}
                                  className="min-w-0 break-words text-primary underline-offset-4 hover:underline"
                                >
                                  <bdi>{item.title}</bdi>
                                </Link>
                              ) : (
                                <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                                  {item.title}
                                </span>
                              )}
                              <p className="text-xs text-muted-foreground">
                                {copy('currentPriority')}{' '}
                                <bdi className="font-medium">
                                  {priorityText(item.priorityOverride, item.priority)}
                                </bdi>
                              </p>
                            </div>
                            <CatalogueRelationEditor
                              mode="priority"
                              locale={locale}
                              id={`member-priority-${item.id}`}
                              value={item.id}
                              priority={memberPriorities[item.id] ?? ''}
                              priorityName={`${label('priorityOverride')} · ${item.title}`}
                              savedPriority={override(item)}
                              basis={priorityBasis(item)}
                              epoch={generation.current}
                              disabled={
                                detailDisabled ||
                                !!action ||
                                pending ||
                                form.pending ||
                                operationUncertain
                              }
                              labels={{
                                member: '',
                                priority: label('priorityOverride'),
                                inherit: copy('inheritPriorityHint'),
                                save: label('updatePriority'),
                                unavailable: label('unavailable'),
                              }}
                              onChange={(_, priority) =>
                                setMemberPriorities((previous) => ({
                                  ...previous,
                                  [item.id]: priority,
                                }))
                              }
                              onSubmit={(value, owner) =>
                                proposeMembership(
                                  {
                                    groupId: selected,
                                    memberId: item.id,
                                    expected: value.priorityOverride.trim()
                                      ? policyPriority(value.priorityOverride)
                                      : null,
                                    choicesRequired: false,
                                    owner,
                                  },
                                  'POST',
                                  {
                                    policyId: item.id,
                                    priorityOverride: value.priorityOverride.trim()
                                      ? policyPriority(value.priorityOverride)
                                      : null,
                                  }
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              className="justify-self-start lg:self-center"
                              disabled={detailDisabled || !!action || pending || operationUncertain}
                              aria-label={`${label('unlink')} ${item.title}`}
                              onClick={() =>
                                proposeMembership(
                                  {
                                    groupId: selected,
                                    memberId: item.id,
                                    expected: 'absent',
                                    choicesRequired: false,
                                  },
                                  'DELETE'
                                )
                              }
                            >
                              {label('unlink')}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-4 py-3 text-sm text-muted-foreground">
                        {copy('emptyMembers')}
                      </p>
                    )}
                  </section>
                </section>
              )}
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            operationUncertain ||
            commandDisabled(action.path, action.body) ||
            (!!formCapture.current && (changed || uncertain))
          }
          onPendingChange={onPendingChange}
          onDenied={scope.deny}
          onValidationError={(fields) =>
            operationCapture.current?.owner?.fields(fields) ??
            (formCapture.current ? ownedFields(fields) : false)
          }
          onUnconfirmed={unconfirmed}
          summary={
            operationCapture.current ? (
              <>
                <CatalogueMembershipReview
                  command={operationCapture.current}
                  locale={locale}
                  refresh={
                    actionReadIssue
                      ? undefined
                      : {
                          label: label('refresh'),
                          disabled: pending || list.loading || choices.loading,
                          onClick: refresh,
                        }
                  }
                />
                {actionReadIssue && recovery}
              </>
            ) : (
              recovery
            )
          }
          onClose={() => {
            generation.current++;
            setAction(null);
            onPendingChange(false);
          }}
          onSuccess={((command, version) => async (value: unknown) => {
            if (actionRef.current !== command) return;
            const operation = operationCapture.current;
            if (operation) {
              const response = await confirmationRead(
                `/api/admin/policy-groups/${operation.groupId}`
              );
              if (actionRef.current !== command) return;
              if (response.status === 401 || response.status === 403) {
                scope.deny();
                return;
              }
              if (response.status !== 200) throw new Error('Unconfirmed group membership');
              const fresh: unknown = response.value;
              if (actionRef.current !== command) return;
              if (!validateDetail(fresh) || !fresh.members || !matchesMembership(fresh, operation))
                throw new Error('Unconfirmed group membership');
              if (!selectedRead.accept(fresh)) throw new Error('Obsolete group membership');
              operation.owner?.verified(
                operation.choicesRequired
                  ? memberIdsBasis(fresh.members)
                  : operation.expected === 'absent'
                    ? ''
                    : priorityBasis(fresh.members.find((row) => row.id === operation.memberId)!)
              );
              operationCapture.current = null;
              setAction(null);
              onPendingChange(false);
              setNotice(true);
              list.retry();
              choices.retry();
              return;
            }
            const captured = formCapture.current;
            if (version !== generation.current && !captured) return;
            if (captured && !matchesAiCatalogueReceipt(value, captured.body, captured.id))
              throw new Error('Unconfirmed catalogue settings');
            if (command.body && typeof command.body === 'object' && 'title' in command.body) {
              setDraft(null);
              draftBasis.current = null;
              if (workspace && workspace.view !== 'list' && validEntries([value])) {
                toast.success(label('saved'));
                workspace.showRecord((value as Entry).id, true);
                return;
              }
            }
            if (command.path.endsWith('/members')) {
              setMember('');
              setMemberPriority('');
            }
            if (command.method === 'DELETE' && command.path === `/api/admin/${kind}/${selected}`) {
              clearSelection();
              if (workspace && workspace.view !== 'list') {
                toast.success(label('saved'));
                workspace.showList(true);
                return;
              }
            }
            setNotice(true);
            list.retry();
            choices.retry();
            selectedRead.retry();
          })(action, commandGeneration.current)}
        />
      )}
    </div>
  );
}
