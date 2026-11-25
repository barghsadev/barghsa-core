import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import { Link } from '@tanstack/react-router';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { ContractCancellationPanel } from './ContractCancellationPanel.js';
import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import {
  contractBase,
  type ContractDetailData,
  type ContractSignatureData,
  type ContractVersion,
} from '../lib/contracts.js';
import {
  validContractDetail,
  validContractSnapshot,
  validContractVersionPage,
  type ContractVersionPage,
} from '../lib/contract-detail-records.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractActivationPanel } from './ContractActivationPanel.js';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { CompactFieldFeedback } from './CompactFieldFeedback.js';
import {
  RecordEditorActions,
  RecordEditorDisclosure,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import { ContractTerms } from './ContractTerms.js';
import { ContractStatusTimeline } from './ContractStatusTimeline.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import {
  contractAttachmentActions,
  contractAttachmentTitle,
  contractVersionPosition,
} from '../lib/contract-attachments.js';
import { WorkflowStatusBanner } from './WorkflowStatusBanner.js';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';
import { t } from '@barghsa/i18n/workspace';
import { t as increaseText } from '@barghsa/i18n/electricity-increase-customer';
import { customerContractNextAction } from '../lib/contract-guidance.js';

import { Form, FormControl, FormField, FormItem, FormLabel, useZodForm } from '@barghsa/ui/form';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  contractFormRejection,
  matchedChangesReceipt,
  type ContractFormCoordination,
  type ContractSigningSource,
} from '../lib/contract-review-signature-form.js';

function ContractIncreaseEntry(props: {
  contractId: string;
  versionId: string;
  profileId: string;
  orderId: string;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    props.profileId,
    JSON.stringify([props.contractId, props.versionId])
  );
  const [available, setAvailable] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAvailable(false);
    setFailed(false);
    void readContract<{ canRequest: unknown; request: unknown }>(
      `/api/electricity/contracts/${encodeURIComponent(props.contractId)}/increase`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (typeof value.canRequest !== 'boolean' || !Object.hasOwn(value, 'request'))
          throw new Error('Invalid increase eligibility');
        if (!controller.signal.aborted) setAvailable(value.canRequest && value.request === null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [props.contractId, props.versionId, props.profileId, retry, readContract]);
  if (failed)
    return (
      <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
        {increaseText('electricity.increase.retry', locale)}
      </Button>
    );
  return available ? (
    <Link
      to="/electricity/orders/$orderId/increases/new"
      params={{ orderId: props.orderId }}
      className={buttonVariants({ variant: 'outline' })}
    >
      {increaseText('electricity.increaseForm.openRequest', locale)}
    </Link>
  ) : null;
}

type DetailProps = {
  id: string;
  staff: boolean;
  onClose?: () => void;
  onChanged?: () => void;
  recordPage?: boolean;
  initialVersionId?: string | undefined;
  requestChangesVersionId?: string;
  acceptanceVersionId?: string;
  signingOperation?: 'request' | 'record';
  staffRecordSearch?: Record<string, unknown>;
  customerRecordSearch?: Record<string, unknown>;
  coordination?: ContractFormCoordination;
  refreshRevision?: number;
  onWithdrawal?: () => void;
};
export function ContractDetail(props: DetailProps) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return (
    <ContractDetailContent
      key={JSON.stringify([
        props.id,
        props.staff,
        props.initialVersionId,
        props.requestChangesVersionId,
        props.acceptanceVersionId,
        props.signingOperation,
        actor,
        revision,
      ])}
      {...props}
    />
  );
}

interface ChangeCommand {
  action: TeamAction & {
    body: { expectedVersionId: string; idempotencyKey: string; reason: string };
  };
  source: ContractSigningSource;
  actor: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
type LifecycleKind = 'accept' | 'submit' | 'publish' | 'amendment-publish';
type LifecycleCommand = {
  kind: LifecycleKind;
  action: TeamAction;
  source: ContractSigningSource;
  waiting: boolean;
  retryReview?: { hash: string; idempotencyKey: string };
};

function lifecycleEligible(kind: LifecycleKind, { contract, version }: ContractSigningSource) {
  const current = contract.currentVersionId ?? contract.currentVersion?.id ?? contract.version?.id;
  if (kind === 'amendment-publish')
    return (
      contract.amendmentSupported === true &&
      contract.pendingAmendment?.state === 'Draft' &&
      contract.pendingAmendment.versionId === version.id &&
      contract.pendingAmendment.baseVersionId === current
    );
  if (kind === 'accept')
    return (
      contract.canAccept === true &&
      (contract.amendment?.state === 'AwaitingCustomerAcceptance'
        ? contract.version?.id === version.id && contract.amendment.baseVersionId === current
        : current === version.id && contract.state === 'AwaitingCustomerAcceptance')
    );
  return (
    current === version.id &&
    contract.state === (kind === 'submit' ? 'Draft' : 'AwaitingStaffReview')
  );
}

function lifecycleReceipt(value: unknown, { kind, source }: LifecycleCommand) {
  const result = value as Partial<ContractDetailData> | null;
  const { contract, version } = source;
  if (
    !result ||
    result.id !== contract.id ||
    result.profileId !== contract.profileId ||
    result.serviceType !== contract.serviceType
  )
    return false;
  if (kind === 'accept') {
    const acceptedAt = result.version?.acceptedAt;
    return (
      result.version?.id === version.id &&
      result.canAccept === false &&
      typeof acceptedAt === 'string' &&
      Number.isFinite(Date.parse(acceptedAt)) &&
      (contract.amendment?.state === 'AwaitingCustomerAcceptance'
        ? result.amendment?.baseVersionId === contract.amendment.baseVersionId &&
          ['AwaitingSignature', 'Applied'].includes(result.amendment.state)
        : result.state === 'Accepted')
    );
  }
  if (kind === 'amendment-publish')
    return (
      result.state === contract.state &&
      result.pendingAmendment?.versionId === version.id &&
      result.pendingAmendment.baseVersionId === contract.pendingAmendment?.baseVersionId &&
      result.pendingAmendment.state === 'AwaitingCustomerAcceptance'
    );
  return (
    result.currentVersionId === version.id &&
    result.currentVersion?.id === version.id &&
    result.state === (kind === 'submit' ? 'AwaitingStaffReview' : 'AwaitingCustomerAcceptance')
  );
}
function ContractDetailContent({
  id,
  staff,
  onClose,
  onChanged,
  recordPage,
  initialVersionId,
  requestChangesVersionId,
  acceptanceVersionId,
  signingOperation,
  staffRecordSearch,
  customerRecordSearch,
  coordination,
  refreshRevision,
  onWithdrawal,
}: DetailProps) {
  const actor = useAccountUser();
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<{
    contract: ContractDetailData;
    version: ContractVersion;
  } | null>(null);
  const [signatureStatus, setSignatureStatus] = useState<ContractSignatureData | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(initialVersionId ?? null);
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([id, staff, selectedVersion])
  );
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const focusedAction = requestChangesVersionId || acceptanceVersionId || signingOperation;
  const [decisionRecorded, setDecisionRecorded] = useState(false);
  const copy = (key: string) => tContractReviewSignature(key, locale);
  const epoch = useRef(0),
    readEpoch = useRef(0),
    parentOwner = useRef<object>({}),
    owner = useRef<object | null>(null);
  const [locked, setLocked] = useState(false),
    [preparing, setPreparing] = useState(false),
    preparingRef = useRef(false);
  const command = useRef<ChangeCommand | null>(null),
    [uncertain, setUncertain] = useState(false);
  const lifecycle = useRef<LifecycleCommand | null>(null);
  const [needsLifecycleRead, setNeedsLifecycleRead] = useState(false);
  const [checkingLifecycle, setCheckingLifecycle] = useState(false);
  const source = useRef<ContractSigningSource | null>(null);
  source.current = data;
  const alive = useRef(true);
  const callbacks = useRef({ coordination, onChanged, onWithdrawal });
  callbacks.current = { coordination, onChanged, onWithdrawal };
  const reasonForm = useZodForm<{ reason: string }>(
    async () => {
      const token = epoch.current;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && token === epoch.current
        ? schema.contractChangesSchema(copy('reasonInvalid'))
        : schema.inactiveChangesSchema;
    },
    { defaultValues: { reason: '' }, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const reasonFields = useActionFieldErrors(
    reasonForm,
    { reason: copy('reasonInvalid') },
    word('error')
  );
  function blocked() {
    return (
      !alive.current ||
      !!owner.current ||
      !!lifecycle.current?.waiting ||
      preparingRef.current ||
      reasonForm.isSubmissionPending() ||
      !!callbacks.current.coordination?.blocked()
    );
  }
  const shared = useMemo<ContractFormCoordination>(
    () => ({
      blocked: () => blocked(),
      revision: () => readEpoch.current,
      acquire: (claim) => {
        if (blocked()) return false;
        if (callbacks.current.coordination && !callbacks.current.coordination.acquire(claim))
          return false;
        owner.current = claim;
        setLocked(true);
        ++readEpoch.current;
        active.current?.abort();
        setLoadingMore(false);
        return true;
      },
      release: (claim) => {
        if (owner.current === claim) {
          owner.current = null;
          setLocked(false);
          callbacks.current.coordination?.release(claim);
        }
      },
    }),
    []
  );
  function withdraw() {
    if (!alive.current) return;
    ++epoch.current;
    ++readEpoch.current;
    active.current?.abort();
    if (owner.current) shared.release(owner.current);
    command.current = null;
    lifecycle.current = null;
    setNeedsLifecycleRead(false);
    setCheckingLifecycle(false);
    preparingRef.current = false;
    setPreparing(false);
    setAction(null);
    setUncertain(false);
    source.current = null;
    setData(null);
    setSignatureStatus(null);
    setVersions([]);
    setNext(null);
    reasonForm.reset({ reason: '' });
    setAcknowledged(false);
    setError(true);
    callbacks.current.onWithdrawal?.();
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++epoch.current;
      ++readEpoch.current;
      active.current?.abort();
      if (owner.current) shared.release(owner.current);
    };
  }, []);
  const [action, setAction] = useState<TeamAction | null>(null);
  const currentAction = useRef(action);
  currentAction.current = action;
  const renderedCommand = command.current;
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (owner.current || preparingRef.current) return;
    active.current = controller;
    const read = ++readEpoch.current;
    const fresh = () =>
      alive.current && !controller.signal.aborted && read === readEpoch.current && !owner.current;
    source.current = null;
    setData(null);
    setSignatureStatus(null);
    setVersions([]);
    setNext(null);
    setError(false);
    setHistoryError(false);
    setLoadingMore(false);
    setAcknowledged(false);
    setAction(null);

    const base = `${contractBase(staff)}/${encodeURIComponent(id)}`;
    const contractRead = readContract<ContractDetailData>(base, { signal: controller.signal });
    const readSelected = (versionId: string) =>
      readContract<ContractVersion | ContractDetailData>(
        `${base}/versions/${encodeURIComponent(versionId)}`,
        { signal: controller.signal }
      );
    void Promise.all([
      contractRead,
      focusedAction
        ? Promise.resolve(null)
        : readContract<ContractVersionPage>(`${base}/versions`, { signal: controller.signal }),
      selectedVersion
        ? signingOperation
          ? contractRead.then((contract) => {
              const defaultVersion = staff ? contract.currentVersion : contract.version;
              return defaultVersion?.id === selectedVersion ? null : readSelected(selectedVersion);
            })
          : readSelected(selectedVersion)
        : Promise.resolve(null),
    ])
      .then(([contract, page, chosen]) => {
        if (!fresh()) return;
        if (
          !validContractDetail(contract, id) ||
          (!focusedAction && (!page || !validContractVersionPage(page, id)))
        )
          throw new Error('Invalid contract detail');
        const current = staff ? contract.currentVersion : contract.version;
        if (!validContractSnapshot(current, id, staff ? contract.currentVersionId : undefined))
          throw new Error('Invalid current contract snapshot');
        const customerSelection = !staff ? (chosen as ContractDetailData | null) : null;
        if (
          customerSelection &&
          (!validContractDetail(customerSelection, id) ||
            customerSelection.profileId !== contract.profileId)
        )
          throw new Error('Mismatched selected contract');
        const version = customerSelection
          ? customerSelection.version
          : ((chosen as ContractVersion | null) ?? current);
        if (!validContractSnapshot(version, id, selectedVersion ?? undefined))
          throw new Error('Invalid selected contract snapshot');
        const pending = lifecycle.current;
        if (pending?.waiting) {
          if (contract.id !== id || contract.profileId !== pending.source.contract.profileId)
            throw new Error('Mismatched contract recovery read');
          if (
            version.id === pending.source.version.id &&
            lifecycleEligible(pending.kind, { contract, version })
          ) {
            pending.waiting = false;
          } else {
            if (acceptanceVersionId && lifecycleReceipt(contract, pending))
              setDecisionRecorded(true);
            lifecycle.current = null;
            callbacks.current.onChanged?.();
          }
          setNeedsLifecycleRead(false);
          setCheckingLifecycle(false);
        }
        setData({
          contract: chosen
            ? {
                ...contract,
                history:
                  (staff
                    ? (chosen as ContractVersion).history
                    : (chosen as ContractDetailData).history) ?? [],
                historyTruncated:
                  (staff
                    ? (chosen as ContractVersion).historyTruncated
                    : (chosen as ContractDetailData).historyTruncated) ?? false,
              }
            : contract,
          version,
        });
        setVersions(page?.versions ?? []);
        setNext(page?.nextBefore ?? null);
      })
      .catch((failure: unknown) => {
        if (!fresh()) return;
        setCheckingLifecycle(false);
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          withdraw();
        else setError(true);
      });
    return () => controller.abort();
  }, [id, staff, selectedVersion, focusedAction, reload, refreshRevision, readContract]);
  useEffect(() => {
    if (
      acceptanceVersionId &&
      !staff &&
      data?.version.id === acceptanceVersionId &&
      lifecycleEligible('accept', data) &&
      !decisionRecorded &&
      !needsLifecycleRead &&
      !action
    ) {
      choose('accept');
    }
  }, [acceptanceVersionId, staff, data, decisionRecorded, needsLifecycleRead, action]);
  useEffect(() => {
    reasonForm.reset({ reason: '' });
  }, [selectedVersion]);
  async function more() {
    const controller = active.current;
    if (blocked() || next === null || !controller || loadingMore) return;
    const read = readEpoch.current;
    const fresh = () =>
      alive.current && !controller.signal.aborted && read === readEpoch.current && !owner.current;
    setLoadingMore(true);
    setHistoryError(false);
    try {
      const page = await readContract<ContractVersionPage>(
        `${contractBase(staff)}/${encodeURIComponent(id)}/versions?before=${next}`,
        { signal: controller.signal }
      );
      if (fresh()) {
        if (!validContractVersionPage(page, id, next)) throw new Error('Invalid version history');
        setVersions((previous) => [
          ...previous,
          ...page.versions.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setNext(page.nextBefore);
      }
    } catch (failure) {
      if (fresh()) {
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          withdraw();
        else setHistoryError(true);
      }
    } finally {
      if (fresh()) setLoadingMore(false);
    }
  }
  function choose(kind: LifecycleKind) {
    if (
      !data ||
      blocked() ||
      !lifecycleEligible(kind, data) ||
      (!(kind === 'accept' && acceptanceVersionId) && !shared.acquire(parentOwner.current))
    )
      return;
    const previous = lifecycle.current;
    const same =
      previous?.kind === kind &&
      previous.source.contract.profileId === data.contract.profileId &&
      previous.source.version.id === data.version.id;
    const action: TeamAction = {
      title: word(kind),
      description: `${word(data.contract.serviceType)} · ${word('version')} ${data.version.versionNumber.toLocaleString(locale)}`,
      path:
        kind === 'amendment-publish'
          ? `${contractBase(staff)}/${id}/amendments/publish`
          : `${contractBase(staff)}/${id}/${kind}`,
      method: 'POST',
      body: {
        expectedVersionId: data.version.id,
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    };
    const next = same && kind !== 'accept' ? previous.action : action;
    lifecycle.current = {
      kind,
      action: next,
      source: data,
      waiting: false,
      ...(same && previous.retryReview ? { retryReview: previous.retryReview } : {}),
    };
    setAction(next);
  }
  function requireLifecycleRead(shown: TeamAction, attempted: TeamAction = shown) {
    const pending = lifecycle.current;
    if (!alive.current || pending?.action !== shown || currentAction.current !== shown) return;
    const body = attempted.body as { expectedReviewHash?: string; idempotencyKey: string };
    if (body.expectedReviewHash)
      pending.retryReview = { hash: body.expectedReviewHash, idempotencyKey: body.idempotencyKey };
    pending.waiting = true;
    setNeedsLifecycleRead(true);
    setAction(null);
    shared.release(parentOwner.current);
  }
  const currentCommand = (captured: ChangeCommand) =>
    alive.current && captured === command.current && captured.generation === epoch.current;
  function closeChanges(captured: ChangeCommand) {
    if (!currentCommand(captured)) return;
    setAction(null);
    if (captured.attempted && (!captured.rejected || captured.uncertain)) {
      captured.uncertain = true;
      setUncertain(true);
    } else {
      command.current = null;
      setUncertain(false);
      shared.release(parentOwner.current);
    }
  }
  function decorateChanges(captured: ChangeCommand): TeamAction {
    const mapped = (value: unknown) => {
      if (!currentCommand(captured)) return word('error');
      const rejection = contractFormRejection(value);
      if (rejection?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
        withdraw();
        return word('error');
      }
      if (rejection && !captured.uncertain) {
        captured.rejected = true;
        if (
          rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
          Array.isArray(rejection.fields) &&
          reasonFields(rejection.fields)
        )
          closeChanges(captured);
      }
      return word('error');
    };
    return {
      ...captured.action,
      errorMessages: Object.fromEntries(
        [
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          'VALIDATION:PARSE:ZOD_ERROR',
          ErrorCodes.CONFLICT_STATE.code,
          ErrorCodes.CONFLICT_VERSION.code,
          ErrorCodes.NOT_FOUND_RESOURCE.code,
        ].map((code) => [code, mapped])
      ),
    };
  }
  async function prepareChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const capturedSource = source.current;
    if (
      event.target !== event.currentTarget ||
      !actor ||
      !staff ||
      !capturedSource ||
      !lifecycleEligible('publish', capturedSource) ||
      (requestChangesVersionId && capturedSource.version.id !== requestChangesVersionId) ||
      blocked() ||
      !shared.acquire(parentOwner.current)
    )
      return;
    const token = epoch.current,
      raw = reasonForm.getValues('reason');
    preparingRef.current = true;
    setPreparing(true);
    try {
      await reasonForm.handleSubmit((values) => {
        if (
          !alive.current ||
          token !== epoch.current ||
          capturedSource !== source.current ||
          raw !== reasonForm.getValues('reason')
        )
          return;
        const captured: ChangeCommand = {
          action: {
            title: word('request-changes'),
            description: `${word(capturedSource.contract.serviceType)} · ${word('version')} ${capturedSource.version.versionNumber.toLocaleString(locale)}`,
            path: `${contractBase(staff)}/${id}/request-changes`,
            method: 'POST',
            responseDeadline: true,
            successStatus: 200,
            body: {
              expectedVersionId: capturedSource.version.id,
              idempotencyKey: crypto.randomUUID(),
              reason: values.reason.trim(),
            },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('denied'),
          },
          source: capturedSource,
          actor,
          generation: token,
          attempted: false,
          uncertain: false,
          rejected: false,
        };
        command.current = captured;
        setAction(decorateChanges(captured));
      })();
    } finally {
      if (alive.current && token === epoch.current) {
        preparingRef.current = false;
        setPreparing(false);
        if (!command.current) shared.release(parentOwner.current);
      }
    }
  }
  function selectVersion(value: string) {
    if (!blocked() && value !== selectedVersion && value !== data?.version.id) {
      ++epoch.current;
      setSelectedVersion(value);
      setData(null);
    }
  }
  function closeAction(shownAction: TeamAction, captured: ChangeCommand | null) {
    if (!alive.current || currentAction.current !== shownAction) return;
    if (captured) closeChanges(captured);
    else {
      setAction(null);
      shared.release(parentOwner.current);
    }
  }
  async function completed(
    result: unknown,
    shownAction: TeamAction,
    captured: ChangeCommand | null
  ) {
    if (
      !alive.current ||
      currentAction.current !== shownAction ||
      (captured && !currentCommand(captured))
    )
      return;
    if (captured) {
      if (!currentCommand(captured) || !matchedChangesReceipt(result, captured.source))
        throw new Error('contract receipt');
      command.current = null;
      reasonForm.reset({ reason: '' });
      setUncertain(false);
    } else {
      const pending = lifecycle.current;
      if (pending?.action !== shownAction || !lifecycleReceipt(result, pending))
        throw new Error('Contract lifecycle receipt mismatch');
      lifecycle.current = null;
    }
    setAction(null);
    shared.release(parentOwner.current);
    if (focusedAction) setDecisionRecorded(true);
    else setReload((value) => value + 1);
    callbacks.current.onChanged?.();
    return confirmationText('recorded', locale);
  }
  function blockSibling(event: SyntheticEvent) {
    if (blocked()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  const { isCurrent, isPendingAmendment } = data
    ? contractVersionPosition(data.contract, data.version.id, staff)
    : { isCurrent: false, isPendingAmendment: false };
  const documentsFocused = useRef(false);
  useEffect(() => {
    if (
      recordPage &&
      data &&
      !documentsFocused.current &&
      window.location.hash === '#contract-documents'
    ) {
      documentsFocused.current = true;
      document.getElementById('contract-documents')?.scrollIntoView({ block: 'start' });
    }
  }, [data, recordPage]);
  const pendingState = staff
    ? data?.contract.pendingAmendment?.state
    : data?.contract.amendment?.state;
  const canAcceptVersion =
    !staff &&
    data?.contract.canAccept &&
    (data.contract.amendment?.state === 'AwaitingCustomerAcceptance'
      ? isPendingAmendment
      : isCurrent);
  const pendingNotice =
    pendingState === 'AwaitingSignature'
      ? 'amendmentSignatureNotice'
      : staff
        ? 'amendmentPublishedNotice'
        : data?.contract.amendment?.signatureRequired
          ? 'amendmentAcceptForSignatureNotice'
          : 'amendmentAcceptNotice';
  const nextAction = data ? customerContractNextAction(data.contract, signatureStatus) : null;
  const commandLocked = locked || preparing || needsLifecycleRead;
  const recordSignatureInSummary = !staff && isCurrent && !data?.contract.canAccept;
  const customerOperation = data?.contract.canAccept
    ? 'accept'
    : recordSignatureInSummary && signatureStatus?.canRecord
      ? 'record-signature'
      : undefined;
  const customerDecisionEntry =
    recordPage && !staff && data?.contract.version && customerOperation ? (
      <Link
        to="/contracts/$contractId/$operation/$versionId"
        params={{
          contractId: id,
          operation: customerOperation,
          versionId: customerOperation === 'accept' ? data.contract.version.id : data.version.id,
        }}
        search={customerRecordSearch ?? {}}
        className={buttonVariants({ size: 'sm' })}
        aria-disabled={commandLocked || undefined}
        onClick={(event) => {
          if (blocked()) event.preventDefault();
        }}
      >
        {customerOperation === 'accept' ? copy('acceptHeading') : word('recordSignature')}
      </Link>
    ) : null;
  const recordHeading = useRef<HTMLHeadingElement>(null);
  const signingTitle = signingOperation
    ? word(signingOperation === 'request' ? 'prepareSignature' : 'recordSignature')
    : undefined;
  const signingReturnVersion =
    data && data.version.id !== (staff ? data.contract.currentVersion : data.contract.version)?.id
      ? data.version.id
      : undefined;
  useEffect(() => {
    if (recordPage) recordHeading.current?.focus({ preventScroll: true });
  }, [id, recordPage]);
  const correctionsForm = (
    <Form {...reasonForm}>
      <form
        data-testid="contract-request-changes-form"
        aria-label={word('request-changes')}
        noValidate
        onSubmit={(event) => void prepareChanges(event)}
        className={recordEditorSurface}
      >
        <div className="space-y-3 px-4 py-4 sm:px-6">
          {requestChangesVersionId && (
            <p className="text-sm text-muted-foreground">{copy('changeFormIntent')}</p>
          )}
          <FormField
            control={reasonForm.control}
            name="reason"
            render={({ field, fieldState }) => (
              <FormItem id="contract-change-reason">
                <FormLabel>{word('reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    dir="auto"
                    rows={requestChangesVersionId ? 3 : 2}
                    className="min-h-16 max-h-48 resize-y"
                    placeholder={copy('reasonPlaceholder')}
                    aria-required="true"
                    disabled={!!command.current}
                  />
                </FormControl>
                <CompactFieldFeedback
                  help={copy('reasonHelp')}
                  validationMessage={copy('reasonInvalid')}
                  invalid={fieldState.invalid}
                />
              </FormItem>
            )}
          />
          {reasonForm.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
        </div>
        <RecordEditorActions>
          <Button
            type="submit"
            variant={requestChangesVersionId ? 'default' : 'outline'}
            loading={preparing}
            disabled={locked || preparing}
          >
            {word('request-changes')}
          </Button>
        </RecordEditorActions>
      </form>
    </Form>
  );
  return (
    <section
      className={
        focusedAction
          ? 'min-w-0 space-y-3'
          : 'flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-5'
      }
      aria-label={
        signingTitle ??
        (acceptanceVersionId
          ? copy('acceptHeading')
          : word(requestChangesVersionId ? 'request-changes' : 'terms'))
      }
    >
      {recordPage && <RecordCommandGuard blocked={blocked} />}
      {focusedAction && (
        <Link
          {...(!staff
            ? {
                to: '/contracts/$contractId/{-$action}' as const,
                params: { contractId: id, action: undefined },
                search: {
                  ...customerRecordSearch,
                  ...(signingOperation && { versionId: signingReturnVersion }),
                },
              }
            : {
                to: '/admin/contracts/$contractId/{-$action}/{-$item}' as const,
                params: { contractId: id, action: undefined, item: undefined },
                search: {
                  ...staffRecordSearch,
                  ...(signingOperation && { versionId: signingReturnVersion }),
                },
              })}
          className="touch-action inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline aria-disabled:opacity-60"
          aria-disabled={commandLocked || undefined}
          onClick={(event) => {
            if (blocked()) event.preventDefault();
          }}
        >
          {word('backToContract')}
        </Link>
      )}
      <header className="flex items-start justify-between gap-3">
        {recordPage ? (
          <h1
            ref={recordHeading}
            tabIndex={-1}
            className={
              focusedAction
                ? 'w-fit rounded-sm text-2xl font-semibold'
                : 'min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-3xl'
            }
          >
            {signingTitle ??
              (acceptanceVersionId
                ? copy('acceptHeading')
                : requestChangesVersionId
                  ? word('request-changes')
                  : data
                    ? word('recordTitle').replace('{service}', word(data.contract.serviceType))
                    : word('terms'))}
          </h1>
        ) : (
          <h2 className="text-xl font-semibold">
            {data ? word(data.contract.serviceType) : word('terms')}
          </h2>
        )}
        {onClose && (
          <Button
            variant="ghost"
            disabled={commandLocked}
            onClick={() => {
              if (!blocked()) onClose();
            }}
          >
            {word('close')}
          </Button>
        )}
        {recordPage && data && !decisionRecorded && !signingOperation && (
          <Button
            variant="ghost"
            className="min-h-11 shrink-0"
            disabled={commandLocked}
            onClick={() => {
              if (!blocked()) setReload((value) => value + 1);
            }}
          >
            {word('refresh')}
          </Button>
        )}
      </header>
      {needsLifecycleRead && (
        <Alert variant="destructive">
          <AlertDescription>{confirmationText('unconfirmed', locale)}</AlertDescription>
          <Button
            variant="outline"
            disabled={checkingLifecycle}
            onClick={() => {
              if (!lifecycle.current?.waiting || owner.current) return;
              setCheckingLifecycle(true);
              setData(null);
              setReload((value) => value + 1);
            }}
          >
            {confirmationText('checkStatus', locale)}
          </Button>
        </Alert>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button
            variant="outline"
            disabled={locked || preparing}
            onClick={() => {
              if (!blocked()) setReload((value) => value + 1);
            }}
          >
            {word('refresh')}
          </Button>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : signingOperation ? (
        isCurrent || isPendingAmendment ? (
          <>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {word(data.contract.contractNumber ? 'contractNumber' : 'contractReference')}
                </dt>
                <dd className="wrap-anywhere font-semibold">
                  <bdi dir="ltr">{data.contract.contractNumber ?? id}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{word('version')}</dt>
                <dd className="font-medium">{data.version.versionNumber.toLocaleString(locale)}</dd>
              </div>
            </dl>
            <ContractSignaturePanel
              id={id}
              versionId={data.version.id}
              profileId={data.contract.profileId}
              staff={staff}
              source={data}
              coordination={shared}
              navigation={{
                operation: signingOperation,
                search: (staff ? staffRecordSearch : customerRecordSearch) ?? {},
              }}
              onDenied={withdraw}
              onChanged={() => onChanged?.()}
            />
          </>
        ) : (
          <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
            {copy('signatureActionUnavailable')}
          </p>
        )
      ) : focusedAction ? (
        decisionRecorded ? (
          <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm font-medium">
            {copy(acceptanceVersionId ? 'acceptanceRecorded' : 'changeRecorded')}
          </p>
        ) : acceptanceVersionId ? (
          !staff && data.version.id === acceptanceVersionId && lifecycleEligible('accept', data) ? (
            <p className="text-sm text-muted-foreground">
              {word(isPendingAmendment ? pendingNotice : 'acceptNotice')}
            </p>
          ) : (
            <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
              {copy('acceptanceUnavailable')}
            </p>
          )
        ) : staff &&
          data.version.id === requestChangesVersionId &&
          lifecycleEligible('publish', data) ? (
          <>
            <div className="rounded-xl border bg-card text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 sm:px-6">
                <dl className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">
                      {word(data.contract.contractNumber ? 'contractNumber' : 'contractReference')}
                    </dt>
                    <dd className="wrap-anywhere font-semibold">
                      <bdi dir="ltr">{data.contract.contractNumber ?? data.contract.id}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{word('version')}</dt>
                    <dd className="font-medium">
                      {data.version.versionNumber.toLocaleString(locale)}
                    </dd>
                  </div>
                </dl>
                <StatusBadge label={word(data.contract.state)} />
              </div>
              <RecordEditorDisclosure label={word('terms')}>
                <ContractTerms value={data.version.content} />
              </RecordEditorDisclosure>
            </div>
            {correctionsForm}
          </>
        ) : (
          <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
            {copy('changeUnavailable')}
          </p>
        )
      ) : (
        <>
          {time.notice}
          {!staff && isCurrent ? (
            <WorkflowStatusBanner
              locale={locale}
              submittedAt={
                signatureStatus?.request?.requestedAt || data.contract.submittedAt
                  ? `${workflowFeedback('submitted', locale)}: ${time.format(signatureStatus?.request?.requestedAt ?? data.contract.submittedAt!)}`
                  : undefined
              }
              status={word(data.contract.state)}
              happened={
                signatureStatus?.signature
                  ? word('signatureRecorded')
                  : signatureStatus?.request
                    ? `${word('signatureRequest')} ${signatureStatus.request.requestNumber.toLocaleString(locale)}`
                    : data.version.changeDescription
              }
              nextAction={
                nextAction!.key.startsWith('workflow.')
                  ? t(nextAction!.key, locale)
                  : word(nextAction!.key)
              }
              owner={nextAction!.owner}
              actionHref={nextAction!.href}
              actionLink={customerDecisionEntry}
            />
          ) : (
            <StatusBadge label={word(data.contract.state)} />
          )}
          <p className="text-sm text-muted-foreground">
            {word(data.contract.contractNumber ? 'contractNumber' : 'contractReference')}:{' '}
            <bdi dir="ltr" className="[overflow-wrap:anywhere]">
              {data.contract.contractNumber ?? data.contract.id}
            </bdi>
          </p>
          {staff && recordPage && isCurrent && data.contract.state === 'AwaitingStaffReview' && (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/25 px-4 py-3">
              <p className="max-w-md text-sm text-muted-foreground">{copy('publishHelp')}</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/admin/contracts/$contractId/{-$action}/{-$item}"
                  params={{ contractId: id, action: 'request-changes', item: data.version.id }}
                  search={staffRecordSearch ?? {}}
                  className={buttonVariants({ variant: 'outline' })}
                  aria-disabled={commandLocked || undefined}
                  onClick={(event) => {
                    if (blocked()) event.preventDefault();
                  }}
                >
                  {word('request-changes')}
                </Link>
                <Button disabled={commandLocked} onClick={() => choose('publish')}>
                  {word('publish')}
                </Button>
              </div>
            </div>
          )}
          {recordPage && (data.contract.serviceStartsAt || data.contract.serviceEndsAt) && (
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              {data.contract.serviceStartsAt && (
                <div>
                  <dt className="text-muted-foreground">{word('serviceStartsAt')}</dt>
                  <dd>
                    <time dateTime={data.contract.serviceStartsAt}>
                      {time.format(data.contract.serviceStartsAt)}
                    </time>
                  </dd>
                </div>
              )}
              {data.contract.serviceEndsAt && (
                <div>
                  <dt className="text-muted-foreground">{word('serviceEndsAt')}</dt>
                  <dd>
                    <time dateTime={data.contract.serviceEndsAt}>
                      {time.format(data.contract.serviceEndsAt)}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {data.contract.serviceType === 'electricity' && data.contract.linkedOrderStatus ? (
            <p className="text-sm text-muted-foreground">
              {word('linkedOrderStatus')}:{' '}
              {t(`electricity.order.status.${data.contract.linkedOrderStatus}`, locale)}
            </p>
          ) : null}
          {data.contract.acceptedParty && isCurrent ? (
            <div className="rounded-lg border p-3 text-sm">
              <h3 className="font-semibold">{word('acceptedParty')}</h3>
              <p>
                {data.contract.acceptedParty.name || word('draftUnnamedProfile')} ·{' '}
                {word(
                  data.contract.acceptedParty.profileType === 'LEGAL'
                    ? 'draftLegal'
                    : 'draftIndividual'
                )}
              </p>
              {data.contract.acceptedParty.identifier ? (
                <p>
                  {word(
                    data.contract.acceptedParty.profileType === 'LEGAL'
                      ? 'legalIdentifier'
                      : 'nationalIdentifier'
                  )}
                  : <bdi dir="ltr">{data.contract.acceptedParty.identifier}</bdi>
                </p>
              ) : null}
              {data.contract.acceptedParty.registrationNumber ? (
                <p>
                  {word('registrationNumber')}:{' '}
                  <bdi dir="ltr">{data.contract.acceptedParty.registrationNumber}</bdi>
                </p>
              ) : null}
            </div>
          ) : null}
          {staff && data.contract.pendingAmendment ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <div>
                <p className="font-medium">{word('amendmentPending')}</p>
                <p className="text-sm text-muted-foreground">
                  {word(
                    data.contract.pendingAmendment.state === 'Draft'
                      ? 'amendmentDraftNotice'
                      : data.contract.pendingAmendment.state === 'AwaitingSignature'
                        ? 'amendmentSigningNotice'
                        : 'amendmentPublishedNotice'
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={locked || preparing}
                onClick={() => selectVersion(data.contract.pendingAmendment!.versionId)}
              >
                {word('amendmentReview')}
              </Button>
            </div>
          ) : null}
          {!staff &&
          ['AwaitingCustomerAcceptance', 'AwaitingSignature'].includes(
            data.contract.amendment?.state ?? ''
          ) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <div>
                <p className="font-medium">
                  {word(
                    data.contract.amendment?.state === 'AwaitingSignature'
                      ? 'amendmentAwaitingSignature'
                      : 'amendmentAwaitingAcceptance'
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{word('amendmentEffectiveNotice')}</p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  selectVersion(
                    isPendingAmendment
                      ? data.contract.amendment!.baseVersionId
                      : data.contract.version!.id
                  )
                }
              >
                {word(isPendingAmendment ? 'amendmentViewEffective' : 'amendmentReview')}
              </Button>
            </div>
          ) : null}
          {!staff && data.contract.serviceType === 'electricity' && data.contract.orderId ? (
            <Link
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              to="/electricity/orders/$orderId"
              params={{ orderId: data.contract.orderId }}
              className="touch-action self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedOrder')}
            </Link>
          ) : null}
          {!staff &&
          isCurrent &&
          data.contract.state === 'Active' &&
          data.contract.serviceType === 'electricity' &&
          data.contract.orderId ? (
            <fieldset
              disabled={blocked()}
              onClickCapture={blockSibling}
              onSubmitCapture={blockSibling}
              className="contents"
            >
              <ContractIncreaseEntry
                key={JSON.stringify([data.contract.id, data.version.id, data.contract.profileId])}
                contractId={data.contract.id}
                versionId={data.version.id}
                profileId={data.contract.profileId}
                orderId={data.contract.orderId}
              />
            </fieldset>
          ) : null}
          {staff && data.contract.serviceType === 'electricity' && data.contract.orderId ? (
            <a
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              href={`/admin/electricity-orders/${encodeURIComponent(data.contract.orderId)}`}
              className="touch-action self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedOrder')}
            </a>
          ) : null}
          {!staff && data.contract.serviceType === 'savings' && data.contract.savingOrderId ? (
            <Link
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              to="/savings/orders/$orderId"
              params={{ orderId: data.contract.savingOrderId }}
              className="touch-action self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedSavingOrder')}
            </Link>
          ) : null}
          <div>
            <h3 className="font-semibold">
              {word('version')} {data.version.versionNumber.toLocaleString(locale)}
              {isCurrent ? ` · ${word('current')}` : ''}
              {isPendingAmendment ? ` · ${word('amendmentPending')}` : ''}
            </h3>
            <p className="text-sm text-muted-foreground">{data.version.changeDescription}</p>
            <p className="text-sm">{time.format(data.version.createdAt)}</p>
            {data.version.publishedAt ? (
              <p className="text-sm">
                {word('publishedAt')}: {time.format(data.version.publishedAt)}
              </p>
            ) : null}
            {staff && data.version.createdBy ? (
              <p className="text-sm">
                {word('changedBy')}: {data.version.createdBy}
              </p>
            ) : null}
          </div>
          <ContractTerms value={data.version.content} />
          {staff && isCurrent && ['Draft', 'ChangesRequested'].includes(data.contract.state) ? (
            staffRecordSearch ? (
              <Link
                to="/admin/contracts/$contractId/{-$action}/{-$item}"
                params={{ contractId: id, action: 'edit', item: undefined }}
                search={staffRecordSearch}
                className="touch-action text-sm font-medium text-primary underline"
                aria-disabled={commandLocked || undefined}
                onClick={(event) => {
                  if (blocked()) event.preventDefault();
                }}
              >
                {word('draftEdit')}
              </Link>
            ) : (
              <ContractDraftEditor
                key={data.version.id}
                existing={data}
                coordination={shared}
                onDenied={withdraw}
                onSaved={() => {
                  if (blocked()) return;
                  setSelectedVersion(null);
                  setReload((value) => value + 1);
                  onChanged?.();
                }}
              />
            )
          ) : null}
          {staff &&
          isCurrent &&
          data.contract.amendmentSupported &&
          !data.contract.pendingAmendment &&
          ['Accepted', 'Signed', 'Active'].includes(data.contract.state) ? (
            staffRecordSearch ? (
              <Link
                to="/admin/contracts/$contractId/{-$action}/{-$item}"
                params={{ contractId: id, action: 'amendments', item: 'new' }}
                search={staffRecordSearch}
                className="touch-action text-sm font-medium text-primary underline"
                aria-disabled={commandLocked || undefined}
                onClick={(event) => {
                  if (blocked()) event.preventDefault();
                }}
              >
                {word('amendmentCreate')}
              </Link>
            ) : (
              <ContractDraftEditor
                key={'amendment:' + data.version.id}
                existing={data}
                coordination={shared}
                onDenied={withdraw}
                amendment
                onSaved={() => {
                  if (blocked()) return;
                  setReload((value) => value + 1);
                  onChanged?.();
                }}
              />
            )
          ) : null}
          {data.version.acceptedAt ? (
            <p role="status">
              {word('acceptedAt')}: {time.format(data.version.acceptedAt)}
            </p>
          ) : null}
          {canAcceptVersion && !recordPage ? (
            <form
              id="contract-accept"
              className={`${recordEditorSurface} scroll-mt-28`}
              onSubmit={(event) => {
                event.preventDefault();
                if (acknowledged && !commandLocked) choose('accept');
              }}
            >
              <div className="space-y-3 px-4 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{copy('acceptHeading')}</h3>
                  <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
                    {word('version')} {data.version.versionNumber.toLocaleString(locale)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {word(isPendingAmendment ? pendingNotice : 'acceptNotice')}
                </p>
                <label className="touch-label flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    aria-required="true"
                    disabled={commandLocked}
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  {word('acceptAcknowledgement')}
                </label>
              </div>
              <RecordEditorActions>
                <Button type="submit" disabled={!acknowledged || commandLocked}>
                  {word('accept')}
                </Button>
              </RecordEditorActions>
            </form>
          ) : isPendingAmendment ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{word(pendingNotice)}</p>
              {customerOperation === 'accept' && customerDecisionEntry}
            </div>
          ) : null}
          {staff && isCurrent && data.contract.state === 'Draft' ? (
            <Button
              className="self-start"
              disabled={commandLocked}
              onClick={() => choose('submit')}
            >
              {word('submit')}
            </Button>
          ) : null}
          {staff && !recordPage && isCurrent && data.contract.state === 'AwaitingStaffReview' ? (
            <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {correctionsForm}
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3.5 sm:px-6 xl:flex-col xl:items-start">
                <p className="text-sm text-muted-foreground">{copy('publishHelp')}</p>
                <Button disabled={commandLocked} onClick={() => choose('publish')}>
                  {word('publish')}
                </Button>
              </div>
            </div>
          ) : null}
          {staff &&
          isPendingAmendment &&
          data.contract.pendingAmendment?.state === 'Draft' &&
          data.contract.amendmentSupported ? (
            <Button
              className="self-start"
              disabled={commandLocked}
              onClick={() => choose('amendment-publish')}
            >
              {word('amendment-publish')}
            </Button>
          ) : null}
          <ContractStatusTimeline
            history={data.contract.history ?? []}
            truncated={data.contract.historyTruncated ?? false}
            locale={locale}
            formatTimestamp={time.format}
          />
          <h3 className="font-semibold">{word('versions')}</h3>
          <ol className="flex flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border p-3">
                <Button
                  variant="link"
                  disabled={locked || preparing}
                  onClick={() => selectVersion(version.id)}
                  aria-pressed={version.id === data.version.id}
                >
                  {word('version')} {version.versionNumber.toLocaleString(locale)}
                </Button>
                <p>{version.changeDescription}</p>
                <p className="text-sm text-muted-foreground">
                  {time.format(version.createdAt)}
                  {staff && version.createdBy
                    ? ` · ${word('changedBy')}: ${version.createdBy}`
                    : ''}
                </p>
                {version.publishedAt ? (
                  <p className="text-sm text-muted-foreground">
                    {word('publishedAt')}: {time.format(version.publishedAt)}
                  </p>
                ) : null}
                {version.acceptedAt ? (
                  <p className="text-sm text-muted-foreground">
                    {word('acceptedAt')}: {time.format(version.acceptedAt)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {historyError ? <p role="alert">{word('error')}</p> : null}
          {next !== null ? (
            <Button
              variant="outline"
              disabled={loadingMore || locked || preparing}
              onClick={() => void more()}
            >
              {word('next')}
            </Button>
          ) : null}
          <fieldset
            disabled={locked || preparing}
            onClickCapture={blockSibling}
            onSubmitCapture={blockSibling}
            className="contents"
          >
            {isCurrent ? (
              <ContractCancellationPanel
                key={'cancellation:' + id + ':' + reload}
                id={id}
                versionId={data.version.id}
                staff={staff}
                {...(recordPage
                  ? {
                      renderAction: (view, label, disabled) =>
                        staff ? (
                          <Link
                            to="/admin/contracts/$contractId/{-$action}/{-$item}"
                            params={{
                              contractId: id,
                              action: view.action,
                              item: 'requestId' in view ? view.requestId : undefined,
                            }}
                            search={staffRecordSearch ?? {}}
                            disabled={disabled || blocked()}
                            className={buttonVariants({
                              variant: view.action === 'reject' ? 'destructive' : 'outline',
                            })}
                          >
                            {label}
                          </Link>
                        ) : (
                          <Link
                            to="/contracts/$contractId/{-$action}"
                            params={{ contractId: id, action: 'cancel' }}
                            search={customerRecordSearch ?? {}}
                            disabled={disabled || blocked()}
                            className={buttonVariants({
                              variant: 'outline',
                              className: 'self-start',
                            })}
                          >
                            {label}
                          </Link>
                        ),
                    }
                  : {})}
                onChanged={() => {
                  if (blocked()) return;
                  setReload((value) => value + 1);
                  onChanged?.();
                }}
              />
            ) : null}
          </fieldset>
          {!isPendingAmendment ? (
            <ContractActivationPanel
              key={'activation:' + data.version.id}
              refreshRevision={reload + (refreshRevision ?? 0)}
              source={data.contract}
              coordination={shared}
              onDenied={withdraw}
              id={id}
              versionId={data.version.id}
              staff={staff}
              editableVersion={staff && isCurrent ? data.version : undefined}
              staffRecordSearch={staffRecordSearch}
            />
          ) : null}
          {!isPendingAmendment || pendingState === 'AwaitingSignature' ? (
            <ContractSignaturePanel
              key={'signature:' + data.version.id}
              id={id}
              versionId={data.version.id}
              profileId={data.contract.profileId}
              staff={staff}
              source={data}
              coordination={shared}
              onDenied={withdraw}
              onStatus={setSignatureStatus}
              {...(recordPage && {
                navigation: {
                  search: (staff ? staffRecordSearch : customerRecordSearch) ?? {},
                  recordInSummary: recordSignatureInSummary,
                },
              })}
              onChanged={() => {
                if (blocked()) return;
                setReload((value) => value + 1);
                onChanged?.();
              }}
            />
          ) : null}
          <ContractDocuments
            key={data.version.id + ':' + reload}
            contract={data.contract}
            version={data.version}
            staff={staff}
            search={(staff ? staffRecordSearch : customerRecordSearch) ?? {}}
            coordination={shared}
            blocked={locked || preparing}
          />
        </>
      )}
      {uncertain && (
        <Alert variant="destructive">
          <AlertDescription>{copy('uncertain')}</AlertDescription>
        </Alert>
      )}
      {uncertain && (
        <Button
          data-testid="contract-review-retry"
          variant="outline"
          disabled={!!action}
          onClick={() => {
            const captured = command.current;
            if (captured && currentCommand(captured)) setAction(decorateChanges(captured));
          }}
        >
          {copy('retryCaptured')}
        </Button>
      )}
      {action && action.path.endsWith('/accept') && data ? (
        <ContractFinancialReviewDialog
          action={action}
          profileId={data.contract.profileId}
          contractId={id}
          time={time}
          {...(acceptanceVersionId && {
            inlineAcceptance: true,
            onPendingChange: (pending: boolean) => {
              if (pending) shared.acquire(parentOwner.current);
              else shared.release(parentOwner.current);
            },
          })}
          {...(lifecycle.current?.retryReview
            ? { retryReview: lifecycle.current.retryReview }
            : {})}
          onClose={() => closeAction(action, renderedCommand)}
          onDenied={withdraw}
          onUnconfirmed={(attempted) => requireLifecycleRead(action, attempted)}
          onSuccess={(result) => completed(result, action, renderedCommand)}
        />
      ) : action ? (
        <TeamActionDialog
          action={action}
          summary={
            renderedCommand && (
              <div className="space-y-2 rounded-lg border bg-muted/25 px-3 py-3">
                <p className="text-sm font-medium">{word('reason')}</p>
                <p className="text-sm whitespace-pre-wrap wrap-anywhere">
                  {renderedCommand.action.body.reason}
                </p>
                <p className="text-sm text-muted-foreground">{copy('changeReviewHelp')}</p>
              </div>
            )
          }
          onDenied={() => {
            if (
              alive.current &&
              currentAction.current === action &&
              (!renderedCommand || currentCommand(renderedCommand))
            )
              withdraw();
          }}
          onCommandDispatch={(dispatched) => {
            if (renderedCommand && currentCommand(renderedCommand))
              renderedCommand.attempted = dispatched || renderedCommand.uncertain;
          }}
          onUnconfirmed={() => {
            if (renderedCommand && currentCommand(renderedCommand)) {
              renderedCommand.uncertain = true;
              setUncertain(true);
              setAction(null);
            } else requireLifecycleRead(action);
          }}
          onClose={() => closeAction(action, renderedCommand)}
          onSuccess={(result) => completed(result, action, renderedCommand)}
        />
      ) : null}
    </section>
  );
}
function ContractDocuments({
  contract,
  version,
  staff,
  search,
  coordination,
  blocked,
}: {
  contract: ContractDetailData;
  version: ContractVersion;
  staff: boolean;
  search: Record<string, unknown>;
  coordination: ContractFormCoordination;
  blocked: boolean;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(false);
  const [generated, setGenerated] = useState<'scanning' | 'created' | null>(null);
  const generationOwner = useRef<object>({});
  useEffect(() => () => coordination.release(generationOwner.current), [coordination]);
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'contract',
      state: '',
      category: '',
      query: '',
      profileId: contract.profileId,
      businessRecordId: contract.id,
      contractVersionId: version.id,
    }),
    [contract.profileId, contract.id, version.id]
  );
  const { uploads, canGenerate } = contractAttachmentActions(contract, version, staff);
  const { isCurrent, isPendingAmendment } = contractVersionPosition(contract, version.id, staff);
  async function generatePdf() {
    if (
      coordination.blocked() ||
      generating ||
      generated ||
      !coordination.acquire(generationOwner.current)
    )
      return;
    setGenerating(true);
    setGenerationError(false);
    try {
      const result = await documentRequest(
        `${contractBase(true)}/${encodeURIComponent(contract.id)}/versions/${encodeURIComponent(version.id)}/generate-pdf`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey: version.id }) }
      );
      const state =
        result && typeof result === 'object' && 'state' in result ? result.state : undefined;
      if (
        typeof state !== 'string' ||
        !['PendingScan', 'Available', 'SubmittedForReview', 'Approved'].includes(state)
      )
        throw new Error('Unexpected generated document state');
      setGenerated(state === 'PendingScan' ? 'scanning' : 'created');
      setReload((value) => value + 1);
    } catch {
      setGenerationError(true);
    } finally {
      setGenerating(false);
      coordination.release(generationOwner.current);
    }
  }
  function blockDocumentList(event: SyntheticEvent) {
    if (coordination.blocked()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  return (
    <section
      id="contract-documents"
      className="flex scroll-mt-28 flex-col gap-4"
      aria-label={word('documents')}
    >
      <fieldset disabled={blocked && !generating} className="contents">
        <h3 className="font-semibold">{word('documents')}</h3>
        <p className="text-sm text-muted-foreground">{word('copyNotice')}</p>
        {staff ? (
          <p className="text-sm text-muted-foreground">{word('replaceOriginalHint')}</p>
        ) : null}
        {canGenerate ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={generating || Boolean(generated) || blocked}
              onClick={() => void generatePdf()}
            >
              {word(generating ? 'generatingContractPdf' : 'generateContractPdf')}
            </Button>
            {generated ? (
              <p role="status" className="text-sm">
                {word(generated === 'scanning' ? 'contractPdfScanning' : 'contractPdfSubmitted')}
              </p>
            ) : null}
            {generationError ? (
              <p role="alert" className="text-sm text-destructive">
                {word('contractPdfError')}
              </p>
            ) : null}
          </div>
        ) : null}
        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uploads.map((role) => {
              const label = word(contractAttachmentTitle[role]);
              const preventBlockedNavigation = (event: SyntheticEvent) => {
                if (coordination.blocked()) event.preventDefault();
              };
              if (blocked)
                return (
                  <Button key={role} variant="outline" disabled>
                    {label}
                  </Button>
                );
              return staff ? (
                <Link
                  key={role}
                  to="/admin/contracts/$contractId/{-$action}/{-$item}"
                  params={{ contractId: contract.id, action: `upload-${role}`, item: version.id }}
                  search={{ ...search, versionId: undefined }}
                  className={buttonVariants({ variant: 'outline' })}
                  onClick={preventBlockedNavigation}
                >
                  {label}
                </Link>
              ) : (
                <Link
                  key={role}
                  to="/contracts/$contractId/$operation/$versionId"
                  params={{
                    contractId: contract.id,
                    operation: 'upload-signed',
                    versionId: version.id,
                  }}
                  search={{ ...search, versionId: undefined }}
                  className={buttonVariants({ variant: 'outline' })}
                  onClick={preventBlockedNavigation}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        )}
        <fieldset
          disabled={blocked}
          onClickCapture={blockDocumentList}
          onSubmitCapture={blockDocumentList}
          className="contents"
        >
          <DocumentResults
            key={reload}
            staff={staff}
            filters={filters}
            profileId={contract.profileId}
            relatedLinks={{
              context: { kind: 'contract', id: contract.id, versionId: version.id, staff, search },
              allowChanges: isCurrent || isPendingAmendment,
              allowUpload: false,
              disabled: blocked,
              blocked: () => coordination.blocked(),
            }}
          />
        </fieldset>
      </fieldset>
    </section>
  );
}
